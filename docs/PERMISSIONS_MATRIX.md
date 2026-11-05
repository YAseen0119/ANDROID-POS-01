# Granular Role-Based Access Control (RBAC) Matrix

**Application:** Dqnamo POS  
**Catalog Module:** `src/lib/rbac-capabilities.ts`  
**Server Enforcement:** `src/server/release-onboarding.service.ts` (`requireServerCapability`, `assertActorHasCapability`)

---

## 1. System Roles (9 Roles)

| Role Code | Legacy Mapping | Title (EN / AR) | Default Capabilities Count |
|---|---|---|---:|
| `COMPANY_OWNER` | `admin` | Company Owner / مالك الشركة | **46 / 46** (Full Unconditional Access + Last-Owner Protection) |
| `ADMIN` | `admin` | System Administrator / مدير النظام | **46 / 46** |
| `MANAGER` | `manager` | Store / Branch Manager / مدير المتجر / الفرع | **40 / 46** |
| `CASHIER` | `cashier` | POS Cashier / كاشير المبيعات | **11 / 46** |
| `INVENTORY_MANAGER` | `inventory_clerk` | Inventory & Warehouse Manager / مسؤول المخزون والمستودع | **15 / 46** |
| `ACCOUNTANT` | `manager` | Accountant & Finance Officer / المحاسب والمسؤول المالي | **22 / 46** |
| `PURCHASING_MANAGER` | `inventory_clerk` | Purchasing & Suppliers Manager / مسؤول المشتريات والموردين | **16 / 46** |
| `REPORT_VIEWER` | `manager` | Executive Report Viewer / مستعرض التقارير والتحليلات | **14 / 46** (Read-Only Analytics) |
| `CUSTOM_ROLE` | `cashier` | Custom Role / دور مخصص | Configurable per employee (1 to 46 capabilities) |

---

## 2. Granular Capabilities Catalog (46 Capabilities across 11 Functional Groups)

### Group 1: Dashboard (`dashboard`)
- `dashboard.view` — View Executive Dashboard & Live KPIs

### Group 2: Sales & Checkout (`sales`)
- `sales.view` — View Sales & Invoices
- `sales.create` — Create POS Sales & Issue Receipts
- `sales.edit` — Edit Invoices & Fulfillment Status
- `sales.cancel` — Cancel / Void Invoices *(Sensitive)*
- `sales.refund` — Process Merchandise Refunds *(Sensitive)*
- `sales.discount` — Apply Cart & Item Discounts
- `sales.view_cost` — View Unit Cost & Profit Margin *(Sensitive)*

### Group 3: Products & Catalog (`products`)
- `products.view` — View Products & Barcodes
- `products.create` — Create New Products
- `products.edit` — Edit Product Details, Prices & Packaging
- `products.delete` — Delete / Archive Products *(Sensitive)*

### Group 4: Inventory & Stock Movements (`inventory`)
- `inventory.view` — View Stock Balances & Movements
- `inventory.adjust` — Perform Stock Adjustments (Damage / Audit) *(Sensitive)*
- `inventory.receive` — Receive Goods into Stock
- `inventory.transfer` — Create / Execute Inter-Branch Stock Transfers
- `inventory.approve_adjustments` — Approve Stock Adjustments *(Sensitive)*

### Group 5: Purchasing & Suppliers (`purchasing`)
- `purchases.view` — View Purchase Orders & Receipts
- `purchases.create` — Create Purchase Orders
- `purchases.approve` — Approve Purchase Orders *(Sensitive)*
- `purchases.receive` — Receive Supplier Shipments
- `suppliers.manage` — Create & Edit Suppliers

### Group 6: Customers & Receivables (`customers`)
- `customers.view` — View Customer Directory
- `customers.create` — Add New Customers
- `customers.edit` — Edit Customer Profiles
- `customers.view_debts` — View Customer Receivables & Settle Installments

### Group 7: Accounting & Finance (`accounting`)
- `accounting.view` — View Accounting Summary
- `accounting.create_expense` — Record Store Expenses
- `accounting.manage_payables` — Manage Supplier Payables
- `accounting.manage_receivables` — Manage Customer Receivables Ledger
- `accounting.view_financial_reports` — View P&L & Cash Flow Statements *(Sensitive)*

### Group 8: Business Analytics (`analytics`)
- `analytics.view` — View Operational Analytics
- `analytics.financial.view` — View Financial & Margin Analytics *(Sensitive)*
- `analytics.inventory.view` — View Inventory Valuation & ABC/XYZ Analytics
- `analytics.export` — Export Reports & CSV Data

### Group 9: Intelligence & Demand Lifecycle (`intelligence`)
- `intelligence.view` — View Smart Store Insights & Unmet Demand
- `intelligence.acknowledge` — Acknowledge Alerts & Recommendations
- `intelligence.resolve` — Mark Recommendations Resolved
- `intelligence.dismiss` — Dismiss Recommendations with Reason
- `intelligence.reopen` — Reopen Archived Intelligence Items

### Group 10: Users, Roles & RBAC (`users`)
- `users.view` — View Employee Directory & Audit Trail
- `users.create` — Create New Employee Accounts *(Sensitive)*
- `users.edit` — Edit Employee Profiles & Reset Passwords *(Sensitive)*
- `users.deactivate` — Activate / Deactivate Employee Accounts *(Sensitive)*
- `roles.manage` — Assign System Roles *(Sensitive)*
- `permissions.manage` — Customize Granular Capability Matrix *(Sensitive)*

### Group 11: Company, Currencies & Branches (`company`)
- `company.view` — View Company Profile & Branches
- `company.edit` — Edit Company Identity & Tax Settings *(Sensitive)*
- `company.currency.manage` — Manage Currencies & Exchange Rates *(Sensitive)*
- `company.branches.manage` — Create & Manage Company Branches *(Sensitive)*
