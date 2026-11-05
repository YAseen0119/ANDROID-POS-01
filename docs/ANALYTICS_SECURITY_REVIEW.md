# Analytics RBAC & Data Security Audit Review

## 1. Threat Model & Vulnerabilities Addressed (Phase 7)

| Security Finding | Pre-Audit Behavior | Corrected Production Behavior |
| :--- | :--- | :--- |
| **Client Role & Branch Spoofing** | `resolveAnalyticsUserContext` trusted client-supplied `x-user-role` and `x-branch-id` headers/query params directly without verifying against server-side user records. | `resolveAnalyticsUserContext(input, dataset.users)` looks up `userId` in the server-side `dataset.users` directory. When matched, the server's authoritative `role`, `branchId`, and `assignedTerminalName` override any client-supplied headers (`roleVerifiedFromServerStore = true`). |
| **Direct Endpoint Access to `/api/analytics/financial`** | `GET /api/analytics/financial` returned `HTTP 200` for `cashier` and `inventory_clerk` roles with zeroed P&L numbers. | `GET /api/analytics/financial` enforces `!overview.userContext.canViewFinancials` and returns **`HTTP 403 Forbidden`** with `errorCode: 'FORBIDDEN_FINANCIAL_ACCESS'`. |
| **Zero-Masking Ambiguity (`0` vs `null`)** | Unauthorized financial and cost fields (`grossProfit`, `costOfGoodsSold`, `netOperatingProfit`, `byProduct[].cogs`) were replaced with `0`, which looked like a valid $0.00 financial result. | All restricted financial, cost, and margin fields are masked as **`null`** (never `0`), accompanied by explicit metadata flags: `financialAccessStatus: 'restricted_by_role'` and `costAccessStatus: 'restricted_by_role'`. The UI renders `null` values as `"Restricted / N/A"` (`"غير مصرح / غير متاح"`). |

---

## 2. Role-Based Analytical Access Matrix

| Capability / Field Group | `admin` | `manager` | `inventory_clerk` | `cashier` |
| :--- | :--- | :--- | :--- | :--- |
| **Branch Scope** | All Branches (`canViewAllBranches: true`) | All Branches (`canViewAllBranches: true`) | Scoped to `assignedBranchId` | Scoped to `assignedBranchId` & `assignedTerminalName` |
| **`GET /api/analytics/financial`** | `200 OK` (`authorized`) | `200 OK` (`authorized`) | `403 Forbidden` | `403 Forbidden` |
| **P&L (`grossProfit`, `costOfGoodsSold`, `profitAfterRecordedShrinkage`)** | Full values | Full values | `null` (`restricted_by_role`) | `null` (`restricted_by_role`) |
| **Inventory & SKU Costs (`unitCost`, `inventoryValueAtCost`, `cogsInPeriod`)** | Full values | Full values | Full values (`canViewCostAndMargin: true`) | `null` (`restricted_by_role`) |
| **Customer Phone PII (`topCustomers[].phone`)** | Full phone (`canViewCustomerPII: true`) | Full phone (`canViewCustomerPII: true`) | Masked (`******1234`, `piiAccessStatus: 'restricted_by_role'`) | Full phone (`canViewCustomerPII: true`) |
| **Database Write Access** | Read-Only (`SELECT` only) | Read-Only (`SELECT` only) | Read-Only (`SELECT` only) | Read-Only (`SELECT` only) |
