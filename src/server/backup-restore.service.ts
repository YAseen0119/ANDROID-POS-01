/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { Router, Request, Response } from 'express';
import {
  ALL_BACKUP_MODULE_IDS,
  applyIntelligentBackupMerge,
  analyzeBackupMergePreview,
  BackupEnvelopeV1,
  BackupManifestV1,
  BackupMergeExecutionSummary,
  BackupMergePreviewReport,
  BackupModuleId,
  BackupPayloadV1,
  computeBackupModuleRecordCounts,
  ExecuteBackupMergeOptions,
  filterPayloadByIncludedModules,
  remapBackupPayloadForNewCompany,
  resolveBackupModuleDependencies,
  scrubSensitiveUserFields,
} from '../lib/backup-merge-engine.ts';
import {
  appendPlatformAuditLog,
  assertActorCompanyMatch,
  assertActorHasCapability,
  AuthenticatedActorContext,
  hashPasswordScrypt,
  issueSessionForUser,
  loadPlatformState,
  PRACTICE_COMPANY_ID,
  ReleasePlatformError,
  resolveAuthenticatedActorFromRequest,
  savePlatformState,
  StoredUserRecord,
  validatePasswordStrength,
  verifyPasswordScrypt,
} from './release-onboarding.service.ts';
import {
  ALL_CAPABILITY_CODES,
  CapabilityCode,
  deriveLegacyPermissionsFromCapabilities,
} from '../lib/rbac-capabilities.ts';
import type { CompanyProfile } from '../lib/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.resolve(ROOT_DIR, '.data');
const BACKUPS_DIR = path.resolve(DATA_DIR, 'backups');
const PROD_STORE_FILE = path.resolve(DATA_DIR, 'store-state.json');
const PRODUCTS_FILE = path.resolve(DATA_DIR, 'products.json');
const CURRENCIES_FILE = path.resolve(DATA_DIR, 'currencies.json');
const EXCHANGE_RATES_FILE = path.resolve(DATA_DIR, 'exchange-rates.json');
const UOM_FILE = path.resolve(DATA_DIR, 'uom.json');
const CUSTOM_FIELDS_FILE = path.resolve(DATA_DIR, 'custom-fields.json');
const COMPANY_MODULES_DIR = path.resolve(DATA_DIR, 'company-modules');

export const CURRENT_BACKUP_SCHEMA_VERSION = '2025.05.1';
export const CURRENT_BACKUP_APP_VERSION = '2.4.0';

// ============================================================================
// 1. CRYPTOGRAPHIC CHECKSUMS, COMPRESSION & AES-256-GCM ENCRYPTION
// ============================================================================

