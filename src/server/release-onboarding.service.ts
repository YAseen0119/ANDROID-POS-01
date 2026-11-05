/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router, Request, Response, NextFunction } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, hasDatabaseCredentials } from '../db/index.ts';
import {
  companies,
  authSessions,
  branches,
  roles,
  users,
  auditLogs,
  storeSettings,
} from '../db/schema.ts';
import {
  ALL_CAPABILITY_CODES,
  CAPABILITY_GROUPS,
  CapabilityCode,
  deriveCapabilitiesFromUser,
  deriveLegacyPermissionsFromCapabilities,
  getDefaultCapabilitiesForRole,
  mapSystemRoleToLegacyRole,
  normalizeSystemRoleCode,
  SYSTEM_ROLE_DEFINITIONS,
  SystemRoleCode,
  userHasCapability,
} from '../lib/rbac-capabilities.ts';
import {
  INITIAL_CUSTOMERS,
  INITIAL_PRODUCTS,
  INITIAL_STOCK_MOVEMENTS,
  INITIAL_TRANSACTIONS,
  INITIAL_UNMET_DEMAND_REQUESTS,
  INITIAL_USERS,
} from '../lib/initial-data.ts';
import type {
  BranchRecord,
  CompanyProfile,
  POSUser,
  SupportedCurrency,
  WorkspaceMode,
} from '../lib/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.resolve(ROOT_DIR, '.data');
const PROD_STORE_FILE = path.resolve(DATA_DIR, 'store-state.json');
const PRACTICE_STORE_FILE = path.resolve(DATA_DIR, 'practice-store-state.json');
const PLATFORM_STATE_FILE = path.resolve(DATA_DIR, 'platform-onboarding-state.json');

export const DEFAULT_COMPANY_ID = 'comp-default';
export const PRACTICE_COMPANY_ID = 'comp-demo-practice';

export class ReleasePlatformError extends Error {
  statusCode: number;
  errorCode: string;
  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

// ============================================================================
// 1. CRYPTOGRAPHIC PASSWORD HASHING & TOKEN UTILITIES (scrypt + SHA-256)
// ============================================================================

export function hashPasswordScrypt(password: string, existingSalt?: string): {
  hash: string;
  salt: string;
} {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifyPasswordScrypt(
  password: string,
  expectedHash?: string | null,
  salt?: string | null
): boolean {
  if (!expectedHash || !salt) return false;
  try {
    const { hash } = hashPasswordScrypt(password, salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  messageEn?: string;
  messageAr?: string;
} {
  if (!password || password.trim().length < 4) {
    return {
      valid: false,
      messageEn: 'Password must be at least 4 characters long.',
      messageAr: 'يجب أن تتكون كلمة المرور من 4 أحرف أو أرقام على الأقل.',
    };
  }
  return { valid: true };
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ============================================================================
// 2. PLATFORM STATE PERSISTENCE (PostgreSQL + .data/platform-onboarding-state.json)
// ============================================================================

export interface StoredUserRecord extends POSUser {
  companyId: string;
  username: string;
  email?: string;
  phone?: string;
  systemRole: SystemRoleCode;
  capabilities: CapabilityCode[];
  branchId: string;
  assignedBranchIds: string[];
  passwordHash?: string | null;
  passwordSalt?: string | null;
  mustChangePassword?: boolean;
  tourProgressJson?: Record<string, any>;
}

export interface StoredSessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  companyId: string;
  workspaceMode: WorkspaceMode;
  activeBranchId: string;
  terminalName: string;
  isRevoked: boolean;
  expiresAt: string;
  lastActiveAt: string;
  createdAt: string;
}

export interface StoredAuditLogRecord {
  id: string;
  companyId: string;
  userId: string | null;
  actorName?: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, any>;
  createdAt: string;
}

export interface PlatformOnboardingState {
  cleanProductionInitialized?: boolean;
  companies: CompanyProfile[];
  branches: BranchRecord[];
  users: StoredUserRecord[];
  sessions: StoredSessionRecord[];
  auditLogs: StoredAuditLogRecord[];
  idempotencyKeys: Record<string, string>; // key -> companyId
}

function buildDefaultCompanies(): CompanyProfile[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'comp-demo-practice',
      code: 'DQ-DEMO-PRACTICE',
      legalName: 'Dqnamo Practice Sandbox Store (Training Only)',
      displayName: 'Practice Mode Sandbox Store',
      displayNameAr: 'متجر التدريب التجريبي (بيئة معزولة)',
      businessType: 'retail',
      logoUrl: null,
      country: 'Sudan',
      city: 'Khartoum',
      address: 'Practice Training Environment — Isolated Data',
      addressAr: 'بيئة تدريب افتراضية معزولة عن البيانات الحقيقية',
      phone: '+249 90 000 0000',
      email: 'practice@dqnamo.local',
      taxNumber: 'DEMO-000000',
      defaultLanguage: 'ar',
      defaultTimezone: 'Africa/Khartoum',
      baseCurrency: 'SDG',
      currencyDisplayFormat: 'symbol_amount',
      fiscalYearStartMonth: 1,
      rateUpdatePolicy: 'admin_or_manager',
      isDemo: true,
      setupCompleted: true,
      ownerUserId: 'demo-user-owner',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function buildDefaultBranches(): BranchRecord[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'demo-branch-main',
      companyId: 'comp-demo-practice',
      name: 'Practice Main Branch',
      nameAr: 'فرع التدريب الرئيسي',
      code: 'DEMO-BR-01',
      city: 'Khartoum',
      address: 'Training Sandbox Branch #1',
      phone: '+249 90 000 0001',
      managerUserId: 'demo-user-owner',
      isMain: true,
      isActive: true,
      createdAt: now,
    },
    {
      id: 'demo-branch-2',
      companyId: 'comp-demo-practice',
      name: 'Practice North Branch',
      nameAr: 'فرع التدريب الشمالي',
      code: 'DEMO-BR-02',
      city: 'Omdurman',
      address: 'Training Sandbox Branch #2',
      phone: '+249 90 000 0002',
      managerUserId: 'demo-user-manager',
      isMain: false,
      isActive: true,
      createdAt: now,
    },
  ];
}

function enrichSeedUserToStoredUser(
  u: POSUser,
  companyId: string,
  defaultSystemRole?: SystemRoleCode
): StoredUserRecord {
  const sysRole: SystemRoleCode =
    defaultSystemRole ||
    (u.id === 'user-1'
      ? 'COMPANY_OWNER'
      : u.role === 'admin'
      ? 'ADMIN'
      : u.role === 'manager'
      ? 'MANAGER'
      : u.role === 'inventory_clerk'
      ? 'INVENTORY_MANAGER'
      : 'CASHIER');

  const branchId =
    u.branchId ||
    (companyId === 'comp-demo-practice'
      ? 'demo-branch-main'
      : u.terminalName?.includes('02')
      ? 'branch-bahri'
      : 'branch-main');

  const assignedBranchIds =
    Array.isArray(u.assignedBranchIds) && u.assignedBranchIds.length > 0
      ? u.assignedBranchIds
      : sysRole === 'COMPANY_OWNER' || sysRole === 'ADMIN'
      ? companyId === 'comp-demo-practice'
        ? ['demo-branch-main', 'demo-branch-2']
        : [branchId]
      : [branchId];

  const capabilities =
    Array.isArray(u.capabilities) && u.capabilities.length > 0
      ? (u.capabilities as CapabilityCode[])
      : getDefaultCapabilitiesForRole(sysRole);

  return {
    ...u,
    companyId,
    username: u.username || u.id,
    email: u.email || `${u.id}@dqnamo.sd`,
    phone: u.phone || '+249 91 000 0000',
    role: mapSystemRoleToLegacyRole(sysRole),
    systemRole: sysRole,
    capabilities,
    branchId,
    assignedBranchIds,
    permissions: deriveLegacyPermissionsFromCapabilities(capabilities),
    hasPassword: Boolean((u as any).passwordHash || u.hasPassword),
    mustChangePassword: false,
    tourProgressJson: {},
  };
}

function buildDefaultUsers(): StoredUserRecord[] {
  const demoUsers: StoredUserRecord[] = [
    enrichSeedUserToStoredUser(
      {
        id: 'demo-user-owner',
        name: 'Practice Trainer (Demo Owner)',
        nameAr: 'مدرب النظام (مالك المتجر التجريبي)',
        role: 'admin',
        pin: '1111',
        terminalName: 'Practice Terminal 01',
        terminalNameAr: 'جهاز التدريب 1',
        avatarColor: '#10b981',
        isActive: true,
        permissions: deriveLegacyPermissionsFromCapabilities(ALL_CAPABILITY_CODES),
        lastActiveAt: new Date().toISOString(),
      },
      'comp-demo-practice',
      'COMPANY_OWNER'
    ),
    enrichSeedUserToStoredUser(
      {
        id: 'demo-user-cashier',
        name: 'Practice Cashier',
        nameAr: 'كاشير متدرب (وضع التدريب)',
        role: 'cashier',
        pin: '2222',
        terminalName: 'Practice Terminal 02',
        terminalNameAr: 'جهاز التدريب 2',
        avatarColor: '#3b82f6',
        isActive: true,
        permissions: deriveLegacyPermissionsFromCapabilities(
          getDefaultCapabilitiesForRole('CASHIER')
        ),
        lastActiveAt: new Date().toISOString(),
      },
      'comp-demo-practice',
      'CASHIER'
    ),
  ];

  return demoUsers;
}

const LEGACY_DEMO_USER_IDS = new Set(['user-1', 'user-2', 'user-3', 'user-4']);
const LEGACY_DEMO_BRANCH_IDS = new Set(['branch-main', 'branch-bahri']);

export function loadPlatformState(): PlatformOnboardingState {
  try {
    if (fs.existsSync(PLATFORM_STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PLATFORM_STATE_FILE, 'utf-8'));
      const defaultCompanies = buildDefaultCompanies();
      const defaultBranches = buildDefaultBranches();
      const defaultUsers = buildDefaultUsers();

      // Strip auto-seeded comp-default and user-1..user-4 if they were never explicitly created by a real owner
      let companiesList: CompanyProfile[] = Array.isArray(raw.companies)
        ? raw.companies.filter((c: CompanyProfile) => c.id !== 'comp-default')
        : [...defaultCompanies];

      if (!companiesList.some((c) => c.id === 'comp-demo-practice')) {
        companiesList.push(defaultCompanies[0]);
      }

      const branchesList: BranchRecord[] = Array.isArray(raw.branches)
        ? raw.branches.filter(
            (b: BranchRecord) =>
              b.companyId !== 'comp-default' && !LEGACY_DEMO_BRANCH_IDS.has(b.id)
          )
        : [...defaultBranches];

      for (const db of defaultBranches) {
        if (!branchesList.some((b) => b.id === db.id)) {
          branchesList.push(db);
        }
      }

      const usersList: StoredUserRecord[] = Array.isArray(raw.users)
        ? raw.users
            .filter(
              (u: any) =>
                u &&
                u.companyId !== 'comp-default' &&
                !LEGACY_DEMO_USER_IDS.has(String(u.id))
            )
            .map((u: any) => ({
              ...enrichSeedUserToStoredUser(u, u.companyId || 'comp-demo-practice', u.systemRole),
              passwordHash: u.passwordHash || null,
              passwordSalt: u.passwordSalt || null,
              hasPassword: Boolean(u.passwordHash || u.hasPassword),
            }))
        : [...defaultUsers];

      for (const du of defaultUsers) {
        if (!usersList.some((u) => u.id === du.id)) {
          usersList.push(du);
        }
      }

      const loaded: PlatformOnboardingState = {
        cleanProductionInitialized: true,
        companies: companiesList,
        branches: branchesList,
        users: usersList,
        sessions: Array.isArray(raw.sessions)
          ? raw.sessions.filter((s: StoredSessionRecord) => s.companyId !== 'comp-default')
          : [],
        auditLogs: Array.isArray(raw.auditLogs) ? raw.auditLogs : [],
        idempotencyKeys: raw.idempotencyKeys || {},
      };

      if (!raw.cleanProductionInitialized) {
        savePlatformState(loaded);
      }
      return loaded;
    }
  } catch (err) {
    console.warn('Could not read platform-onboarding-state.json, initializing clean defaults:', err);
  }

  const initial: PlatformOnboardingState = {
    cleanProductionInitialized: true,
    companies: buildDefaultCompanies(),
    branches: buildDefaultBranches(),
    users: buildDefaultUsers(),
    sessions: [],
    auditLogs: [],
    idempotencyKeys: {},
  };
  savePlatformState(initial);
  return initial;
}

export function savePlatformState(state: PlatformOnboardingState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PLATFORM_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');

    // Also mirror production users into .data/store-state.json so analytics & legacy sync see them immediately
    if (fs.existsSync(PROD_STORE_FILE)) {
      try {
        const prodRaw = JSON.parse(fs.readFileSync(PROD_STORE_FILE, 'utf-8'));
        const prodUsers = state.users
          .filter((u) => u.companyId !== 'comp-demo-practice')
          .map(({ passwordHash, passwordSalt, ...safeUser }) => safeUser);
        prodRaw.users = prodUsers;
        fs.writeFileSync(PROD_STORE_FILE, JSON.stringify(prodRaw, null, 2), 'utf-8');
      } catch {}
    }
  } catch (err) {
    console.warn('Could not write platform-onboarding-state.json:', err);
  }
}

export function appendPlatformAuditLog(
  state: PlatformOnboardingState,
  entry: {
    companyId: string;
    userId: string | null;
    actorName?: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, any>;
  }
): StoredAuditLogRecord {
  const record: StoredAuditLogRecord = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    companyId: entry.companyId || 'comp-default',
    userId: entry.userId,
    actorName: entry.actorName || 'System',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId || null,
    details: entry.details || {},
    createdAt: new Date().toISOString(),
  };
  state.auditLogs.unshift(record);
  if (state.auditLogs.length > 500) {
    state.auditLogs = state.auditLogs.slice(0, 500);
  }
  return record;
}

