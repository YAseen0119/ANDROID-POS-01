# Analytics Security Retest Report (`SEC-01` & `SEC-02`)

**Date:** 2026-11-03  
**Target Files:** `src/analytics/analytics.routes.ts`, `src/analytics/analytics.permissions.ts`  
**Status:** **PASS — 100% REMEDIATED**

---

## 1. Security Vulnerabilities Remediated

### 1.1 `SEC-01` — Removal of Default Admin Role & Client Header Role Inference
- **Previous Defect:** `parseUserContextFromReq` in `src/analytics/analytics.routes.ts` defaulted missing `x-user-id` headers to `'usr-admin-1'` and missing `x-user-role` headers to `'admin'`.
- **Fix Implemented:**
  - `parseUserContextFromReq(req)` now extracts **only** `userId` (`req.headers['x-user-id']`, `req.query.userId`, or `req.body?.userId`) and never reads `x-user-role`, `query.userRole`, `query.role`, `x-branch-id`, or `x-terminal-name`.
  - When `userId` is missing, `computeFromRequest(req)` immediately throws `AnalyticsAuthError(401, 'UNAUTHENTICATED_MISSING_USER', ...)` across all 10 analytics endpoints.
  - When `POST /api/analytics/overview` receives a client `snapshot` in `req.body`, `dataset.users` is forcibly overwritten with `serverDataset.users` so a client can never inject fake administrator accounts in the request body.

### 1.2 `SEC-02` — Rejection of Unknown User IDs & Server-Store Role Verification
- **Previous Defect:** In `resolveAnalyticsUserContext` (`src/analytics/analytics.permissions.ts`), when `input.userId` did not match any record in `knownUsers`, execution fell into the `else` branch and trusted `input.role` (`'admin'`).
- **Fix Implemented:**
  - `resolveAnalyticsUserContext` now looks up `input.userId` strictly in `knownUsers`.
  - If `!matchedServerUser` (missing or unknown `userId`), it returns:
    - `roleVerifiedFromServerStore: false`
    - `role: 'cashier'`
    - `canViewFinancials: false`
    - `canViewCostAndMargin: false`
    - `canViewAllBranches: false`
    - `canViewCustomerPII: false`
    - `canExportAnalytics: false`
    - `branchRestrictionEnforced: true`
  - On HTTP routes (`src/analytics/analytics.routes.ts`), any unknown `userId` not present in `serverDataset.users` is rejected immediately with **HTTP `401`** (`UNAUTHORIZED_UNKNOWN_USER`).

---

## 2. Live HTTP & Unit Retest Matrix

| Test ID | Scenario | Request / Input | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-RT-01** | Missing `userId` on `/api/analytics/financial` | `GET /api/analytics/financial` (no headers) | HTTP `401` (`UNAUTHENTICATED_MISSING_USER`) | HTTP `401` | **PASS** |
| **SEC-RT-02** | Missing `userId` + spoofed `x-user-role: admin` | `GET /api/analytics/overview` with `x-user-role: admin` | HTTP `401` (`UNAUTHENTICATED_MISSING_USER`) | HTTP `401` | **PASS** |
| **SEC-RT-03** | Unknown `userId` (`nonexistent-id-999`) + spoofed `x-user-role: admin` | `GET /api/analytics/financial` with `x-user-id: nonexistent-id-999`, `x-user-role: admin` | HTTP `401` (`UNAUTHORIZED_UNKNOWN_USER`) | HTTP `401` | **PASS** |
| **SEC-RT-04** | Known `cashier` (`user-3`) spoofing `x-user-role: admin` on `/financial` | `GET /api/analytics/financial` with `x-user-id: user-3`, `x-user-role: admin` | HTTP `403` (`FORBIDDEN_FINANCIAL_ACCESS`), role resolved to `'cashier'` | HTTP `403` | **PASS** |
| **SEC-RT-05** | Known `inventory_clerk` (`user-4`) spoofing `x-user-role: admin` on `/financial` | `GET /api/analytics/financial` with `x-user-id: user-4`, `x-user-role: admin` | HTTP `403` (`FORBIDDEN_FINANCIAL_ACCESS`), role resolved to `'inventory_clerk'` | HTTP `403` | **PASS** |
| **SEC-RT-06** | Known `cashier` (`user-3`) requesting `branchId=all` on `/overview` | `GET /api/analytics/overview?branchId=all` with `x-user-id: user-3`, `x-user-role: admin` | HTTP `200`, `role: 'cashier'`, `branchId: 'branch-main'`, `cashierName: 'POS Terminal 03 (Express)'`, `grossProfit: null`, `cogs: null` | HTTP `200` (All fields masked `null`, never `0`) | **PASS** |
| **SEC-RT-07** | Known `inventory_clerk` (`user-4`) on `/customers` | `GET /api/analytics/customers` with `x-user-id: user-4` | HTTP `200`, `piiAccessStatus: 'restricted_by_role'`, customer phone numbers masked (`*******1234`) | HTTP `200` (Phones masked) | **PASS** |
| **SEC-RT-08** | Known `admin` (`user-1`) on `/financial` | `GET /api/analytics/financial` with `x-user-id: user-1` | HTTP `200`, `roleVerifiedFromServerStore: true`, full P&L and Cash Flow authorized | HTTP `200` | **PASS** |
