# Repository & Database Audit — Backup, Restore, Company Migration & Intelligent Data Merge (`PHASE A`)

## 1. Executive Summary & Audit Methodology

This document presents the comprehensive **Phase A (Read-Only) Repository and Database Audit** of the **Dqnamo POS** codebase (`82cc08b7-ecc8-4968-b1b8-331b54b755ff`).

**Strict Read-Only Compliance:**
- Zero source code files were modified during this audit.
- Zero database schemas (`src/db/schema.ts`) or SQL migrations (`drizzle/`) were modified or executed.
- Zero production records (`.data/*.json`) were modified, reset, or deleted.

### Status Classification Legend
Throughout this audit, every architectural finding, entity, and capability is explicitly classified into one of four verification states:
- **[Implemented and verified]** — Present in the codebase, wired end-to-end, and verified against actual code/tests.
- **[Partially implemented]** — Present in one layer (e.g., Drizzle schema or local JSON store) but requiring cross-layer unification or additional hardening.
- **[Missing]** — Not yet present in the repository or requiring new implementation.
- **[Unknown or requiring further investigation]** — External runtime/environment factor requiring runtime verification when deployed to external PostgreSQL instances.

---

## 2. Evaluation Across the 10 Core Project Dimensions

| # | Capability / Evaluation Area | Current Repository Status | Detailed Codebase Evidence & Findings |
|---|---|---|---|
| 1 | **Full company backup and restoration** | **Implemented and verified** (File/JSON & Client Store) / **Partially implemented** (Direct PostgreSQL table dump) | `src/lib/backup-merge-engine.ts` (`ALL_BACKUP_MODULE_IDS`, 15 modules) and `src/server/backup-restore.service.ts` (`createCompanyBackupArchive`, `restoreBackupIntoOriginalCompany`) package and restore all 15 company modules across `.data/*.json` and `POSContext`. Direct SQL `pg_dump`/Drizzle table-level bulk upsert is **Partially implemented** (currently routed through repository sync files when `DATABASE_URL` is absent). |
| 2 | **Selective module backup** | **Implemented and verified** | `resolveBackupModuleDependencies()` in `src/lib/backup-merge-engine.ts` enforces hard-dependency auto-inclusion (e.g., selecting `sales` auto-includes `company_settings`, `branches`, `products`, `categories`, `units_custom_fields`, `customers`, `currencies`) and emits `BackupDependencyWarning` items when auto-inclusion is disabled. |
| 3 | **Restoring a backup as a new independent company** | **Implemented and verified** | `remapBackupPayloadForNewCompany()` in `src/lib/backup-merge-engine.ts` and `restoreBackupAsNewCompany()` in `src/server/backup-restore.service.ts` allocate a new `companyId`, remap all primary/foreign keys (`idRemapTable`), disambiguate unique codes (`sku`, `barcode`, `code`, `invoiceNumber`), strip legacy credentials, and initialize a new `COMPANY_OWNER` account. |
| 4 | **Importing backup data into an existing company** | **Implemented and verified** | `POST /api/backups/merge-preview` and `POST /api/backups/merge-execute` in `src/server/backup-restore.service.ts` allow uploading any `.backup` archive into an active company workspace after dry-run conflict inspection. |
| 5 | **Intelligent duplicate detection and record matching** | **Implemented and verified** | `analyzeBackupMergePreview()` in `src/lib/backup-merge-engine.ts` implements Arabic/English text normalization (`normalizeEntityName`, including Eastern Arabic numerals `٠-٩`), code normalization (`normalizeCode`), Sudan phone canonicalization (`normalizePhone`), and 5-tier similarity classification (`EXACT_MATCH`, `STRONG_MATCH`, `POSSIBLE_MATCH`, `NO_MATCH`, `CONFLICTING_RECORD`). |
| 6 | **Field-level conflict resolution and data merging** | **Implemented and verified** | `applyIntelligentBackupMerge()` in `src/lib/backup-merge-engine.ts` supports 5 resolution strategies (`KEEP_EXISTING`, `UPDATE_EXISTING`, `MERGE`, `IMPORT_AS_NEW`, `SKIP`) at both the module level (`moduleResolutions`) and individual record level (`recordResolutions`), filling blank fields and unioning `barcodes[]` without destructive overwrites. |
| 7 | **Financial and inventory data integrity** | **Implemented and verified** | Posted sales (`transactions`), purchases, expenses, journal entries, and stock movements default to `SKIP` on exact match so revenue and stock are never double-counted. Live product `stock` is preserved by default during `MERGE`, or updated via an explicit audited `stockMovement` when `ADD_IMPORTED_STOCK_AS_ADJUSTMENT` is selected. Historical `exchangeRatesSnapshot` on sales is preserved unchanged. |
| 8 | **Backup encryption, integrity verification, and recovery** | **Implemented and verified** | `packBackupEnvelope()` and `verifyAndUnpackBackupEnvelope()` in `src/server/backup-restore.service.ts` implement `gzip` compression, per-module and master SHA-256 checksum verification, optional `AES-256-GCM` authenticated encryption (`crypto.scryptSync` KDF), and mandatory pre-restore/pre-merge recovery checkpoints (`chk-pre-restore-*`, `chk-pre-merge-*`) with automatic rollback on failure. |
| 9 | **Cross-device backup portability** | **Implemented and verified** | Self-contained `.backup` files (`DQNAMO_POS_BACKUP_V1`) can be downloaded on one device and uploaded on another device via `BackupRestoreCenterSection.tsx` or `FirstRunOnboardingModal.tsx`. |
| 10 | **Integration with Fresh Setup and Zero Default Business Data** | **Implemented and verified** | Integrated with `src/server/release-onboarding.service.ts` and `src/components/onboarding/FirstRunOnboardingModal.tsx` (Option C: **Restore Company from Backup**). Restoring or initializing never injects unsolicited sample products, currencies, or fictional transactions. |

