# Zero Default Data Policy — Dqnamo POS

## 1. Policy Statement
In **Production Mode** (`workspaceMode === 'PRODUCTION'`), Dqnamo POS strictly enforces a **Zero Default Business Data Policy**. The system operates exclusively on records explicitly created by the authenticated Company Owner or authorized employees.

---

## 2. Prohibited Auto-Generated Records in Production
On fresh installation, company creation, or after an authorized reset, the system **never** automatically generates or falls back to:
1. Products (`INITIAL_PRODUCTS` / `prod-1`..`prod-10` are strictly blocked from production).
2. Product categories or sample barcodes.
3. Customers (`INITIAL_CUSTOMERS` / `cust-1`..`cust-3` are strictly blocked from production).
4. Suppliers.
5. Employee accounts (`INITIAL_USERS` / `user-1`..`user-4` are strictly blocked from production), except the Initial Company Owner created during onboarding.
6. Sales or purchase transactions (`INITIAL_TRANSACTIONS` / `TXN-1001`..`TXN-1002` are strictly blocked from production).
7. Inventory quantities or fake opening stock movements (`INITIAL_STOCK_MOVEMENTS`).
8. Expenses, accounting transactions, or financial balances.
9. Unconfigured currencies or fictional historical exchange rates (`INITIAL_EXCHANGE_RATE_HISTORY`).
10. Branches (`branch-main`, `branch-bahri`), except the Initial Main Branch explicitly created for the company.
11. Notifications, intelligence alerts, demand forecasts, or historical reports based on fictional business activity.

---

## 3. Code-Level Enforcement Layers
- **File Repository (`src/db/products-repo.ts`):** Initializes `.data/products.json` as `[]` (empty array) and strips legacy demo IDs (`prod-1`..`prod-10`).
- **Analytics Engine (`src/analytics/analytics.snapshot.ts` & `src/analytics/analytics.repository.ts`):** Defaults omitted datasets to `[]` and never falls back to `INITIAL_PRODUCTS`, `INITIAL_TRANSACTIONS`, `INITIAL_CUSTOMERS`, or `INITIAL_STOCK_MOVEMENTS`.
- **Platform Onboarding Service (`src/server/release-onboarding.service.ts`):** `buildDefaultCompanies()`, `buildDefaultBranches()`, and `buildDefaultUsers()` only initialize the isolated `comp-demo-practice` sandbox. Production starts with `0` companies and `0` users.
- **Frontend State (`src/context/POSContext.tsx`):** `ensureCleanProductionMigration()` and `loadCompanyOperationalState()` strip any legacy demo seeds and initialize all production arrays to `[]`.
- **Product Creation Modal (`src/components/products/ProductsView.tsx`):** In Production Mode, new product forms open with empty SKU, empty cost/selling price inputs, and `0` opening stock (no pre-filled `2700`, `5400`, or `25`).
