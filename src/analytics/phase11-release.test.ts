/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  ALL_CAPABILITY_CODES,
  CAPABILITY_GROUPS,
  SYSTEM_ROLE_DEFINITIONS,
  deriveCapabilitiesFromUser,
  deriveLegacyPermissionsFromCapabilities,
  getDefaultCapabilitiesForRole,
  userHasCapability,
} from '../lib/rbac-capabilities';
import {
  TRAINING_TOUR_STEPS,
  calculateTourCompletionPercent,
  computeOnboardingChecklistStatus,
  createInitialTourProgress,
  getUserTourStorageKey,
  isTourStepAccessibleForUser,
  markTourCompleted,
  markTourStepVisited,
} from '../lib/training-tour';
import {
  DEFAULT_COMPANY_ID,
  PRACTICE_COMPANY_ID,
  authenticateAccount,
  createCompanyAndInitialOwner,
  hashPasswordScrypt,
  readPracticeSandboxState,
  releasePlatformRouter,
  resetPracticeSandboxState,
  verifyPasswordScrypt,
  writePracticeSandboxState,
} from '../server/release-onboarding.service';

async function invokeAppRequest(
  app: express.Express,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: any;
  }
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}${options.path}`, {
          method: options.method,
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        server.close(() => resolve({ status: res.status, body: json }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

describe('PHASE 11 — Initial Release, Company Onboarding, Practice Mode & Granular RBAC Suite', () => {
  it('1. Scrypt Password Hashing: salts, hashes, and verifies passwords without plaintext storage', () => {
    const plain = 'StrongOwnerPass#2026';
    const hash1 = hashPasswordScrypt(plain);
    const hash2 = hashPasswordScrypt(plain);

    assert.equal(hash1.hash.length, 128, '64-byte scrypt key must be 128 hex characters');
    assert.equal(hash1.salt.length, 32, '16-byte random salt must be 32 hex characters');
    assert.notEqual(hash1.hash, hash2.hash, 'Random 16-byte salt must produce distinct hashes');
    assert.equal(
      verifyPasswordScrypt(plain, hash1.hash, hash1.salt),
      true,
      'Correct password must verify'
    );
    assert.equal(
      verifyPasswordScrypt('WrongPassword123', hash1.hash, hash1.salt),
      false,
      'Wrong password must fail'
    );
  });

  it('2. Granular RBAC Catalog: defines 9 system roles and 50 capabilities across 11 groups', () => {
    assert.equal(CAPABILITY_GROUPS.length, 11, 'Must have 11 capability groups');
    assert.equal(ALL_CAPABILITY_CODES.length, 50, 'Must have 50 granular capabilities');
    assert.equal(SYSTEM_ROLE_DEFINITIONS.length, 9, 'Must have 9 system roles');

    const ownerCaps = getDefaultCapabilitiesForRole('COMPANY_OWNER');
    assert.equal(ownerCaps.length, 50, 'COMPANY_OWNER must hold all 50 capabilities');

    const cashierCaps = getDefaultCapabilitiesForRole('CASHIER');
    assert.ok(cashierCaps.includes('sales.create'), 'CASHIER must have sales.create');
    assert.equal(
      cashierCaps.includes('permissions.manage'),
      false,
      'CASHIER must not have permissions.manage'
    );
    assert.equal(
      cashierCaps.includes('company.edit'),
      false,
      'CASHIER must not have company.edit'
    );
  });

  it('3. Company Onboarding & Initial Owner Creation: creates isolated company, main branch, and owner with idempotency', async () => {
    const uniqueSuffix = Date.now().toString(36);
    const idemKey = `test-onboard-${uniqueSuffix}`;

    const res1 = await createCompanyAndInitialOwner({
      idempotencyKey: idemKey,
      legalName: `Blue Nile Retail Group ${uniqueSuffix}`,
      displayName: `Blue Nile Retail ${uniqueSuffix}`,
      displayNameAr: 'مجموعة النيل الأزرق للتجزئة',
      businessType: 'Supermarket & Grocery',
      country: 'Sudan',
      city: 'Khartoum',
      baseCurrency: 'SDG',
      secondaryCurrencies: ['USD', 'SAR'],
      branchName: 'Khartoum East Main Branch',
      branchCode: 'BN-MAIN',
      ownerName: 'Khalid Al-Bashir',
      ownerUsername: `khalid.owner.${uniqueSuffix}`,
      ownerEmail: `khalid.${uniqueSuffix}@bluenile.sd`,
      ownerPassword: 'OwnerSecurePassword99',
      ownerConfirmPassword: 'OwnerSecurePassword99',
      ownerPin: '7788',
    });

    assert.equal(res1.ok, true, 'Company onboarding should succeed');
    assert.ok(res1.company?.id.startsWith('comp-'), 'Must generate unique company ID');
    assert.equal(res1.company?.baseCurrency, 'SDG', 'Base currency must default to SDG');
    assert.equal(res1.branch?.companyId, res1.company?.id, 'Main branch must belong to new company');
    assert.equal(res1.owner?.companyId, res1.company?.id, 'Initial owner must belong to new company');
    assert.equal(res1.owner?.systemRole, 'COMPANY_OWNER', 'Initial user must be COMPANY_OWNER');
    assert.equal(
      res1.owner?.capabilities?.length,
      ALL_CAPABILITY_CODES.length,
      'Initial owner must have all capabilities'
    );

    // Duplicate submission with same idempotencyKey must replay without creating a duplicate company
    const res2 = await createCompanyAndInitialOwner({
      idempotencyKey: idemKey,
      legalName: `Blue Nile Retail Group ${uniqueSuffix}`,
      ownerName: 'Khalid Al-Bashir',
      ownerUsername: `khalid.owner.${uniqueSuffix}`,
      ownerPassword: 'OwnerSecurePassword99',
      ownerConfirmPassword: 'OwnerSecurePassword99',
    });

    assert.equal(res2.ok, true);
    assert.equal(res2.idempotentReplay, true, 'Repeated submission must be flagged as idempotentReplay');
    assert.equal(res2.company?.id, res1.company?.id, 'Must return identical company ID');
  });

  it('4. Practice Mode Isolation: modifies and resets Practice Mode sandbox without touching production companies', () => {
    const initialPractice = readPracticeSandboxState();
    assert.equal(initialPractice.companyId, PRACTICE_COMPANY_ID);

    // Mutate Practice Mode sandbox
    writePracticeSandboxState({
      ...initialPractice,
      transactions: [
        {
          id: 'prac-tx-test-999',
          grandTotal: 125000,
          status: 'completed',
        },
      ],
    });
    const modifiedPractice = readPracticeSandboxState();
    assert.equal(modifiedPractice.transactions.length, 1);

    // Reset Practice Mode sandbox
    const resetPractice = resetPracticeSandboxState();
    assert.equal(resetPractice.companyId, PRACTICE_COMPANY_ID);
    assert.ok(
      !resetPractice.transactions.some((t: any) => t.id === 'prac-tx-test-999'),
      'Practice Mode reset must wipe temporary practice transactions'
    );
    assert.ok(resetPractice.products.length > 0, 'Practice Mode reset must restore demo products');
  });

  it('5. Multi-Company & Branch Isolation + Last Owner Protection + Deactivation via API', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', releasePlatformRouter);

    const suffix = Date.now().toString(36);
    // Create Company A
    const createARes = await invokeAppRequest(app, {
      method: 'POST',
      path: '/api/onboarding/companies',
      body: {
        idempotencyKey: `comp-a-${suffix}`,
        legalName: `Company Alpha ${suffix}`,
        ownerName: 'Alpha Owner',
        ownerUsername: `alpha.owner.${suffix}`,
        ownerPassword: 'AlphaPassword123',
        ownerConfirmPassword: 'AlphaPassword123',
      },
    });
    assert.equal(createARes.status, 201);
    const companyA = createARes.body.data.company;
    const ownerA = createARes.body.data.owner;

    // Create Company B
    const createBRes = await invokeAppRequest(app, {
      method: 'POST',
      path: '/api/onboarding/companies',
      body: {
        idempotencyKey: `comp-b-${suffix}`,
        legalName: `Company Beta ${suffix}`,
        ownerName: 'Beta Owner',
        ownerUsername: `beta.owner.${suffix}`,
        ownerPassword: 'BetaPassword123',
        ownerConfirmPassword: 'BetaPassword123',
      },
    });
    assert.equal(createBRes.status, 201);
    const companyB = createBRes.body.data.company;
    const ownerB = createBRes.body.data.owner;

    // Cross-Company Isolation: Owner A cannot list or create users in Company B
    const crossReadRes = await invokeAppRequest(app, {
      method: 'GET',
      path: `/api/users?companyId=${companyB.id}`,
      headers: {
        'x-user-id': ownerA.id,
        'x-company-id': companyB.id,
      },
    });
    assert.equal(
      crossReadRes.status,
      403,
      'Owner of Company A must receive 403 when querying Company B users'
    );
    assert.equal(crossReadRes.body.code, 'FORBIDDEN_CROSS_COMPANY_ACCESS');

    // Cross-Company Isolation: Owner A cannot update Company B profile
    const crossCompanyEditRes = await invokeAppRequest(app, {
      method: 'PUT',
      path: `/api/companies/${companyB.id}`,
      headers: {
        'x-user-id': ownerA.id,
      },
      body: {
        displayName: 'Hacked Name',
      },
    });
    assert.equal(crossCompanyEditRes.status, 403);

    // Last Active Owner Protection: Owner A cannot deactivate themselves when they are the sole owner of Company A
    const deactivateSoleOwnerRes = await invokeAppRequest(app, {
      method: 'POST',
      path: `/api/users/${ownerA.id}/deactivate`,
      headers: {
        'x-user-id': ownerA.id,
        'x-company-id': companyA.id,
      },
      body: { reason: 'Testing self deactivation' },
    });
    assert.equal(
      deactivateSoleOwnerRes.status,
      400,
      'Deactivating the sole active Company Owner must be blocked with 400'
    );
    assert.equal(deactivateSoleOwnerRes.body.code, 'LAST_OWNER_PROTECTION');

    // Owner A creates an Employee (Cashier) in Company A
    const createCashierRes = await invokeAppRequest(app, {
      method: 'POST',
      path: '/api/users',
      headers: {
        'x-user-id': ownerA.id,
        'x-company-id': companyA.id,
      },
      body: {
        companyId: companyA.id,
        name: 'Salma Cashier',
        username: `salma.cashier.${suffix}`,
        password: 'SalmaPassword123',
        pin: '4321',
        systemRole: 'CASHIER',
      },
    });
    assert.equal(createCashierRes.status, 201);
    const cashierA = createCashierRes.body.data.user;
    assert.equal(cashierA.companyId, companyA.id);
    assert.equal(cashierA.systemRole, 'CASHIER');

    // Granular RBAC Route Enforcement: Cashier A cannot create another user (lacks users.create)
    const cashierCreateUserRes = await invokeAppRequest(app, {
      method: 'POST',
      path: '/api/users',
      headers: {
        'x-user-id': cashierA.id,
        'x-company-id': companyA.id,
      },
      body: {
        companyId: companyA.id,
        name: 'Unauthorized Staff',
        systemRole: 'ADMIN',
      },
    });
    assert.equal(
      cashierCreateUserRes.status,
      403,
      'Cashier must receive 403 when attempting to create a user'
    );
    assert.equal(cashierCreateUserRes.body.code, 'FORBIDDEN_MISSING_CAPABILITY');

    // Authenticate Cashier A with password
    const loginSuccess = authenticateAccount({
      companyId: companyA.id,
      identifier: `salma.cashier.${suffix}`,
      passwordOrPin: 'SalmaPassword123',
    });
    assert.equal(loginSuccess.ok, true, 'Cashier should authenticate with valid password');
    assert.ok(loginSuccess.sessionToken, 'Must issue session token');

    // Owner A deactivates Cashier A -> Cashier A can no longer log in
    const deactivateCashierRes = await invokeAppRequest(app, {
      method: 'POST',
      path: `/api/users/${cashierA.id}/deactivate`,
      headers: {
        'x-user-id': ownerA.id,
        'x-company-id': companyA.id,
      },
      body: { reason: 'Shift ended' },
    });
    assert.equal(deactivateCashierRes.status, 200);

    const loginAfterDeactivate = authenticateAccount({
      companyId: companyA.id,
      identifier: `salma.cashier.${suffix}`,
      passwordOrPin: 'SalmaPassword123',
    });
    assert.equal(loginAfterDeactivate.ok, false);
    assert.equal(
      loginAfterDeactivate.code,
      'ACCOUNT_DEACTIVATED',
      'Deactivated employee must be blocked from logging in'
    );
    assert.ok(ownerB.id, 'Company B owner remains unaffected');
  });

  it('6. 13-Module Interactive Guided Tour & 8-Item Onboarding Checklist Engine', () => {
    assert.equal(
      TRAINING_TOUR_STEPS.length,
      13,
      'Guided tour must contain all 13 required modules'
    );

    let prog = createInitialTourProgress();
    assert.equal(calculateTourCompletionPercent(prog), 0);

    prog = markTourStepVisited(prog, 0);
    prog = markTourStepVisited(prog, 1);
    assert.equal(prog.completedStepIds.length, 2);

    prog = markTourCompleted(prog);
    assert.equal(prog.isCompleted, true);
    assert.equal(calculateTourCompletionPercent(prog), 100);

    // Per-user storage key isolation
    const keyUser1 = getUserTourStorageKey('user-1', DEFAULT_COMPANY_ID);
    const keyUser2 = getUserTourStorageKey('user-2', DEFAULT_COMPANY_ID);
    assert.notEqual(keyUser1, keyUser2, 'Tour progress keys must be isolated per user & company');

    // Role-based tour step accessibility
    const userMgmtStep = TRAINING_TOUR_STEPS.find(
      (s) => s.stepNumber === 12
    )!;
    const cashierCaps = getDefaultCapabilitiesForRole('CASHIER');
    const ownerCaps = getDefaultCapabilitiesForRole('COMPANY_OWNER');
    const cashierUser = {
      id: 'cashier-test',
      role: 'cashier' as const,
      systemRole: 'CASHIER' as const,
      capabilities: cashierCaps,
      permissions: deriveLegacyPermissionsFromCapabilities(cashierCaps),
      isActive: true,
    };
    const ownerUser = {
      id: 'owner-test',
      role: 'admin' as const,
      systemRole: 'COMPANY_OWNER' as const,
      capabilities: ownerCaps,
      permissions: deriveLegacyPermissionsFromCapabilities(ownerCaps),
      isActive: true,
    };
    assert.equal(
      isTourStepAccessibleForUser(userMgmtStep, cashierUser),
      false,
      'User Management step must be marked role-restricted for Cashier'
    );
    assert.equal(
      isTourStepAccessibleForUser(userMgmtStep, ownerUser),
      true,
      'User Management step must be accessible for Company Owner'
    );
    assert.equal(userHasCapability(ownerUser, 'permissions.manage'), true);
    assert.equal(
      deriveCapabilitiesFromUser(cashierUser).includes('sales.create'),
      true
    );

    // 8-Item Onboarding Checklist calculation
    const checklist = computeOnboardingChecklistStatus({
      companyProfileConfigured: true,
      currenciesConfigured: true,
      branchCreated: true,
      productsCount: 113,
      employeesCount: 4,
      salesCount: 12,
      inventoryReviewed: true,
      guidedTourCompleted: true,
    });
    assert.equal(checklist.totalCount, 8);
    assert.equal(checklist.completedCount, 8);
    assert.equal(checklist.completionPercent, 100);
  });
});
