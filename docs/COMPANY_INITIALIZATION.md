# Company Initialization & Empty State Architecture — Dqnamo POS

## 1. Company Initialization Sequence
When the owner confirms setup in Step 5 of the onboarding wizard (`createCompanyAndInitialOwner` / `createNewCompanyWorkspace`):
1. **Company Record Created:** Assigned a unique `comp-<timestamp>-<hash>` ID, legal name, display names (EN/AR), base currency, and `setupCompleted: true`.
2. **Initial Main Branch Created:** Assigned `br-<timestamp>-main` linked to `companyId` with `isMain: true`.
3. **Initial Owner Account Created:** Assigned `usr-owner-<timestamp>` linked to `companyId` and `branchId`, granted `COMPANY_OWNER` system role (all 46 capabilities), with password hashed via `crypto.scryptSync`.
4. **Data Isolation Scope Initialized:** Dedicated localStorage namespace (`<key>__<companyId>`) and server-side tenant scope (`companyId`) are initialized with empty operational arrays (`products: []`, `transactions: []`, `customers: []`, `stockMovements: []`, `unmetDemandRequests: []`).
5. **Audit Trail Recorded:** Immutable `COMPANY_CREATED` and `INITIAL_OWNER_CREATED` entries are written to the platform audit log.

---

## 2. Bilingual Empty States (Arabic RTL & English LTR)
Every operational module renders an informative bilingual empty state when zero records exist:

| Module | English (LTR) Empty State | Arabic (RTL) Empty State |
| :--- | :--- | :--- |
| **Products & Categories** | "No products have been added yet." | "لم تتم إضافة أي منتجات بعد — ابدأ بإضافة منتجاتك الحقيقية." |
| **Customers & Debts** | "No customer records found." | "لا يوجد عملاء مسجلون حالياً." |
| **Employees & Accounts** | "No accounts have been added yet — click Add Employee to create your first account." | "لم يتم إضافة أي حسابات بعد — اضغط على إضافة موظف لإنشاء حسابك الخاص." |
| **Currencies & Rates** | "No currencies have been added yet — use the form below to add your store's base currency and any secondary currencies." | "لم يتم إضافة أي عملات بعد — استخدم النموذج أدناه لإضافة العملة الأساسية للمتجر وأي عملات إضافية." |
| **Sales & Invoices** | "No sales transactions have been recorded." | "لا توجد معاملات بيع مسجلة حتى الآن." |
| **Inventory & Movements** | "No inventory records are available yet." | "لا توجد سجلات مخزون أو حركات مخزنية متاحة بعد." |
| **Reports & Accounting** | "Reports will become available after recording actual business transactions." | "ستتوفر التقارير المالية فور تسجيل معاملات بيع حقيقية." |
| **Analytics & Forecasts** | "Insufficient historical data to generate reliable analytics." | "لا تتوفر بيانات تاريخية كافية لتوليد تحليلات أو توقعات." |
