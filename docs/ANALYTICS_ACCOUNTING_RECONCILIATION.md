# Analytics Accounting & Financial Reconciliation Specification

## 1. Revenue & Invoice Accounting Identities (Phase 3)

### 1.1 Tax-Exclusive vs Tax-Inclusive Invoice Detection
For every completed invoice (`status === 'completed'`):
- Let $S$ be `view.subtotal`, $D_{\text{inv}}$ be `view.discountAmount`, $T$ be `view.taxAmount`, and $G$ be `view.grandTotal`.
- An invoice is detected as **Tax-Inclusive** (`isTransactionTaxInclusive`) when $T > 0$ and $|G - (S - D_{\text{inv}})| \le 0.05$ while $|G - (S - D_{\text{inv}} + T)| > 0.05$.
- **Ex-Tax Pre-Discount Gross Sales**:
  $$\text{GrossSales}_{\text{tx}} = \begin{cases} \sum (\text{LinePreDiscount}) - T, & \text{if Tax-Inclusive} \\ \sum (\text{LinePreDiscount}), & \text{if Tax-Exclusive} \end{cases}$$
- **Total Discounts**:
  $$\text{DiscountsTotal}_{\text{tx}} = \text{ItemDiscounts}_{\text{tx}} + D_{\text{inv}}$$
- **Ex-Tax Net Sales (Before Returns)**:
  $$\text{NetSalesBeforeReturn}_{\text{tx}} = \max(0, \text{GrossSales}_{\text{tx}} - \text{DiscountsTotal}_{\text{tx}})$$

### 1.2 Voided Invoices vs Merchandise Returns
1. **Voided Invoices (`status === 'voided'`)**:
   - Excluded from `GrossSales`, `NetSales`, `DiscountsTotal`, `TaxCollected`, and `COGS`.
   - Tracked in `voidedCount` and `voidedSalesExcluded`.
2. **Merchandise Returns (`returns` & `return_items`)**:
   - Linked to the original completed invoice via `saleId`.
   - Cumulative gross return refund (`grossReturnBilled`) is capped at the original invoice's `grandTotal` so multiple partial returns can never exceed 100% of the sale.
   - Proportional ex-tax net return (`netReturnAmount`) is deducted from `NetSales`, proportional tax (`taxReturnAmount`) is deducted from `TaxCollected`, and returned units' historical cost (`returnedCogs`) is reversed from `COGS`.

---

## 2. Historical COGS Hierarchy & Quality Classification (Phase 2)

Every sold line item resolves its historical unit/pack cost at `tx.timestamp` using a strict 4-tier hierarchy:
1. **`exact_frozen_at_sale`**: Uses `item.unitCostAtSale` frozen on the sale line item when present.
2. **`reconstructed_from_price_history`**: Reconstructs the exact historical unit cost active at `tx.timestamp` by inspecting chronological `Product.priceHistory[]` records (`previousCostPrice` before the earliest post-sale price change, or `newCostPrice` of the latest pre-sale price change).
3. **`estimated_from_current_catalog_cost`**: Uses current `Product.costPrice` when no historical price change exists, explicitly marking `cogsDataQuality = 'estimated_from_current_catalog_cost'` and `isGrossProfitEstimated = true`.
4. **`incomplete_missing_cost`**: If a product was deleted and has no cost record, records `costInCurrency = 0`, marks `cogsDataQuality = 'incomplete_missing_cost'`, and tracks the revenue in `unresolvableCostRevenuePortion`. **Never** fabricates `0.45 * item.total`.

---

## 3. Profit & Loss, Cash Flow, and Break-Even Identities (Phase 4)

- **Gross Profit**:
  $$\text{GrossProfit} = \text{NetSalesRevenue} - \text{COGS}$$
- **Profit After Recorded Shrinkage**:
  $$\text{ProfitAfterRecordedShrinkage} = \text{GrossProfit} - \text{RecordedShrinkageAndDamageExpense}$$
- **Net Operating Profit**:
  - Because general overhead expenses (rent, payroll, utilities) are not stored in the current PostgreSQL schema, `netOperatingProfit` is `null` (`operatingProfitStatus = 'unavailable_missing_operating_expenses'`) by default.
  - When `fixedOperatingExpensesOverride` is provided, $\text{NetOperatingProfit} = \text{ProfitAfterRecordedShrinkage} - \text{FixedOperatingExpenses}$.
- **Break-Even Sales Revenue**:
  $$\text{ContributionMarginRatio} = \frac{\text{NetSalesRevenue} - \text{VariableCOGS}}{\text{NetSalesRevenue}}$$
  $$\text{BreakEvenSalesRevenue} = \begin{cases} \dfrac{\text{FixedOperatingCosts}}{\text{ContributionMarginRatio}}, & \text{if FixedOperatingCosts provided} \\ \text{null (\texttt{unavailable\_missing\_fixed\_costs})}, & \text{otherwise} \end{cases}$$
- **Inventory Turnover & Working Capital (Phase 5)**:
  - Reconstructed Beginning Stock: $\text{BeginningStock} = \max(0, \text{CurrentStock} + \text{NetUnitsSold} - \text{RestockedUnits} + \text{ShrinkageUnits} - \text{AuditDelta})$.
  - Average Inventory Value at Cost: $\text{AvgInventoryAtCost} = \frac{\text{BeginningStock} + \text{CurrentStock}}{2} \times \text{UnitCost}$.
  - Standard Cost-Based Turnover: $\text{CostBasedStockTurnoverRatio} = \frac{\text{COGS}}{\text{AvgInventoryAtCost}}$.
  - Unit Sell-Through Proxy: $\text{EstimatedUnitSellThroughRatio} = \frac{\text{NetUnitsSold}}{\text{AvgStockUnits}}$.
