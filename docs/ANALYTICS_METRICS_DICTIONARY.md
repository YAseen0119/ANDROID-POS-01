# Business Intelligence Metrics Dictionary

**Application:** Dqnamo POS (`com.dqnamo.pos`)  
**Base Currency:** `SDG` (`SDG = 1`, historical sale-time exchange rate locked per invoice)

---

## 1. Sales Analytics Metrics

| Metric Key | English Name | Arabic Name | Exact Mathematical Formula | Source Tables |
| :--- | :--- | :--- | :--- | :--- |
| `grossSales` | Gross Sales (Pre-Discount) | إجمالي المبيعات (قبل الخصم) | $\sum (\text{UnitPrice} \times \text{Quantity})$ for completed transactions | `sales`, `sale_items` |
| `discountsTotal` | Total Discounts Given | إجمالي الخصومات الممنوحة | $\sum \text{LineItemDiscounts} + \sum \text{GlobalInvoiceDiscounts}$ | `sales`, `sale_items` |
| `netSales` | Net Sales Revenue | صافي المبيعات | $\text{GrossSales} - \text{DiscountsTotal}$ (excludes tax and voided/returned invoices) | `sales`, `sale_items`, `returns` |
| `taxCollected` | Tax Collected | الضريبة المحصلة | $\sum \text{TaxAmount}$ on completed invoices | `sales` |
| `billedGrandTotal` | Billed Grand Total | إجمالي الفواتير شاملة الضريبة | $\text{NetSales} + \text{TaxCollected}$ | `sales` |
| `returnedOrVoidedSales` | Returns & Voided Sales | المرتجعات والفواتير الملغاة | $\sum \text{GrandTotal}$ where `status = 'voided'` or in `returns` | `sales`, `returns` |
| `averageTransactionValue` | Average Transaction Value (ATV) | متوسط صافي قيمة الفاتورة (ATV) | $\frac{\text{NetSales}}{\text{CompletedTransactionCount}}$ | `sales` |
| `unitsPerTransaction` | Units Per Transaction (UPT) | متوسط الوحدات لكل فاتورة (UPT) | $\frac{\sum \text{UnitsSold}}{\text{CompletedTransactionCount}}$ | `sales`, `sale_items` |
| `periodOverPeriodGrowthPercent` | Period-over-Period Growth % | نسبة النمو مقارنة بالفترة السابقة | $\frac{\text{NetSales}_{\text{current}} - \text{NetSales}_{\text{prev}}}{\text{NetSales}_{\text{prev}}} \times 100$ | `sales` |

---

## 2. Intraday Hourly Candlestick (OHLC) Metrics

To prevent misleading stock-price semantics on retail data, daily candlesticks represent **Intraday Hourly Sales Distribution**:
- **Open ($O$):** Net sales recorded in the **first active hour** of the day.
- **High ($H$):** **Highest hourly net sales** (peak hour) of the day.
- **Low ($L$):** **Lowest active hourly net sales** of the day.
- **Close ($C$):** Net sales recorded in the **last active hour** of the day.
- **Daily Volume Bar:** Total daily net sales ($\sum_{h=0}^{23} \text{NetSales}_h$).

---

## 3. Financial & Accounting Metrics

| Metric Key | English Name | Arabic Name | Exact Mathematical Formula | Source Tables |
| :--- | :--- | :--- | :--- | :--- |
| `costOfGoodsSold` | Cost of Goods Sold (COGS) | تكلفة البضاعة المباعة (COGS) | $\sum (\text{UnitOrPackCost} \times \text{SoldQty})$ converted at invoice's historical exchange rate | `sale_items`, `products` |
| `grossProfit` | Gross Profit | مجمل الربح | $\text{NetSalesRevenue} - \text{COGS}$ | `sales`, `sale_items`, `products` |
| `grossProfitMarginPercent` | Gross Profit Margin % | نسبة هامش مجمل الربح % | $\frac{\text{GrossProfit}}{\text{NetSalesRevenue}} \times 100$ | `sales`, `products` |
| `recordedShrinkageAndDamageExpense` | Recorded Shrinkage & Damage | مصروف التلف والفاقد المسجل | $\sum (|\Delta \text{Qty}| \times \text{UnitCost})$ where `type IN ('damage', 'loss')` | `stock_movements`, `products` |
| `netOperatingProfit` | Net Operating Profit | صافي الربح التشغيلي | $\text{GrossProfit} - \text{RecordedShrinkageAndDamageExpense}$ (General overhead flagged as `not_recorded_in_schema`) | `sales`, `stock_movements` |
| `totalCashInflows` | Total Cash Inflows | إجمالي التدفقات النقدية الداخلة | $\text{UpfrontCheckoutCashPaid} + \sum \text{DebtSettlementInstallments}$ | `sales`, `payments` |
| `accountsReceivableOutstandingDebt` | Accounts Receivable (AR) | الذمم المدينة (ديون العملاء) | $\sum \text{RemainingDebtAmount}$ on completed invoices | `sales`, `customers` |
| `breakEvenSalesRevenue` | Break-Even Sales Revenue | إيرادات نقطة التعادل | $\frac{\text{RecordedCostsToCover}}{\text{GrossProfitMarginRatio}}$ | `sales`, `stock_movements` |

---

## 4. Inventory, ABC & Reorder Metrics

| Metric Key | English Name | Arabic Name | Exact Mathematical Formula | Source Tables |
| :--- | :--- | :--- | :--- | :--- |
| `inventoryValueAtCost` | Inventory Valuation at Cost | قيمة المخزون بالتكلفة | $\sum (\text{CurrentStock} \times \text{UnitCost})$ | `products`, `inventory` |
| `averageDailyDemand` | Average Daily Demand | متوسط السحب اليومي | $\frac{\text{BaseUnitsSoldInPeriod}}{\text{EffectiveActiveSpanDays}}$ | `sale_items`, `products` |
| `stockTurnoverRatio` | Stock Turnover Ratio | معدل دوران المخزون | $\frac{\text{UnitsSoldInPeriod}}{\text{CurrentStock} + 0.5 \times \text{UnitsSoldInPeriod}}$ | `products`, `sale_items` |
| `daysOfInventoryOnHand` | Days of Inventory on Hand (DOH) | أيام كفاية المخزون (DOH) | $\frac{\text{CurrentStock}}{\text{AverageDailyDemand}}$ (`null` if demand = 0) | `products`, `sale_items` |
| `reorderPointUnits` | Reorder Point (ROP) | نقطة إعادة الطلب | $\lceil \text{AvgDailyDemand} \times \text{LeadTimeDays} \rceil + \max(\text{MinAlert}, \lceil \text{AvgDailyDemand} \times \text{SafetyDays} \rceil)$ | `products`, `sale_items` |
| `abcClass` | ABC Pareto Class | تصنيف باريتو (A / B / C) | Ranked by selected basis (`revenue`, `gross_profit`, or `consumption_value`): **A** $\le 75\%$, **B** $75\text{–}92\%$, **C** $>92\%$ | `products`, `sale_items` |