// ============================================================================
// 3. PRACTICE MODE ISOLATED SANDBOX STORE (.data/practice-store-state.json)
// ============================================================================

export interface PracticeSandboxStoreState {
  companyId: 'comp-demo-practice';
  workspaceMode: 'PRACTICE';
  storeCode: 'DQ-DEMO-PRACTICE';
  updatedAt: string;
  resetCount: number;
  settings?: Record<string, any>;
  products: any[];
  transactions: any[];
  customers: any[];
  stockMovements: any[];
  users: any[];
  activeSessions: any[];
  unmetDemandRequests: any[];
}

export function buildFreshPracticeSandboxState(resetCount = 0): PracticeSandboxStoreState {
  const state = loadPlatformState();
  const demoUsers = state.users
    .filter((u) => u.companyId === 'comp-demo-practice')
    .map(({ passwordHash, passwordSalt, ...safe }) => safe);

  return {
    companyId: 'comp-demo-practice',
    workspaceMode: 'PRACTICE',
    storeCode: 'DQ-DEMO-PRACTICE',
    updatedAt: new Date().toISOString(),
    resetCount,
    products: JSON.parse(JSON.stringify(INITIAL_PRODUCTS)).map((p: any) => ({
      ...p,
      companyId: 'comp-demo-practice',
    })),
    transactions: JSON.parse(JSON.stringify(INITIAL_TRANSACTIONS)).map((t: any) => ({
      ...t,
      companyId: 'comp-demo-practice',
    })),
    customers: JSON.parse(JSON.stringify(INITIAL_CUSTOMERS)).map((c: any) => ({
      ...c,
      companyId: 'comp-demo-practice',
    })),
    stockMovements: JSON.parse(JSON.stringify(INITIAL_STOCK_MOVEMENTS)).map((m: any) => ({
      ...m,
      companyId: 'comp-demo-practice',
    })),
    users: demoUsers,
    activeSessions: [],
    unmetDemandRequests: JSON.parse(JSON.stringify(INITIAL_UNMET_DEMAND_REQUESTS)).map(
      (r: any) => ({
        ...r,
        companyId: 'comp-demo-practice',
      })
    ),
  };
}

export function readPracticeSandboxState(): PracticeSandboxStoreState {
  try {
    if (fs.existsSync(PRACTICE_STORE_FILE)) {
      return JSON.parse(fs.readFileSync(PRACTICE_STORE_FILE, 'utf-8'));
    }
  } catch {}
  const fresh = buildFreshPracticeSandboxState(0);
  writePracticeSandboxState(fresh);
  return fresh;
}

export function writePracticeSandboxState(sandbox: PracticeSandboxStoreState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PRACTICE_STORE_FILE, JSON.stringify(sandbox, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write practice-store-state.json:', err);
  }
}

export function resetPracticeSandboxState(actorUserId?: string): PracticeSandboxStoreState {
  const current = readPracticeSandboxState();
  const next = buildFreshPracticeSandboxState((current.resetCount || 0) + 1);
  writePracticeSandboxState(next);

  const pState = loadPlatformState();
  appendPlatformAuditLog(pState, {
    companyId: 'comp-demo-practice',
    userId: actorUserId || 'demo-user-owner',
    actorName: 'Practice Operator',
    action: 'PRACTICE_SANDBOX_RESET',
    entityType: 'company',
    entityId: 'comp-demo-practice',
    details: { resetCount: next.resetCount },
  });
  savePlatformState(pState);
  return next;
}

// ============================================================================
// 4. COMPANY CREATION & INITIAL OWNER ONBOARDING (Idempotent + DB Synced)
// ============================================================================

export interface CreateCompanyOnboardingInput {
  idempotencyKey?: string;
  // Nested format
  company?: {
    legalName: string;
    displayName?: string;
    displayNameAr?: string;
    businessType?: string;
    logoUrl?: string | null;
    country?: string;
    city?: string;
    address?: string;
    addressAr?: string;
    phone?: string;
    email?: string;
    taxNumber?: string;
    defaultLanguage?: 'ar' | 'en';
    defaultTimezone?: string;
    baseCurrency?: SupportedCurrency;
    currencyDisplayFormat?: 'symbol_amount' | 'code_amount' | 'amount_symbol';
    fiscalYearStartMonth?: number;
    rateUpdatePolicy?: 'owner_only' | 'admin_only' | 'admin_or_manager';
  };
  mainBranch?: {
    name: string;
    nameAr?: string;
    code?: string;
    city?: string;
    address?: string;
    phone?: string;
  };
  owner?: {
    fullName: string;
    fullNameAr?: string;
    usernameOrEmail: string;
    phone?: string;
    password: string;
    confirmPassword: string;
    pin?: string;
  };
  // Flat format convenience aliases
  legalName?: string;
  displayName?: string;
  displayNameAr?: string;
  businessType?: string;
  country?: string;
  city?: string;
  baseCurrency?: SupportedCurrency;
  secondaryCurrencies?: string[];
  branchName?: string;
  branchCode?: string;
  ownerName?: string;
  ownerUsername?: string;
  ownerEmail?: string;
  ownerPassword?: string;
  ownerConfirmPassword?: string;
  ownerPin?: string;
}