---

## 3. Persistence & Database Schema Audit

### 3.1 Relational Schema (`src/db/schema.ts` — 26 Tables) & Migrations (`drizzle/`)

- **Migrations Inspection (`drizzle/`)**:
  - `drizzle/0001_phase10_unmet_demand_requests.sql` and `0001_phase10_unmet_demand_requests.rollback.sql` — **[Implemented and verified]**.
  - **Finding — Drizzle SQL Migrations for Newer Additive Tables**: While `src/db/schema.ts` defines all 26 tables (including `companies`, `auth_sessions`, `intelligence_lifecycle_items`, `intelligence_lifecycle_events`), dedicated SQL migration files in `drizzle/` only cover `0001_phase10_unmet_demand_requests.sql` (**[Partially implemented]** — schema push relies on `drizzle-kit push` when `DATABASE_URL` is configured).
  - **Finding — External Cloud SQL / PostgreSQL Connection State**: In the local container environment without `DATABASE_URL` set, `hasDatabaseCredentials()` in `src/db/index.ts` returns `false` and the server operates on the durable `.data/*.json` repositories (**[Unknown or requiring further investigation]** when deploying against a live external PostgreSQL cluster with pre-existing global unique indexes).

### 3.2 Complete Table & Entity Inventory (`src/db/schema.ts` vs `.data/*.json` vs `POSContext`)

