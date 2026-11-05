# Data Migration, Backup & Restore Architecture (`PHASE A`)

## 1. Architecture Overview & Verification Status

The **Backup, Restore, Company Migration & Intelligent Data Merge Engine** provides a deterministic, transactional, and tenant-isolated architecture to package, encrypt, validate, restore, migrate, and merge company data across devices and installations.

### Component Status Matrix
| Architectural Component | Verification Status | Implementation Location |
|---|---|---|
| Versioned `.backup` Envelope (`DQNAMO_POS_BACKUP_V1`) | **Implemented and verified** | `src/lib/backup-merge-engine.ts`, `src/server/backup-restore.service.ts` |
| 15-Module Dependency DAG Resolver (`resolveBackupModuleDependencies`) | **Implemented and verified** | `src/lib/backup-merge-engine.ts` |
| Gzip Compression & Multi-Layer SHA-256 Checksums | **Implemented and verified** | `src/server/backup-restore.service.ts` (`packBackupEnvelope`, `verifyAndUnpackBackupEnvelope`) |
| Authenticated Encryption (`AES-256-GCM` + `scrypt` KDF) | **Implemented and verified** | `src/server/backup-restore.service.ts` |
| Option 1: Restore into Original Company + Auto Checkpoint & Rollback | **Implemented and verified** | `src/server/backup-restore.service.ts` (`restoreBackupIntoOriginalCompany`) |
| Option 2: Restore as New Isolated Company + Full ID Remapper | **Implemented and verified** | `src/lib/backup-merge-engine.ts` (`remapBackupPayloadForNewCompany`), `src/server/backup-restore.service.ts` (`restoreBackupAsNewCompany`) |
| Dual-Layer Server (`.data/*.json`) + Client (`POSContext`) Hydration | **Implemented and verified** | `src/context/POSContext.tsx` (`collectClientBackupDataset`, `hydrateCompanyFromBackupPayload`) |
| Direct PostgreSQL Bulk Transaction Adapter (when `DATABASE_URL` is active) | **Partially implemented** | `src/db/schema.ts` defines 26 tables; `expenses`/`accounts`/`journal_entries` are persisted in JSON aux store (**Missing** in PG DDL) |
| External Cloud Object Storage Offload (S3 / GCS backup bucket) | **Missing** (Not required for local/file portability) | Currently uses local `.backup` file download/upload and `.data/backups/<companyId>/` vault |

---

## 2. Versioned Backup File Format Specification (`.backup`)

### 2.1 File Naming Convention
```text
company-backup-YYYY-MM-DD.backup
company-selective-backup-YYYY-MM-DD.backup
pre-restore-checkpoint-YYYY-MM-DD-HHmmss.backup
```

### 2.2 Container Envelope Structure (`BackupEnvelopeV1`) — **[Implemented and verified]**

The `.backup` file is a self-contained JSON envelope supporting `gzip` payload compression and optional authenticated encryption (**AES-256-GCM** with **scrypt** key derivation):

```typescript
export interface BackupEnvelopeV1 {
  formatSignature: 'DQNAMO_POS_BACKUP_V1';
  formatVersion: '1.0.0';
  createdAt: string; // ISO-8601 UTC timestamp
  encrypted: boolean;
  compression: 'gzip' | 'none';
  encryptionMeta?: {
    algorithm: 'AES-256-GCM';
    kdf: 'scrypt';
    saltHex: string;       // 32-byte random salt (hex)
    ivHex: string;         // 16-byte initialization vector (hex)
    authTagHex: string;    // 16-byte GCM authentication tag (hex)
    kdfParams: { N: 16384; r: 8; p: 1; keyLen: 32 };
  };
  manifest: BackupManifestV1;
  payloadChecksumSha256: string; // SHA-256 of the plaintext serialized BackupPayloadV1 JSON
  payloadData: string;           // Base64-encoded (gzipped and optionally AES-256-GCM encrypted) BackupPayloadV1
}
```

### 2.3 Backup Modules (`BackupModuleId` — 15 Modules) — **[Implemented and verified]**

1. `company_settings`: Company profile, `storeSettings`, `invoiceSettings` (including logo/branding base64 assets and receipt customization).
2. `currencies`: Company-configured `currencies`, active `exchangeRates`, `exchangeRateItems`, and `exchangeRateHistory`.
3. `branches`: Company `branches` and branch configurations.
4. `employees_permissions`: Employee profiles and role/capability assignments (strictly excluding `passwordHash`, `passwordSalt`, `pin`, and session tokens).
5. `units_custom_fields`: Units of measurement (`unitsOfMeasure`) and `customFieldDefinitions`.
6. `categories`: Product `categories`.
7. `products`: `products`, primary `barcode`, `barcodes[]`, packaging/unit conversions, and `customFields`.
8. `customers`: `customers` directory, credit/debt balances, and loyalty points.
9. `suppliers`: `suppliers` directory and balances.
10. `inventory`: `stockMovements` and inter-branch `branchTransfers`.
11. `purchases`: `purchases` (purchase orders/invoices) and `items`.
12. `sales`: `transactions` (sales, returns, debt settlement payments, and locked `exchangeRatesSnapshot`).
13. `expenses`: Operational `expenses`.
14. `accounting`: Chart of `accounts` and double-entry `journalEntries`.
15. `intelligence_audit`: `unmetDemandRequests`, `intelligenceLifecycleItems`, and company `auditLogs`.