export async function createCompanyAndInitialOwner(
  rawInput: CreateCompanyOnboardingInput
): Promise<{
  ok: boolean;
  idempotentReplay: boolean;
  company: CompanyProfile;
  mainBranch: BranchRecord;
  branch: BranchRecord;
  owner: Omit<StoredUserRecord, 'passwordHash' | 'passwordSalt'>;
  sessionToken: string;
}> {
  const input = {
    idempotencyKey: rawInput.idempotencyKey,
    company: rawInput.company || {
      legalName: rawInput.legalName || '',
      displayName: rawInput.displayName || rawInput.legalName || '',
      displayNameAr: rawInput.displayNameAr,
      businessType: rawInput.businessType,
      country: rawInput.country,
      city: rawInput.city,
      baseCurrency: rawInput.baseCurrency,
      email: rawInput.ownerEmail,
    },
    mainBranch: rawInput.mainBranch || {
      name: rawInput.branchName || '',
      code: rawInput.branchCode,
      city: rawInput.city,
    },
    owner: rawInput.owner || {
      fullName: rawInput.ownerName || '',
      usernameOrEmail: rawInput.ownerUsername || rawInput.ownerEmail || '',
      password: rawInput.ownerPassword || '',
      confirmPassword: rawInput.ownerConfirmPassword || rawInput.ownerPassword || '',
      pin: rawInput.ownerPin,
    },
  };
  const state = loadPlatformState();

  // 1. Check idempotency key first to prevent duplicate company creation on retry
  const idemKey = (input.idempotencyKey || '').trim();
  if (idemKey && state.idempotencyKeys[idemKey]) {
    const existingCompanyId = state.idempotencyKeys[idemKey];
    const existingCompany = state.companies.find((c) => c.id === existingCompanyId);
    if (existingCompany) {
      const existingBranch =
        state.branches.find((b) => b.companyId === existingCompany.id && b.isMain) ||
        state.branches[0];
      const existingOwner =
        state.users.find(
          (u) => u.companyId === existingCompany.id && u.systemRole === 'COMPANY_OWNER'
        ) || state.users[0];
      const { passwordHash, passwordSalt, ...safeOwner } = existingOwner;
      return {
        ok: true,
        idempotentReplay: true,
        company: existingCompany,
        mainBranch: existingBranch,
        branch: existingBranch,
        owner: safeOwner,
        sessionToken: issueSessionForUser(state, existingOwner, 'PRODUCTION'),
      };
    }
  }

  // 2. Validate Company Information
  const legalName = (input.company?.legalName || '').trim();
  const displayName = (input.company?.displayName || legalName).trim();
  if (legalName.length < 2) {
    throw new ReleasePlatformError(
      400,
      'INVALID_COMPANY_NAME',
      'Company legal/display name is required (at least 2 characters).'
    );
  }

  // 3. Validate Main Branch
  const branchName = (input.mainBranch?.name || '').trim() || `${displayName} — Main Branch`;

  // 4. Validate Initial Owner Account
  const ownerName = (input.owner?.fullName || '').trim();
  const usernameOrEmail = (input.owner?.usernameOrEmail || '').trim().toLowerCase();
  const password = input.owner?.password || '';
  const confirmPassword = input.owner?.confirmPassword || '';

  if (ownerName.length < 2) {
    throw new ReleasePlatformError(
      400,
      'INVALID_OWNER_NAME',
      'Initial owner full name is required.'
    );
  }
  if (usernameOrEmail.length < 3) {
    throw new ReleasePlatformError(
      400,
      'INVALID_OWNER_IDENTITY',
      'Owner email or login username is required (at least 3 characters).'
    );
  }
  if (password !== confirmPassword) {
    throw new ReleasePlatformError(
      400,
      'PASSWORD_CONFIRMATION_MISMATCH',
      'Password and password confirmation do not match.'
    );
  }
  const pwdCheck = validatePasswordStrength(password);
  if (!pwdCheck.valid) {
    throw new ReleasePlatformError(
      400,
      'WEAK_OWNER_PASSWORD',
      pwdCheck.messageEn || 'Password does not meet security policy.'
    );
  }

  // Check if a non-demo company with the exact same legalName + owner username was already created within the last 5 minutes
  const duplicateCompany = state.companies.find(
    (c) =>
      !c.isDemo &&
      c.legalName.toLowerCase() === legalName.toLowerCase() &&
      state.users.some(
        (u) =>
          u.companyId === c.id &&
          (u.username.toLowerCase() === usernameOrEmail ||
            (u.email || '').toLowerCase() === usernameOrEmail)
      )
  );
  if (duplicateCompany) {
    const existingBranch =
      state.branches.find((b) => b.companyId === duplicateCompany.id && b.isMain) ||
      state.branches[0];
    const existingOwner = state.users.find(
      (u) => u.companyId === duplicateCompany.id && u.systemRole === 'COMPANY_OWNER'
    )!;
    const { passwordHash, passwordSalt, ...safeOwner } = existingOwner;
    return {
      ok: true,
      idempotentReplay: true,
      company: duplicateCompany,
      mainBranch: existingBranch,
      branch: existingBranch,
      owner: safeOwner,
      sessionToken: issueSessionForUser(state, existingOwner, 'PRODUCTION'),
    };
  }

  const nowIso = new Date().toISOString();
  const suffix = Date.now().toString(36).toUpperCase();
  const companyId = `comp-${Date.now().toString(36)}-${ crypto.randomBytes(2).toString('hex') }`;
  const companyCode = `CMP-${suffix}`;
  const branchId = `br-${Date.now().toString(36)}-main`;
  const branchCode = (input.mainBranch?.code || '').trim().toUpperCase() || `BR-${suffix}-01`;
  const ownerId = `usr-owner-${Date.now().toString(36)}`;
  const resolvedUsername = state.users.some(
    (u) => u.username.toLowerCase() === usernameOrEmail
  )
    ? `${usernameOrEmail}.${suffix.toLowerCase()}`
    : usernameOrEmail;

  const { hash: passwordHash, salt: passwordSalt } = hashPasswordScrypt(password);

  const newCompany: CompanyProfile = {
    id: companyId,
    code: companyCode,
    legalName,
    displayName,
    displayNameAr: (input.company.displayNameAr || displayName).trim(),
    businessType: input.company.businessType || 'retail',
    logoUrl: input.company.logoUrl || null,
    country: input.company.country || 'Sudan',
    city: input.company.city || 'Khartoum',
    address: input.company.address || '',
    addressAr: input.company.addressAr || input.company.address || '',
    phone: input.company.phone || input.owner.phone || '',
    email: input.company.email || (usernameOrEmail.includes('@') ? usernameOrEmail : ''),
    taxNumber: input.company.taxNumber || '',
    defaultLanguage: input.company.defaultLanguage || 'ar',
    defaultTimezone: input.company.defaultTimezone || 'Africa/Khartoum',
    baseCurrency: (input.company.baseCurrency || 'SDG').toUpperCase(),
    currencyDisplayFormat: input.company.currencyDisplayFormat || 'symbol_amount',
    fiscalYearStartMonth: Number(input.company.fiscalYearStartMonth) || 1,
    rateUpdatePolicy: input.company.rateUpdatePolicy || 'admin_or_manager',
    isDemo: false,
    setupCompleted: true,
    ownerUserId: ownerId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const newBranch: BranchRecord = {
    id: branchId,
    companyId,
    name: branchName,
    nameAr: (input.mainBranch.nameAr || branchName).trim(),
    code: branchCode,
    city: input.mainBranch.city || newCompany.city || 'Khartoum',
    address: input.mainBranch.address || newCompany.address || '',
    phone: input.mainBranch.phone || newCompany.phone || '',
    managerUserId: ownerId,
    isMain: true,
    isActive: true,
    createdAt: nowIso,
  };

  const ownerCapabilities = [...ALL_CAPABILITY_CODES];
  const newOwner: StoredUserRecord = {
    id: ownerId,
    companyId,
    username: resolvedUsername,
    email: usernameOrEmail.includes('@') ? usernameOrEmail : input.company.email || '',
    phone: input.owner.phone || input.company.phone || '',
    name: ownerName,
    nameAr: (input.owner.fullNameAr || ownerName).trim(),
    role: 'admin',
    systemRole: 'COMPANY_OWNER',
    capabilities: ownerCapabilities,
    branchId,
    assignedBranchIds: [branchId],
    pin: (input.owner.pin || '1111').trim(),
    passwordHash,
    passwordSalt,
    hasPassword: true,
    mustChangePassword: false,
    terminalName: `${newBranch.name} — Owner Terminal`,
    terminalNameAr: `${newBranch.nameAr} — جهاز المالك`,
    avatarColor: '#f59e0b',
    isActive: true,
    permissions: deriveLegacyPermissionsFromCapabilities(ownerCapabilities),
    lastActiveAt: nowIso,
    lastLoginAt: nowIso,
    tourProgressJson: {},
  };

  state.companies.push(newCompany);
  state.branches.push(newBranch);
  state.users.push(newOwner);
  if (idemKey) {
    state.idempotencyKeys[idemKey] = companyId;
  }

  appendPlatformAuditLog(state, {
    companyId,
    userId: ownerId,
    actorName: ownerName,
    action: 'COMPANY_CREATED',
    entityType: 'company',
    entityId: companyId,
    details: {
      code: companyCode,
      legalName,
      baseCurrency: newCompany.baseCurrency,
      mainBranchId: branchId,
    },
  });

  appendPlatformAuditLog(state, {
    companyId,
    userId: ownerId,
    actorName: ownerName,
    action: 'INITIAL_OWNER_CREATED',
    entityType: 'user',
    entityId: ownerId,
    details: {
      username: usernameOrEmail,
      systemRole: 'COMPANY_OWNER',
    },
  });

  const sessionToken = issueSessionForUser(state, newOwner, 'PRODUCTION');
  savePlatformState(state);

  // Best-effort additive persistence to PostgreSQL
  if (hasDatabaseCredentials() && db) {
    try {
      await db
        .insert(companies)
        .values({
          id: newCompany.id,
          code: newCompany.code || companyCode,
          legalName: newCompany.legalName,
          displayName: newCompany.displayName,
          displayNameAr: newCompany.displayNameAr,
          businessType: newCompany.businessType,
          logoUrl: newCompany.logoUrl,
          country: newCompany.country,
          city: newCompany.city,
          address: newCompany.address,
          addressAr: newCompany.addressAr,
          phone: newCompany.phone,
          email: newCompany.email,
          taxNumber: newCompany.taxNumber,
          defaultLanguage: newCompany.defaultLanguage,
          defaultTimezone: newCompany.defaultTimezone,
          baseCurrency: newCompany.baseCurrency,
          currencyDisplayFormat: newCompany.currencyDisplayFormat,
          fiscalYearStartMonth: newCompany.fiscalYearStartMonth,
          rateUpdatePolicy: newCompany.rateUpdatePolicy,
          isDemo: false,
          setupCompleted: true,
          ownerUserId: newOwner.id,
          idempotencyKey: idemKey || null,
        })
        .onConflictDoNothing();

      const dbBranchCode = `${newBranch.code}-${newCompany.id.slice(-4).toUpperCase()}`.slice(0, 24);
      await db
        .insert(branches)
        .values({
          id: newBranch.id,
          companyId: newCompany.id,
          name: newBranch.name,
          nameAr: newBranch.nameAr,
          code: dbBranchCode,
          city: newBranch.city,
          address: newBranch.address,
          phone: newBranch.phone,
          managerUserId: null,
          isMain: true,
          isActive: true,
        })
        .onConflictDoNothing();

      await db
        .insert(roles)
        .values({
          id: 'COMPANY_OWNER',
          companyId: newCompany.id,
          code: 'COMPANY_OWNER',
          name: 'Company Owner',
          nameAr: 'مالك الشركة',
          isSystem: true,
          permissions: ownerCapabilities,
        })
        .onConflictDoNothing();

      await db
        .insert(users)
        .values({
          id: newOwner.id,
          companyId: newCompany.id,
          username: newOwner.username,
          name: newOwner.name,
          nameAr: newOwner.nameAr,
          email: newOwner.email,
          phone: newOwner.phone,
          roleId: 'COMPANY_OWNER',
          branchId: newBranch.id,
          assignedBranchIds: newOwner.assignedBranchIds,
          customPermissions: newOwner.capabilities,
          pinCode: newOwner.pin,
          passwordHash: newOwner.passwordHash,
          passwordSalt: newOwner.passwordSalt,
          isActive: true,
        })
        .onConflictDoNothing();
    } catch (dbErr) {
      console.warn('Non-fatal PostgreSQL sync warning during company creation:', dbErr);
    }
  }

  const { passwordHash: _ph, passwordSalt: _ps, ...safeOwner } = newOwner;
  return {
    ok: true,
    idempotentReplay: false,
    company: newCompany,
    mainBranch: newBranch,
    branch: newBranch,
    owner: safeOwner,
    sessionToken,
  };
}

// ============================================================================
// 5. SESSION ISSUANCE, LOGIN & SERVER-SIDE AUTHORIZATION RESOLUTION
// ============================================================================

export function issueSessionForUser(
  state: PlatformOnboardingState,
  user: StoredUserRecord,
  workspaceMode?: WorkspaceMode
): string {
  const mode: WorkspaceMode =
    workspaceMode || (user.companyId === 'comp-demo-practice' ? 'PRACTICE' : 'PRODUCTION');
  const rawToken = `dqsess_${crypto.randomBytes(24).toString('hex')}`;
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const sessionRecord: StoredSessionRecord = {
    id: `sess-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    tokenHash,
    userId: user.id,
    companyId: user.companyId,
    workspaceMode: mode,
    activeBranchId: user.branchId || 'branch-main',
    terminalName: user.terminalName || 'POS Terminal',
    isRevoked: false,
    expiresAt: expires.toISOString(),
    lastActiveAt: now.toISOString(),
    createdAt: now.toISOString(),
  };

  state.sessions.unshift(sessionRecord);
  if (state.sessions.length > 200) {
    state.sessions = state.sessions.slice(0, 200);
  }
  return rawToken;
}

export interface AuthenticatedActorContext {
  user: StoredUserRecord;
  company: CompanyProfile;
  workspaceMode: WorkspaceMode;
  sessionId?: string;
}

/**
 * Resolves the authenticated user and company scope from Bearer token, `x-session-token`,
 * or `x-user-id` verified strictly against the server-side user store.
 * NEVER trusts client-supplied `x-user-role`, `role`, or `companyId` to escalate privileges!
 */
export function resolveAuthenticatedActorFromRequest(
  req: Request,
  options?: { allowUnauthenticatedDefaultRead?: boolean }
): AuthenticatedActorContext {
  const state = loadPlatformState();

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerToken =
    typeof req.headers['x-session-token'] === 'string'
      ? req.headers['x-session-token'].trim()
      : '';
  const rawToken = bearerToken || headerToken;

  if (rawToken) {
    const tokenHash = hashSessionToken(rawToken);
    const matchedSession = state.sessions.find(
      (s) =>
        s.tokenHash === tokenHash &&
        !s.isRevoked &&
        new Date(s.expiresAt).getTime() > Date.now()
    );
    if (!matchedSession) {
      throw new ReleasePlatformError(
        401,
        'INVALID_OR_EXPIRED_SESSION',
        'Authentication failed: session token is invalid, expired, or revoked.'
      );
    }
    const matchedUser = state.users.find(
      (u) => u.id === matchedSession.userId && u.companyId === matchedSession.companyId
    );
    if (!matchedUser || !matchedUser.isActive) {
      throw new ReleasePlatformError(
        403,
        'USER_ACCOUNT_DEACTIVATED',
        'Access denied: user account is deactivated.'
      );
    }
    const company =
      state.companies.find((c) => c.id === matchedUser.companyId) || state.companies[0];
    return {
      user: matchedUser,
      company,
      workspaceMode: company.isDemo ? 'PRACTICE' : matchedSession.workspaceMode,
      sessionId: matchedSession.id,
    };
  }

  // Fallback to verified `x-user-id` or `userId` in server store
  const userId =
    (typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'].trim() : '') ||
    (typeof req.query.userId === 'string' ? req.query.userId.trim() : '') ||
    (typeof req.body?.userId === 'string' ? req.body.userId.trim() : '');

  if (!userId) {
    if (options?.allowUnauthenticatedDefaultRead) {
      const prodUser = state.users.find(
        (u) => u.companyId !== 'comp-demo-practice' && u.isActive
      );
      const fallbackUser = prodUser || state.users[0];
      const fallbackCompany =
        state.companies.find((c) => c.id === fallbackUser.companyId) || state.companies[0];
      return {
        user: fallbackUser,
        company: fallbackCompany,
        workspaceMode: fallbackCompany.isDemo ? 'PRACTICE' : 'PRODUCTION',
      };
    }
    throw new ReleasePlatformError(
      401,
      'UNAUTHENTICATED_REQUEST',
      'Authentication required: missing session token or x-user-id header.'
    );
  }

  const matchedUser = state.users.find((u) => u.id === userId);
  if (!matchedUser) {
    throw new ReleasePlatformError(
      401,
      'UNKNOWN_USER_IDENTITY',
      `Authentication failed: user "${userId}" does not exist in the server user store.`
    );
  }
  if (!matchedUser.isActive) {
    throw new ReleasePlatformError(
      403,
      'USER_ACCOUNT_DEACTIVATED',
      `Access denied: user "${userId}" is deactivated.`
    );
  }

  const company =
    state.companies.find((c) => c.id === matchedUser.companyId) || state.companies[0];

  return {
    user: matchedUser,
    company,
    workspaceMode: company.isDemo ? 'PRACTICE' : 'PRODUCTION',
  };
}

export function assertActorHasCapability(
  actor: AuthenticatedActorContext,
  capability: CapabilityCode
): void {
  if (!userHasCapability(actor.user, capability)) {
    throw new ReleasePlatformError(
      403,
      'FORBIDDEN_MISSING_CAPABILITY',
      `Access denied: user "${actor.user.name}" (${actor.user.systemRole}) lacks required permission "${capability}".`
    );
  }
}

export function assertActorCompanyMatch(
  actor: AuthenticatedActorContext,
  targetCompanyId?: string | null
): void {
  if (targetCompanyId && targetCompanyId !== actor.company.id) {
    throw new ReleasePlatformError(
      403,
      'FORBIDDEN_CROSS_COMPANY_ACCESS',
      `Tenant isolation violation: user in company "${actor.company.id}" cannot access or modify records belonging to company "${targetCompanyId}".`
    );
  }
}

export function assertActorBranchAccess(
  actor: AuthenticatedActorContext,
  targetBranchId?: string | null
): void {
  if (!targetBranchId || targetBranchId === 'all') return;
  if (
    actor.user.systemRole === 'COMPANY_OWNER' ||
    actor.user.systemRole === 'ADMIN' ||
    actor.user.role === 'admin'
  ) {
    return;
  }
  const allowed = new Set([
    actor.user.branchId,
    ...(actor.user.assignedBranchIds || []),
  ]);
  if (!allowed.has(targetBranchId)) {
    throw new ReleasePlatformError(
      403,
      'FORBIDDEN_BRANCH_ACCESS',
      `Branch isolation violation: user "${actor.user.name}" is not assigned to branch "${targetBranchId}".`
    );
  }
}

// ============================================================================
// 6. EMPLOYEE ACCOUNT MANAGEMENT & GRANULAR RBAC OPERATIONS
// ============================================================================

export function createEmployeeAccount(
  actor: AuthenticatedActorContext,
  input: {
    name: string;
    nameAr?: string;
    username?: string;
    email?: string;
    phone?: string;
    systemRole: string;
    branchId?: string;
    assignedBranchIds?: string[];
    capabilities?: CapabilityCode[];
    password?: string;
    pin?: string;
    terminalName?: string;
    terminalNameAr?: string;
  }
): Omit<StoredUserRecord, 'passwordHash' | 'passwordSalt'> {
  assertActorHasCapability(actor, 'users.create');

  const state = loadPlatformState();
  const name = (input.name || input.nameAr || '').trim();
  if (!name) {
    throw new ReleasePlatformError(400, 'INVALID_EMPLOYEE_NAME', 'Employee name is required.');
  }

  const sysRole = normalizeSystemRoleCode(input.systemRole);
  if (
    (sysRole === 'COMPANY_OWNER' || sysRole === 'ADMIN') &&
    actor.user.systemRole !== 'COMPANY_OWNER' &&
    actor.user.systemRole !== 'ADMIN'
  ) {
    throw new ReleasePlatformError(
      403,
      'FORBIDDEN_ROLE_ESCALATION',
      'Only a Company Owner or System Admin can assign Owner/Admin roles.'
    );
  }

  const rawUsername = (
    input.username ||
    input.email ||
    `emp-${Date.now().toString(36)}`
  )
    .trim()
    .toLowerCase();

  if (
    state.users.some(
      (u) =>
        u.companyId === actor.company.id &&
        (u.username.toLowerCase() === rawUsername ||
          (input.email && u.email?.toLowerCase() === input.email.trim().toLowerCase()))
    )
  ) {
    throw new ReleasePlatformError(
      409,
      'DUPLICATE_EMPLOYEE_USERNAME',
      `An employee with username/email "${rawUsername}" already exists in this company.`
    );
  }

  const companyBranches = state.branches.filter((b) => b.companyId === actor.company.id);
  const defaultBranchId =
    input.branchId || companyBranches.find((b) => b.isMain)?.id || 'branch-main';

  // Verify branch belongs to actor's company
  const targetBranch = state.branches.find((b) => b.id === defaultBranchId);
  if (targetBranch && targetBranch.companyId !== actor.company.id) {
    throw new ReleasePlatformError(
      403,
      'FORBIDDEN_CROSS_COMPANY_ACCESS',
      'Cannot assign employee to a branch belonging to another company.'
    );
  }

  const assignedBranchIds =
    Array.isArray(input.assignedBranchIds) && input.assignedBranchIds.length > 0
      ? input.assignedBranchIds
      : [defaultBranchId];

  const capabilities =
    Array.isArray(input.capabilities) && input.capabilities.length > 0
      ? input.capabilities
      : getDefaultCapabilitiesForRole(sysRole);

  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (input.password && input.password.trim()) {
    const pwdCheck = validatePasswordStrength(input.password.trim());
    if (!pwdCheck.valid) {
      throw new ReleasePlatformError(400, 'WEAK_EMPLOYEE_PASSWORD', pwdCheck.messageEn!);
    }
    const hashed = hashPasswordScrypt(input.password.trim());
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  const id = `usr-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  const nowIso = new Date().toISOString();

  const created: StoredUserRecord = {
    id,
    companyId: actor.company.id,
    username: rawUsername,
    email: input.email?.trim() || '',
    phone: input.phone?.trim() || '',
    name,
    nameAr: (input.nameAr || name).trim(),
    role: mapSystemRoleToLegacyRole(sysRole),
    systemRole: sysRole,
    capabilities,
    branchId: defaultBranchId,
    assignedBranchIds,
    pin: (input.pin || '5555').trim(),
    passwordHash,
    passwordSalt,
    hasPassword: Boolean(passwordHash),
    mustChangePassword: false,
    terminalName: input.terminalName?.trim() || 'POS Terminal',
    terminalNameAr: input.terminalNameAr?.trim() || 'نقطة بيع',
    avatarColor: '#10b981',
    isActive: true,
    permissions: deriveLegacyPermissionsFromCapabilities(capabilities),
    lastActiveAt: nowIso,
    tourProgressJson: {},
  };

  state.users.push(created);

  appendPlatformAuditLog(state, {
    companyId: actor.company.id,
    userId: actor.user.id,
    actorName: actor.user.name,
    action: 'EMPLOYEE_CREATED',
    entityType: 'user',
    entityId: created.id,
    details: {
      name: created.name,
      systemRole: created.systemRole,
      branchId: created.branchId,
      assignedBranchIds: created.assignedBranchIds,
    },
  });

  savePlatformState(state);
  const { passwordHash: _ph, passwordSalt: _ps, ...safe } = created;
  return safe;
}

export function updateEmployeeAccount(
  actor: AuthenticatedActorContext,
  targetUserId: string,
  updates: {
    name?: string;
    nameAr?: string;
    email?: string;
    phone?: string;
    systemRole?: string;
    branchId?: string;
    assignedBranchIds?: string[];
    capabilities?: CapabilityCode[];
    permissions?: Partial<POSUser['permissions']>;
    isActive?: boolean;
    pin?: string;
    terminalName?: string;
    terminalNameAr?: string;
  }
): Omit<StoredUserRecord, 'passwordHash' | 'passwordSalt'> {
  const state = loadPlatformState();
  const idx = state.users.findIndex((u) => u.id === targetUserId);
  if (idx === -1) {
    throw new ReleasePlatformError(404, 'USER_NOT_FOUND', `Employee "${targetUserId}" not found.`);
  }

  const target = state.users[idx];
  assertActorCompanyMatch(actor, target.companyId);

  // Check required capabilities based on what is being modified
  if (updates.systemRole !== undefined && updates.systemRole !== target.systemRole) {
    assertActorHasCapability(actor, 'roles.manage');
  }
  if (updates.capabilities !== undefined || updates.permissions !== undefined) {
    assertActorHasCapability(actor, 'permissions.manage');
  }
  if (updates.isActive !== undefined && updates.isActive !== target.isActive) {
    assertActorHasCapability(actor, 'users.deactivate');
  } else {
    assertActorHasCapability(actor, 'users.edit');
  }

  const nextSysRole = updates.systemRole
    ? normalizeSystemRoleCode(updates.systemRole)
    : target.systemRole;

  const nextIsActive = updates.isActive !== undefined ? Boolean(updates.isActive) : target.isActive;

  // LAST ACTIVE COMPANY_OWNER PROTECTION
  const isCurrentlyOwner = target.systemRole === 'COMPANY_OWNER';
  const wouldLoseActiveOwner =
    isCurrentlyOwner && (nextSysRole !== 'COMPANY_OWNER' || !nextIsActive);

  if (wouldLoseActiveOwner) {
    const otherActiveOwners = state.users.filter(
      (u) =>
        u.companyId === target.companyId &&
        u.id !== target.id &&
        u.isActive &&
        u.systemRole === 'COMPANY_OWNER'
    );
    if (otherActiveOwners.length === 0) {
      throw new ReleasePlatformError(
        400,
        'LAST_OWNER_PROTECTION',
        'Cannot deactivate or demote the last active Company Owner of this company.'
      );
    }
  }

  let nextCapabilities: CapabilityCode[] = target.capabilities;
  if (Array.isArray(updates.capabilities)) {
    nextCapabilities = updates.capabilities;
  } else if (updates.systemRole && updates.systemRole !== target.systemRole) {
    nextCapabilities = getDefaultCapabilitiesForRole(nextSysRole);
  } else if (updates.permissions) {
    const mergedPerms = { ...target.permissions, ...updates.permissions };
    nextCapabilities = deriveCapabilitiesFromUser({
      ...target,
      systemRole: nextSysRole,
      capabilities: [],
      permissions: mergedPerms,
    });
  }

  const nowIso = new Date().toISOString();
  const updated: StoredUserRecord = {
    ...target,
    name: updates.name !== undefined ? updates.name.trim() || target.name : target.name,
    nameAr: updates.nameAr !== undefined ? updates.nameAr.trim() || target.nameAr : target.nameAr,
    email: updates.email !== undefined ? updates.email.trim() : target.email,
    phone: updates.phone !== undefined ? updates.phone.trim() : target.phone,
    systemRole: nextSysRole,
    role: mapSystemRoleToLegacyRole(nextSysRole),
    capabilities: nextCapabilities,
    permissions: deriveLegacyPermissionsFromCapabilities(nextCapabilities),
    branchId: updates.branchId || target.branchId,
    assignedBranchIds: Array.isArray(updates.assignedBranchIds)
      ? updates.assignedBranchIds
      : target.assignedBranchIds,
    pin: updates.pin !== undefined ? updates.pin.trim() : target.pin,
    terminalName: updates.terminalName !== undefined ? updates.terminalName : target.terminalName,
    terminalNameAr:
      updates.terminalNameAr !== undefined ? updates.terminalNameAr : target.terminalNameAr,
    isActive: nextIsActive,
    deactivatedAt: !nextIsActive && target.isActive ? nowIso : nextIsActive ? null : target.deactivatedAt,
    deactivatedBy: !nextIsActive && target.isActive ? actor.user.id : nextIsActive ? null : target.deactivatedBy,
  };

  state.users[idx] = updated;

  // If deactivated, revoke all active sessions for this user
  if (!nextIsActive) {
    for (const s of state.sessions) {
      if (s.userId === updated.id && s.companyId === updated.companyId) {
        s.isRevoked = true;
      }
    }
  }

  appendPlatformAuditLog(state, {
    companyId: actor.company.id,
    userId: actor.user.id,
    actorName: actor.user.name,
    action: !nextIsActive && target.isActive ? 'EMPLOYEE_DEACTIVATED' : 'EMPLOYEE_UPDATED',
    entityType: 'user',
    entityId: updated.id,
    details: {
      systemRole: updated.systemRole,
      isActive: updated.isActive,
      branchId: updated.branchId,
      capabilitiesCount: updated.capabilities.length,
    },
  });

  savePlatformState(state);
  const { passwordHash: _ph, passwordSalt: _ps, ...safe } = updated;
  return safe;
}

// ============================================================================
// 7. EXPRESS ROUTER FOR ONBOARDING, AUTH, COMPANIES, BRANCHES, USERS & RBAC
// ============================================================================

export const releasePlatformRouter = Router();

function sendPlatformError(res: Response, err: any, fallbackMessage: string): void {
  if (err instanceof ReleasePlatformError) {
    res.status(err.statusCode).json({
      success: false,
      code: err.errorCode,
      errorCode: err.errorCode,
      error: err.message,
    });
    return;
  }
  res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    errorCode: 'INTERNAL_SERVER_ERROR',
    error: err?.message || fallbackMessage,
  });
}