export function computeSha256Hex(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function computeModuleChecksums(
  payload: BackupPayloadV1,
  modulesIncluded: BackupModuleId[]
): Record<BackupModuleId, string> {
  const inc = new Set<BackupModuleId>(modulesIncluded);
  const extractModuleSlice = (modId: BackupModuleId): any => {
    if (!inc.has(modId)) return null;
    switch (modId) {
      case 'company_settings':
        return {
          companyProfile: payload.companyProfile,
          storeSettings: payload.storeSettings,
          invoiceSettings: payload.invoiceSettings,
        };
      case 'currencies':
        return {
          currencies: payload.currencies,
          exchangeRates: payload.exchangeRates,
          exchangeRateItems: payload.exchangeRateItems,
          exchangeRateHistory: payload.exchangeRateHistory,
        };
      case 'branches':
        return payload.branches;
      case 'employees_permissions':
        return payload.employees;
      case 'uom_custom_fields':
        return {
          unitsOfMeasure: payload.unitsOfMeasure,
          customFieldDefinitions: payload.customFieldDefinitions,
        };
      case 'categories':
        return payload.categories;
      case 'products':
        return payload.products;
      case 'customers':
        return payload.customers;
      case 'suppliers':
        return payload.suppliers;
      case 'inventory':
        return {
          stockMovements: payload.stockMovements,
          branchTransfers: payload.branchTransfers,
        };
      case 'purchases':
        return payload.purchases;
      case 'sales':
        return payload.transactions;
      case 'expenses':
        return payload.expenses;
      case 'accounting':
        return {
          accounts: payload.accounts,
          journalEntries: payload.journalEntries,
        };
      case 'intelligence_audit':
        return {
          unmetDemandRequests: payload.unmetDemandRequests,
          intelligenceLifecycleItems: payload.intelligenceLifecycleItems,
          auditLogs: payload.auditLogs,
        };
    }
  };

  const hashes = {} as Record<BackupModuleId, string>;
  for (const modId of ALL_BACKUP_MODULE_IDS) {
    const slice = extractModuleSlice(modId);
    hashes[modId] = computeSha256Hex(JSON.stringify(slice ?? null));
  }
  return hashes;
}

export function packBackupEnvelope(params: {
  payload: BackupPayloadV1;
  backupId?: string;
  backupType?: 'FULL_COMPANY' | 'SELECTIVE_MODULES' | 'PRE_RESTORE_CHECKPOINT';
  selectedModules?: BackupModuleId[];
  autoIncludeHardDependencies?: boolean;
  createdByUserId: string;
  createdByUsername: string;
  notes?: string;
  encryptionPassword?: string;
  useCompression?: boolean;
}): BackupEnvelopeV1 {
  const backupType = params.backupType || 'FULL_COMPANY';
  const requestedModules =
    backupType === 'FULL_COMPANY' || backupType === 'PRE_RESTORE_CHECKPOINT'
      ? [...ALL_BACKUP_MODULE_IDS]
      : params.selectedModules && params.selectedModules.length > 0
      ? params.selectedModules
      : [...ALL_BACKUP_MODULE_IDS];

  const depResult = resolveBackupModuleDependencies(requestedModules, {
    autoIncludeHardDependencies: params.autoIncludeHardDependencies ?? true,
  });

  // Always scrub sensitive user credentials before serializing
  const filteredPayload = filterPayloadByIncludedModules(
    params.payload,
    depResult.modulesIncluded
  );
  filteredPayload.employees = (filteredPayload.employees || []).map((u) =>
    scrubSensitiveUserFields(u)
  );

  const { recordCounts, totalRecords } = computeBackupModuleRecordCounts(
    filteredPayload,
    depResult.modulesIncluded
  );
  const moduleChecksumsSha256 = computeModuleChecksums(
    filteredPayload,
    depResult.modulesIncluded
  );

  const nowIso = new Date().toISOString();
  const backupId =
    params.backupId ||
    `bkp-${nowIso.slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;

  const manifest: BackupManifestV1 = {
    backupId,
    backupType,
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    appVersion: CURRENT_BACKUP_APP_VERSION,
    createdAt: nowIso,
    createdByUserId: params.createdByUserId,
    createdByUsername: params.createdByUsername,
    notes: params.notes,
    sourceCompany: {
      companyId: filteredPayload.companyProfile.id,
      code: filteredPayload.companyProfile.code || 'CMP-MAIN',
      legalName: filteredPayload.companyProfile.legalName || 'Company',
      displayName:
        filteredPayload.companyProfile.displayName ||
        filteredPayload.companyProfile.legalName ||
        'Company',
      displayNameAr: filteredPayload.companyProfile.displayNameAr,
      baseCurrency: filteredPayload.companyProfile.baseCurrency || null,
      businessType: filteredPayload.companyProfile.businessType,
    },
    modulesIncluded: depResult.modulesIncluded,
    autoIncludedDependencies: depResult.autoIncludedDependencies,
    dependencyWarnings: depResult.dependencyWarnings,
    recordCounts,
    moduleChecksumsSha256,
    totalRecords,
  };

  const plaintextJson = JSON.stringify(filteredPayload);
  const payloadChecksumSha256 = computeSha256Hex(plaintextJson);

  const compression: 'gzip' | 'none' =
    params.useCompression === false ? 'none' : 'gzip';
  let binaryBuffer: Buffer = Buffer.from(plaintextJson, 'utf-8');
  if (compression === 'gzip') {
    binaryBuffer = zlib.gzipSync(binaryBuffer);
  }

  const pwd = (params.encryptionPassword || '').trim();
  if (pwd.length > 0) {
    const salt = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const kdfParams = { N: 16384, r: 8, p: 1, keyLen: 32 };
    const key = crypto.scryptSync(pwd, salt, kdfParams.keyLen, {
      N: kdfParams.N,
      r: kdfParams.r,
      p: kdfParams.p,
    });
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encryptedBuf = Buffer.concat([
      cipher.update(binaryBuffer),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      formatSignature: 'DQNAMO_POS_BACKUP_V1',
      formatVersion: '1.0.0',
      createdAt: nowIso,
      encrypted: true,
      compression,
      encryptionMeta: {
        algorithm: 'AES-256-GCM',
        kdf: 'scrypt',
        saltHex: salt.toString('hex'),
        ivHex: iv.toString('hex'),
        authTagHex: authTag.toString('hex'),
        kdfParams,
      },
      manifest,
      payloadChecksumSha256,
      payloadData: encryptedBuf.toString('base64'),
    };
  }

  return {
    formatSignature: 'DQNAMO_POS_BACKUP_V1',
    formatVersion: '1.0.0',
    createdAt: nowIso,
    encrypted: false,
    compression,
    manifest,
    payloadChecksumSha256,
    payloadData: binaryBuffer.toString('base64'),
  };
}

export function verifyAndUnpackBackupEnvelope(
  envelopeInput: any,
  decryptionPassword?: string
): {
  envelope: BackupEnvelopeV1;
  manifest: BackupManifestV1;
  payload: BackupPayloadV1;
  integrityVerified: boolean;
} {
  let envelope: BackupEnvelopeV1;
  if (typeof envelopeInput === 'string') {
    try {
      envelope = JSON.parse(envelopeInput);
    } catch {
      throw new ReleasePlatformError(
        400,
        'MALFORMED_BACKUP_FILE',
        'Backup file is not valid JSON.'
      );
    }
  } else if (envelopeInput && typeof envelopeInput === 'object') {
    envelope = envelopeInput as BackupEnvelopeV1;
  } else {
    throw new ReleasePlatformError(
      400,
      'INVALID_BACKUP_ENVELOPE',
      'Backup package is missing or empty.'
    );
  }

  if (
    envelope.formatSignature !== 'DQNAMO_POS_BACKUP_V1' ||
    !envelope.manifest ||
    typeof envelope.payloadData !== 'string' ||
    typeof envelope.payloadChecksumSha256 !== 'string'
  ) {
    throw new ReleasePlatformError(
      400,
      'UNSUPPORTED_BACKUP_FORMAT',
      'Invalid backup format signature or missing manifest/checksum headers.'
    );
  }

  // Verify schema compatibility
  const supportedSchemas = new Set(['2025.05.1', '2025.01.0', '1.0.0']);
  if (!supportedSchemas.has(envelope.manifest.schemaVersion)) {
    throw new ReleasePlatformError(
      400,
      'INCOMPATIBLE_BACKUP_SCHEMA',
      `Backup schema version "${envelope.manifest.schemaVersion}" is not compatible with current engine version "${CURRENT_BACKUP_SCHEMA_VERSION}".`
    );
  }

  let dataBuffer = Buffer.from(envelope.payloadData, 'base64');

  if (envelope.encrypted) {
    const pwd = (decryptionPassword || '').trim();
    if (!pwd) {
      throw new ReleasePlatformError(
        401,
        'BACKUP_PASSWORD_REQUIRED',
        'This backup package is encrypted. Please provide the backup decryption password.'
      );
    }
    const meta = envelope.encryptionMeta;
    if (
      !meta ||
      meta.algorithm !== 'AES-256-GCM' ||
      !meta.saltHex ||
      !meta.ivHex ||
      !meta.authTagHex
    ) {
      throw new ReleasePlatformError(
        400,
        'CORRUPTED_ENCRYPTION_METADATA',
        'Backup encryption metadata is missing or corrupted.'
      );
    }

    try {
      const salt = Buffer.from(meta.saltHex, 'hex');
      const iv = Buffer.from(meta.ivHex, 'hex');
      const authTag = Buffer.from(meta.authTagHex, 'hex');
      const N = meta.kdfParams?.N || 16384;
      const r = meta.kdfParams?.r || 8;
      const p = meta.kdfParams?.p || 1;
      const keyLen = meta.kdfParams?.keyLen || 32;

      const key = crypto.scryptSync(pwd, salt, keyLen, { N, r, p });
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      dataBuffer = Buffer.concat([
        decipher.update(dataBuffer),
        decipher.final(),
      ]);
    } catch {
      throw new ReleasePlatformError(
        401,
        'INVALID_BACKUP_PASSWORD_OR_TAMPERED',
        'Failed to decrypt backup: incorrect encryption password or tampered ciphertext.'
      );
    }
  }

  if (envelope.compression === 'gzip') {
    try {
      dataBuffer = zlib.gunzipSync(dataBuffer);
    } catch {
      throw new ReleasePlatformError(
        400,
        'CORRUPTED_BACKUP_ARCHIVE',
        'Failed to decompress gzip backup payload.'
      );
    }
  }

  const plaintextJson = dataBuffer.toString('utf-8');
  const computedMasterHash = computeSha256Hex(plaintextJson);
  if (computedMasterHash !== envelope.payloadChecksumSha256) {
    throw new ReleasePlatformError(
      400,
      'BACKUP_CHECKSUM_MISMATCH',
      'Backup integrity check failed: master SHA-256 checksum does not match payload.'
    );
  }

  let payload: BackupPayloadV1;
  try {
    payload = JSON.parse(plaintextJson);
  } catch {
    throw new ReleasePlatformError(
      400,
      'CORRUPTED_BACKUP_PAYLOAD',
      'Decrypted backup payload is not valid JSON.'
    );
  }

  // Verify per-module SHA-256 checksums
  const computedModHashes = computeModuleChecksums(
    payload,
    envelope.manifest.modulesIncluded
  );
  for (const modId of envelope.manifest.modulesIncluded) {
    const expectedModHash = envelope.manifest.moduleChecksumsSha256?.[modId];
    if (expectedModHash && computedModHashes[modId] !== expectedModHash) {
      throw new ReleasePlatformError(
        400,
        'MODULE_CHECKSUM_MISMATCH',
        `Backup integrity check failed: module "${modId}" SHA-256 checksum mismatch.`
      );
    }
  }

  // Ensure any user records in unpacked payload have credentials stripped
  if (Array.isArray(payload.employees)) {
    payload.employees = payload.employees.map((u) => scrubSensitiveUserFields(u));
  }

  return {
    envelope,
    manifest: envelope.manifest,
    payload,
    integrityVerified: true,
  };
}

// ============================================================================
// 2. SERVER-SIDE COMPANY DATASET COLLECTOR & PERSISTENCE
// ============================================================================

function readJsonFileSafe<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {}
  return fallback;
}

function writeJsonFileSafe(filePath: string, data: any): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`Could not write ${filePath}:`, err);
  }
}

function getCompanyAuxModulesFilePath(companyId: string): string {
  const safeCompanyId = String(companyId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.resolve(COMPANY_MODULES_DIR, `${safeCompanyId}.json`);
}

export function collectServerCompanyPayload(
  companyId: string,
  clientDatasetOverride?: Partial<BackupPayloadV1>
): BackupPayloadV1 {
  const platformState = loadPlatformState();
  const companyProfile: CompanyProfile =
    clientDatasetOverride?.companyProfile ||
    (platformState.companies.find((c) => c.id === companyId) as CompanyProfile | undefined) || {
      id: companyId,
      code: 'CMP-MAIN',
      legalName: 'Company',
      displayName: 'Company',
      businessType: 'Retail & Wholesale',
      country: 'Sudan',
      defaultLanguage: 'ar',
      fiscalYearStartMonth: 1,
      baseCurrency: 'SDG',
      createdAt: new Date().toISOString(),
    };

  const branches =
    clientDatasetOverride?.branches ||
    platformState.branches.filter((b) => b.companyId === companyId);

  const employees = (
    clientDatasetOverride?.employees ||
    platformState.users.filter((u) => u.companyId === companyId)
  ).map((u) => scrubSensitiveUserFields(u));

  const storeState = readJsonFileSafe<any>(PROD_STORE_FILE, {
    products: [],
    transactions: [],
    customers: [],
    stockMovements: [],
    unmetDemandRequests: [],
  });
  const diskProducts = readJsonFileSafe<any[]>(PRODUCTS_FILE, []);
  const currenciesFile = readJsonFileSafe<any>(CURRENCIES_FILE, []);
  const ratesFile = readJsonFileSafe<any[]>(EXCHANGE_RATES_FILE, []);
  const uomFile = readJsonFileSafe<any>(UOM_FILE, { units: [] });
  const customFieldsFile = readJsonFileSafe<any>(CUSTOM_FIELDS_FILE, { definitions: [] });
  const auxModules = readJsonFileSafe<Partial<BackupPayloadV1>>(
    getCompanyAuxModulesFilePath(companyId),
    {}
  );

  // Resolve products belonging to this company (or unscoped single-company store products)
  const rawProducts: any[] =
    clientDatasetOverride?.products ||
    (Array.isArray(diskProducts) && diskProducts.length > 0
      ? diskProducts
      : storeState.products || []);
  const companyProducts = rawProducts.filter(
    (p) => !p.companyId || p.companyId === companyId
  );

  const rawTransactions: any[] =
    clientDatasetOverride?.transactions || storeState.transactions || [];
  const companyTransactions = rawTransactions.filter(
    (t) => !t.companyId || t.companyId === companyId
  );

  const rawCustomers: any[] =
    clientDatasetOverride?.customers || storeState.customers || [];
  const companyCustomers = rawCustomers.filter(
    (c) => !c.companyId || c.companyId === companyId
  );

  const rawMovements: any[] =
    clientDatasetOverride?.stockMovements || storeState.stockMovements || [];
  const companyMovements = rawMovements.filter(
    (m) => !m.companyId || m.companyId === companyId
  );

  const rawDemand: any[] =
    clientDatasetOverride?.unmetDemandRequests || storeState.unmetDemandRequests || [];
  const companyDemand = rawDemand.filter(
    (d) => !d.companyId || d.companyId === companyId
  );

  const resolvedCurrencies =
    clientDatasetOverride?.currencies ||
    auxModules.currencies ||
    (Array.isArray(currenciesFile)
      ? currenciesFile
      : Array.isArray(currenciesFile?.currencies)
      ? currenciesFile.currencies
      : []);

  const resolvedRateItems =
    clientDatasetOverride?.exchangeRateItems ||
    auxModules.exchangeRateItems ||
    (Array.isArray(ratesFile)
      ? ratesFile
      : Array.isArray(currenciesFile?.exchangeRates)
      ? currenciesFile.exchangeRates
      : []);

  const resolvedRatesMap: Record<string, number> =
    clientDatasetOverride?.exchangeRates ||
    auxModules.exchangeRates || {
      [companyProfile.baseCurrency || 'SDG']: 1,
      SDG: 1,
    };
  for (const r of resolvedRateItems) {
    if (r && r.sourceCurrency && Number(r.rate) > 0) {
      resolvedRatesMap[String(r.sourceCurrency).toUpperCase()] = Number(r.rate);
    }
  }

  return {
    companyProfile,
    storeSettings: clientDatasetOverride?.storeSettings || auxModules.storeSettings,
    invoiceSettings: clientDatasetOverride?.invoiceSettings || auxModules.invoiceSettings,
    currencies: resolvedCurrencies,
    exchangeRates: resolvedRatesMap,
    exchangeRateItems: resolvedRateItems,
    exchangeRateHistory:
      clientDatasetOverride?.exchangeRateHistory || auxModules.exchangeRateHistory || [],
    branches,
    employees,
    unitsOfMeasure:
      clientDatasetOverride?.unitsOfMeasure ||
      auxModules.unitsOfMeasure ||
      (Array.isArray(uomFile) ? uomFile : uomFile.units || []),
    customFieldDefinitions:
      clientDatasetOverride?.customFieldDefinitions ||
      auxModules.customFieldDefinitions ||
      (Array.isArray(customFieldsFile)
        ? customFieldsFile
        : customFieldsFile.definitions || []),
    categories: clientDatasetOverride?.categories || auxModules.categories || [],
    products: companyProducts,
    customers: companyCustomers,
    suppliers: clientDatasetOverride?.suppliers || auxModules.suppliers || [],
    stockMovements: companyMovements,
    branchTransfers:
      clientDatasetOverride?.branchTransfers || auxModules.branchTransfers || [],
    purchases: clientDatasetOverride?.purchases || auxModules.purchases || [],
    transactions: companyTransactions,
    expenses: clientDatasetOverride?.expenses || auxModules.expenses || [],
    accounts: clientDatasetOverride?.accounts || auxModules.accounts || [],
    journalEntries:
      clientDatasetOverride?.journalEntries || auxModules.journalEntries || [],
    unmetDemandRequests: companyDemand,
    intelligenceLifecycleItems:
      clientDatasetOverride?.intelligenceLifecycleItems ||
      auxModules.intelligenceLifecycleItems ||
      [],
    auditLogs: platformState.auditLogs.filter((l) => l.companyId === companyId),
  };
}

export function persistServerCompanyPayload(
  companyId: string,
  payload: BackupPayloadV1,
  modulesToPersist: BackupModuleId[],
  options?: { preserveExistingCredentials?: boolean }
): void {
  const activeMods = new Set<BackupModuleId>(modulesToPersist);
  const platformState = loadPlatformState();

  // 1. Update company profile
  if (activeMods.has('company_settings') && payload.companyProfile) {
    const compIdx = platformState.companies.findIndex((c) => c.id === companyId);
    const updatedCompany = {
      ...payload.companyProfile,
      id: companyId,
      isDemo: false,
      setupCompleted: true,
      updatedAt: new Date().toISOString(),
    };
    if (compIdx !== -1) {
      platformState.companies[compIdx] = {
        ...platformState.companies[compIdx],
        ...updatedCompany,
        ownerUserId:
          platformState.companies[compIdx].ownerUserId || updatedCompany.ownerUserId,
      };
    } else {
      platformState.companies.push(updatedCompany);
    }
  }

  // 2. Update branches for this company (preserving other companies' branches)
  if (activeMods.has('branches') && Array.isArray(payload.branches)) {
    const otherBranches = platformState.branches.filter((b) => b.companyId !== companyId);
    const restoredBranches = payload.branches.map((b) => ({
      ...b,
      companyId,
    }));
    platformState.branches = [...otherBranches, ...restoredBranches];
  }

  // 3. Update employees for this company while strictly preserving existing Owner/user credentials
  if (activeMods.has('employees_permissions') && Array.isArray(payload.employees)) {
    const existingCompanyUsers = platformState.users.filter(
      (u) => u.companyId === companyId
    );
    const otherUsers = platformState.users.filter((u) => u.companyId !== companyId);

    const existingOwner = existingCompanyUsers.find(
      (u) => u.systemRole === 'COMPANY_OWNER' || u.role === 'admin'
    );

    const mergedCompanyUsers: StoredUserRecord[] = [];
    if (existingOwner && options?.preserveExistingCredentials !== false) {
      mergedCompanyUsers.push(existingOwner);
    }

    for (const emp of payload.employees) {
      const existingMatch = existingCompanyUsers.find(
        (u) =>
          u.id === emp.id ||
          (emp.username && u.username.toLowerCase() === emp.username.toLowerCase())
      );
      if (existingMatch && existingOwner && existingMatch.id === existingOwner.id) {
        continue; // Already preserved owner with live credentials
      }

      const sysRole = emp.systemRole || 'CASHIER';
      const caps =
        Array.isArray(emp.capabilities) && emp.capabilities.length > 0
          ? emp.capabilities
          : [...ALL_CAPABILITY_CODES];

      mergedCompanyUsers.push({
        ...(emp as any),
        id: existingMatch?.id || emp.id,
        companyId,
        username: emp.username || emp.id,
        systemRole: sysRole,
        capabilities: caps,
        branchId: emp.branchId || platformState.branches.find((b) => b.companyId === companyId)?.id || 'branch-main',
        assignedBranchIds: emp.assignedBranchIds || [emp.branchId || 'branch-main'],
        // Preserve existing passwordHash/passwordSalt if user already existed on server; never import credentials from backup
        passwordHash: existingMatch?.passwordHash || null,
        passwordSalt: existingMatch?.passwordSalt || null,
        pin: existingMatch?.pin || '0000',
        hasPassword: Boolean(existingMatch?.passwordHash),
        mustChangePassword: !existingMatch?.passwordHash,
        isActive: emp.isActive ?? true,
        permissions: deriveLegacyPermissionsFromCapabilities(caps as CapabilityCode[]),
      });
    }

    platformState.users = [...otherUsers, ...mergedCompanyUsers];
  }

  savePlatformState(platformState);

  // 4. Update store-state.json & products.json (preserving records belonging to any other company)
  const storeState = readJsonFileSafe<any>(PROD_STORE_FILE, {
    storeCode: 'DQ-POS-MAIN',
    updatedAt: new Date().toISOString(),
    products: [],
    transactions: [],
    customers: [],
    stockMovements: [],
    users: [],
    activeSessions: [],
    unmetDemandRequests: [],
  });

  if (activeMods.has('products')) {
    const otherProds = (storeState.products || []).filter(
      (p: any) => p.companyId && p.companyId !== companyId
    );
    const taggedProds = (payload.products || []).map((p) => ({
      ...p,
      companyId,
    }));
    storeState.products = [...otherProds, ...taggedProds];

    const diskProds = readJsonFileSafe<any[]>(PRODUCTS_FILE, []);
    const otherDiskProds = (Array.isArray(diskProds) ? diskProds : []).filter(
      (p: any) => p.companyId && p.companyId !== companyId
    );
    writeJsonFileSafe(PRODUCTS_FILE, [...otherDiskProds, ...taggedProds]);
  }

  if (activeMods.has('sales')) {
    const otherTxs = (storeState.transactions || []).filter(
      (t: any) => t.companyId && t.companyId !== companyId
    );
    const taggedTxs = (payload.transactions || []).map((t) => ({
      ...t,
      companyId,
    }));
    storeState.transactions = [...otherTxs, ...taggedTxs];
  }

  if (activeMods.has('customers')) {
    const otherCusts = (storeState.customers || []).filter(
      (c: any) => c.companyId && c.companyId !== companyId
    );
    const taggedCusts = (payload.customers || []).map((c) => ({
      ...c,
      companyId,
    }));
    storeState.customers = [...otherCusts, ...taggedCusts];
  }

  if (activeMods.has('inventory')) {
    const otherMovs = (storeState.stockMovements || []).filter(
      (m: any) => m.companyId && m.companyId !== companyId
    );
    const taggedMovs = (payload.stockMovements || []).map((m) => ({
      ...m,
      companyId,
    }));
    storeState.stockMovements = [...otherMovs, ...taggedMovs];
  }

  if (activeMods.has('intelligence_audit')) {
    const otherDemand = (storeState.unmetDemandRequests || []).filter(
      (d: any) => d.companyId && d.companyId !== companyId
    );
    const taggedDemand = (payload.unmetDemandRequests || []).map((d) => ({
      ...d,
      companyId,
    }));
    storeState.unmetDemandRequests = [...otherDemand, ...taggedDemand];
  }

  storeState.updatedAt = new Date().toISOString();
  writeJsonFileSafe(PROD_STORE_FILE, storeState);

  if (activeMods.has('currencies')) {
    writeJsonFileSafe(CURRENCIES_FILE, payload.currencies || []);
    writeJsonFileSafe(EXCHANGE_RATES_FILE, payload.exchangeRateItems || []);
  }

  // 5. Persist auxiliary modules per company (.data/company-modules/<companyId>.json)
  const existingAux = readJsonFileSafe<Partial<BackupPayloadV1>>(
    getCompanyAuxModulesFilePath(companyId),
    {}
  );
  const nextAux: Partial<BackupPayloadV1> = {
    ...existingAux,
    ...(activeMods.has('company_settings')
      ? {
          storeSettings: payload.storeSettings,
          invoiceSettings: payload.invoiceSettings,
        }
      : {}),
    ...(activeMods.has('currencies')
      ? {
          currencies: payload.currencies,
          exchangeRates: payload.exchangeRates,
          exchangeRateItems: payload.exchangeRateItems,
          exchangeRateHistory: payload.exchangeRateHistory,
        }
      : {}),
    ...(activeMods.has('uom_custom_fields')
      ? {
          unitsOfMeasure: payload.unitsOfMeasure,
          customFieldDefinitions: payload.customFieldDefinitions,
        }
      : {}),
    ...(activeMods.has('categories') ? { categories: payload.categories } : {}),
    ...(activeMods.has('suppliers') ? { suppliers: payload.suppliers } : {}),
    ...(activeMods.has('purchases') ? { purchases: payload.purchases } : {}),
    ...(activeMods.has('expenses') ? { expenses: payload.expenses } : {}),
    ...(activeMods.has('accounting')
      ? {
          accounts: payload.accounts,
          journalEntries: payload.journalEntries,
        }
      : {}),
    ...(activeMods.has('inventory')
      ? { branchTransfers: payload.branchTransfers }
      : {}),
  };
  writeJsonFileSafe(getCompanyAuxModulesFilePath(companyId), nextAux);
}

// ============================================================================
// 3. SERVER BACKUP ARCHIVE STORAGE (PER-COMPANY TENANT ISOLATION)
// ============================================================================

function getCompanyBackupDir(companyId: string): string {
  const safeCompanyId = String(companyId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!safeCompanyId) {
    throw new ReleasePlatformError(400, 'INVALID_COMPANY_ID', 'Invalid company ID.');
  }
  return path.resolve(BACKUPS_DIR, safeCompanyId);
}

function getBackupFilePath(companyId: string, backupId: string): string {
  const safeBackupId = String(backupId || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safeBackupId || safeBackupId !== backupId) {
    throw new ReleasePlatformError(400, 'INVALID_BACKUP_ID', 'Invalid backup ID format.');
  }
  return path.resolve(getCompanyBackupDir(companyId), `${safeBackupId}.backup.json`);
}

export function saveBackupEnvelopeToDisk(
  companyId: string,
  envelope: BackupEnvelopeV1
): string {
  const filePath = getBackupFilePath(companyId, envelope.manifest.backupId);
  writeJsonFileSafe(filePath, envelope);
  return filePath;
}

export function listCompanySavedBackups(companyId: string): {
  backupId: string;
  fileName: string;
  encrypted: boolean;
  compression: 'gzip' | 'none';
  manifest: BackupManifestV1;
  payloadChecksumSha256: string;
  sizeBytes: number;
}[] {
  const dir = getCompanyBackupDir(companyId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.backup.json'));
  const list: {
    backupId: string;
    fileName: string;
    encrypted: boolean;
    compression: 'gzip' | 'none';
    manifest: BackupManifestV1;
    payloadChecksumSha256: string;
    sizeBytes: number;
  }[] = [];

  for (const file of files) {
    try {
      const fullPath = path.resolve(dir, file);
      const stat = fs.statSync(fullPath);
      const env = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as BackupEnvelopeV1;
      if (env && env.formatSignature === 'DQNAMO_POS_BACKUP_V1' && env.manifest) {
        const datePart = env.manifest.createdAt.slice(0, 10);
        list.push({
          backupId: env.manifest.backupId,
          fileName: `company-backup-${datePart}-${env.manifest.backupId}.backup`,
          encrypted: Boolean(env.encrypted),
          compression: env.compression,
          manifest: env.manifest,
          payloadChecksumSha256: env.payloadChecksumSha256,
          sizeBytes: stat.size,
        });
      }
    } catch {}
  }

  return list.sort(
    (a, b) =>
      new Date(b.manifest.createdAt).getTime() -
      new Date(a.manifest.createdAt).getTime()
  );
}

export function loadSavedBackupEnvelope(
  companyId: string,
  backupId: string
): BackupEnvelopeV1 {
  const filePath = getBackupFilePath(companyId, backupId);
  if (!fs.existsSync(filePath)) {
    throw new ReleasePlatformError(
      404,
      'BACKUP_NOT_FOUND',
      `Backup "${backupId}" was not found for company "${companyId}".`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BackupEnvelopeV1;
}

// ============================================================================
// 4. OWNER RE-AUTHENTICATION HELPER FOR SENSITIVE OPERATIONS
// ============================================================================

export function verifyCompanyOwnerReauth(
  companyId: string,
  ownerPasswordOrPin?: string,
  actorUser?: StoredUserRecord
): StoredUserRecord {
  const pwd = String(ownerPasswordOrPin || '').trim();
  if (!pwd) {
    throw new ReleasePlatformError(
      401,
      'OWNER_PASSWORD_REAUTH_REQUIRED',
      'Company Owner password or PIN re-authentication is required for this operation.'
    );
  }

  const state = loadPlatformState();
  const companyOwners = state.users.filter(
    (u) =>
      u.companyId === companyId &&
      u.isActive &&
      (u.systemRole === 'COMPANY_OWNER' || u.role === 'admin')
  );

  const candidates = actorUser
    ? [actorUser, ...companyOwners.filter((u) => u.id !== actorUser.id)]
    : companyOwners;

  for (const candidate of candidates) {
    if (candidate.companyId !== companyId) continue;
    if (
      candidate.systemRole !== 'COMPANY_OWNER' &&
      candidate.systemRole !== 'ADMIN' &&
      candidate.role !== 'admin'
    ) {
      continue;
    }
    if (candidate.passwordHash && candidate.passwordSalt) {
      if (verifyPasswordScrypt(pwd, candidate.passwordHash, candidate.passwordSalt)) {
        return candidate;
      }
    }
    if (candidate.pin && candidate.pin === pwd) {
      return candidate;
    }
  }

  throw new ReleasePlatformError(
    401,
    'INVALID_OWNER_CREDENTIALS',
    'Company Owner password re-authentication failed. Operation aborted.'
  );
}

// ============================================================================
// 5. HIGH-LEVEL BACKUP, RESTORE & MERGE OPERATIONS (PHASES B, C, D, E, F, G)
// ============================================================================

export function createCompanyBackupArchive(
  actor: AuthenticatedActorContext,
  input: {
    backupType?: 'FULL_COMPANY' | 'SELECTIVE_MODULES' | 'PRE_RESTORE_CHECKPOINT';
    selectedModules?: BackupModuleId[];
    autoIncludeHardDependencies?: boolean;
    encryptionPassword?: string;
    notes?: string;
    clientDataset?: Partial<BackupPayloadV1>;
  }
): {
  envelope: BackupEnvelopeV1;
  fileName: string;
} {
  assertActorHasCapability(actor, 'backup.create');
  if (actor.company.id === PRACTICE_COMPANY_ID || actor.workspaceMode === 'PRACTICE') {
    throw new ReleasePlatformError(
      403,
      'PRACTICE_MODE_BACKUP_BLOCKED',
      'Cannot create production company backups from the Practice Mode sandbox.'
    );
  }

  const fullPayload = collectServerCompanyPayload(
    actor.company.id,
    input.clientDataset
  );

  const envelope = packBackupEnvelope({
    payload: fullPayload,
    backupType: input.backupType || 'FULL_COMPANY',
    selectedModules: input.selectedModules,
    autoIncludeHardDependencies: input.autoIncludeHardDependencies ?? true,
    createdByUserId: actor.user.id,
    createdByUsername: actor.user.username || actor.user.name,
    notes: input.notes,
    encryptionPassword: input.encryptionPassword,
    useCompression: true,
  });

  saveBackupEnvelopeToDisk(actor.company.id, envelope);

  const pState = loadPlatformState();
  appendPlatformAuditLog(pState, {
    companyId: actor.company.id,
    userId: actor.user.id,
    actorName: actor.user.name,
    action:
      envelope.manifest.backupType === 'PRE_RESTORE_CHECKPOINT'
        ? 'BACKUP_RESTORE_CHECKPOINT_CREATED'
        : 'BACKUP_CREATED',
    entityType: 'backup',
    entityId: envelope.manifest.backupId,
    details: {
      backupType: envelope.manifest.backupType,
      encrypted: envelope.encrypted,
      modulesIncluded: envelope.manifest.modulesIncluded,
      totalRecords: envelope.manifest.totalRecords,
      payloadChecksumSha256: envelope.payloadChecksumSha256,
    },
  });
  savePlatformState(pState);

  const datePart = envelope.manifest.createdAt.slice(0, 10);
  const fileName =
    envelope.manifest.backupType === 'PRE_RESTORE_CHECKPOINT'
      ? `pre-restore-checkpoint-${datePart}-${envelope.manifest.backupId}.backup`
      : `company-backup-${datePart}.backup`;

  return { envelope, fileName };
}

export function restoreBackupIntoOriginalCompany(
  actor: AuthenticatedActorContext,
  input: {
    envelope?: any;
    backupId?: string;
    decryptionPassword?: string;
    ownerPassword: string;
    allowCrossCompanyIdOverride?: boolean;
    currentClientDataset?: Partial<BackupPayloadV1>;
  }
): {
  ok: boolean;
  checkpointBackupId: string;
  restoredManifest: BackupManifestV1;
  restoredPayload: BackupPayloadV1;
} {
  assertActorHasCapability(actor, 'backup.restore');
  if (actor.company.id === PRACTICE_COMPANY_ID || actor.workspaceMode === 'PRACTICE') {
    throw new ReleasePlatformError(
      403,
      'PRACTICE_MODE_RESTORE_BLOCKED',
      'Cannot execute a production restore inside Practice Mode.'
    );
  }

  // 1. Verify Owner password re-authentication
  verifyCompanyOwnerReauth(actor.company.id, input.ownerPassword, actor.user);

  // 2. Load and cryptographically verify backup envelope
  const rawEnvelope = input.backupId
    ? loadSavedBackupEnvelope(actor.company.id, input.backupId)
    : input.envelope;
  const unpacked = verifyAndUnpackBackupEnvelope(
    rawEnvelope,
    input.decryptionPassword
  );

  // 3. Verify company identity match unless Owner explicitly authorized cross-company override
  const sourceCompanyId = unpacked.manifest.sourceCompany.companyId;
  const sourceCode = unpacked.manifest.sourceCompany.code;
  const isSameCompany =
    sourceCompanyId === actor.company.id ||
    (sourceCode && sourceCode === actor.company.code);

  if (!isSameCompany && !input.allowCrossCompanyIdOverride) {
    throw new ReleasePlatformError(
      409,
      'BACKUP_COMPANY_IDENTITY_MISMATCH',
      `Backup belongs to company "${unpacked.manifest.sourceCompany.displayName}" (${sourceCompanyId}), which differs from active company "${actor.company.displayName}" (${actor.company.id}). Use "Restore as New Company", "Intelligent Merge", or explicitly confirm cross-company restore.`
    );
  }

  // 4. Create mandatory automatic pre-restore recovery checkpoint
  const liveSnapshot = collectServerCompanyPayload(
    actor.company.id,
    input.currentClientDataset
  );
  const checkpointEnvelope = packBackupEnvelope({
    payload: liveSnapshot,
    backupId: `chk-pre-restore-${Date.now().toString(36)}`,
    backupType: 'PRE_RESTORE_CHECKPOINT',
    createdByUserId: actor.user.id,
    createdByUsername: actor.user.username || actor.user.name,
    notes: `Automatic pre-restore checkpoint before restoring ${unpacked.manifest.backupId}`,
  });
  saveBackupEnvelopeToDisk(actor.company.id, checkpointEnvelope);

  // 5. Execute transactional restore with automatic rollback on failure
  try {
    const restoredPayload: BackupPayloadV1 = {
      ...unpacked.payload,
      companyProfile: {
        ...unpacked.payload.companyProfile,
        id: actor.company.id,
        ownerUserId: actor.company.ownerUserId || actor.user.id,
      },
    };

    persistServerCompanyPayload(
      actor.company.id,
      restoredPayload,
      unpacked.manifest.modulesIncluded,
      { preserveExistingCredentials: true }
    );

    const pState = loadPlatformState();
    appendPlatformAuditLog(pState, {
      companyId: actor.company.id,
      userId: actor.user.id,
      actorName: actor.user.name,
      action: 'BACKUP_RESTORED_IN_PLACE',
      entityType: 'backup',
      entityId: unpacked.manifest.backupId,
      details: {
        checkpointBackupId: checkpointEnvelope.manifest.backupId,
        modulesRestored: unpacked.manifest.modulesIncluded,
        totalRecordsRestored: unpacked.manifest.totalRecords,
      },
    });
    savePlatformState(pState);

    return {
      ok: true,
      checkpointBackupId: checkpointEnvelope.manifest.backupId,
      restoredManifest: unpacked.manifest,
      restoredPayload: collectServerCompanyPayload(actor.company.id, restoredPayload),
    };
  } catch (err: any) {
    // Automatic rollback from liveSnapshot
    persistServerCompanyPayload(
      actor.company.id,
      liveSnapshot,
      ALL_BACKUP_MODULE_IDS,
      { preserveExistingCredentials: true }
    );
    throw new ReleasePlatformError(
      500,
      'RESTORE_FAILED_ROLLED_BACK',
      `Restore failed and was automatically rolled back to checkpoint "${checkpointEnvelope.manifest.backupId}": ${err?.message || 'Unknown error'}`
    );
  }
}

export function restoreBackupAsNewCompany(
  req: Request,
  input: {
    envelope: any;
    decryptionPassword?: string;
    companyName: string;
    companyNameAr?: string;
    businessType?: string;
    ownerName?: string;
    ownerUsername: string;
    ownerEmail?: string;
    ownerPassword: string;
    ownerConfirmPassword: string;
    ownerPin?: string;
  }
): {
  ok: boolean;
  company: any;
  mainBranch: any;
  owner: any;
  sessionToken: string;
  restoredPayload: BackupPayloadV1;
  idRemapCount: number;
} {
  const pState = loadPlatformState();
  const existingProdCompanies = pState.companies.filter(
    (c) => !c.isDemo && c.setupCompleted
  );

  // Security gate: if an active production company already exists, require an authenticated COMPANY_OWNER with backup.restore
  let actorUserId: string | null = null;
  if (existingProdCompanies.length > 0) {
    const actor = resolveAuthenticatedActorFromRequest(req);
    assertActorHasCapability(actor, 'backup.restore');
    actorUserId = actor.user.id;
  }

  // Validate new company & owner inputs
  const companyName = (input.companyName || '').trim();
  if (companyName.length < 2) {
    throw new ReleasePlatformError(
      400,
      'INVALID_COMPANY_NAME',
      'New company/store name is required (at least 2 characters).'
    );
  }

  const ownerUsername = (input.ownerUsername || '').trim().toLowerCase();
  if (ownerUsername.length < 3) {
    throw new ReleasePlatformError(
      400,
      'INVALID_OWNER_USERNAME',
      'New Owner username is required (at least 3 characters).'
    );
  }

  if (
    pState.users.some(
      (u) => !u.companyId.includes('demo') && u.username.toLowerCase() === ownerUsername
    )
  ) {
    throw new ReleasePlatformError(
      409,
      'DUPLICATE_OWNER_USERNAME',
      `Username "${ownerUsername}" is already in use. Please choose a unique username for the new company owner.`
    );
  }

  const password = input.ownerPassword || '';
  const confirmPassword = input.ownerConfirmPassword || '';
  if (password !== confirmPassword) {
    throw new ReleasePlatformError(
      400,
      'PASSWORD_CONFIRMATION_MISMATCH',
      'Owner password and confirm password do not match.'
    );
  }
  const pwdCheck = validatePasswordStrength(password);
  if (!pwdCheck.valid) {
    throw new ReleasePlatformError(
      400,
      'WEAK_OWNER_PASSWORD',
      pwdCheck.messageEn || 'Owner password does not meet security policy.'
    );
  }

  // Unpack and verify backup integrity
  const unpacked = verifyAndUnpackBackupEnvelope(
    input.envelope,
    input.decryptionPassword
  );

  // Remap all IDs, codes, and foreign keys for the new isolated company
  const {
    remappedPayload,
    idRemapTable,
    newCompany,
    newMainBranch,
    newOwnerProfile,
  } = remapBackupPayloadForNewCompany(unpacked.payload, {
    companyName,
    companyNameAr: input.companyNameAr || companyName,
    businessType: input.businessType,
    ownerName: (input.ownerName || ownerUsername).trim(),
    ownerUsername,
    ownerEmail: input.ownerEmail,
    ownerPin: input.ownerPin || '1111',
  });

  // Hash new Owner password securely with scrypt
  const { hash: passwordHash, salt: passwordSalt } = hashPasswordScrypt(password);

  // Save new company, branches, and owner in platform state
  const freshState = loadPlatformState();
  freshState.companies.push(newCompany);
  for (const br of remappedPayload.branches) {
    freshState.branches.push(br);
  }

  const storedOwner: StoredUserRecord = {
    ...newOwnerProfile,
    companyId: newCompany.id,
    username: ownerUsername,
    systemRole: 'COMPANY_OWNER',
    capabilities: [...ALL_CAPABILITY_CODES],
    branchId: newMainBranch.id,
    assignedBranchIds: remappedPayload.branches.map((b) => b.id),
    passwordHash,
    passwordSalt,
    hasPassword: true,
    mustChangePassword: false,
  };
  freshState.users.push(storedOwner);

  // Also add non-owner employees with scrubbed credentials
  for (const emp of remappedPayload.employees) {
    if (emp.id === storedOwner.id || emp.systemRole === 'COMPANY_OWNER') continue;
    freshState.users.push({
      ...(emp as any),
      companyId: newCompany.id,
      username: emp.username || emp.id,
      systemRole: emp.systemRole || 'CASHIER',
      capabilities: emp.capabilities || [],
      branchId: emp.branchId || newMainBranch.id,
      assignedBranchIds: emp.assignedBranchIds || [newMainBranch.id],
      passwordHash: null,
      passwordSalt: null,
      pin: '0000',
      hasPassword: false,
      mustChangePassword: true,
      isActive: emp.isActive ?? true,
    });
  }

  const sessionToken = issueSessionForUser(freshState, storedOwner, 'PRODUCTION');

  appendPlatformAuditLog(freshState, {
    companyId: newCompany.id,
    userId: storedOwner.id,
    actorName: storedOwner.name,
    action: 'BACKUP_RESTORED_AS_NEW_COMPANY',
    entityType: 'company',
    entityId: newCompany.id,
    details: {
      sourceBackupId: unpacked.manifest.backupId,
      sourceCompanyName: unpacked.manifest.sourceCompany.displayName,
      newCompanyName: newCompany.displayName,
      ownerUsername: storedOwner.username,
      initiatedByUserId: actorUserId || storedOwner.id,
      remappedEntitiesCount: Object.keys(idRemapTable).length,
    },
  });

  savePlatformState(freshState);

  // Persist operational modules for the new company
  persistServerCompanyPayload(
    newCompany.id,
    remappedPayload,
    unpacked.manifest.modulesIncluded,
    { preserveExistingCredentials: true }
  );

  // Also save a copy of the envelope in the new company's backup directory
  saveBackupEnvelopeToDisk(newCompany.id, unpacked.envelope);

  const { passwordHash: _ph, passwordSalt: _ps, ...safeOwner } = storedOwner;

  return {
    ok: true,
    company: newCompany,
    mainBranch: newMainBranch,
    owner: safeOwner,
    sessionToken,
    restoredPayload: remappedPayload,
    idRemapCount: Object.keys(idRemapTable).length,
  };
}

export function previewCompanyBackupMerge(
  actor: AuthenticatedActorContext,
  input: {
    envelope?: any;
    backupId?: string;
    decryptionPassword?: string;
    selectedModules?: BackupModuleId[];
    currentClientDataset?: Partial<BackupPayloadV1>;
  }
): {
  manifest: BackupManifestV1;
  preview: BackupMergePreviewReport;
} {
  assertActorHasCapability(actor, 'backup.import');
  const rawEnvelope = input.backupId
    ? loadSavedBackupEnvelope(actor.company.id, input.backupId)
    : input.envelope;
  const unpacked = verifyAndUnpackBackupEnvelope(
    rawEnvelope,
    input.decryptionPassword
  );

  const targetDataset = collectServerCompanyPayload(
    actor.company.id,
    input.currentClientDataset
  );
  const modulesToAnalyze =
    input.selectedModules && input.selectedModules.length > 0
      ? input.selectedModules.filter((m) =>
          unpacked.manifest.modulesIncluded.includes(m)
        )
      : unpacked.manifest.modulesIncluded;

  const preview = analyzeBackupMergePreview(
    unpacked.payload,
    targetDataset,
    modulesToAnalyze
  );

  const pState = loadPlatformState();
  appendPlatformAuditLog(pState, {
    companyId: actor.company.id,
    userId: actor.user.id,
    actorName: actor.user.name,
    action: 'BACKUP_MERGE_PREVIEWED',
    entityType: 'backup',
    entityId: unpacked.manifest.backupId,
    details: {
      totals: preview.totals,
      modulesAnalyzed: modulesToAnalyze,
    },
  });
  savePlatformState(pState);

  return {
    manifest: unpacked.manifest,
    preview,
  };
}

export function executeCompanyBackupMerge(
  actor: AuthenticatedActorContext,
  input: {
    envelope?: any;
    backupId?: string;
    decryptionPassword?: string;
    ownerPassword: string;
    mergeOptions?: ExecuteBackupMergeOptions;
    currentClientDataset?: Partial<BackupPayloadV1>;
  }
): {
  ok: boolean;
  checkpointBackupId: string;
  summary: BackupMergeExecutionSummary;
  mergedPayload: BackupPayloadV1;
} {
  assertActorHasCapability(actor, 'backup.merge');
  if (actor.company.id === PRACTICE_COMPANY_ID || actor.workspaceMode === 'PRACTICE') {
    throw new ReleasePlatformError(
      403,
      'PRACTICE_MODE_MERGE_BLOCKED',
      'Cannot execute a production backup merge inside Practice Mode.'
    );
  }

  // 1. Verify Owner password re-authentication
  verifyCompanyOwnerReauth(actor.company.id, input.ownerPassword, actor.user);

  // 2. Unpack and verify backup
  const rawEnvelope = input.backupId
    ? loadSavedBackupEnvelope(actor.company.id, input.backupId)
    : input.envelope;
  const unpacked = verifyAndUnpackBackupEnvelope(
    rawEnvelope,
    input.decryptionPassword
  );

  // 3. Collect current live state and create automatic pre-merge recovery checkpoint
  const liveSnapshot = collectServerCompanyPayload(
    actor.company.id,
    input.currentClientDataset
  );
  const checkpointEnvelope = packBackupEnvelope({
    payload: liveSnapshot,
    backupId: `chk-pre-merge-${Date.now().toString(36)}`,
    backupType: 'PRE_RESTORE_CHECKPOINT',
    createdByUserId: actor.user.id,
    createdByUsername: actor.user.username || actor.user.name,
    notes: `Automatic pre-merge checkpoint before merging ${unpacked.manifest.backupId}`,
  });
  saveBackupEnvelopeToDisk(actor.company.id, checkpointEnvelope);

  // 4. Execute transactional merge
  try {
    const activeModules =
      input.mergeOptions?.selectedModules &&
      input.mergeOptions.selectedModules.length > 0
        ? input.mergeOptions.selectedModules.filter((m) =>
            unpacked.manifest.modulesIncluded.includes(m)
          )
        : unpacked.manifest.modulesIncluded;

    const { mergedDataset, summary } = applyIntelligentBackupMerge(
      unpacked.payload,
      liveSnapshot,
      {
        ...input.mergeOptions,
        selectedModules: activeModules,
      }
    );

    persistServerCompanyPayload(actor.company.id, mergedDataset, activeModules, {
      preserveExistingCredentials: true,
    });

    const pState = loadPlatformState();
    appendPlatformAuditLog(pState, {
      companyId: actor.company.id,
      userId: actor.user.id,
      actorName: actor.user.name,
      action: 'BACKUP_MERGE_EXECUTED',
      entityType: 'backup',
      entityId: unpacked.manifest.backupId,
      details: {
        checkpointBackupId: checkpointEnvelope.manifest.backupId,
        insertedCount: summary.insertedCount,
        updatedCount: summary.updatedCount,
        mergedCount: summary.mergedCount,
        keptExistingCount: summary.keptExistingCount,
        skippedCount: summary.skippedCount,
        remappedReferencesCount: summary.remappedReferencesCount,
      },
    });
    savePlatformState(pState);

    return {
      ok: true,
      checkpointBackupId: checkpointEnvelope.manifest.backupId,
      summary,
      mergedPayload: mergedDataset,
    };
  } catch (err: any) {
    persistServerCompanyPayload(
      actor.company.id,
      liveSnapshot,
      ALL_BACKUP_MODULE_IDS,
      { preserveExistingCredentials: true }
    );
    throw new ReleasePlatformError(
      500,
      'MERGE_FAILED_ROLLED_BACK',
      `Merge failed and was automatically rolled back to checkpoint "${checkpointEnvelope.manifest.backupId}": ${err?.message || 'Unknown error'}`
    );
  }
}

export function deleteSavedCompanyBackup(
  actor: AuthenticatedActorContext,
  backupId: string,
  ownerPassword: string
): { ok: boolean; deletedBackupId: string } {
  assertActorHasCapability(actor, 'backup.delete');
  verifyCompanyOwnerReauth(actor.company.id, ownerPassword, actor.user);

  const filePath = getBackupFilePath(actor.company.id, backupId);
  if (!fs.existsSync(filePath)) {
    throw new ReleasePlatformError(
      404,
      'BACKUP_NOT_FOUND',
      `Backup "${backupId}" not found.`
    );
  }

  fs.unlinkSync(filePath);

  const pState = loadPlatformState();
  appendPlatformAuditLog(pState, {
    companyId: actor.company.id,
    userId: actor.user.id,
    actorName: actor.user.name,
    action: 'BACKUP_CHECKPOINT_DELETED',
    entityType: 'backup',
    entityId: backupId,
    details: { backupId },
  });
  savePlatformState(pState);

  return { ok: true, deletedBackupId: backupId };
}

// ============================================================================
// 6. EXPRESS ROUTER (/api/backups/*)
// ============================================================================

export const backupRestoreRouter = Router();

function sendBackupError(res: Response, err: any, fallbackMessage: string): void {
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

// GET /api/backups — List saved backups & checkpoints for the authenticated company
backupRestoreRouter.get('/', (req: Request, res: Response) => {
  try {
    const requestedCompanyId =
      typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
    if (requestedCompanyId === 'comp-clean-store' || requestedCompanyId === 'comp-demo-practice') {
      res.json({
        success: true,
        data: {
          companyId: requestedCompanyId,
          backups: [],
          auditLogs: [],
        },
      });
      return;
    }
    const actor = resolveAuthenticatedActorFromRequest(req);
    if (requestedCompanyId) {
      assertActorCompanyMatch(actor, requestedCompanyId);
    }
    assertActorHasCapability(actor, 'backup.view');

    const backups = listCompanySavedBackups(actor.company.id);
    const pState = loadPlatformState();
    const auditLogs = pState.auditLogs
      .filter(
        (l) =>
          l.companyId === actor.company.id &&
          (l.entityType === 'backup' || l.action.startsWith('BACKUP_'))
      )
      .slice(0, 50);

    res.json({
      success: true,
      data: {
        companyId: actor.company.id,
        backups,
        auditLogs,
      },
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to list company backups');
  }
});

// POST /api/backups/create — Create Full or Selective Company Backup
backupRestoreRouter.post('/create', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const { envelope, fileName } = createCompanyBackupArchive(actor, req.body || {});
    res.status(201).json({
      success: true,
      data: {
        backupId: envelope.manifest.backupId,
        fileName,
        envelope,
      },
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to create company backup');
  }
});

// GET /api/backups/:backupId/download — Download a saved .backup file
backupRestoreRouter.get('/:backupId/download', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const requestedCompanyId =
      typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
    if (requestedCompanyId) {
      assertActorCompanyMatch(actor, requestedCompanyId);
    }
    assertActorHasCapability(actor, 'backup.download');

    const envelope = loadSavedBackupEnvelope(actor.company.id, req.params.backupId);
    const pState = loadPlatformState();
    appendPlatformAuditLog(pState, {
      companyId: actor.company.id,
      userId: actor.user.id,
      actorName: actor.user.name,
      action: 'BACKUP_DOWNLOADED',
      entityType: 'backup',
      entityId: envelope.manifest.backupId,
      details: { backupType: envelope.manifest.backupType },
    });
    savePlatformState(pState);

    res.json({
      success: true,
      data: {
        fileName: `company-backup-${envelope.manifest.createdAt.slice(0, 10)}.backup`,
        envelope,
      },
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to download backup');
  }
});

// POST /api/backups/inspect — Validate & Inspect a Backup Envelope
backupRestoreRouter.post('/inspect', (req: Request, res: Response) => {
  try {
    const { envelope, backupId, decryptionPassword } = req.body || {};
    let targetEnvelope = envelope;
    if (!targetEnvelope && backupId) {
      const actor = resolveAuthenticatedActorFromRequest(req);
      assertActorHasCapability(actor, 'backup.view');
      targetEnvelope = loadSavedBackupEnvelope(actor.company.id, backupId);
    }
    const unpacked = verifyAndUnpackBackupEnvelope(
      targetEnvelope,
      decryptionPassword
    );

    res.json({
      success: true,
      data: {
        integrityVerified: unpacked.integrityVerified,
        encrypted: unpacked.envelope.encrypted,
        compression: unpacked.envelope.compression,
        manifest: unpacked.manifest,
        payloadChecksumSha256: unpacked.envelope.payloadChecksumSha256,
      },
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to validate backup package');
  }
});

// POST /api/backups/restore-in-place — Option 1: Restore into Original Company
backupRestoreRouter.post('/restore-in-place', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const result = restoreBackupIntoOriginalCompany(actor, req.body || {});
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to restore backup into company');
  }
});

// POST /api/backups/restore-new-company — Option 2: Restore as a Completely New Company
backupRestoreRouter.post('/restore-new-company', (req: Request, res: Response) => {
  try {
    const result = restoreBackupAsNewCompany(req, req.body || {});
    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to restore backup as new company');
  }
});

// POST /api/backups/merge-preview — Dry-Run Duplicate & Conflict Analysis
backupRestoreRouter.post('/merge-preview', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const result = previewCompanyBackupMerge(actor, req.body || {});
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to generate backup merge preview');
  }
});

// POST /api/backups/merge-execute — Execute Transactional Intelligent Merge
backupRestoreRouter.post('/merge-execute', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const result = executeCompanyBackupMerge(actor, req.body || {});
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to execute intelligent backup merge');
  }
});

// DELETE /api/backups/:backupId — Delete a Saved Backup / Checkpoint
backupRestoreRouter.delete('/:backupId', (req: Request, res: Response) => {
  try {
    const actor = resolveAuthenticatedActorFromRequest(req);
    const ownerPassword =
      req.body?.ownerPassword || req.headers['x-owner-password'] || '';
    const result = deleteSavedCompanyBackup(
      actor,
      req.params.backupId,
      String(ownerPassword)
    );
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendBackupError(res, err, 'Failed to delete backup checkpoint');
  }
});
