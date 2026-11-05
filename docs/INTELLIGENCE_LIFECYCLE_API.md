# Phase 9.5 — Intelligence Lifecycle REST API Specification (`INTELLIGENCE_LIFECYCLE_API.md`)

**Date:** 2026-04-12  
**Base Paths:** Mounted on both `/api/intelligence` and `/api/analytics`

---

## 1. Authentication & Authorization Headers

All endpoints require an authenticated user ID resolved against the server-side user store:
- Header: `x-user-id: <valid_user_id>` (or `Authorization: Bearer <token>`)
- Client-supplied `x-user-role` or `role` query parameters are **never trusted**.
- Missing or unknown user IDs return `401 Unauthorized`.

---

## 2. Endpoints

### 2.1 List & Filter Lifecycle Items
- **Method & Path:** `GET /api/intelligence/lifecycle` (or `POST /api/intelligence/lifecycle/query`)
- **Query / Body Parameters:**
  - `status`: `'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED' | 'ALL_HISTORY'` (default `'ACTIVE'`)
  - `sourceStream`: `'all' | 'smart_alert' | 'replenishment' | 'branch_transfer' | 'bi_insight'`
  - `category`: `'all' | string`
  - `severity`: `'all' | 'critical' | 'warning' | 'info'`
  - `branchId`: `'all' | string`
  - `search`: `string` (matches Arabic/English title, description, SKU, product name, branch name, notes, actor names)
  - `startDate`, `endDate`: `YYYY-MM-DD`
  - `sortBy`: `'severity' | 'financial_impact' | 'confidence' | 'updated_at' | 'detected_at'`
  - `sortDir`: `'asc' | 'desc'`
  - `page`: `number` (1-indexed, default `1`)
  - `pageSize`: `number` (default `25`, max `100`)
- **Response (`200 OK`):**
```json
{
  "items": [
    {
      "id": "8e3b0f12-...",
      "dedupeKey": "alert:inventory_risk:br-main:prod-1",
      "sourceStream": "smart_alert",
      "category": "inventory_risk",
      "severity": "critical",
      "status": "ACTIVE",
      "scopeType": "BRANCH",
      "branchId": "br-main",
      "branchName": "Main Branch",
      "productId": "prod-1",
      "productName": "Full Cream Milk 1L",
      "sku": "MILK-001",
      "titleAr": "خطر نفاد مخزون وشيك: حليب كامل الدسم 1 لتر",
      "titleEn": "Imminent Stockout Risk: Full Cream Milk 1L",
      "confidenceScore": 92,
      "confidenceLevel": "high",
      "financialImpactEstimate": 1450,
      "protectedRevenueEstimate": 1450,
      "firstDetectedAt": "2026-04-12T10:00:00.000Z",
      "lastDetectedAt": "2026-04-12T10:00:00.000Z",
      "updatedAt": "2026-04-12T10:00:00.000Z"
    }
  ],
  "counts": {
    "active": 12,
    "acknowledged": 2,
    "resolved": 4,
    "dismissed": 1,
    "allHistory": 19,
    "criticalActive": 3,
    "warningActive": 6,
    "infoActive": 3,
    "totalProtectedRevenueActive": 18450
  },
  "totalFiltered": 12,
  "page": 1,
  "pageSize": 25
}
```

---

### 2.2 Get Item Detail & Chronological Audit History
- **Method & Path:** `GET /api/intelligence/lifecycle/:id/history`
- **Response (`200 OK`):**
```json
{
  "item": { "...full IntelligenceLifecycleItemRecord..." },
  "events": [
    {
      "id": "ev-3",
      "lifecycleItemId": "8e3b0f12-...",
      "eventType": "RESOLVED",
      "fromStatus": "ACKNOWLEDGED",
      "toStatus": "RESOLVED",
      "actorUserId": "u-admin",
      "actorName": "مدير النظام",
      "actorRole": "admin",
      "note": "Created Purchase Order PO-2026-089 for 75 units",
      "actionType": "PO_CREATED",
      "createdAt": "2026-04-12T10:15:00.000Z"
    },
    {
      "id": "ev-2",
      "lifecycleItemId": "8e3b0f12-...",
      "eventType": "ACKNOWLEDGED",
      "fromStatus": "ACTIVE",
      "toStatus": "ACKNOWLEDGED",
      "actorUserId": "u-admin",
      "actorName": "مدير النظام",
      "actorRole": "admin",
      "note": "Checking warehouse inventory count",
      "createdAt": "2026-04-12T10:05:00.000Z"
    },
    {
      "id": "ev-1",
      "lifecycleItemId": "8e3b0f12-...",
      "eventType": "CREATED",
      "fromStatus": null,
      "toStatus": "ACTIVE",
      "actorUserId": null,
      "actorName": "System Intelligence Engine",
      "actorRole": "system",
      "note": "Initial detection (smart_alert)",
      "createdAt": "2026-04-12T10:00:00.000Z"
    }
  ]
}
```

---

### 2.3 Acknowledge Item
- **Method & Path:** `POST /api/intelligence/lifecycle/:id/acknowledge`
- **Request Body:** `{ "note"?: string }`
- **Behavior:** Transitions item to `ACKNOWLEDGED`, records `acknowledgedBy`, `acknowledgedByName`, `acknowledgedByRole`, `acknowledgedAt`, and appends an `ACKNOWLEDGED` audit event.

### 2.4 Resolve Item
- **Method & Path:** `POST /api/intelligence/lifecycle/:id/resolve`
- **Request Body:** `{ "resolutionNote": string, "actionType"?: string, "note"?: string }`
- **Behavior:** Validates non-empty `resolutionNote`, transitions item to `RESOLVED`, records `resolvedBy`, `resolvedAt`, `resolutionNote`, `actionType`, and appends a `RESOLVED` audit event.

### 2.5 Dismiss Item
- **Method & Path:** `POST /api/intelligence/lifecycle/:id/dismiss`
- **Request Body:** `{ "dismissReason": string, "note"?: string }`
- **Behavior:** Validates non-empty `dismissReason`, transitions item to `DISMISSED`, records `dismissedBy`, `dismissedAt`, `dismissReason`, and appends a `DISMISSED` audit event.

### 2.6 Reopen Item
- **Method & Path:** `POST /api/intelligence/lifecycle/:id/reopen`
- **Request Body:** `{ "note"?: string }`
- **Authorization:** Restricted to `admin` and `manager` roles (`403 FORBIDDEN_REOPEN_ROLE` for cashiers/clerks).
- **Behavior:** Transitions item from `ACKNOWLEDGED`, `RESOLVED`, or `DISMISSED` back to `ACTIVE`, increments `reopenedCount`, updates `lastReopenedAt`, and appends a `REOPENED` audit event.