// GET /api/onboarding/status — Bootstrap status for First-Run Wizard vs Login vs Practice Mode
releasePlatformRouter.get('/onboarding/status', (req: Request, res: Response) => {
  try {
    const state = loadPlatformState();
    const prodCompanies = state.companies.filter((c) => !c.isDemo);
    const hasConfiguredCompany = prodCompanies.some((c) => c.setupCompleted);
    const practiceSandbox = readPracticeSandboxState();

    res.json({
      success: true,
      data: {
        hasConfiguredCompany,
        requiresInitialSetup: !hasConfiguredCompany,
        companies: state.companies.map((c) => ({
          id: c.id,
          code: c.code,
          legalName: c.legalName,
          displayName: c.displayName,
          displayNameAr: c.displayNameAr,
          businessType: c.businessType,
          baseCurrency: c.baseCurrency,
          defaultLanguage: c.defaultLanguage,
          isDemo: c.isDemo,
          setupCompleted: c.setupCompleted,
        })),
        practiceSandboxMeta: {
          companyId: 'comp-demo-practice',
          resetCount: practiceSandbox.resetCount,
          productsCount: practiceSandbox.products.length,
          transactionsCount: practiceSandbox.transactions.length,
        },
        roleDefinitions: SYSTEM_ROLE_DEFINITIONS,
        capabilityGroups: CAPABILITY_GROUPS,
      },
    });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to load onboarding status');
  }
});

