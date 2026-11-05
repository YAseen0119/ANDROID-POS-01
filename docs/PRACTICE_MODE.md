# Practice Mode (Isolated Training Sandbox)

**Application:** Dqnamo POS  
**Sandbox Tenant ID:** `comp-demo-practice`  
**Workspace Mode:** `PRACTICE`

---

## 1. Purpose

Practice Mode allows store owners, cashiers, inventory clerks, and managers to explore every feature of Dqnamo POS — including barcode scanning, multi-currency checkout, pack/strip sales, customer debt settlement, goods receipts, unmet demand logging, and intelligence recommendations — without affecting real production data.

---

## 2. Strict Data Isolation Architecture

| Layer | Production Mode (`PRODUCTION`) | Practice Mode (`PRACTICE`) |
|---|---|---|
| **Company ID** | `comp-default` (or created `comp-*` ID) | `comp-demo-practice` |
| **Client LocalStorage Prefix** | `dqnamo_pos_*_<companyId>` | `dqnamo_pos_practice_*` |
| **Server State File** | `.data/store-state.json` | `.data/practice-store-state.json` |
| **PostgreSQL Product Mutations** | Writes to `products` table (`company_id = 'comp-default'`) | Routed by `isPracticeModeRequest(req)` in `server.ts` exclusively to `.data/practice-store-state.json` |
| **Demo Reset Allowed?** | **NO** (`403 FORBIDDEN_PRODUCTION_RESET`) | **YES** (`POST /api/onboarding/practice/reset`) |

---

## 3. Preloaded Synthetic Demo Dataset

When Practice Mode is initialized or reset via `buildFreshPracticeSandboxState()`, it is populated with realistic, clearly labeled synthetic data:
- **Products**: Multi-category retail items (groceries, beverages, household essentials, unit + pack/carton items) with barcodes and SDG/USD pricing.
- **Demo Users**: Pre-configured practice accounts for Owner, Manager, Cashier, and Inventory Clerk roles.
- **Sample Transactions & Stock Movements**: Realistic completed sales, partial debt invoices, and restock movements.
- **Unmet Demand Requests**: Sample customer product requests to demonstrate the Phase 10 Intelligence & Replenishment engine.

---

## 4. Persistent Visual Indicator & Controls

Whenever `workspaceMode === 'PRACTICE'`, `PracticeModeBanner.tsx` (`[data-testid="practice-mode-banner"]`) is pinned at the top of the viewport in both Arabic RTL and English LTR:
- **Status Badge**: *"PRACTICE MODE — Training Data Only (No Real Operations Saved)"* / *"وضع التدريب التجريبي — جميع العمليات للتجربة فقط ولا تؤثر على بيانات الشركة الحقيقية"*.
- **Reset Demo Data** (`[data-testid="practice-reset-data-btn"]`): Restores the Practice Mode sandbox to its clean initial state in one click while leaving all production companies untouched.
- **Create Real Company** (`[data-testid="practice-create-company-btn"]`): Opens the production Company Creation Wizard.
- **Exit Practice Mode** (`[data-testid="practice-exit-btn"]`): Immediately returns to the active production workspace.