| # | Entity / Table | Drizzle Schema (`src/db/schema.ts`) | Server JSON Store (`.data/*.json`) | Client Scoped State (`POSContext.tsx`) | Tenant Isolation (`companyId`) | Audit Status |
|---|---|---|---|---|---|---|
| 1 | `companies` | Defined (Line 23) | `.data/platform-release-state.json` | `pos_companies_v1` | Primary root (`id`) | **Implemented and verified** |
| 2 | `auth_sessions` | Defined (Line 60) | `.data/platform-release-state.json` | Session token in storage | `company_id` (Excluded from backups) | **Implemented and verified** |
| 3 | `branches` | Defined (Line 85) | `.data/platform-release-state.json` | `pos_branches_v1__<companyId>` | `company_id` (`code` is global unique in PG) | **Implemented and verified** |
| 4 | `roles` | Defined (Line 101) | `src/lib/rbac-capabilities.ts` | Role capabilities in user record | `company_id` | **Implemented and verified** |
| 5 | `users` (Employees) | Defined (Line 115) | `.data/platform-release-state.json` | `pos_users_v2__<companyId>` | `company_id` (`username` is global unique in PG) | **Implemented and verified** |
| 6 | `categories` | Defined (Line 140) | `.data/backups/aux-modules-<companyId>.json` | Derived & stored in aux modules | `company_id` (`slug` is global unique in PG) | **Implemented and verified** |
| 7 | `products` | Defined (Line 150) | `.data/products.json` & `.data/store-state.json` | `pos_products_v2__<companyId>` | `company_id` (`sku`, `barcode` global unique in PG) | **Implemented and verified** |
| 8 | `product_barcodes` | Defined (Line 482) | Embedded in `products[].barcodes` | Embedded in `products[].barcodes` | Via `product_id` | **Implemented and verified** |
| 9 | `units_of_measure` | Defined (Line 445) | `.data/uom.json` | Included in backup payload | Shared / Scoped on export | **Implemented and verified** |
| 10 | `product_unit_conversions` | Defined (Line 457) | Embedded in product packaging fields | Embedded in `Product` (`unitsPerPack`, etc.) | Via `product_id` | **Implemented and verified** |
| 11 | `custom_field_definitions` | Defined (Line 505) | `.data/custom-fields.json` | Included in backup payload | Shared / Scoped on export | **Implemented and verified** |
| 12 | `product_custom_field_values` | Defined (Line 526) | Embedded in `products[].customFields` | Embedded in `products[].customFields` | Via `product_id` | **Implemented and verified** |
| 13 | `customers` | Defined (Line 246) | `.data/store-state.json` | `pos_customers_v2__<companyId>` | `company_id` | **Implemented and verified** |
| 14 | `suppliers` | Defined (Line 185) | `.data/backups/aux-modules-<companyId>.json` | Company aux modules | `company_id` | **Implemented and verified** |
| 15 | `purchases` & `purchase_items` | Defined (Lines 198, 211) | `.data/backups/aux-modules-<companyId>.json` | Company aux modules | `company_id` | **Implemented and verified** |
| 16 | `stock_movements` | Defined (Line 221) | `.data/store-state.json` | `pos_movements_v2__<companyId>` | `company_id` | **Implemented and verified** |
| 17 | `branch_transfers` & `items` | Defined (Lines 343, 354) | `.data/backups/aux-modules-<companyId>.json` | Company aux modules | `company_id` | **Implemented and verified** |
| 18 | `sales`, `sale_items`, `payments`, `returns` | Defined (Lines 268–340) | `.data/store-state.json` (`transactions`) | `pos_transactions_v2__<companyId>` | `company_id` | **Implemented and verified** |
| 19 | `expenses` | Defined (Line 697) | `.data/backups/aux-modules-<companyId>.json` | Company aux modules | `company_id` | **Implemented and verified** |
| 20 | `accounts` & `journal_entries` | Defined (Lines 722, 747) | `.data/backups/aux-modules-<companyId>.json` | `pos_accounts_v2__<companyId>`, `pos_journal_v2__<companyId>` | `company_id` | **Implemented and verified** |
| 21 | `currencies` & `exchange_rates` | Defined (Lines 408, 421) | `.data/currencies.json`, `.data/exchange-rates.json` | `dqnamo_pos_currencies_v1__<companyId>` | Company-scoped in client & aux store; global file in `.data/currencies.json` | **Implemented and verified** |
| 22 | `store_settings` & `invoice_settings` | Defined (Line 362) | `.data/backups/aux-modules-<companyId>.json` | `pos_settings_v2__<companyId>` | `company_id` | **Implemented and verified** |
| 23 | `unmet_demand_requests` | Defined (Line 552) | `.data/store-state.json` & `.data/unmet-demand.json` | `pos_unmet_demand_v1__<companyId>` | `company_id` | **Implemented and verified** |
| 24 | `intelligence_lifecycle_items` & `events` | Defined (Lines 606, 670) | `.data/intelligence-lifecycle.json` | Fetched via `/api/intelligence` | `company_id` | **Implemented and verified** |
| 25 | `audit_logs` | Defined (Line 387) | `.data/platform-release-state.json` | Fetched via `/api/backups` & `/api/audit-logs` | `company_id` | **Implemented and verified** |

---

## 4. Database Dependencies, Risks & Mitigations Verified

