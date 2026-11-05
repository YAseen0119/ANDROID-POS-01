# Business Intelligence & Predictive Analytics Module Architecture

**Application:** Dqnamo POS (`com.dqnamo.pos`)  
**Module Path:** `src/analytics/` & `src/components/analytics/`

---

## 1. Architectural Principles

1. **Strictly Read-Only Operational Boundary:**
   - The BI & Predictive Analytics module never inserts, updates, deletes, or mutates operational transactions, inventory balances, accounting ledgers, or customer records.
   - Reorder recommendations carry `approvalStatus: 'requires_user_approval'` and never auto-generate purchase orders without explicit user action.
2. **100% Accounting & Multi-Currency Reconciliation:**
   - Uses the exact same base currency (`SDG = 1`), multi-unit packaging rules (`unit` vs `pack`), and invoice-level historical exchange-rate snapshots (`exchangeRatesSnapshot` / `exchangeRateUsed`) as `src/lib/pos-calculations.ts`.
3. **Zero Fabricated Data:**
   - Metrics are computed exclusively from actual operational records (`sales`, `sale_items`, `products`, `stock_movements`, `customers`, `users`).
   - Where general overhead expenses (rent, payroll, utilities) are not stored in the current POS database schema, the Financial module sets `generalOperatingExpenses: null` and `generalOperatingExpensesStatus: 'not_recorded_in_schema'` with a transparent explanation in Arabic and English.
4. **Isomorphic Pure Calculation Core:**
   - All analytical calculators (`sales.metrics.ts`, `financial.metrics.ts`, `inventory.metrics.ts`, `customer-branch.metrics.ts`, `technical-analysis.ts`, `forecasting.engine.ts`, `insights.service.ts`) are pure, deterministic TypeScript functions that run identically on the Express backend (`/api/analytics/*`), in the React 19 client (`BusinessIntelligenceDashboard.tsx`), and in automated Node test suites (`analytics.test.ts`).

---

## 2. Module Directory Structure

```text
src/
├── analytics/
│   ├── analytics.types.ts              # Complete domain interfaces & API contracts
│   ├── analytics.permissions.ts        # Server & client RBAC scoping + PII/P&L masking
│   ├── analytics.snapshot.ts           # Browser-safe operational snapshot builder
│   ├── analytics.repository.ts         # Server read-only data loader (PostgreSQL + .data)
│   ├── analytics.service.ts            # Unified orchestrator + Metrics Dictionary
│   ├── analytics.routes.ts             # Express REST router mounted at /api/analytics/*
│   ├── calculations/
│   │   ├── sales.metrics.ts            # Sales, ATV, UPT, Hourly/Weekday, Intraday Candlesticks
│   │   ├── financial.metrics.ts        # P&L, COGS, Cash Flow, AR/AP, Break-Even, FX Sensitivity
│   │   ├── inventory.metrics.ts        # Valuation, Turnover, DOH, ABC Pareto, Reorder Engine
│   │   └── customer-branch.metrics.ts  # Customer RFM/Credit segments & Multi-Branch ranking
│   ├── indicators/
│   │   └── technical-analysis.ts       # SMA(7/30/90), EMA(7/30), RSI(14), MACD(12/26/9), Trendline
│   ├── forecasting/
│   │   └── forecasting.engine.ts       # MA, Seasonal Naive, SES, Holt-Winters + MAE/WAPE Backtest
│   ├── insights/
│   │   └── insights.service.ts         # Deterministic explainable insights & recommendations
│   └── analytics.test.ts               # Automated unit & integration tests (node:test)
└── components/
    └── analytics/
        ├── BusinessIntelligenceDashboard.tsx # 10-tab bilingual RTL/LTR BI workspace
        └── AnalyticsCharts.tsx               # Custom SVG/D3 interactive charts
```

---

## 3. Data Flow & Security Pipeline

```text
[Client UI / API Request]
       │
       ▼
[analytics.permissions.ts]
  ├─ Resolves UserRole ('admin' | 'manager' | 'inventory_clerk' | 'cashier')
  ├─ Enforces branch/terminal isolation on AnalyticsFilterParams
       │
       ▼
[analytics.repository.ts / analytics.snapshot.ts]
  ├─ Loads read-only snapshot from PostgreSQL (Drizzle) / .data/store-state.json
       │
       ▼
[analytics.service.ts -> computeFullAnalyticsOverview()]
  ├─ 1. computeSalesAnalytics()
  ├─ 2. computeFinancialAnalytics()
  ├─ 3. computeInventoryAnalytics()
  ├─ 4. computeCustomerAnalytics() & computeBranchAnalytics()
  ├─ 5. computeTechnicalIndicators()
  ├─ 6. computeForecasts()
  └─ 7. generateExplainableInsights()
       │
       ▼
[Role-Based Field Masking]
  ├─ Masks COGS/Profit for 'cashier'
  ├─ Masks Customer Phone PII if unauthorized
       │
       ▼
[JSON Response / Interactive D3 & SVG Dashboard]
```
