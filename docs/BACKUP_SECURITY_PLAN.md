# Backup, Restore & Migration Security Plan (`PHASE A`)

## 1. Security Objectives & Verification Status

Backup, Restore, and Data Migration operations handle the entirety of a company's commercial, financial, and operational records. This security plan documents the **Authentication, Role-Based Access Control (RBAC), Cryptographic Integrity, Credential Scrubbing, Tenant Isolation, and Immutable Audit Logging** controls and their current verification status in the repository.

### Security Control Verification Matrix
| Security Control | Status | Implementation Evidence |
|---|---|---|
| 8 Granular `backup.*` RBAC Capabilities | **Implemented and verified** | `src/lib/rbac-capabilities.ts` (Lines 107–115, `groupKey: 'backup'`) |
| Zero-Credential & Token Scrubbing on Export | **Implemented and verified** | `scrubSensitiveUserFields()` in `src/lib/backup-merge-engine.ts` |
| Multi-Layer SHA-256 Checksums (Per-Module + Master Payload) | **Implemented and verified** | `packBackupEnvelope()` & `verifyAndUnpackBackupEnvelope()` in `src/server/backup-restore.service.ts` |
| Authenticated Encryption (`AES-256-GCM` + `scrypt` KDF) | **Implemented and verified** | `src/server/backup-restore.service.ts` (32-byte salt, 16-byte IV, 16-byte GCM authTag) |
| Owner Step-Up Password Re-Authentication for Restore/Merge/Delete | **Implemented and verified** | `verifyCompanyOwnerReauth()` in `src/server/backup-restore.service.ts` |
| Automatic Pre-Restore & Pre-Merge Checkpoints + Rollback | **Implemented and verified** | `restoreBackupIntoOriginalCompany()` & `executeCompanyBackupMerge()` in `src/server/backup-restore.service.ts` |
| Cross-Tenant Isolation & Company Identity Verification | **Implemented and verified** | `assertActorCompanyMatch()` & `BACKUP_COMPANY_IDENTITY_MISMATCH` check in `src/server/backup-restore.service.ts` |
| Immutable Audit Trail for All Backup/Restore/Merge Events | **Implemented and verified** | `appendPlatformAuditLog()` in `src/server/backup-restore.service.ts` |
| Legacy `/api/store-sync` Multi-Tenant Filtering | **Partially implemented** | `/api/backups/*` enforces strict tenant isolation; legacy `/api/store-sync` in `server.ts` merges shared JSON state without per-tenant auth headers |
| Hardware Security Module (HSM) / Cloud KMS Key Wrapping | **Unknown or requiring further investigation** | Optional enterprise cloud extension when deployed to GCP/AWS |

---

## 2. Role-Based Access Control (RBAC) Matrix — **[Implemented and verified]**

Eight granular capabilities are defined in `src/lib/rbac-capabilities.ts` under `groupKey: 'backup'`:

| Capability Code | Description | `COMPANY_OWNER` | `ADMIN` | `MANAGER` | `ACCOUNTANT` | `INVENTORY_MANAGER` | `CASHIER` / `REPORT_VIEWER` |
|---|---|---|---|---|---|---|---|
| `backup.view` | View backup history, manifest summaries, and validation reports | Yes | Yes | Yes | Yes | No | No |
| `backup.create` | Generate full or selective company backups | Yes | Yes | Yes | No | No | No |
| `backup.download` | Download `.backup` archives to local device | Yes | Yes | Yes | No | No | No |
| `backup.import` | Upload and inspect external `.backup` packages (dry-run preview) | Yes | Yes | Yes | No | No | No |
| `backup.restore` | Execute full restore (in-place or as new company) | **Yes** | Yes | No | No | No | No |
| `backup.merge` | Execute intelligent data merge into existing company | **Yes** | Yes | No | No | No | No |
| `backup.manage` | Configure encryption options and recovery checkpoints | **Yes** | Yes | No | No | No | No |
| `backup.delete` | Delete stored server-side backup checkpoints | **Yes** | Yes | No | No | No | No |

