# Phase 9.5 — Design System & Layout Architecture (`DESIGN_SYSTEM.md`)

**Date:** 2026-04-12  
**Application:** Dqnamo POS  

---

## 1. Typography System

Defined in `src/index.css` via `@theme`:

| Token / Usage | Font Stack | Sizes & Weights | Rules |
|---|---|---|---|
| `--font-sans` (UI & Arabic/English Copy) | `'Inter'`, `'Cairo'`, `'Tajawal'`, `'Noto Sans Arabic'`, system sans | Page Title: `18px–20px` (`font-black`)<br>Section Header: `14px–16px` (`font-extrabold`)<br>Card Title: `13px–14px` (`font-bold`)<br>Body Copy: `12px–14px` (`font-medium`)<br>Metadata / Caption: `10px–11px` (`font-bold`) | Line-height `1.5` for bilingual Arabic/English legibility; strict `truncate` or `line-clamp-2` on dense card headers. |
| `--font-mono` (Financials, SKUs, Quantities, Timestamps) | `'JetBrains Mono'`, `'Fira Code'`, monospace | KPI Primary Metric: `20px–24px` (`font-black`)<br>Table Cell Numeric: `12px` (`font-bold`) | Enforces `font-variant-numeric: tabular-nums` (`.tabular-nums`) across all currency, percentage, stock, and invoice numbers. |

---

## 2. Semantic Color & Surface Tokens

All components standardize on the `neutral-*` surface scale alongside semantic status tokens:

| Semantic Role | Light Mode Classes | Dark Mode Classes | Usage |
|---|---|---|---|
| **App Canvas** | `bg-neutral-50 text-neutral-900` | `dark:bg-neutral-950 dark:text-neutral-100` | Root viewport background |
| **Primary Card Surface** | `bg-white border-neutral-200/80` | `dark:bg-neutral-900 dark:border-neutral-800` | KPI cards, tables, lifecycle items |
| **Elevated / Muted Surface** | `bg-neutral-50/90 border-neutral-200/60` | `dark:bg-neutral-950/60 dark:border-neutral-800/80` | Filter bars, evidence metrics, audit timeline |
| **Critical / High Risk** | `bg-rose-50 text-rose-700 border-rose-200` | `dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50` | Stockout risk, negative margin, critical severity |
| **Warning / Medium Risk** | `bg-amber-50 text-amber-700 border-amber-200` | `dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50` | Acknowledged lifecycle state, demand spikes, warnings |
| **Success / Resolved** | `bg-emerald-50 text-emerald-700 border-emerald-200` | `dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50` | Resolved lifecycle state, healthy stock, positive growth |
| **Info / Analytical** | `bg-indigo-50 text-indigo-700 border-indigo-200` | `dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/50` | Primary active navigation, replenishment & transfer streams |
| **Dismissed / Archived** | `bg-neutral-100 text-neutral-600 border-neutral-200` | `dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700` | Dismissed lifecycle state, inactive metadata |

---

## 3. Spacing, Container & Grid System

- **Global Max Container Width:** `max-w-[1600px] mx-auto w-full px-3 sm:px-5 lg:px-6` across `AppHeader`, `ReportsView`, `BusinessIntelligenceDashboard`, and `IntelligenceCenterView`.
- **Responsive KPI Card Grids:**
  - `360px – 639px` (Mobile): `grid-cols-1` or `grid-cols-2` for compact summary counters.
  - `640px – 1023px` (Tablet): `sm:grid-cols-2` / `md:grid-cols-3`.
  - `1024px+` (Desktop): `lg:grid-cols-4` / `xl:grid-cols-6`.
- **Bilingual RTL & LTR Rules:**
  - Logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`) are used instead of hardcoded left/right offsets.
  - Header popovers use `fixed sm:absolute inset-x-3 sm:inset-x-auto sm:end-0 max-w-[calc(100vw-1.5rem)]` to prevent off-screen clipping in both Arabic (`dir="rtl"`) and English (`dir="ltr"`).

---

## 4. Standardized Information Architecture (7 Primary Sections)

The Business Intelligence & Operations module is organized into **7 Primary Sections** (`[data-testid="bi-primary-sections-nav"]`):

1. **Business Overview** (`executive`) — Executive KPIs, revenue vs. profit trends, payment mix, and automated insights.
2. **Sales** (`sales`, `products`) — Daily/hourly sales velocity and SKU/category performance.
3. **Inventory & Demand** (`inventory`, `forecasts`) — Stock health, dead stock, shrinkage, unmet customer demand, and 7/14/30-day demand forecasts.
4. **Financial Overview** (`financial`) — Gross-to-net revenue bridge, COGS, operating expenses, AR/AP, and cash collections.
5. **Branch Performance** (`branches`, `cashiers`, `customers`) — Multi-branch health scores, transfer opportunities, cashier audit, and customer retention.
6. **Intelligence Center** (`intelligence_center`) — Persistent lifecycle management (`Active`, `Acknowledged`, `Resolved`, `Dismissed`, `All History`) with full audit trail.
7. **Reports & Signals** (`smart_intelligence`) — Live diagnostic signal generation, replenishment formula cards, and branch transfer recommendations.
