# Intelligent Data Merge & Duplicate Detection Rules (`PHASE A`)

## 1. Overview & Verification Status

When importing a backup package into an **existing company that already contains live data**, the **Intelligent Data Merge Engine** (`src/lib/backup-merge-engine.ts`) analyzes every incoming record against the target company's existing dataset before writing any changes.

### Merge Engine Verification Status Matrix
| Feature / Rule Set | Status | Location in Codebase |
|---|---|---|
| Arabic & Latin Name Normalization (including Eastern Arabic digits `٠-٩`) | **Implemented and verified** | `normalizeEasternArabicDigits()`, `normalizeEntityName()` in `src/lib/backup-merge-engine.ts` |
| Code / SKU / Barcode Normalization (`normalizeCode`) | **Implemented and verified** | `normalizeCode()` in `src/lib/backup-merge-engine.ts` |
| Sudan & International Phone Canonicalization (`+249` / `00249` / `0`) | **Implemented and verified** | `normalizePhone()` in `src/lib/backup-merge-engine.ts` |
| 5-Tier Similarity Classification (`EXACT_MATCH` .. `CONFLICTING_RECORD`) | **Implemented and verified** | `analyzeBackupMergePreview()` in `src/lib/backup-merge-engine.ts` |
| 5 Conflict Resolution Modes (`KEEP_EXISTING`, `UPDATE_EXISTING`, `MERGE`, `IMPORT_AS_NEW`, `SKIP`) | **Implemented and verified** | `applyIntelligentBackupMerge()` in `src/lib/backup-merge-engine.ts` |
| Foreign-Key Remapping Across Merged Master Entities (`idRemapTable`) | **Implemented and verified** | `applyIntelligentBackupMerge()` in `src/lib/backup-merge-engine.ts` |
| Financial & Inventory Protection Rules (No duplicate sales/movements, live stock preserved) | **Implemented and verified** | `applyIntelligentBackupMerge()` in `src/lib/backup-merge-engine.ts` |
| Automated Unit & Acceptance Tests for Arabic/Phone Normalization & Merge | **Implemented and verified** | `src/server/backup-restore-acceptance.test.ts` (Tests 5 & 6) |

---

## 2. Text, Numeral, Code & Phone Normalization Pipeline — **[Implemented and verified]**

Before comparing records across backups and live company data, all candidate keys pass through deterministic normalization:

1. **Eastern Arabic-Indic Numeral Normalization (`normalizeEasternArabicDigits`)**:
   - Converts Eastern Arabic-Indic digits (`٠١٢٣٤٥٦٧٨٩`) and Extended Arabic-Indic digits (`۰۱۲۳۴۵۶۷۸۹`) to standard ASCII digits (`0123456789`) so `"عبوة ٥ كجم"` and `"عبوة 5 كجم"` match identically.
2. **String / Name Normalization (`normalizeEntityName`)**:
   - Unicode NFKC normalization, trim, and lowercase.
   - Strips Arabic diacritics (*Tashkeel* `\u064B-\u065F`, `\u0670`) and *Tatweel* (`\u0640`).
   - Unifies Arabic Alef variants (`أ`, `إ`, `آ`, `ٱ` -> `ا`), Teh Marbuta (`ة` -> `ه`), and Alef Maksura (`ى` -> `ي`).
3. **Code / SKU / Barcode Normalization (`normalizeCode`)**:
   - Normalizes digits, trims whitespace, strips spaces/hyphens/underscores, and uppercases (`"  sku-001 "` -> `"SKU001"`).
4. **Sudan Phone Canonicalization (`normalizePhone`)**:
   - Strips spaces, dashes, and parentheses, and normalizes Sudan country prefixes (`+249912345678`, `00249912345678`, and `0912345678` all normalize to `249912345678`).

---

## 3. Five-Tier Similarity Classification — **[Implemented and verified]**

Every incoming record in the backup is classified into one of five deterministic categories:

