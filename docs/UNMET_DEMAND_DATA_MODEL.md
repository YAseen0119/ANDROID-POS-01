# Phase 10 — Unmet Customer Demand Data Model & Capture Design (Phase B)

**Application:** Dqnamo POS  
**Document Version:** 1.0 (Phase B Deliverable)  
**Migration Execution Status:** **NOT EXECUTED** (Prepared for review and explicit approval)

---

## 1. Existing Schema Evaluation & Justification for Additive Table

### 1.1 Inspection of Existing 22 PostgreSQL Tables (`src/db/schema.ts`)
Before proposing any schema addition, all 22 existing tables in `src/db/schema.ts` were evaluated for safe reuse:
1. **`sales` & `sale_items`:** Record completed or voided commercial invoices. Storing unmet customer inquiries here would corrupt revenue, tax, COGS, and invoice sequence numbers (`TXN-*`). **Cannot be reused.**
2. **`stock_movements`:** Records physical inventory changes (`sale`, `restock`, `damage`, `loss`, `audit`, `transfer`) with mandatory `previousStock` and `newStock` integers and a `NOT NULL` foreign key to `products.id`. Unmet demand does not change physical stock and can occur for unregistered products (`productId = null`). **Cannot be reused.**
3. **`returns` & `return_items`:** Tied to completed `sales.id` via `NOT NULL` foreign key. **Cannot be reused.**
4. **`audit_logs`:** Generic security/compliance log (`action`, `entityType`, `entityId`, `details JSONB`). Lacks structured columns and composite indexes for `productId`, `branchId`, `unavailabilityReason`, `requestedQuantity`, and `requestedTimestamp`, which would force slow full-table JSONB scans during analytics queries. **Not suitable as primary analytical store.**

### 1.2 Additive Storage Decision
We design a single, strictly additive table **`unmet_demand_requests`** (with an identical TypeScript interface `UnmetDemandRequestRecord` persisted in `.data/store-state.json` when operating in local/offline fallback mode).

- **Zero Impact on Existing Tables:** No existing table, column, constraint, or index is modified, renamed, or dropped.
- **Foreign Key Safety:** All foreign keys (`product_id`, `branch_id`, `customer_id`, `recorded_by_user_id`) are **nullable** with `ON DELETE SET NULL`. Deleting or archiving a product, customer, or user will never fail or cascade-delete historical demand intelligence.

---

## 2. Proposed Table Specification: `unmet_demand_requests`

### 2.1 Column Definitions

