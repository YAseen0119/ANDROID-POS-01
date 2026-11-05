# Production Seed Audit Report — Dqnamo POS

## 1. Audit Summary
All startup paths, file repositories, analytics pipelines, and frontend context initializers were audited to eliminate every automatic fallback to `INITIAL_PRODUCTS`, `INITIAL_CUSTOMERS`, `INITIAL_TRANSACTIONS`, `INITIAL_STOCK_MOVEMENTS`, `INITIAL_USERS`, `DEFAULT_CURRENCIES_LIST`, and `DEFAULT_EXCHANGE_RATES_MAP` in Production Mode.

---

## 2. Remediated Files & Findings

| File | Previous Behavior | Production-Clean Behavior |
| :--- | :--- | :--- |
| `src/db/products-repo.ts` | `ensureDataFile()` wrote `INITIAL_PRODUCTS` to `.data/products.json` when missing. | Writes `[]` (empty array) and filters out legacy demo IDs (`prod-1`..`prod-10`). |
| `src/analytics/analytics.snapshot.ts` | `buildAnalyticsSnapshotFromState` defaulted omitted arrays to `INITIAL_PRODUCTS`, `INITIAL_TRANSACTIONS`, `INITIAL_CUSTOMERS`, `INITIAL_STOCK_MOVEMENTS`. | Defaults omitted arrays to `[]` and `{ SDG: 1 }`. |
| `src/analytics/analytics.repository.ts` | `loadServerAnalyticsDataset` fell back to `INITIAL_*` when `mergedProducts.length === 0`. | Returns `mergedProducts` (`[]` when empty) and strips demo seed IDs in production. |
| `src/server/release-onboarding.service.ts` | `buildDefaultCompanies()`, `buildDefaultBranches()`, `buildDefaultUsers()` created `comp-default`, `branch-main`, `branch-bahri`, and `user-1`..`user-4`. | Creates **only** the isolated `comp-demo-practice` sandbox; fresh production starts with `0` companies and `0` users. |
| `src/components/settings/ExchangeRateSettings.tsx` | Fell back to `[{ code: 'SDG', ... }]` when `contextCurrencies` was empty. | Shows empty state card (`0` currencies) and supports full manual currency addition, base currency toggle, and `clearAllCurrencies`. |
| `src/components/layout/AppHeader.tsx` | Fell back to `['SDG', 'USD', 'SAR', 'AED', 'EUR', 'GBP']` when `currencies` was empty. | Displays `+ عملة / + Currency` shortcut badge when `0` currencies are configured. |
| `src/components/settings/SettingsView.tsx` | Fell back to `['SDG', 'USD', 'SAR', 'AED', 'EUR', 'GBP']` when `contextCurrencies` was empty. | Shows empty state message when `0` currencies are configured. |
| `src/components/products/ProductsView.tsx` | Pre-filled `2700`, `5400`, `25` in the Add Product modal. | Opens with empty SKU, empty cost/selling price inputs, and `0` stock in Production Mode. |
| `src/components/onboarding/FirstRunOnboardingModal.tsx` | Fell back to `'Admin1234'` when `ownerPassword` was left blank. | Requires explicit `ownerUsername`, `ownerPassword` (>= 4 chars), and matching `ownerConfirmPassword`. |