| Classification | Definition | Default Recommended Resolution |
|---|---|---|
| `EXACT_MATCH` | Primary unique key (`barcode`, `sku`, `code`, `phone` + `name`, or `transactionId`) AND core attributes match. | `MERGE` (Master Data) / `SKIP` (Historical Transactions) |
| `STRONG_MATCH` | Natural key matches (`barcode`, `sku`, normalized `phone`, `email`, `taxNumber`, or exact normalized Arabic/English name), with updated mutable fields. | `MERGE` |
| `POSSIBLE_MATCH` | Fuzzy token Jaccard + bigram Dice similarity $\ge 0.78$ on normalized Arabic/English names, with differing or missing code. | `KEEP_EXISTING` (Flagged for Owner review) |
| `NO_MATCH` | No matching identifier, natural key, or similar name exists in the target company. | `IMPORT_AS_NEW` |
| `CONFLICTING_RECORD` | Shares a unique constraint key (e.g., same `barcode` or `sku`, or same `phone`, or incompatible `baseCurrency`) with a completely different entity name ($< 0.45$ similarity), or same invoice ID with different financial totals. | `KEEP_EXISTING` (Flagged as Conflict requiring explicit decision) |

---

## 4. Entity-Specific Matching & Merge Rules — **[Implemented and verified]**

1. **Products (`products`)**:
   - Matched by: (1) Primary or additional `barcodes[]`, (2) Normalized `sku`, (3) Exact normalized `name` / `nameAr` + `category`, (4) Fuzzy name similarity $\ge 0.80$.
   - **`MERGE` Behavior**: Preserves existing `id`; fills blank `nameAr`, `description`, `image`, and `customFields`; unions `barcodes[]` without duplicates; **preserves live target `stock`** by default (or adds imported stock via an audited `stockMovement` adjustment if `stockMergePolicy: 'ADD_IMPORTED_STOCK_AS_ADJUSTMENT'` is selected).
2. **Product Categories (`categories`)**:
   - Matched by normalized `slug`, `name`, or `nameAr`. Maps `incomingCategory.id -> existingCategory.id` in `idRemapTable` so imported products link to the existing category.
3. **Customers (`customers`) & Suppliers (`suppliers`)**:
   - Matched by normalized `phone`, `taxNumber`, `email`, or normalized `name`.
   - **`MERGE` Behavior**: Preserves existing `id`, remaps foreign keys (`customerId`, `supplierId`) on imported invoices/purchases, fills missing contact fields, and preserves live financial balances (`totalSpent`, `totalDebt`, `loyaltyPoints`).
4. **Units of Measurement & Custom Fields (`units_custom_fields`)**:
   - Matched by normalized UOM `code`/`name` or custom field `name`. Unions dropdown `options[]`.
5. **Branches (`branches`)**:
   - Matched by normalized branch `code` or `name`/`nameAr`.
6. **Currencies & Exchange Rates (`currencies`)**:
   - Matched by ISO `code` (`SDG`, `USD`, `SAR`, `AED`, `EGP`).
   - **Base Currency Protection**: Never overwrites the target company's `baseCurrency`. Missing secondary currencies and historical exchange rates are imported non-destructively.
7. **Employees & Permissions (`employees_permissions`)**:
   - Matched by `username`, `email`, or normalized `name`. Existing users and their credentials are never overwritten; newly imported employees have credentials stripped (`hasPassword: false`, `mustChangePassword: true`).

---

## 5. Financial & Inventory Protection Rules (Non-Negotiable) — **[Implemented and verified]**

1. **Sales (`transactions`) & Purchases (`purchases`)**:
   - Matched by `id`, `idempotencyKey`, or `purchaseNumber`.
   - Matched invoices default to `SKIP` so posted revenue, tax, and customer debt are never double-counted.
   - Newly imported historical sales (`IMPORT_AS_NEW`) retain their original locked `exchangeRatesSnapshot` and have their `customerId`, `branchId`, and `items[].productId` remapped via `idRemapTable`.
2. **Stock Movements (`stockMovements`) & Branch Transfers (`branchTransfers`)**:
   - Matched by `id` or `(productId, timestamp, type, quantityChange)`. Existing movements default to `SKIP` to prevent duplicate ledger entries.
3. **Accounting (`accounts` & `journalEntries`) & Expenses (`expenses`)**:
   - Chart of Accounts matched by `code` or normalized `name`/`nameAr` (preserving existing `balance` during `MERGE` and mapping `accountId` for journal lines).
   - Posted `journalEntries` and `expenses` default to `SKIP` on match so financial ledgers are never duplicated.