| Column Name | SQL Type | Nullable | Default | Purpose & Domain Rules |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `text` (PK) | `NOT NULL` | — | Unique request identifier (e.g., `UDR-20261103-849201`). |
| `idempotency_key` | `text` (UNIQUE) | `NOT NULL` | — | Client/server idempotency token preventing network retry duplicates. |
| `dedupe_fingerprint` | `text` | `NOT NULL` | — | Hash of `(branchId, recordedByUserId, productId || barcode || normalizedName, unavailabilityReason, requestedQuantity)` used for 60-second accidental double-tap detection. |
| `product_id` | `text` (FK $\to$ `products.id`) | `NULL` | `NULL` | Populated when the requested item exists in the catalog (even if `stock = 0`). `NULL` for unregistered product requests. |
| `is_registered_product` | `boolean` | `NOT NULL` | `true` | `true` if linked to a catalog product; `false` for unregistered catalog requests. |
| `product_name_snapshot` | `text` | `NOT NULL` | — | Snapshot of product name (or staff-entered descriptive name for unregistered items) at request time. |
| `product_name_ar_snapshot` | `text` | `NULL` | `NULL` | Optional Arabic name snapshot. |
| `sku_snapshot` | `text` | `NULL` | `NULL` | Snapshot of `product.sku` if registered. |
| `barcode` | `text` | `NULL` | `NULL` | Scanned or typed barcode (supports both registered and unregistered items). |
| `category_snapshot` | `text` | `NOT NULL` | `'General'` | Snapshot of product category (`'Unregistered'` or staff-selected category for non-catalog items). |
| `branch_id` | `text` (FK $\to$ `branches.id`) | `NULL` | `NULL` | Server-verified branch ID where the inquiry occurred. |
| `terminal_name` | `text` | `NULL` | `NULL` | Server-verified POS terminal name (e.g., `Main Terminal`, `T1`). |
| `requested_timestamp` | `timestamp` | `NOT NULL` | `now()` | Timestamp when the customer requested the item. |
| `requested_quantity` | `integer` | `NOT NULL` | `1` | Quantity requested by the customer (`CHECK (requested_quantity > 0 AND requested_quantity <= 10000)`). |
| `sale_unit_mode` | `text` | `NOT NULL` | `'unit'` | `'unit'` (piece/strip) or `'pack'` (box/carton). |
| `requested_base_units` | `integer` | `NOT NULL` | `1` | Normalized base units (`requested_quantity * unitsPerPack` when `sale_unit_mode = 'pack'`). |
| `available_stock_at_request` | `integer` | `NULL` | `NULL` | Snapshot of `product.stock` at the moment of the inquiry (`NULL` if unregistered or unknown). |
| `availability_status` | `text` | `NOT NULL` | — | `'OUT_OF_STOCK'` \| `'INSUFFICIENT_QUANTITY'` \| `'EXPIRED'` \| `'UNREGISTERED'` \| `'TEMPORARILY_UNAVAILABLE'`. |
| `unavailability_reason` | `text` | `NOT NULL` | — | Strictly validated enum: `'OUT_OF_STOCK'` \| `'EXPIRED'` \| `'NOT_STOCKED'` \| `'TEMPORARILY_UNAVAILABLE'` \| `'OTHER'`. |
| `confirmed_purchase_intent` | `boolean` | `NOT NULL` | `false` | `true` only if the staff member explicitly records that the customer intended to buy immediately if available (never assumed by default). |
| `fulfillment_status` | `text` | `NOT NULL` | `'unfulfilled'` | `'unfulfilled'` \| `'fulfilled_later'` \| `'cancelled'`. |
| `customer_id` | `text` (FK $\to$ `customers.id`) | `NULL` | `NULL` | Optional link to registered customer (used only for authorized repeat-request analysis). |
| `customer_reference` | `text` | `NULL` | `NULL` | Optional non-PII reference or masked tag; redacted in aggregate endpoints. |
| `unit_selling_price_snapshot` | `numeric(12,2)` | `NULL` | `NULL` | Snapshot of product selling price at request time (`NULL` for unregistered items without known price). |
| `unit_cost_price_snapshot` | `numeric(12,2)` | `NULL` | `NULL` | Snapshot of product cost price at request time (`NULL` if unknown). |
| `currency_snapshot` | `text` | `NOT NULL` | `'SDG'` | Currency code of price snapshot (`SDG` base). |
| `exchange_rate_snapshot` | `numeric(16,6)` | `NOT NULL` | `1.000000` | Exchange rate to `SDG` at request time. |
| `notes` | `text` | `NULL` | `NULL` | Optional staff notes (max 500 chars, sanitized). |
| `recorded_by_user_id` | `text` (FK $\to$ `users.id`) | `NULL` | `NULL` | Server-verified employee ID who logged the request. |
| `recorded_by_name` | `text` | `NOT NULL` | — | Server-verified employee name. |
| `created_at` | `timestamp` | `NOT NULL` | `now()` | Database record creation timestamp. |

### 2.2 Indexes & Constraints
1. `PRIMARY KEY (id)`
2. `UNIQUE INDEX unmet_demand_idempotency_idx ON unmet_demand_requests (idempotency_key)`
3. `INDEX unmet_demand_timestamp_idx ON unmet_demand_requests (requested_timestamp DESC)` — accelerates date-range filtering (`7d`, `30d`, `90d`, `custom`).
4. `INDEX unmet_demand_product_time_idx ON unmet_demand_requests (product_id, requested_timestamp DESC)` — accelerates per-product demand and stockout-overlap queries.
5. `INDEX unmet_demand_branch_time_idx ON unmet_demand_requests (branch_id, requested_timestamp DESC)` — accelerates branch-scoped queries and branch comparisons.
6. `INDEX unmet_demand_reason_idx ON unmet_demand_requests (unavailability_reason)` — accelerates reason breakdown aggregations.
7. `INDEX unmet_demand_dedupe_idx ON unmet_demand_requests (dedupe_fingerprint, requested_timestamp DESC)` — accelerates 60-second duplicate submission checks.
8. `CHECK (requested_quantity > 0 AND requested_quantity <= 10000)`
9. `CHECK (requested_base_units > 0)`

