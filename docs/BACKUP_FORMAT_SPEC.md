# Backup File Format Specification (`DQNAMO_POS_BACKUP_V1`)

## 1. Overview & File Naming Convention

Every Dqnamo POS backup package is a self-contained, cryptographically verifiable archive using the `.backup` file extension:

- **Full Company Backup:** `company-backup-YYYY-MM-DD-HHmmss.backup`
- **Selective Module Backup:** `selective-backup-YYYY-MM-DD-HHmmss.backup`
- **Pre-Restore Recovery Checkpoint:** `pre-restore-checkpoint-YYYY-MM-DD-HHmmss.backup`
- **Pre-Merge Recovery Checkpoint:** `pre-merge-checkpoint-YYYY-MM-DD-HHmmss.backup`

---

## 2. Top-Level Envelope Structure (`BackupPackageEnvelope`)

```json
{
  "formatSignature": "DQNAMO_POS_BACKUP_V1",
  "manifest": {
    "backupId": "bkp-m9x4k2a1-f81c92",
    "formatVersion": "1.0.0",
    "schemaVersion": "2025.05.1",
    "appVersion": "1.0.0",
    "backupType": "FULL_COMPANY",
    "createdAt": "2025-05-12T10:30:00.000Z",
    "createdByUserId": "usr-owner-01",
    "createdByUsername": "owner.admin",
    "sourceCompanyId": "comp-nile-01",
    "sourceCompanyCode": "CMP-NILE01",
    "sourceCompanyDisplayName": "Nile Mart Trading",
    "sourceCompanyDisplayNameAr": "أسواق النيل التجارية",
    "baseCurrency": "SDG",
    "modulesIncluded": [
      "company_settings",
      "currencies",
      "branches",
      "employees_permissions",
      "units_custom_fields",
      "categories",
      "products",
      "customers",
      "suppliers",
      "inventory",
      "purchases",
      "sales",
      "expenses",
      "accounting",
      "intelligence_audit"
    ],
    "autoIncludedDependencies": [],
    "dependencyWarnings": [],
    "recordCounts": {
      "company_settings": 1,
      "currencies": 2,
      "branches": 1,
      "employees_permissions": 2,
      "units_custom_fields": 4,
      "categories": 3,
      "products": 45,
      "customers": 12,
      "suppliers": 5,
      "inventory": 68,
      "purchases": 9,
      "sales": 120,
      "expenses": 14,
      "accounting": 85,
      "intelligence_audit": 32
    },
    "totalRecords": 403,
    "moduleChecksums": {
      "company_settings": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "products": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
    },
    "masterPayloadChecksum": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "compression": "gzip-base64",
    "isEncrypted": false
  },
  "compressedPayloadBase64": "H4sIAAAAAAAAA...",
  "payload": null
}
```

---

## 3. Supported Data Modules (`BackupModuleId`)

| Module ID | Contents | Auto-Included Hard Dependencies |
|---|---|---|
| `company_settings` | Company profile, store settings, tax policies, receipt footer, store logo | — |
| `currencies` | Active currencies, exchange rates to base currency (`SDG`), exchange rate history | `company_settings` |
| `branches` | Branch profiles, branch codes, addresses, active flags | `company_settings` |
| `employees_permissions` | Employee profiles, roles, capability assignments (passwords/PINs stripped) | `company_settings`, `branches` |
| `units_custom_fields` | Units of measurement (`unitsOfMeasure`) & dynamic product custom fields | `company_settings` |
| `categories` | Product categories & hierarchy | `company_settings` |
| `products` | Products, primary & additional barcodes, units, cost/selling prices, custom fields | `company_settings`, `categories`, `units_custom_fields`, `currencies` |
| `customers` | Customer profiles, phones, emails, credit limits, loyalty points, balances | `company_settings` |
| `suppliers` | Supplier profiles, tax numbers, balances | `company_settings` |
| `inventory` | Stock movements (`stockMovements`) & inter-branch transfers (`branchTransfers`) | `company_settings`, `branches`, `products` |
| `purchases` | Purchase orders, purchase invoices, and line items | `company_settings`, `branches`, `products`, `suppliers`, `currencies` |
| `sales` | Sales invoices, returns, payment breakdowns, locked `exchangeRatesSnapshot` | `company_settings`, `branches`, `products`, `customers`, `currencies` |
| `expenses` | Operational expense records | `company_settings`, `branches`, `currencies` |
| `accounting` | Custom chart of accounts (`accounts`) and double-entry `journalEntries` | `company_settings`, `currencies` |
| `intelligence_audit` | Unmet demand logs, intelligence lifecycle records, and company audit trail | `company_settings` |

---

## 4. Compression, Checksums & Authenticated Encryption

1. **Deterministic Checksums:**
   - Every module's dataset is serialized and hashed using **SHA-256** (`manifest.moduleChecksums[moduleId]`).
   - The complete `BackupPayloadV1` JSON string is hashed using **SHA-256** (`manifest.masterPayloadChecksum`).
2. **Compression (`gzip-base64`):**
   - The serialized `BackupPayloadV1` is compressed with `zlib.gzipSync(..., { level: 9 })` and encoded as Base64 in `compressedPayloadBase64`.
3. **Optional Password-Protected Encryption (`AES-256-GCM`):**
   - When the user supplies an encryption password, a 256-bit key is derived using `crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })`.
   - The compressed payload is encrypted with `aes-256-gcm` using a random 96-bit IV and produces a 128-bit authentication tag (`authTagHex`).
   - Any tampering with the ciphertext, IV, salt, or manifest checksum causes decryption or verification to fail immediately before touching company data.

---

## 5. Zero-Credential Security Guarantee

Before any employee record is written into a backup payload, `scrubSensitiveUserFields()` strips:
- `password`
- `passwordHash`
- `passwordSalt`
- `pin`
- `pinHash`
- `sessionToken` / `token` / `refreshToken` / `apiKey`