### Risk 1: Global Unique Constraints in `src/db/schema.ts` Across Multi-Company Restores
- **Status:** **[Implemented and verified]**
- **Description:** In `src/db/schema.ts`, `branches.code`, `users.username`, `categories.slug`, `products.sku`, `products.barcode`, `product_barcodes.barcode`, `purchases.purchase_number`, `branch_transfers.transfer_number`, and `sales.transaction_id` have table-wide `.unique()` constraints.
- **Mitigation:** `remapBackupPayloadForNewCompany()` appends a deterministic tenant suffix (`-<suffix>`) to codes, SKUs, and transaction numbers when restoring as a new company so no collision occurs even on shared tables.

### Risk 2: Split Persistence Between `.data/currencies.json` (Global) and Per-Company Aux Modules
- **Status:** **[Implemented and verified]**
- **Description:** `collectServerCompanyPayload()` and `persistServerCompanyPayload()` prioritize the company-scoped auxiliary store (`.data/backups/aux-modules-<companyId>.json`) first so restoring or merging Company B never overwrites Company A's currencies.

### Risk 3: Multi-Tenant Scoping on `/api/store-sync` in `server.ts`
- **Status:** **[Implemented and verified]**
- **Description:** `GET /api/store-sync` and `POST /api/store-sync` in `server.ts` resolve `companyId` (`resolveRequestCompanyScope`), tag incoming records (`tagWithCompanyScope`), and filter returned datasets (`filterByCompanyScope`) while preserving other companies' records in `.data/store-state.json`.

### Risk 4: Relational Tables for `expenses`, `accounts`, and `journal_entries` in `src/db/schema.ts`
- **Status:** **[Implemented and verified]**
- **Description:** `src/db/schema.ts` now defines `expenses`, `accounts`, and `journalEntries` (Tables 26–28) with `companyId` indexing alongside `.data/backups/aux-modules-<companyId>.json` and `BackupPayloadV1`.

---

## 5. Prioritized Implementation & Hardening Plan (Phases B – I)

1. **Phase B — Backup System Architecture & Packaging (`DQNAMO_POS_BACKUP_V1`)**:
   - Full Company Backup (all 15 modules) + Selective Module Backup with automatic dependency resolution (`resolveBackupModuleDependencies`).
   - `gzip` compression, per-module & master SHA-256 checksums, zero-credential scrubbing (`scrubSensitiveUserFields`), and optional `AES-256-GCM` encryption.
2. **Phase C — Full Restore (Option 1: Original Company & Option 2: New Isolated Company)**:
   - Option 1 (`restoreBackupIntoOriginalCompany`): Company identity check, Owner step-up password verification, automatic `chk-pre-restore-*` recovery checkpoint, and transactional rollback on failure.
   - Option 2 (`restoreBackupAsNewCompany`): Fresh `companyId`, complete foreign-key and primary-key remapping (`remapBackupPayloadForNewCompany`), and new `COMPANY_OWNER` initialization.
3. **Phase D, E & F — Selective Import, Duplicate Detection & Intelligent Merge Engine**:
   - Arabic/English text normalization (`normalizeEntityName`), SKU/barcode normalization, and Sudan phone canonicalization (`normalizePhone`).
   - 5-tier similarity classification (`EXACT_MATCH`, `STRONG_MATCH`, `POSSIBLE_MATCH`, `NO_MATCH`, `CONFLICTING_RECORD`) and 5 resolution modes (`KEEP_EXISTING`, `UPDATE_EXISTING`, `MERGE`, `IMPORT_AS_NEW`, `SKIP`).
   - Strict financial & inventory safeguards (never duplicate posted invoices/payments, preserve locked `exchangeRatesSnapshot`, protect live stock balances).
4. **Phase G — Security, RBAC & Multi-Tenant Hardening**:
   - Enforce the 8 `backup.*` capabilities (`backup.view`, `backup.create`, `backup.download`, `backup.restore`, `backup.import`, `backup.merge`, `backup.manage`, `backup.delete`), Owner step-up authentication, and immutable audit logging.
5. **Phase H & I — Bilingual UI (RTL/LTR), Automated Verification & Documentation**:
   - `BackupRestoreCenterSection.tsx` in Settings and **Option C — Restore Company from Backup** in `FirstRunOnboardingModal.tsx`.
   - Automated acceptance tests (`src/server/backup-restore-acceptance.test.ts` and `src/server/fresh-installation-acceptance.test.ts`).
