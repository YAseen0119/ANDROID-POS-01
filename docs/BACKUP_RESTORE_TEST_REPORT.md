# Backup, Restore & Intelligent Merge — Verification & Test Report

## 1. Automated Test Suite Summary

All automated unit and integration tests were executed via Node's test runner (`npx --yes tsx --test`):

| Test Suite | Total Tests | Passed | Failed | Duration |
|---|---|---|---|---|
| `src/server/backup-restore-acceptance.test.ts` | 7 comprehensive suites (covering 14 scenarios) | **7** | **0** | ~1.1s |
| `src/server/fresh-installation-acceptance.test.ts` | 20 acceptance tests | **20** | **0** | ~1.3s |
| **Total** | **27** | **27** | **0** | **100% Pass** |

---

## 2. Verified Scenarios Matrix (`backup-restore-acceptance.test.ts`)

1. **Full Company Backup Creation & Zero-Credential Policy:**
   - Verified packaging of all 15 company-owned modules into `DQNAMO_POS_BACKUP_V1`.
   - Verified SHA-256 per-module checksums and master payload checksum.
   - Verified that `passwordHash`, `passwordSalt`, `pin`, and `sessionToken` are 100% stripped from exported employee records.
2. **Selective Module Backup & Automatic Dependency Resolution:**
   - Verified that selecting `sales` with `autoIncludeDependencies: true` automatically includes `company_settings`, `branches`, `products`, `customers`, `categories`, `units_custom_fields`, and `currencies`.
   - Verified that disabling `autoIncludeDependencies` generates explicit `BackupDependencyWarning` alerts for missing dependencies.
3. **Password-Protected Authenticated Encryption (`AES-256-GCM`):**
   - Verified key derivation via `scrypt` and encryption via `aes-256-gcm`.
   - Verified that unpacking without a password throws `BACKUP_PASSWORD_REQUIRED`.
   - Verified that unpacking with an incorrect password throws `BACKUP_DECRYPTION_FAILED`.
   - Verified that unpacking with the correct password restores the exact payload and passes all SHA-256 checksums.
4. **Tampered / Corrupted Backup Rejection:**
   - Verified that modifying any record or checksum inside the archive throws `BACKUP_MODULE_CHECKSUM_MISMATCH` or `BACKUP_MASTER_CHECKSUM_MISMATCH` before any company data is touched.
5. **Arabic/English Text, Numeral & Sudan Phone Normalization:**
   - Verified unification of Arabic Alef variants (`أ`, `إ`, `آ` -> `ا`), Teh Marbuta (`ة` -> `ه`), diacritics, and Eastern Arabic-Indic numerals (`٥` -> `5`).
   - Verified Sudan phone canonicalization (`+249 91 234 5678`, `00249-91-234-5678`, `0912345678` -> `249912345678`).
6. **Intelligent Duplicate Detection & Non-Destructive Merge Engine:**
   - Verified detection of `EXACT_MATCH` (shared barcode/SKU/phone/invoice number), `STRONG_MATCH`, and `NO_MATCH`.
   - Verified that `MERGE` on products unions `additionalBarcodes`, fills missing Arabic names, and preserves live target `stock` (`25` units preserved instead of being overwritten by backup's `8` units).
   - Verified foreign-key ID remapping when merging categories and customers (`cat-backup-old` -> `cat-target-existing`, `cust-backup-99` -> `cust-target-1`).
   - Verified that duplicate posted sales invoices (`INV-2025-001`) are automatically skipped (`SKIP`) so revenue is never double-counted, while new invoices (`INV-2025-002`) are imported with remapped customer and product IDs.
7. **End-to-End Multi-Tenant Server Backup, Pre-Restore Checkpoint, In-Place Restore, Restore as New Company & RBAC:**
   - Verified that a `CASHIER` role lacking `backup.create` is rejected with `403 FORBIDDEN_MISSING_CAPABILITY`.
   - Verified tenant isolation: Company B cannot view or restore Company A's backups in-place (`BACKUP_COMPANY_IDENTITY_MISMATCH`).
   - Verified that in-place restore requires step-up Owner password verification (`INVALID_OWNER_CREDENTIALS` on wrong password) and automatically creates a `chk-pre-restore-*` checkpoint before applying data.
   - Verified **Restore as New Company** (`restoreBackupAsNewCompany`) creates an isolated company with a new `companyId`, remaps product/customer/branch/invoice IDs, preserves item-to-product references, and issues a valid Owner session token.