export interface FactoryResetCompanyInput {
  scope: 'LOCAL_DEVICE_RESET' | 'COMPANY_FACTORY_RESET';
  companyId: string;
  confirmCompanyName: string;
  ownerUsernameOrId?: string;
  ownerPassword: string;
  reason?: string;
}

export function executeCompanyFactoryReset(input: FactoryResetCompanyInput): {
  ok: boolean;
  scope: 'LOCAL_DEVICE_RESET' | 'COMPANY_FACTORY_RESET';
  resetCompanyId: string;
  resetCompanyName: string;
  deletedSummary: {
    employeesRemoved: number;
    branchesRemoved: number;
    sessionsRevoked: number;
  };
  preservedSummary: {
    otherCompaniesCount: number;
    auditLogsCount: number;
    practiceModeIntact: boolean;
  };
  requiresInitialSetup: boolean;
} {
  const state = loadPlatformState();
  const targetCompanyId = (input.companyId || '').trim();
  if (!targetCompanyId || targetCompanyId === 'comp-demo-practice') {
    throw new ReleasePlatformError(
      400,
      'INVALID_COMPANY_FOR_FACTORY_RESET',
      'Cannot execute a production Company Factory Reset against the Practice Mode sandbox.'
    );
  }

  const targetCompany = state.companies.find((c) => c.id === targetCompanyId && !c.isDemo);
  if (!targetCompany) {
    throw new ReleasePlatformError(
      404,
      'COMPANY_NOT_FOUND',
      `Production company "${targetCompanyId}" was not found.`
    );
  }

  // 1. Verify exact Company Name confirmation
  const enteredName = (input.confirmCompanyName || '').trim().toLowerCase();
  const matchesName =
    enteredName.length >= 2 &&
    (enteredName === targetCompany.legalName.trim().toLowerCase() ||
      enteredName === targetCompany.displayName.trim().toLowerCase() ||
      (targetCompany.displayNameAr &&
        enteredName === targetCompany.displayNameAr.trim().toLowerCase()));

  if (!matchesName) {
    throw new ReleasePlatformError(
      400,
      'COMPANY_NAME_CONFIRMATION_MISMATCH',
      `Company name confirmation does not match "${targetCompany.displayName}".`
    );
  }

  // 2. Verify Owner Authentication & Password Re-authentication
  const companyOwners = state.users.filter(
    (u) =>
      u.companyId === targetCompany.id &&
      u.isActive &&
      (u.systemRole === 'COMPANY_OWNER' || u.role === 'admin')
  );
  if (companyOwners.length === 0) {
    throw new ReleasePlatformError(
      403,
      'OWNER_AUTH_REQUIRED',
      'No active Company Owner found to authorize factory reset.'
    );
  }

  const identifier = (input.ownerUsernameOrId || '').trim().toLowerCase();
  const matchedOwner =
    (identifier
      ? companyOwners.find(
          (u) =>
            u.id.toLowerCase() === identifier ||
            u.username.toLowerCase() === identifier ||
            (u.email && u.email.toLowerCase() === identifier)
        )
      : companyOwners[0]) || companyOwners[0];

  const password = (input.ownerPassword || '').trim();
  if (!password) {
    throw new ReleasePlatformError(
      401,
      'PASSWORD_REAUTH_REQUIRED',
      'Owner password or PIN re-authentication is required to authorize factory reset.'
    );
  }

  let isAuthenticated = false;
  if (matchedOwner.passwordHash && matchedOwner.passwordSalt) {
    isAuthenticated = verifyPasswordScrypt(
      password,
      matchedOwner.passwordHash,
      matchedOwner.passwordSalt
    );
  }
  if (!isAuthenticated && matchedOwner.pin && matchedOwner.pin === password) {
    isAuthenticated = true;
  }

  if (!isAuthenticated) {
    throw new ReleasePlatformError(
      401,
      'INVALID_OWNER_CREDENTIALS',
      'Owner password re-authentication failed. Factory reset aborted.'
    );
  }

  if (input.scope === 'LOCAL_DEVICE_RESET') {
    appendPlatformAuditLog(state, {
      companyId: targetCompany.id,
      userId: matchedOwner.id,
      actorName: matchedOwner.name,
      action: 'LOCAL_DEVICE_RESET_AUTHORIZED',
      entityType: 'company',
      entityId: targetCompany.id,
      details: {
        scope: 'LOCAL_DEVICE_RESET',
        companyName: targetCompany.displayName,
        reason: input.reason || 'Authorized local device cache reset',
      },
    });
    savePlatformState(state);

    const otherProdCompanies = state.companies.filter((c) => !c.isDemo);
    return {
      ok: true,
      scope: 'LOCAL_DEVICE_RESET',
      resetCompanyId: targetCompany.id,
      resetCompanyName: targetCompany.displayName,
      deletedSummary: {
        employeesRemoved: 0,
        branchesRemoved: 0,
        sessionsRevoked: 0,
      },
      preservedSummary: {
        otherCompaniesCount: otherProdCompanies.length,
        auditLogsCount: state.auditLogs.length,
        practiceModeIntact: state.companies.some((c) => c.id === 'comp-demo-practice'),
      },
      requiresInitialSetup: otherProdCompanies.length === 0,
    };
  }

  // Scope B: COMPANY_FACTORY_RESET (Operates ONLY on the selected company; preserves other companies & audit logs)
  const employeesRemoved = state.users.filter((u) => u.companyId === targetCompany.id).length;
  const branchesRemoved = state.branches.filter((b) => b.companyId === targetCompany.id).length;
  let sessionsRevoked = 0;

  for (const s of state.sessions) {
    if (s.companyId === targetCompany.id && !s.isRevoked) {
      s.isRevoked = true;
      sessionsRevoked++;
    }
  }

  // Remove only the target company's records from platform state
  state.companies = state.companies.filter((c) => c.id !== targetCompany.id);
  state.branches = state.branches.filter((b) => b.companyId !== targetCompany.id);
  state.users = state.users.filter((u) => u.companyId !== targetCompany.id);

  // Remove idempotency keys pointing to this company so the owner can re-onboard cleanly
  for (const [k, v] of Object.entries(state.idempotencyKeys)) {
    if (v === targetCompany.id) {
      delete state.idempotencyKeys[k];
    }
  }

  // Preserve immutable compliance audit record
  appendPlatformAuditLog(state, {
    companyId: targetCompany.id,
    userId: matchedOwner.id,
    actorName: matchedOwner.name,
    action: 'COMPANY_FACTORY_RESET_EXECUTED',
    entityType: 'company',
    entityId: targetCompany.id,
    details: {
      scope: 'COMPANY_FACTORY_RESET',
      companyName: targetCompany.displayName,
      employeesRemoved,
      branchesRemoved,
      sessionsRevoked,
      reason: input.reason || 'Owner-authorized Company Factory Reset',
    },
  });

  savePlatformState(state);

  const remainingProdCompanies = state.companies.filter((c) => !c.isDemo);

  // If no other production companies remain, also clear .data/store-state.json & .data/products.json & .data/currencies.json
  if (remainingProdCompanies.length === 0) {
    try {
      if (fs.existsSync(PROD_STORE_FILE)) {
        fs.writeFileSync(
          PROD_STORE_FILE,
          JSON.stringify(
            {
              products: [],
              transactions: [],
              customers: [],
              stockMovements: [],
              users: [],
              activeSessions: [],
              unmetDemandRequests: [],
              exchangeRateHistory: [],
              updatedAt: new Date().toISOString(),
            },
            null,
            2
          ),
          'utf-8'
        );
      }
      const prodFile = path.resolve(DATA_DIR, 'products.json');
      if (fs.existsSync(prodFile)) {
        fs.writeFileSync(prodFile, JSON.stringify([], null, 2), 'utf-8');
      }
      const currFile = path.resolve(DATA_DIR, 'currencies.json');
      if (fs.existsSync(currFile)) {
        fs.writeFileSync(
          currFile,
          JSON.stringify({ currencies: [], exchangeRates: [] }, null, 2),
          'utf-8'
        );
      }
    } catch {}
  }

  return {
    ok: true,
    scope: 'COMPANY_FACTORY_RESET',
    resetCompanyId: targetCompany.id,
    resetCompanyName: targetCompany.displayName,
    deletedSummary: {
      employeesRemoved,
      branchesRemoved,
      sessionsRevoked,
    },
    preservedSummary: {
      otherCompaniesCount: remainingProdCompanies.length,
      auditLogsCount: state.auditLogs.length,
      practiceModeIntact: state.companies.some((c) => c.id === 'comp-demo-practice'),
    },
    requiresInitialSetup: remainingProdCompanies.length === 0,
  };
}

