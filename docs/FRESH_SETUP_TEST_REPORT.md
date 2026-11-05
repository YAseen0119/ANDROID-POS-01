# Fresh Setup & Zero Default Data Test Report — Dqnamo POS

## 1. Automated Acceptance Suite
- **Test File:** `src/server/fresh-installation-acceptance.test.ts`
- **Runner:** `npx --yes tsx --test src/server/fresh-installation-acceptance.test.ts`
- **Isolation:** Backs up and restores `.data/*` files around the test run so no test artifacts leak into runtime storage.

---

## 2. 20 Acceptance Scenarios Verified

| # | Scenario | Verification Result |
| :- | :--- | :--- |
| **1** | **Fresh installation state** | `0` production companies (`requiresInitialSetup: true`), `0` default production users. |
| **2** | **First-run company creation** | Creates Company, Initial Main Branch, Owner Account (`COMPANY_OWNER`), and `scrypt` password hash. |
| **3** | **Owner password validation** | Rejects missing or weak passwords (`< 4` chars) with `400 WEAK_OWNER_PASSWORD`. |
| **4** | **Password confirmation mismatch** | Rejects mismatched `ownerPassword` vs `ownerConfirmPassword` with `400 PASSWORD_CONFIRMATION_MISMATCH`. |
| **5** | **Duplicate company creation prevention** | Replaying the same `idempotencyKey` returns `idempotentReplay: true` without creating duplicate companies. |
| **6** | **Empty products after setup** | `dataset.products.length === 0` (`totalStockUnits === 0`). |
| **7** | **Empty customers after setup** | `dataset.customers.length === 0` (`totalOutstandingCreditSdg === 0`). |
| **8** | **Empty sales after setup** | `dataset.transactions.length === 0` (`completedTransactionCount === 0`, `netSalesSdg === 0`). |
| **9** | **Empty inventory after setup** | `dataset.stockMovements.length === 0` (`inventoryValuationAtRetailSdg === 0`). |
| **10** | **Empty reports after setup** | `grossProfitSdg === 0`, `topProductsByRevenue.length === 0`, `salesByCategory.length === 0`. |
| **11** | **Empty analytics after setup** | `replenishmentRecommendations.length === 0`, `deadStockItems.length === 0`. |
| **12** | **Base currency setup** | Configures `SDG` (or 0 currencies when skipped) with zero unconfigured secondary currencies. |
| **13** | **Manual currency addition** | Configures custom currency & exchange rate without fabricating historical revenue. |
| **14** | **First real product creation** | Creates only the requested product with `0` stock and `0` fake movements. |
| **15** | **Opening stock entry** | Deliberate stock adjustment (`restock` / `audit`) accurately updates stock quantity. |
| **16** | **First real sale** | Revenue (`24,000 SDG`) and gross profit (`7,000 SDG`) are calculated strictly from the real invoice. |
| **17** | **Practice Mode isolation** | `comp-demo-practice` holds isolated demo records; resetting Practice Mode leaves production untouched. |
| **18** | **Unauthorized reset rejection** | Rejects wrong company name (`COMPANY_NAME_CONFIRMATION_MISMATCH`) and wrong password (`INVALID_OWNER_CREDENTIALS`). |
| **19** | **Authorized local device reset (Scope A)** | Logs `LOCAL_DEVICE_RESET_AUTHORIZED` audit event and preserves server-side company records. |
| **20** | **Authorized company factory reset (Scope B)** | Wipes only target company, revokes its sessions, preserves unrelated companies and immutable audit logs. |