*Destructive or state-mutating operations (`restore-in-place`, `merge-execute`, `DELETE /:backupId`) additionally enforce **Step-Up Owner Password Verification (`verifyCompanyOwnerReauth`)**.*

---

## 3. Zero-Credential & Secret Scrubbing Policy — **[Implemented and verified]**

1. **Never Export Credentials or Active Tokens**:
   - Every employee record exported into `BackupPayloadV1.employees` passes through `scrubSensitiveUserFields()`:
     - `password`, `passwordHash`, `passwordSalt`, `pin`, `pinCode`, `pinHash` -> **Stripped**
     - `sessionToken`, `token`, `refreshToken`, `apiKey` -> **Stripped**
   - Active `auth_sessions` and server environment secrets (`.env`) are **100% excluded** from backup archives.
2. **Credential Handling During Restore**:
   - **Option 1 (Restore into Original Company)**: `persistServerCompanyPayload(..., { preserveExistingCredentials: true })` preserves the active `COMPANY_OWNER` and existing users' live `passwordHash` and `passwordSalt` on the server so the Owner is never locked out.
   - **Option 2 (Restore as New Company)**: Requires creating a new Owner account (`ownerUsername`, `ownerPassword`, `ownerConfirmPassword`) hashed with `hashPasswordScrypt`.

---

## 4. Authenticated Encryption & Integrity Verification — **[Implemented and verified]**

1. **Multi-Layer SHA-256 Checksums**:
   - Every module in `BackupPayloadV1` has an independent SHA-256 digest stored in `manifest.moduleChecksumsSha256[moduleId]`.
   - The complete serialized `BackupPayloadV1` has a master SHA-256 digest stored in `envelope.payloadChecksumSha256`.
   - Any mismatch throws `BACKUP_MASTER_CHECKSUM_MISMATCH` or `BACKUP_MODULE_CHECKSUM_MISMATCH` (HTTP `400`) before touching company data.
2. **Optional Password-Protected Encryption (`AES-256-GCM`)**:
   - **Cipher**: `aes-256-gcm` with 16-byte random IV and 16-byte authentication tag (`authTagHex`).
   - **Key Derivation**: `crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })` with 32-byte random salt (`saltHex`).
   - Supplying a missing or wrong decryption password throws `BACKUP_PASSWORD_REQUIRED` or `BACKUP_DECRYPTION_FAILED` immediately.

---

## 5. Destructive Operation Safeguards, Checkpoints & Audit Trail — **[Implemented and verified]**

1. **Mandatory Pre-Restore & Pre-Merge Checkpoints**:
   - Before executing any in-place restore or merge, the server snapshots the company's live state into `.data/backups/<companyId>/chk-pre-restore-<timestamp>.backup` (or `chk-pre-merge-<timestamp>.backup`).
2. **Automatic Rollback**:
   - If any step of the restore or merge fails, `catch` immediately restores `liveSnapshot` via `persistServerCompanyPayload()` and returns `500 RESTORE_FAILED_ROLLED_BACK` / `MERGE_FAILED_ROLLED_BACK`.
3. **Path Traversal Protection**:
   - `sanitizeBackupId()` strips all characters outside `[a-zA-Z0-9_-]` before constructing file paths under `.data/backups/<companyId>/`.
4. **Immutable Audit Logging**:
   - Every backup event (`BACKUP_CREATED`, `BACKUP_DOWNLOADED`, `BACKUP_RESTORED_IN_PLACE`, `BACKUP_RESTORED_AS_NEW_COMPANY`, `BACKUP_MERGE_PREVIEWED`, `BACKUP_MERGE_EXECUTED`, `BACKUP_CHECKPOINT_DELETED`) is recorded in `auditLogs` with actor identity, timestamp, company ID, and summary metrics.
