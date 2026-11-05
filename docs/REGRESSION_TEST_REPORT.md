# Phase 9.5 — Full Regression & Lifecycle Verification Report (`REGRESSION_TEST_REPORT.md`)

**Date:** 2026-04-12  
**Test Runner:** Node.js `node:test` via `tsx` + Headless Chromium via `playwright-cli`  

---

## 1. Automated Test Suite Summary

Command executed:
```bash
npx tsx --test \
  src/analytics/phase95-lifecycle.test.ts \
  src/analytics/phase10-intelligence.test.ts \
  src/analytics/unmet-demand.validation.test.ts \
  src/analytics/analytics.test.ts \
  src/analytics/acceptance-audit.test.ts
```

| Test Suite | Tests | Passed | Failed | Skipped | Status |
|---|---:|---:|---:|---:|---|
| `src/analytics/phase95-lifecycle.test.ts` (Phase 9.5 Lifecycle, RBAC, Non-Reactivation, HTTP API) | 4 | 4 | 0 | 0 | **PASS** |
| `src/analytics/phase10-intelligence.test.ts` (Phase 10 Unmet Demand, Latent Forecasting, Replenishment, Transfers, RBAC) | 5 | 5 | 0 | 0 | **PASS** |
| `src/analytics/unmet-demand.validation.test.ts` (Unmet Demand Validation, Deduplication, PII Redaction) | 5 | 5 | 0 | 0 | **PASS** |
| `src/analytics/analytics.test.ts` (Core BI Deduplication, 4-Tier COGS, Returns, P&L, Inventory, Forecasting, RBAC, Technicals) | 8 | 8 | 0 | 0 | **PASS** |
| `src/analytics/acceptance-audit.test.ts` (Production Acceptance Audit + 10k-Tx × 1k-SKU Performance Benchmark) | 6 | 6 | 0 | 0 | **PASS** |
| **TOTAL** | **28** | **28** | **0** | **0** | **100% PASS** |

---

## 2. Phase 9.5 Specific Verification Checks

1. **Candidate Extraction & Deduplication (`Phase 9.5 — Test 1`):**
   - Verified deterministic `dedupeKey` generation across `smart_alert`, `replenishment`, `branch_transfer`, and `bi_insight` streams and automatic creation of `ACTIVE` items with initial `CREATED` audit events.
2. **State Transitions & Non-Reactivation Guarantee (`Phase 9.5 — Test 2`):**
   - Verified `ACTIVE` $\to$ `ACKNOWLEDGED` $\to$ `RESOLVED` (with `resolutionNote` and `actionType`) and `ACTIVE` $\to$ `DISMISSED` (with `dismissReason`) $\to$ `ACTIVE` (`REOPEN`).
   - Verified that running `reconcileIntelligenceLifecycleState` during subsequent analytics refreshes **does not** reset `ACKNOWLEDGED`, `RESOLVED`, or `DISMISSED` items back to `ACTIVE`.
3. **RBAC & Security Enforcement (`Phase 9.5 — Test 3`):**
   - Verified that unauthenticated requests return `HTTP 401`.
   - Verified that `cashier` and `inventory_clerk` roles are blocked (`HTTP 403 FORBIDDEN_LIFECYCLE_ITEM_ACCESS`) from viewing or modifying financial intelligence items (`FINANCIAL_RISK`, `profit_margin`, `cash_and_debt`).
   - Verified that branch-restricted users cannot view or transition items belonging to another branch.
   - Verified that `cashier` and `inventory_clerk` roles are blocked (`HTTP 403 FORBIDDEN_REOPEN_ROLE`) from reopening resolved or dismissed items, while `admin` and `manager` succeed.
4. **End-to-End HTTP API & Browser Reload Persistence (`Phase 9.5 — Test 4` & Playwright CLI):**
   - Verified `/api/intelligence/lifecycle`, `/acknowledge`, `/resolve`, `/dismiss`, `/reopen`, and `/history` end-to-end.
   - Verified in headless Chromium (`playwright-cli`) that acknowledging an item in the **Intelligence Center**, reloading the browser (`page.reload()`), and navigating back to **Intelligence Center $\to$ Acknowledged** preserves the transition across reloads.
   - Verified `scrollWidth === innerWidth` (`overflow: false`) across all 6 viewports (`360px`, `390px`, `768px`, `1024px`, `1366px`, `1920px`) in both English LTR and Arabic RTL with `0` console or page errors.