---

## 3. Module Dependency Graph & Selective Backup Rules — **[Implemented and verified]**

When a user selects specific modules for a **Selective Backup**, `resolveBackupModuleDependencies()` inspects the directed acyclic graph (DAG) below:

| Selected Module | Hard Dependencies (Auto-Included by Default) | Soft Dependencies (Warning Emitted if Omitted) |
|---|---|---|
| `currencies` | `company_settings` | — |
| `branches` | `company_settings` | — |
| `employees_permissions` | `company_settings`, `branches` | — |
| `units_custom_fields` | `company_settings` | — |
| `categories` | `company_settings` | — |
| `products` | `company_settings`, `categories`, `units_custom_fields`, `currencies` | `branches`, `suppliers` |
| `customers` | `company_settings` | `currencies` |
| `suppliers` | `company_settings` | `currencies` |
| `inventory` | `company_settings`, `branches`, `products`, `categories`, `units_custom_fields` | `suppliers` |
| `purchases` | `company_settings`, `branches`, `products`, `categories`, `units_custom_fields`, `suppliers`, `currencies` | `inventory`, `accounting` |
| `sales` | `company_settings`, `branches`, `products`, `categories`, `units_custom_fields`, `customers`, `currencies` | `inventory`, `accounting`, `employees_permissions` |
| `expenses` | `company_settings`, `branches`, `currencies` | `accounting` |
| `accounting` | `company_settings`, `currencies` | `sales`, `purchases`, `expenses` |
| `intelligence_audit` | `company_settings`, `branches`, `products` | `customers`, `sales` |

---

## 4. Topological Restore & Import Execution Order — **[Implemented and verified]**

To guarantee referential integrity and zero broken foreign keys, all Restore and Merge operations execute in strict 14-step topological order:

1. **Step 1:** `company_settings` (`companyProfile`, `storeSettings`, `invoiceSettings`)
2. **Step 2:** `currencies` (`currencies`, `exchangeRates`, `exchangeRateItems`, `exchangeRateHistory`)
3. **Step 3:** `branches`
4. **Step 4:** `employees_permissions` (scrubbed of credentials; mapped to `branchId`)
5. **Step 5:** `units_custom_fields` (`unitsOfMeasure`, `customFieldDefinitions`)
6. **Step 6:** `categories`
7. **Step 7:** `suppliers` & `customers`
8. **Step 8:** `products` (referencing remapped/merged `categoryId` and `branchId`)
9. **Step 9:** `accounting.accounts` (referencing parent `accountId`)
10. **Step 10:** `purchases` (referencing remapped `supplierId`, `branchId`, and `items[].productId`)
11. **Step 11:** `inventory` (`stockMovements` & `branchTransfers` referencing `productId` and `branchId`)
12. **Step 12:** `sales` (`transactions` referencing `customerId`, `branchId`, and `items[].productId`)
13. **Step 13:** `expenses` & `accounting.journalEntries` (referencing `branchId` and `lines[].accountId`)
14. **Step 14:** `intelligence_audit` (`unmetDemandRequests`, `intelligenceLifecycleItems`, `auditLogs`)

---

## 5. Full Restore Modes (`PHASE C`)

### 5.1 Option 1: Restore into the Original Company (`restoreBackupIntoOriginalCompany`) — **[Implemented and verified]**
1. **Company Identity Check:** Verifies `manifest.sourceCompany.companyId === actor.company.id` (or `sourceCompany.code === actor.company.code`), rejecting cross-company restores with `409 BACKUP_COMPANY_IDENTITY_MISMATCH` unless explicitly overridden by the Owner.
2. **Owner Step-Up Re-Authentication:** Verifies the active Owner's password via `verifyPasswordScrypt`.
3. **Automatic Recovery Checkpoint:** Saves `chk-pre-restore-<timestamp>` to `.data/backups/<companyId>/` prior to mutating state.
4. **Transactional Apply & Rollback:** Persists restored modules and automatically rolls back to the live snapshot if any error occurs.

### 5.2 Option 2: Restore as a Completely New Company (`restoreBackupAsNewCompany`) — **[Implemented and verified]**
1. **Supported Entry Points:**
   - **First-Run Onboarding Modal (`FirstRunOnboardingModal.tsx`)**: Option C ("Restore Company from Backup (.backup)").
   - **Settings -> Backup & Restore Center (`BackupRestoreCenterSection.tsx`)**: Tab 2 -> "Option 2: Restore as New Company".
2. **Complete ID & Foreign-Key Remapping (`remapBackupPayloadForNewCompany`)**:
   - Generates a new `companyId` (`comp-<timestamp>-<random>`) and remaps every entity ID (`br`, `emp`, `uom`, `cfd`, `cat`, `prd`, `cus`, `sup`, `pur`, `tx`, `sm`, `bt`, `exp`, `acc`, `je`, `udr`, `ili`) while rewriting all internal foreign keys so there is zero collision with existing companies.
