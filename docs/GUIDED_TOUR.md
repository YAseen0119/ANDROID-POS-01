# Interactive Guided Product Tour & Onboarding Checklist

**Application:** Dqnamo POS  
**Engine:** `src/lib/training-tour.ts`  
**UI Components:** `src/components/tour/TrainingTourOverlay.tsx` & `src/components/settings/TrainingCenterSection.tsx`

---

## 1. Interactive 13-Module Guided Product Tour

The Guided Product Tour walks users step-by-step across all **13 required operational modules** in both **Arabic (RTL)** and **English (LTR)**:

| Step # | Step ID | Category Key | Target Tab | Module Title (EN / AR) | Required Capability |
|:---:|---|---|---|---|---|
| 1 | `step-dashboard-overview` | `dashboard_overview` | `dashboard` | Dashboard & Business Overview / لوحة التحكم والنظرة العامة للأعمال | `dashboard.view` |
| 2 | `step-products-catalog` | `products_barcodes` | `products` | Products, Barcodes & Multi-Unit Packaging / إدارة المنتجات والباركود وتعدد الوحدات | `products.view` |
| 3 | `step-checkout-pos` | `sales_cashier` | `checkout` | POS Checkout, Scanner & Multi-Currency / كاشير المبيعات والماسح وتعدد العملات | `sales.create` |
| 4 | `step-inventory-movements` | `inventory_movements` | `inventory` | Inventory & Stock Movements / إدارة المخزون وحركة الأصناف | `inventory.view` |
| 5 | `step-purchasing-suppliers` | `purchasing_suppliers` | `inventory` | Purchasing, Suppliers & Goods Receipt / المشتريات والموردون واستلام البضائع | `purchases.view` |
| 6 | `step-customers-receivables` | `customers_receivables` | `customers` | Customers & Receivables (Debts) / العملاء والذمم المدينة والأقساط | `customers.view` |
| 7 | `step-expenses-accounting` | `expenses_accounting` | `sales` | Invoices, Expenses & Accounting / الفواتير والمصروفات والمحاسبة المالية | `sales.view` |
| 8 | `step-branch-management` | `branch_management` | `settings` | Multi-Branch Operations & Isolation / إدارة الفروع وعزل بيانات الفروع | `company.view` |
| 9 | `step-reports-analytics` | `reports_analytics` | `reports` | Executive Reports & Rate Fluctuations / التقارير التنفيذية وتحليل تذبذب الصرف | `analytics.view` |
| 10 | `step-intelligence-center` | `intelligence_center` | `reports` | Smart Store Operations & Unmet Demand / ذكاء المتجر وطلبات العملاء غير المتوفرة | `intelligence.view` |
| 11 | `step-notifications-recommendations` | `notifications_recommendations` | `reports` | Alerts, Replenishment & Lifecycle / التنبيهات والتوصيات الذكية ودورة حياتها | `intelligence.view` |
| 12 | `step-users-permissions` | `users_permissions` | `settings` | Employee Management & Granular RBAC / إدارة الموظفين والصلاحيات التفصيلية | `users.view` |
| 13 | `step-company-settings` | `company_settings` | `settings` | Company Profile, Currencies & Practice Mode / إعدادات الشركة والعملات ووضع التدريب | `company.view` |

### Tour Controls & Features
- **Controls**: Next (`التالي`), Previous (`السابق`), Skip / Pause (`إيقاف مؤقت`), Finish (`إنهاء التدريب`), Restart (`إعادة الجولة`), and Direct Step Selector (`1..13`).
- **Role-Aware Step Notice**: If an employee views a tour module that requires a capability outside their assigned role (e.g., a Cashier inspecting Step 12 `step-users-permissions`), the overlay displays a clear bilingual badge explaining which capability is required (`users.view` / `permissions.manage`).
- **Per-User & Per-Company Persistence**: Progress is stored under `dqnamo_pos_training_tour_v1_<companyId>_<userId>`.

---

## 2. Real-Data 8-Item Onboarding Checklist

Computed dynamically by `computeOnboardingChecklistStatus()` in `src/lib/training-tour.ts` from actual workspace state:
1. **Company Profile Configured** (`companyProfileCompleted`)
2. **Base Currency (`SDG`) & Exchange Rates Configured** (`currencyConfigured`)
3. **Main Branch Created & Active** (`branchesCreated`)
4. **Products & Barcodes Added** (`productsAdded`)
5. **Employee Accounts & RBAC Roles Assigned** (`employeesAdded`)
6. **Opening Inventory & Stock Movements Reviewed** (`openingInventoryConfigured`)
7. **First POS Sale Completed** (`firstSaleCompleted`)
8. **13-Module Interactive Guided Tour Completed** (`guidedTourCompleted`)