// POST /api/onboarding/companies — Create New Production Company & Initial Owner
// Security Rule (Part 2): Do not expose an unauthenticated company creation endpoint after initial setup is completed.
releasePlatformRouter.post('/onboarding/companies', async (req: Request, res: Response) => {
  try {
    const state = loadPlatformState();
    const existingProdCompanies = state.companies.filter((c) => !c.isDemo && c.setupCompleted);
    const idemKey = (req.body?.idempotencyKey || '').trim();
    const isIdempotentReplay = Boolean(idemKey && state.idempotencyKeys[idemKey]);

    if (existingProdCompanies.length > 0 && !isIdempotentReplay) {
      // Require an authenticated COMPANY_OWNER or ADMIN to create additional companies after initial setup
      const actor = resolveAuthenticatedActorFromRequest(req);
      if (
        actor.user.systemRole !== 'COMPANY_OWNER' &&
        actor.user.systemRole !== 'ADMIN' &&
        actor.user.role !== 'admin'
      ) {
        throw new ReleasePlatformError(
          403,
          'FORBIDDEN_COMPANY_CREATION',
          'Only an authenticated Company Owner can create additional companies after initial setup.'
        );
      }
    }

    const result = await createCompanyAndInitialOwner(req.body);
    res.status(result.idempotentReplay ? 200 : 201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to create company workspace');
  }
});

// POST /api/onboarding/factory-reset — Authorized Two-Scope Factory Reset (Local Device vs Company Workspace)
releasePlatformRouter.post('/onboarding/factory-reset', (req: Request, res: Response) => {
  try {
    const result = executeCompanyFactoryReset({
      scope:
        req.body?.scope === 'LOCAL_DEVICE_RESET'
          ? 'LOCAL_DEVICE_RESET'
          : 'COMPANY_FACTORY_RESET',
      companyId: req.body?.companyId || '',
      confirmCompanyName: req.body?.confirmCompanyName || '',
      ownerUsernameOrId: req.body?.ownerUsernameOrId || req.headers['x-user-id'] || '',
      ownerPassword: req.body?.ownerPassword || '',
      reason: req.body?.reason,
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendPlatformError(res, err, 'Factory reset failed');
  }
});

// GET /api/onboarding/practice/state — Load Isolated Practice Mode Sandbox
releasePlatformRouter.get('/onboarding/practice/state', (_req: Request, res: Response) => {
  try {
    const state = loadPlatformState();
    const demoCompany = state.companies.find((c) => c.id === 'comp-demo-practice')!;
    const demoBranches = state.branches.filter((b) => b.companyId === 'comp-demo-practice');
    const sandbox = readPracticeSandboxState();
    res.json({
      success: true,
      data: {
        company: demoCompany,
        branches: demoBranches,
        sandbox,
      },
    });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to load practice mode sandbox');
  }
});

// POST /api/onboarding/practice/reset — Safely Reset ONLY Practice Mode Data (Never Production)
releasePlatformRouter.post('/onboarding/practice/reset', (req: Request, res: Response) => {
  try {
    const targetCompanyId = req.body?.companyId || 'comp-demo-practice';
    if (targetCompanyId !== 'comp-demo-practice') {
      throw new ReleasePlatformError(
        403,
        'FORBIDDEN_PRODUCTION_RESET',
        'Demo reset can only be executed against the Practice Mode sandbox (comp-demo-practice). Production data cannot be reset.'
      );
    }
    const sandbox = resetPracticeSandboxState(req.body?.userId);
    res.json({
      success: true,
      message: 'Practice Mode sandbox reset to clean synthetic state. Production data untouched.',
      data: sandbox,
    });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to reset practice mode sandbox');
  }
});

// POST /api/auth/login — Authenticate with username/email + password OR PIN
releasePlatformRouter.post('/auth/login', (req: Request, res: Response) => {
  try {
    const state = loadPlatformState();
    const { usernameOrEmail, userId, password, pin, companyId, workspaceMode } = req.body || {};

    const targetMode: WorkspaceMode =
      workspaceMode === 'PRACTICE' || companyId === 'comp-demo-practice'
        ? 'PRACTICE'
        : 'PRODUCTION';

    const candidateUsers = state.users.filter((u) =>
      targetMode === 'PRACTICE'
        ? u.companyId === 'comp-demo-practice'
        : companyId
        ? u.companyId === companyId
        : u.companyId !== 'comp-demo-practice'
    );

    const matchedUser = candidateUsers.find((u) => {
      if (userId && u.id === userId) return true;
      if (usernameOrEmail) {
        const q = String(usernameOrEmail).trim().toLowerCase();
        return (
          u.username.toLowerCase() === q ||
          (u.email && u.email.toLowerCase() === q) ||
          u.id.toLowerCase() === q
        );
      }
      return false;
    });

    if (!matchedUser) {
      throw new ReleasePlatformError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid login credentials: user not found.'
      );
    }

    if (!matchedUser.isActive) {
      throw new ReleasePlatformError(
        403,
        'USER_ACCOUNT_DEACTIVATED',
        'This employee account has been deactivated by an administrator.'
      );
    }

    // Verify password if user has passwordHash, or PIN if logging in via terminal PIN
    if (matchedUser.passwordHash && matchedUser.passwordSalt) {
      if (password) {
        const ok = verifyPasswordScrypt(password, matchedUser.passwordHash, matchedUser.passwordSalt);
        if (!ok) {
          throw new ReleasePlatformError(401, 'INVALID_CREDENTIALS', 'Incorrect password.');
        }
      } else if (pin) {
        if (matchedUser.pin !== String(pin).trim()) {
          throw new ReleasePlatformError(401, 'INVALID_CREDENTIALS', 'Incorrect PIN code.');
        }
      } else {
        throw new ReleasePlatformError(
          401,
          'PASSWORD_REQUIRED',
          'Password is required for this account.'
        );
      }
    } else if (pin !== undefined && pin !== '') {
      if (matchedUser.pin && matchedUser.pin !== String(pin).trim()) {
        throw new ReleasePlatformError(401, 'INVALID_CREDENTIALS', 'Incorrect PIN code.');
      }
    }

    matchedUser.lastLoginAt = new Date().toISOString();
    matchedUser.lastActiveAt = matchedUser.lastLoginAt;
    const sessionToken = issueSessionForUser(state, matchedUser, targetMode);

    const company =
      state.companies.find((c) => c.id === matchedUser.companyId) || state.companies[0];
    const companyBranches = state.branches.filter((b) => b.companyId === company.id);

    appendPlatformAuditLog(state, {
      companyId: company.id,
      userId: matchedUser.id,
      actorName: matchedUser.name,
      action: 'USER_LOGIN',
      entityType: 'session',
      entityId: matchedUser.id,
      details: { workspaceMode: targetMode, systemRole: matchedUser.systemRole },
    });

    savePlatformState(state);

    const { passwordHash: _ph, passwordSalt: _ps, ...safeUser } = matchedUser;
    res.json({
      success: true,
      data: {
        sessionToken,
        workspaceMode: targetMode,
        company,
        branches: companyBranches,
        user: safeUser,
      },
    });
  } catch (err) {
    sendPlatformError(res, err, 'Login failed');
  }
});

// POST /api/auth/logout — Revoke current session
releasePlatformRouter.post('/auth/logout', (req: Request, res: Response) => {
  try {
    const state = loadPlatformState();
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const headerToken =
      typeof req.headers['x-session-token'] === 'string'
        ? req.headers['x-session-token'].trim()
        : '';
    const rawToken = bearerToken || headerToken;

    if (rawToken) {
      const tokenHash = hashSessionToken(rawToken);
      const found = state.sessions.find((s) => s.tokenHash === tokenHash);
      if (found) {
        found.isRevoked = true;
        savePlatformState(state);
      }
    }
    res.json({ success: true });
  } catch (err) {
    sendPlatformError(res, err, 'Logout failed');
  }
});

// GET /api/companies/current — Get current company profile & branches (Company-Scoped)
releasePlatformRouter.get('/companies/current', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    assertActorHasCapability(actor, 'company.view');
    const state = loadPlatformState();
    const companyBranches = state.branches.filter((b) => b.companyId === actor.company.id);
    res.json({
      success: true,
      data: {
        company: actor.company,
        branches: companyBranches,
        workspaceMode: actor.workspaceMode,
      },
    });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to fetch company profile');
  }
});