---

## 3. Data Integrity & Analytical Separation Rules

1. **Strict Separation from Actual Sales:**
   - `unmet_demand_requests` is never joined into `sales.summary.grossSales`, `netSales`, `unitsSold`, or `transactionCount`.
   - An inquiry is never counted as a completed sale.
2. **Independent Tracking of Core Measures:**
   - `inquiryCount`: Count of distinct `unmet_demand_requests` records (`COUNT(*)`).
   - `requestedQuantityTotal`: Sum of `requested_quantity` in requested units (`SUM(requested_quantity)`).
   - `requestedBaseUnitsTotal`: Sum of normalized base units (`SUM(requested_base_units)`).
   - `confirmedIntentInquiryCount`: Count of inquiries where `confirmed_purchase_intent = true`.
   - `fulfilledRequestsCount` vs. `unfulfilledRequestsCount`: Partitioned by `fulfillment_status`.
   - `repeatCustomerInquiryCount`: Count of inquiries from customers with `> 1` inquiry for the same product in the period, computed **only** when `customer_id` is present.
3. **Accidental Duplicate Prevention vs. Distinct Inquiries:**
   - If the **same employee** at the **same branch** submits an identical `(productId/barcode/name, unavailabilityReason, requestedQuantity, customerId)` within **60 seconds** without an explicit `allowRapidRepeat: true` flag (or distinct `idempotencyKey` marked as a separate walk-in customer), the validation engine rejects the duplicate submission with error code `DUPLICATE_UNMET_DEMAND_SUBMISSION`.
   - Separate inquiries outside the 60-second accidental double-tap window—or inquiries with different `customerId` values or explicit separate-customer confirmation—are preserved as distinct inquiry records and **never automatically merged**.

---

## 4. Request Capture Workflow Design (Cashier & Product Search)

### 4.1 Entry Points
1. **Checkout Screen (`CheckoutView.tsx`):**
   - **Zero-Stock Product Card Action:** When a product card has `stock === 0` (or when searching returns a zero-stock item), a one-tap **"Record Demand / تسجيل طلب غير متوفر"** button appears directly on the card, pre-filling `productId`, `productName`, `barcode`, `availableStockAtRequest: 0`, and `unavailabilityReason: 'OUT_OF_STOCK'`.
   - **No-Search-Match / Unregistered Barcode Action:** When a cashier searches for a product name or scans a barcode that does not exist in `products`, an inline banner offers **"Record Unregistered Product Request / تسجيل طلب منتج غير مسجل"** pre-filled with the searched text or scanned barcode and `unavailabilityReason: 'NOT_STOCKED'` (without creating a catalog product).
   - **Header Quick Action:** A dedicated quick-capture button in the search bar opens the Request Capture Modal at any time without interrupting an active cart.
2. **Products Management Screen (`ProductsView.tsx`):**
   - Each product row/card includes a quick action to log an unmet demand inquiry (e.g., when a customer asks for a quantity exceeding current stock or reports an expired batch).

### 4.2 Fast Capture Payload & Server Validation
- Staff can submit a registered product request in **2 taps** (1 tap on the zero-stock product's "Record Demand" button + 1 tap on "Save" with defaults `quantity: 1`, `reason: OUT_OF_STOCK`).
- All requests are validated by `validateAndNormalizeUnmetDemandInput()` (`src/analytics/unmet-demand.validation.ts`) before persistence.

---

## 5. Privacy, Retention & Rollback Strategy

- **Privacy & PII Minimization:**
  - `customerId` and `customerReference` are optional.
  - Aggregate endpoints (`/api/intelligence/unmet-demand/*`) never return `customerId`, `customerReference`, or customer phone/name fields.
- **Retention:**
  - Records are retained alongside historical analytics (default 370-day active analytical window in `loadServerAnalyticsDataset`).
- **Rollback Strategy:**
  - Because `unmet_demand_requests` has zero inbound foreign keys from other tables, rolling back the database change requires only executing `drizzle/0001_phase10_unmet_demand_requests.rollback.sql` (`DROP TABLE IF EXISTS "unmet_demand_requests";`). Existing operational tables remain 100% untouched.
