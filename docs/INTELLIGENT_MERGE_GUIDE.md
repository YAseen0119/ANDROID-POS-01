# Intelligent Data Merge & Duplicate Detection Guide

## 1. Overview

When importing a `.backup` package into an already operating company, Dqnamo POS runs a non-destructive **Dry-Run Merge Analyzer** (`analyzeBackupMergePreview`) before writing any data. It compares every incoming record against existing company records, classifies similarity, and lets the Owner choose conflict resolution strategies at both the module level and individual record level.

---

## 2. Text, Digit, Code & Phone Normalization Rules

Before comparing records, the engine normalizes text and identifiers across Arabic and English:

1. **Arabic & Latin Text Normalization (`normalizeEntityName`):**
   - Converts Eastern Arabic-Indic numerals (`٠١٢٣٤٥٦٧٨٩`) and Extended Arabic-Indic numerals (`۰۱۲۳۴۵۶۷۸۹`) to standard Western digits (`0123456789`).
   - Strips Arabic diacritics (*Tashkeel* `\u064B-\u065F`, `\u0670`) and *Tatweel/Kashida* (`\u0640`).
   - Normalizes Alef variants (`أ`, `إ`, `آ`, `ٱ` -> `ا`), Teh Marbuta (`ة` -> `ه`), and Alef Maksura (`ى` -> `ي`).
   - Lowercases Latin characters, removes punctuation, and collapses whitespace.
2. **Code / SKU / Barcode Normalization (`normalizeCode`):**
   - Converts Eastern Arabic digits, trims whitespace, strips internal spaces/dashes, and uppercases (`"  sku-001 "` -> `"SKU001"`).
3. **Sudan & International Phone Normalization (`normalizePhone`):**
   - Converts Eastern Arabic digits, strips non-digit characters, and canonicalizes Sudan country prefixes (`+249912345678`, `00249912345678`, and `0912345678` all normalize to `249912345678`).

---

## 3. Five-Tier Similarity Classification

Every incoming record is classified into one of five match tiers:

| Classification | Criteria | Default Strategy |
|---|---|---|
| `EXACT_MATCH` | Identical primary barcode, SKU, invoice number, currency code, account code, or normalized phone + name | `MERGE` (Master Data) / `SKIP` (Historical Transactions) |
| `STRONG_MATCH` | Exact normalized Arabic or English entity name, exact phone match, or exact email match | `MERGE` |
| `POSSIBLE_MATCH` | Token Jaccard + Bigram Sørensen-Dice similarity $\ge 0.78$ on Arabic/English names | `KEEP_EXISTING` (Flagged for Owner review) |
| `CONFLICTING_RECORD` | Same unique code/barcode/phone assigned to a completely different entity name or incompatible currency | `KEEP_EXISTING` (Requires explicit Owner resolution) |
| `NO_MATCH` | Brand-new record with no match in the target company | `IMPORT_AS_NEW` |

---

## 4. Five Conflict Resolution Strategies

Authorized users can apply any of the following resolutions per module or per record:

1. **`KEEP_EXISTING`:** Preserve the target company's existing record unchanged.
2. **`UPDATE_EXISTING`:** Update the existing record's descriptive fields and prices from the backup while preserving the target record's primary `id` and foreign-key integrity.
3. **`MERGE` (Smart Non-Destructive Combine):**
   - Fills blank fields (`nameAr`, `description`, `email`, `phone`, `taxNumber`, `customFields`) on the target record without erasing existing non-empty values.
   - **Barcodes:** Unions `additionalBarcodes` without duplicating existing barcodes.
   - **Product Stock Protection:** Preserves the target company's live `stock` balance by default. If `stockMergePolicy: 'ADD_IMPORTED_STOCK_AS_ADJUSTMENT'` is explicitly chosen, adds the imported stock quantity and generates an audited `stockMovement` adjustment record.
   - **Foreign Key Remapping:** Automatically maps the backup record's old ID to the existing target record's ID so any imported products, sales, or purchases point to the unified record.
4. **`IMPORT_AS_NEW`:** Inserts the record as a brand-new entity (generating a new non-colliding ID and suffixing conflicting SKUs/codes if necessary).
5. **`SKIP`:** Ignores the incoming record completely.

---

## 5. Financial, Inventory & Multi-Currency Safety Rules

- **Posted Sales, Purchases & Stock Movements are Never Duplicated:** Matched invoices (`invoiceNumber` / `id`), purchase orders, expenses, and journal entries default to `SKIP` so revenue, tax, and inventory balances are never double-counted.
- **Target Base Currency is Protected:** Merging a backup never overwrites the target company's `baseCurrency` (`SDG`). Missing secondary currencies are added without deleting existing rates.
- **Historical Exchange-Rate Snapshots are Immutable:** Imported historical sales retain their original `exchangeRatesSnapshot` recorded at the time of sale.