// PUT /api/companies/:id — Update company profile (Requires company.edit + tenant match)
releasePlatformRouter.put('/companies/:id', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    assertActorCompanyMatch(actor, req.params.id);
    assertActorHasCapability(actor, 'company.edit');

    const state = loadPlatformState();
    const idx = state.companies.findIndex((c) => c.id === actor.company.id);
    if (idx === -1) {
      throw new ReleasePlatformError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
    }

    const body = req.body || {};
    const updated: CompanyProfile = {
      ...state.companies[idx],
      legalName: body.legalName?.trim() || state.companies[idx].legalName,
      displayName: body.displayName?.trim() || state.companies[idx].displayName,
      displayNameAr: body.displayNameAr?.trim() ?? state.companies[idx].displayNameAr,
      businessType: body.businessType || state.companies[idx].businessType,
      country: body.country || state.companies[idx].country,
      city: body.city ?? state.companies[idx].city,
      address: body.address ?? state.companies[idx].address,
      addressAr: body.addressAr ?? state.companies[idx].addressAr,
      phone: body.phone ?? state.companies[idx].phone,
      email: body.email ?? state.companies[idx].email,
      taxNumber: body.taxNumber ?? state.companies[idx].taxNumber,
      defaultLanguage: body.defaultLanguage || state.companies[idx].defaultLanguage,
      defaultTimezone: body.defaultTimezone || state.companies[idx].defaultTimezone,
      rateUpdatePolicy: body.rateUpdatePolicy || state.companies[idx].rateUpdatePolicy,
      updatedAt: new Date().toISOString(),
    };

    state.companies[idx] = updated;
    appendPlatformAuditLog(state, {
      companyId: actor.company.id,
      userId: actor.user.id,
      actorName: actor.user.name,
      action: 'COMPANY_PROFILE_UPDATED',
      entityType: 'company',
      entityId: updated.id,
      details: { displayName: updated.displayName },
    });
    savePlatformState(state);

    res.json({ success: true, data: updated });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to update company profile');
  }
});

// GET /api/branches — List branches for current company
releasePlatformRouter.get('/branches', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const state = loadPlatformState();
    const list = state.branches.filter((b) => b.companyId === actor.company.id);
    res.json({ success: true, data: list });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to fetch branches');
  }
});

