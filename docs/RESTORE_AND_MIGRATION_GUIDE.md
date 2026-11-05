# Restore & Company Migration Guide

## 1. Supported Restoration & Migration Modes

Dqnamo POS provides three distinct workflows for restoring or migrating company data from a `.backup` archive:

1. **Option 1 — Restore into the Original Company (In-Place Restore)**
2. **Option 2 — Restore as a Completely New Company (Cross-Device / New Tenant Migration)**
3. **Option 3 — Selective Import & Intelligent Data Merge into an Existing Company**

---

## 2. Option 1: Restore into the Original Company

Use this mode when recovering a company to an earlier state on the same installation.

### Pre-Restore Safety Pipeline
1. **Owner Step-Up Authentication:** The active `COMPANY_OWNER` must re-enter their password to authorize the destructive restore.
2. **Cryptographic Verification:** The server validates the `DQNAMO_POS_BACKUP_V1` signature, decrypts the AES-256-GCM payload (if encrypted), and verifies both `masterPayloadChecksum` and every per-module SHA-256 checksum.
3. **Company Identity Check:** The backup's `sourceCompanyId` / `sourceCompanyCode` must match the target company unless the Owner explicitly authorizes a cross-company override.
4. **Automatic Pre-Restore Recovery Checkpoint:** Before modifying any record, the server automatically creates and stores a full recovery snapshot (`chk-pre-restore-<timestamp>`) in the company's backup vault.
5. **Transactional Apply & Automatic Rollback:** If any error occurs while writing restored modules, the server automatically restores the `liveSnapshot` checkpoint so the company is never left in a partial state.
6. **Credential Preservation:** Existing Owner and employee password hashes on the server are preserved so the Owner is never locked out after restoration.

---

## 3. Option 2: Restore as a Completely New Company

Use this mode when:
- Setting up a **Fresh Installation** from an existing `.backup` file on a new device (via **Option C — Restore Company from Backup** in the First-Run Onboarding screen).
- Cloning or migrating a store into a new, isolated company workspace inside the **Backup & Restore Center**.

### Required Inputs
- **Backup Archive (`.backup`)** + optional **Decryption Password**
- **New Company Name (English & Arabic)**
- **New Owner Full Name & Unique Username**
- **New Owner Password & Password Confirmation**

### Automatic Identifier Remapping (`remapBackupPayloadForNewCompany`)
To guarantee zero primary-key or foreign-key collisions with any existing company on the same server, the migration engine generates a fresh `companyId` and remaps all internal record IDs while preserving historical relationships:
- `companyProfile.id` -> `newCompanyId`
- `branches[].id` -> new branch IDs (updating `products.branchId`, `transactions.branchId`, `stockMovements.branchId`, `purchases.branchId`, `expenses.branchId`, and `employees.branchId`)
- `categories[].id` -> new category IDs (updating `products.categoryId`)
- `products[].id` -> new product IDs (updating `transactions.items[].productId`, `purchases.items[].productId`, `stockMovements.productId`)
- `customers[].id` -> new customer IDs (updating `transactions.customerId`)
- `suppliers[].id` -> new supplier IDs (updating `purchases.supplierId`)
- `accounts[].id` -> new account IDs (updating `journalEntries.lines[].accountId`)
- Legacy employee credentials are stripped; the newly created `COMPANY_OWNER` account is bound to the new company with a fresh `scrypt` password hash.
