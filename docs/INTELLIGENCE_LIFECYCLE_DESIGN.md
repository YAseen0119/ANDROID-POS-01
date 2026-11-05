# Phase 9.5 — Intelligence Lifecycle Architecture & Design (`INTELLIGENCE_LIFECYCLE_DESIGN.md`)

**Date:** 2026-04-12  
**Module:** `src/analytics/intelligence.lifecycle.ts` & `src/db/schema.ts`

---

## 1. Overview & Objectives

Prior to Phase 9.5, intelligence alerts and recommendations were computed ephemerally on every `/api/analytics/overview` request, and user actions (`Acknowledge`, `Resolve`, `Dismiss`) were stored only in React component state (`alertStatusOverrides`), disappearing on browser refresh.

Phase 9.5 introduces a **Persistent Intelligence Lifecycle Management Engine** backed by both PostgreSQL (`intelligence_lifecycle_items` and `intelligence_lifecycle_events`) and `.data/store-state.json` fallback storage.

---

## 2. Database Schema (Additive Only)

Two additive tables were added to `src/db/schema.ts` and provisioned via `cloudsql.UpdateSchema` without modifying or dropping any existing operational tables:

### 2.1 `intelligence_lifecycle_items`
- `id` (`UUID`, Primary Key)
- `dedupe_key` (`VARCHAR(255)`, Unique) — Deterministic fingerprint per stream, branch, product, and category (`alert:...`, `replenish:...`, `transfer:...`, `insight:...`).
- `source_stream` (`VARCHAR(40)`) — `'smart_alert' | 'replenishment' | 'branch_transfer' | 'bi_insight'`
- `source_item_id` (`VARCHAR(150)`)
- `category` (`VARCHAR(80)`)
- `severity` (`VARCHAR(20)`) — `'critical' | 'warning' | 'info'`
- `status` (`VARCHAR(20)`) — `'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'`
- `scope_type` (`VARCHAR(20)`) — `'GLOBAL' | 'BRANCH'`
- `branch_id` (`UUID`, Nullable FK to `branches.id`), `branch_name` (`VARCHAR(150)`)
- `product_id` (`UUID`, Nullable FK to `products.id`), `product_name` (`VARCHAR(255)`), `sku` (`VARCHAR(100)`)
- `title_ar`, `title_en`, `description_ar`, `description_en`, `recommended_action_ar`, `recommended_action_en`
- `confidence_score` (`INTEGER`), `confidence_level` (`VARCHAR(20)`)
- `financial_impact_estimate` (`NUMERIC(14,2)`), `protected_revenue_estimate` (`NUMERIC(14,2)`)
- `observed_metric` (`VARCHAR(255)`), `baseline_comparison` (`VARCHAR(255)`), `time_window_days` (`INTEGER`)
- `condition_hash` (`VARCHAR(120)`) — Captures condition state (`severity|recommendedQty|shortageUnits|metric`)
- `evidence_json` (`JSONB`) — Full supporting metrics, formula summary, and branch/product metadata
- `acknowledged_by`, `acknowledged_by_name`, `acknowledged_by_role`, `acknowledged_at`
- `resolved_by`, `resolved_by_name`, `resolved_by_role`, `resolved_at`, `resolution_note`, `action_type`
- `dismissed_by`, `dismissed_by_name`, `dismissed_by_role`, `dismissed_at`, `dismiss_reason`
- `reopened_count` (`INTEGER`), `last_reopened_at` (`TIMESTAMPTZ`)
- `first_detected_at`, `last_detected_at`, `created_at`, `updated_at` (`TIMESTAMPTZ`)

### 2.2 `intelligence_lifecycle_events`
- `id` (`UUID`, Primary Key)
- `lifecycle_item_id` (`UUID`, FK to `intelligence_lifecycle_items.id` ON DELETE CASCADE)
- `event_type` (`VARCHAR(40)`) — `'CREATED' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED' | 'REOPENED' | 'AUTO_RECURRED' | 'NOTE_ADDED'`
- `from_status` (`VARCHAR(20)`), `to_status` (`VARCHAR(20)`)
- `actor_user_id`, `actor_name`, `actor_role`
- `note` (`TEXT`), `action_type` (`VARCHAR(80)`), `metadata_json` (`JSONB`)
- `created_at` (`TIMESTAMPTZ`)

---

## 3. Lifecycle State Machine & Non-Reactivation Guarantee

```
                  ┌──────────────────────────────────────────┐
                  │                                          ▼
[NEW SIGNAL] ──► ACTIVE ──► ACKNOWLEDGED ──► RESOLVED ◄──► DISMISSED
                  ▲             │               │            │
                  └─────────────┴───────────────┴────────────┘
                        REOPEN (Admin / Manager Only)
```

### Non-Reactivation & Deduplication Rules
1. **Deterministic Deduplication (`dedupeKey`):** Every generated alert, replenishment recommendation, branch transfer recommendation, and BI insight maps to a deterministic `dedupeKey`.
2. **Routine Analytics Refresh Preservation:** When `reconcileIntelligenceLifecycleState` runs during `/api/analytics/overview` or `/api/intelligence/lifecycle`, any item whose current status is `ACKNOWLEDGED`, `RESOLVED`, or `DISMISSED` **retains its lifecycle status, timestamps, actor attribution, and notes** while refreshing its live `evidence_json` and `lastDetectedAt`.
3. **Controlled Reopen:** Items in `RESOLVED` or `DISMISSED` state only return to `ACTIVE` when an authorized `admin` or `manager` explicitly invokes `REOPEN` (or when `allowAutoRecur: true` is explicitly configured and `conditionHash` indicates a new recurrence).

---

## 4. Role-Based Access Control (RBAC)

All lifecycle operations resolve the user from the server-side user store via `resolveAnalyticsRequestUser` and `resolveAnalyticsPermissions`:
- **Unauthenticated / Unknown User:** Rejected with `HTTP 401 UNAUTHORIZED`.
- **Branch Scoping:** Users with `canViewAllBranches === false` (`restrictedBranchId`) can only view and transition items scoped to their assigned branch (`branchId === restrictedBranchId`, `fromBranchId === restrictedBranchId`, `toBranchId === restrictedBranchId`, or `scopeType === 'GLOBAL'`). Cross-branch transitions return `HTTP 403 FORBIDDEN_BRANCH_SCOPE`.
- **Financial Restriction:** Users with `canViewFinancials === false` (`cashier`, `inventory_clerk`) are filtered out from viewing financial lifecycle items (`category === 'financial' | 'financial_anomaly'`) and receive `HTTP 403 FORBIDDEN_FINANCIAL_SCOPE` if attempting to transition or view history on one.
- **Reopen Role Restriction:** Only `admin`, `owner`, `super_admin`, `manager`, or `branch_manager` can execute `REOPEN`. Cashiers and inventory clerks receive `HTTP 403 FORBIDDEN_REOPEN_ROLE`.