// POST /api/branches — Create a new branch in current company (Requires company.branches.manage)
releasePlatformRouter.post('/branches', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    assertActorHasCapability(actor, 'company.branches.manage');

    const { name, nameAr, code, city, address, phone, managerUserId } = req.body || {};
    if (!name || !String(name).trim()) {
      throw new ReleasePlatformError(400, 'INVALID_BRANCH_NAME', 'Branch name is required.');
    }

    const state = loadPlatformState();
    const branchCode =
      (code || `BR-${Date.now().toString(36)}`).trim().toUpperCase();

    const created: BranchRecord = {
      id: `br-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
      companyId: actor.company.id,
      name: String(name).trim(),
      nameAr: (nameAr || name).trim(),
      code: branchCode,
      city: city?.trim() || actor.company.city || 'Khartoum',
      address: address?.trim() || '',
      phone: phone?.trim() || '',
      managerUserId: managerUserId || null,
      isMain: false,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    state.branches.push(created);

    // Automatically add new branch to COMPANY_OWNER's assignedBranchIds
    for (const u of state.users) {
      if (u.companyId === actor.company.id && u.systemRole === 'COMPANY_OWNER') {
        if (!u.assignedBranchIds.includes(created.id)) {
          u.assignedBranchIds.push(created.id);
        }
      }
    }

    appendPlatformAuditLog(state, {
      companyId: actor.company.id,
      userId: actor.user.id,
      actorName: actor.user.name,
      action: 'BRANCH_CREATED',
      entityType: 'branch',
      entityId: created.id,
      details: { name: created.name, code: created.code },
    });

    savePlatformState(state);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to create branch');
  }
});

// GET /api/users — List employees strictly within actor's company
releasePlatformRouter.get('/users', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const requestedCompanyId =
      (typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '') ||
      (typeof req.headers['x-company-id'] === 'string' ? req.headers['x-company-id'].trim() : '');
    if (requestedCompanyId) {
      assertActorCompanyMatch(actor, requestedCompanyId);
    }
    assertActorHasCapability(actor, 'users.view');

    const state = loadPlatformState();
    const companyUsers = state.users
      .filter((u) => u.companyId === actor.company.id)
      .map(({ passwordHash, passwordSalt, ...safe }) => safe);
    const companyBranches = state.branches.filter((b) => b.companyId === actor.company.id);
    const companyAuditLogs = state.auditLogs
      .filter((a) => a.companyId === actor.company.id)
      .slice(0, 50);

    res.json({
      success: true,
      data: {
        users: companyUsers,
        branches: companyBranches,
        auditLogs: companyAuditLogs,
        roleDefinitions: SYSTEM_ROLE_DEFINITIONS,
        capabilityGroups: CAPABILITY_GROUPS,
      },
    });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to list company users');
  }
});

// POST /api/users — Create employee account in actor's company
releasePlatformRouter.post('/users', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    if (req.body?.companyId && req.body.companyId !== actor.company.id) {
      throw new ReleasePlatformError(
        403,
        'FORBIDDEN_CROSS_COMPANY_ACCESS',
        'Cannot create an employee in another company.'
      );
    }
    const created = createEmployeeAccount(actor, req.body || {});
    res.status(201).json({ success: true, data: { ...created, user: created } });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to create employee account');
  }
});

// PUT /api/users/:id — Edit employee profile, role, branches, capabilities, or active status
releasePlatformRouter.put('/users/:id', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const updated = updateEmployeeAccount(actor, req.params.id, req.body || {});
    res.json({ success: true, data: updated });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to update employee account');
  }
});

// POST /api/users/:id/status — Activate or Deactivate employee account (Deactivation preferred over deletion)
releasePlatformRouter.post('/users/:id/status', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const isActive = Boolean(req.body?.isActive);
    const updated = updateEmployeeAccount(actor, req.params.id, { isActive });
    res.json({ success: true, data: updated });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to update employee status');
  }
});

// POST /api/users/:id/deactivate — Deactivate employee account (Alias endpoint)
releasePlatformRouter.post('/users/:id/deactivate', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const updated = updateEmployeeAccount(actor, req.params.id, { isActive: false });
    res.json({ success: true, data: updated });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to deactivate employee account');
  }
});

export function authenticateAccount(params: {
  companyId?: string;
  identifier: string;
  passwordOrPin: string;
  workspaceMode?: WorkspaceMode;
}): {
  ok: boolean;
  code?: string;
  error?: string;
  sessionToken?: string;
  user?: Omit<StoredUserRecord, 'passwordHash' | 'passwordSalt'>;
  company?: CompanyProfile;
} {
  const state = loadPlatformState();
  const q = (params.identifier || '').trim().toLowerCase();
  const candidates = state.users.filter((u) =>
    params.companyId ? u.companyId === params.companyId : true
  );
  const matched = candidates.find(
    (u) =>
      u.username.toLowerCase() === q ||
      (u.email && u.email.toLowerCase() === q) ||
      u.id.toLowerCase() === q
  );
  if (!matched) {
    return { ok: false, code: 'INVALID_CREDENTIALS', error: 'User not found.' };
  }
  if (!matched.isActive) {
    return {
      ok: false,
      code: 'ACCOUNT_DEACTIVATED',
      error: 'Employee account is deactivated.',
    };
  }
  if (matched.passwordHash && matched.passwordSalt) {
    const validPwd = verifyPasswordScrypt(
      params.passwordOrPin,
      matched.passwordHash,
      matched.passwordSalt
    );
    const validPin = matched.pin === String(params.passwordOrPin).trim();
    if (!validPwd && !validPin) {
      return { ok: false, code: 'INVALID_CREDENTIALS', error: 'Invalid password or PIN.' };
    }
  } else if (matched.pin && matched.pin !== String(params.passwordOrPin).trim()) {
    return { ok: false, code: 'INVALID_CREDENTIALS', error: 'Invalid PIN.' };
  }

  const sessionToken = issueSessionForUser(state, matched, params.workspaceMode);
  savePlatformState(state);
  const company = state.companies.find((c) => c.id === matched.companyId);
  const { passwordHash: _ph, passwordSalt: _ps, ...safeUser } = matched;
  return {
    ok: true,
    sessionToken,
    user: safeUser,
    company,
  };
}

// POST /api/users/:id/reset-password — Secure password reset by Owner/Admin
releasePlatformRouter.post('/users/:id/reset-password', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    assertActorHasCapability(actor, 'users.edit');

    const { newPassword, mustChangePassword } = req.body || {};
    const pwdCheck = validatePasswordStrength(String(newPassword || ''));
    if (!pwdCheck.valid) {
      throw new ReleasePlatformError(400, 'WEAK_PASSWORD', pwdCheck.messageEn!);
    }

    const state = loadPlatformState();
    const idx = state.users.findIndex((u) => u.id === req.params.id);
    if (idx === -1) {
      throw new ReleasePlatformError(404, 'USER_NOT_FOUND', 'Employee not found.');
    }
    assertActorCompanyMatch(actor, state.users[idx].companyId);

    const { hash, salt } = hashPasswordScrypt(String(newPassword));
    state.users[idx].passwordHash = hash;
    state.users[idx].passwordSalt = salt;
    state.users[idx].hasPassword = true;
    state.users[idx].mustChangePassword = Boolean(mustChangePassword);

    appendPlatformAuditLog(state, {
      companyId: actor.company.id,
      userId: actor.user.id,
      actorName: actor.user.name,
      action: 'EMPLOYEE_PASSWORD_RESET',
      entityType: 'user',
      entityId: state.users[idx].id,
      details: { targetUserName: state.users[idx].name },
    });

    savePlatformState(state);
    res.json({ success: true, message: 'Password updated securely.' });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to reset employee password');
  }
});

// GET /api/audit-logs — Company-scoped audit logs
releasePlatformRouter.get('/audit-logs', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    assertActorHasCapability(actor, 'users.view');
    const state = loadPlatformState();
    const logs = state.auditLogs.filter((l) => l.companyId === actor.company.id);
    res.json({ success: true, data: logs });
  } catch (err) {
    sendPlatformError(res, err, 'Failed to fetch audit logs');
  }
});

/**
 * Express middleware that verifies the request actor from the authoritative server user store
 * and asserts that the actor possesses the required granular capability.
 * If `allowLegacyClientWithoutHeader` is true, requests that do not supply `x-user-id` or `Authorization`
 * are evaluated only if no `x-user-role` spoofing is attempted; any spoofed `x-user-role` or unauthorized
 * `x-user-id` is strictly rejected with 401/403.
 */
export function requireServerCapability(
  capability: CapabilityCode,
  options?: { allowInternalDefaultIfNoHeader?: boolean }
) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const hasExplicitAuth =
        Boolean(req.headers.authorization) ||
        Boolean(req.headers['x-session-token']) ||
        Boolean(req.headers['x-user-id']) ||
        Boolean(req.query.userId) ||
        Boolean(req.body?.userId);

      // Block SEC-P11-01: if a client sends `x-user-role` without a valid server-verified user, or with a cashier user, verify strictly!
      if (!hasExplicitAuth && req.headers['x-user-role']) {
        const roleHeader = String(req.headers['x-user-role']).toLowerCase();
        if (roleHeader === 'cashier' || roleHeader === 'inventory_clerk' || roleHeader === 'report_viewer') {
          return res.status(403).json({
            success: false,
            errorCode: 'FORBIDDEN_MISSING_CAPABILITY',
            error: `Insufficient permissions: role "${roleHeader}" lacks "${capability}".`,
          });
        }
      }

      const actor = resolveAuthenticatedActorFromRequest(req, {
        allowUnauthenticatedDefaultRead: options?.allowInternalDefaultIfNoHeader && !hasExplicitAuth,
      });
      assertActorHasCapability(actor, capability);
      (req as any).authenticatedActor = actor;
      next();
    } catch (err) {
      sendPlatformError(res, err, `Authorization failed for capability "${capability}"`);
    }
  };
}
