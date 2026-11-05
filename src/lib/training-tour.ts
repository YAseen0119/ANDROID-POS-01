/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppNavTab, OnboardingChecklistStatus, POSUser, Product, Currency, BranchRecord, StockMovement, AppSettings } from './types';
import { CapabilityCode, userHasCapability } from './rbac-capabilities';

export type TourCategoryKey =
  | 'dashboard_overview'
  | 'products_barcodes'
  | 'sales_cashier'
  | 'inventory_movements'
  | 'purchasing_suppliers'
  | 'customers_receivables'
  | 'expenses_accounting'
  | 'branch_management'
  | 'reports_analytics'
  | 'intelligence_center'
  | 'notifications_recommendations'
  | 'users_permissions'
  | 'company_settings';

export interface TrainingTourStep {
  id: string;
  stepNumber: number;
  categoryKey: TourCategoryKey;
  tab: AppNavTab;
  targetSelector?: string;
  requiredCapability?: CapabilityCode;
  restrictedExplanationEn?: string;
  restrictedExplanationAr?: string;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  keyPointsEn: string[];
  keyPointsAr: string[];
  practicalTipEn: string;
  practicalTipAr: string;
  roleRelevance: ('admin' | 'manager' | 'cashier' | 'inventory_clerk')[];
}

export const TRAINING_TOUR_STORAGE_KEY = 'dqnamo_pos_training_tour_v1';

export function getUserTourStorageKey(userId?: string | null, companyId?: string | null): string {
  const cKey = companyId ? `${companyId}_` : '';
  const uKey = userId || 'default';
  return `${TRAINING_TOUR_STORAGE_KEY}_${cKey}${uKey}`;
}

export interface TrainingTourProgressState {
  completed: boolean;
  isCompleted?: boolean;
  lastStepIndex: number;
  completedStepIds: string[];
  updatedAt: string;
}

export const TRAINING_TOUR_STEPS: TrainingTourStep[] = [
  {
    id: 'step-dashboard-overview',
    stepNumber: 1,
    categoryKey: 'dashboard_overview',
    tab: 'dashboard',
    targetSelector: '[data-testid="daily-revenue-d3-chart-card"]',
    requiredCapability: 'dashboard.view',
    titleEn: '1. Dashboard & Business Overview',
    titleAr: '1. لوحة التحكم والنظرة العامة للأعمال',
    subtitleEn: 'Live Store KPIs, Revenue Trends & Peak Day Detection',
    subtitleAr: 'مؤشرات الأداء اللحظية ومنحنى الإيرادات وتحديد ذروة المبيعات',
    descriptionEn:
      'Monitor daily sales, total invoices, average basket value, low-stock alerts, and interactive D3.js revenue trend curves in real time.',
    descriptionAr:
      'تابع مبيعات اليوم، إجمالي الفواتير، متوسط السلة، تنبيهات المخزون، ومنحنى الإيرادات اليومية التفاعلي (D3.js) لحظة بلحظة.',
    keyPointsEn: [
      'Interactive D3.js Revenue Chart: Filter by 7, 14, or 30 days and inspect daily peaks.',
      'Instant Currency Switching: Convert all KPIs between SDG, USD, SAR, AED, EUR, and GBP.',
      'Quick Action Shortcuts: Jump directly to low-stock items or recent invoices.',
    ],
    keyPointsAr: [
      'مخطط D3.js تفاعلي للإيرادات: استعرض آخر 7 أو 14 أو 30 يوماً وتعرف على أعلى يوم مبيعات.',
      'تبديل فوري للعملة: حوّل جميع مؤشرات لوحة التحكم فوراً بين الجنيه السوداني والدولار والريال.',
      'اختصارات تشغيلية سريعة: انتقل مباشرة للأصناف المنخفضة أو أحدث الفواتير.',
    ],
    practicalTipEn:
      'Tip: Switching the active currency in the top header converts all Dashboard KPIs immediately without altering historical invoices.',
    practicalTipAr:
      'نصيحة عملية: تغيير العملة من الشريط العلوي يحوّل مؤشرات لوحة التحكم فوراً دون المساس بقيم الفواتير التاريخية.',
    roleRelevance: ['admin', 'manager', 'cashier', 'inventory_clerk'],
  },
  {
    id: 'step-products-catalog',
    stepNumber: 2,
    categoryKey: 'products_barcodes',
    tab: 'products',
    targetSelector: '[data-testid="open-create-product-modal-btn"]',
    requiredCapability: 'products.view',
    restrictedExplanationEn: 'Creating or editing products requires "products.create" / "products.edit" permissions.',
    restrictedExplanationAr: 'إضافة أو تعديل المنتجات تتطلب صلاحية إدارة المنتجات (products.create / products.edit).',
    titleEn: '2. Products & Barcode Management',
    titleAr: '2. إدارة المنتجات والباركود والعبوات',
    subtitleEn: 'Explicit Barcode Rules, Multi-Unit Packaging & Price History',
    subtitleAr: 'تحكم كامل بالباركود والبيع بالقطعة/الباكو وسجل الأسعار',
    descriptionEn:
      'Manage your product catalog with sequential serial numbers (#0001), camera barcode scanning, multi-unit packaging (Strip/Pack), and full price modification audit trails.',
    descriptionAr:
      'أدر دليل المنتجات مع الترقيم التسلسلي (#0001)، مسح الباركود بالكاميرا، البيع بالقطعة أو الباكو، وسجل تدقيق كامل لتاريخ تعديل الأسعار.',
    keyPointsEn: [
      'Explicit Barcode Control: Scan real barcodes or click "Generate Barcode" when needed.',
      'Multi-Unit Packaging: Sell individual units/strips or full boxes/packs from a unified stock pool.',
      'Historical Price Audit: Every cost and selling price update is logged with timestamps.',
    ],
    keyPointsAr: [
      'تحكم صريح بالباركود: امسح الباركود بالكاميرا أو اضغط "توليد باركود" عند الحاجة فقط.',
      'نظام العبوات المتعددة: بيع بالقطعة/الشريط أو الباكو/الكرتون من نفس الرصيد المخزني.',
      'سجل تدقيق الأسعار: حفظ السعر القديم وتاريخ كل تعديل لأغراض حساب تكلفة البضاعة المباعة.',
    ],
    practicalTipEn:
      'Tip: Enable "Multi-Unit Packaging" (e.g., 1 Pack = 8 Strips) so cashiers can switch between unit and pack in one tap.',
    practicalTipAr:
      'نصيحة عملية: فعّل "البيع بالقطعة أو الباكو" ليتمكن الكاشير من التبديل بينهما بضغطة واحدة داخل السلة.',
    roleRelevance: ['admin', 'manager', 'inventory_clerk', 'cashier'],
  },
  {
    id: 'step-checkout-pos',
    stepNumber: 3,
    categoryKey: 'sales_cashier',
    tab: 'checkout',
    targetSelector: '[data-testid="open-barcode-scanner-btn"]',
    requiredCapability: 'sales.create',
    restrictedExplanationEn: 'Completing sales requires the "sales.create" cashier permission.',
    restrictedExplanationAr: 'إصدار الفواتير يتطلب صلاحية البيع (sales.create).',
    titleEn: '3. Sales & Cashier Checkout Workflow',
    titleAr: '3. سير عمل المبيعات وشاشة الكاشير السريعة',
    subtitleEn: 'Barcode Scanning, Flexible Discounts & Split/Credit Payments',
    subtitleAr: 'مسح الباركود، الخصومات المرنة، والدفع النقدي أو الآجل',
    descriptionEn:
      'Ring up sales rapidly by tapping products, searching by serial/SKU/name, or scanning barcodes. Supports cash, Bankak transfer with receipt photos, and partial credit sales.',
    descriptionAr:
      'أنجز عمليات البيع بسرعة بالضغط على المنتج أو البحث بالاسم/الرقم التسلسلي أو مسح الباركود، مع دعم الدفع النقدي والتحويل البنكي (بنكك) والبيع الآجل.',
    keyPointsEn: [
      'Dual Barcode Scanner: Works on web cameras and Android ML Kit hardware scanners.',
      'Sale-Time Exchange Rate Lock: Locks the exact currency rate on every completed invoice.',
      'Unmet Demand Logging: Log unavailable customer requests directly from the checkout bar.',
    ],
    keyPointsAr: [
      'ماسح باركود مزدوج: يعمل بكاميرا المتصفح وتطبيق الأندرويد (Google ML Kit).',
      'تثبيت سعر صرف البيع: يحفظ سعر الصرف الفعلي لحظة إصدار الفاتورة لحمايتها من التقلبات.',
      'تسجيل الطلبات غير المتوفرة: سجّل أي منتج يطلبه العميل وغير متوفر بضغطة زر من شاشة الكاشير.',
    ],
    practicalTipEn:
      'Tip: Use the "+ Unmet Demand" button whenever a customer asks for an out-of-stock or unstocked item to feed the predictive demand engine.',
    practicalTipAr:
      'نصيحة عملية: استخدم زر "تسجيل طلب غير متوفر" عندما يطلب العميل صنفاً نافداً ليقوم النظام بحساب الطلب الكامن وتوصيات الشراء.',
    roleRelevance: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'step-inventory-control',
    stepNumber: 4,
    categoryKey: 'inventory_movements',
    tab: 'inventory',
    targetSelector: '[data-testid="inventory-search-input"]',
    requiredCapability: 'inventory.view',
    titleEn: '4. Inventory & Stock Movements',
    titleAr: '4. إدارة المخزون والحركات المخزنية',
    subtitleEn: 'Stock Adjustments, Damage/Shrinkage & Audit Ledger',
    subtitleAr: 'تسويات الجرد، تسجيل التالف والفاقد، وسجل حركة الأصناف',
    descriptionEn:
      'Track real-time stock quantities by Pack and Unit, filter low-stock or out-of-stock SKUs, and record stock adjustments, damage, or audit counts.',
    descriptionAr:
      'راقب الكميات المتوفرة مفصلةً بالباكو والوحدة، وفلتر الأصناف المنخفضة أو النافدة، وسجّل تسويات الجرد أو التالف مع السبب والموظف المسؤول.',
    keyPointsEn: [
      'Pack & Unit Breakdown: View available stock in both full packs and loose units.',
      'Audited Stock Movements: Every restock, sale, return, and damage entry is permanently logged.',
      'Shrinkage Tracking: Recorded damage and loss automatically feed the Financial P&L reconciliation.',
    ],
    keyPointsAr: [
      'تفصيل الرصيد بالباكو والوحدة: عرض دقيق للعبوات الكاملة والوحدات المفردة.',
      'سجل حركات مخزنية موثق: توثيق كامل لكل حركة بيع أو توريد أو تالف مع التاريخ والمستخدم.',
      'ربط التالف بالتقارير المالية: ينعكس التالف المسجل تلقائياً في صافي الربح بعد الفاقد.',
    ],
    practicalTipEn:
      'Tip: Recording damaged stock with the "damage" movement type ensures accurate shrinkage reconciliation in Financial Analytics.',
    practicalTipAr:
      'نصيحة عملية: تسجيل البضاعة التالفة بنوع حركة "تالف" يضمن دقة حساب صافي الربح بعد الفاقد في التقارير المالية.',
    roleRelevance: ['admin', 'manager', 'inventory_clerk'],
  },
  {
    id: 'step-purchasing-suppliers',
    stepNumber: 5,
    categoryKey: 'purchasing_suppliers',
    tab: 'inventory',
    targetSelector: '[data-testid="inventory-search-input"]',
    requiredCapability: 'purchases.view',
    titleEn: '5. Purchasing, Goods Receipt & Suppliers',
    titleAr: '5. المشتريات واستلام البضائع والموردون',
    subtitleEn: 'Inbound Shipments, Supplier Invoices & Cost Price Updates',
    subtitleAr: 'استلام الشحنات الواردة، فواتير الموردين، وتحديث سعر التكلفة',
    descriptionEn:
      'Record inbound supplier shipments (Goods & Invoice, Goods Only, or Invoice Only), attach supplier invoice numbers, and optionally update product unit cost.',
    descriptionAr:
      'سجّل استلام بضائع الموردين (بضاعة وفاتورة، بضاعة فقط، أو فاتورة فقط) مع رقم فاتورة المورد وتحديث تكلفة الوحدة تلقائياً.',
    keyPointsEn: [
      'Three Receipt Modes: Handle immediate deliveries, goods pending invoice, or advance invoices.',
      'Supplier Cost Tracking: Automatically records historical cost changes for accurate COGS.',
      'Smart Replenishment Integration: Convert replenishment recommendations into supplier orders.',
    ],
    keyPointsAr: [
      'ثلاثة أنماط للاستلام: استلام بضاعة مع فاتورة، أو بضاعة لحين وصول الفاتورة، أو فاتورة مقدمة.',
      'تتبع تكلفة المورد: يحفظ تغير سعر التكلفة تلقائياً لضمان دقة حساب تكلفة المبيعات (COGS).',
      'تكامل مع توصيات التزويد: اعتمد توصيات الشراء الذكية لتوليد أوامر التوريد.',
    ],
    practicalTipEn:
      'Tip: Check "Update Product Cost" when receiving a shipment at a new supplier price so your profit margins stay accurate.',
    practicalTipAr:
      'نصيحة عملية: فعّل خيار "تحديث سعر التكلفة" عند استلام شحنة بسعر جديد ليحافظ النظام على دقة هوامش الربح.',
    roleRelevance: ['admin', 'manager', 'inventory_clerk'],
  },
  {
    id: 'step-customers-debts',
    stepNumber: 6,
    categoryKey: 'customers_receivables',
    tab: 'customers',
    targetSelector: '[data-testid="customers-search-input"]',
    requiredCapability: 'customers.view',
    titleEn: '6. Customers & Accounts Receivable (Debts)',
    titleAr: '6. العملاء والذمم المدينة وتسديد الديون',
    subtitleEn: 'Customer Profiles, Multi-Installment Debt Collection & Receipts',
    subtitleAr: 'ملفات العملاء، تحصيل الديون على دفعات، وإرفاق الإشعارات البنكية',
    descriptionEn:
      'Track customer purchase history, loyalty points, and outstanding credit balances. Collect partial or full debt payments with multi-currency indexing and receipt image attachments.',
    descriptionAr:
      'تابع سجل مشتريات العملاء ونقاط الولاء والديون المستحقة، وسدّد الديون جزئياً أو كلياً مع دعم التسعير بسعر الصرف المحدث وإرفاق صور إشعارات الدفع.',
    keyPointsEn: [
      'Installment Ledger: View every historical debt payment with remaining balance after each installment.',
      'Exchange-Rate Indexed Settlement: Settle old debts using either the original sale rate or today’s rate.',
      'Receipt Photo Proof: Attach multiple Bankak/transfer screenshots per installment.',
    ],
    keyPointsAr: [
      'دفتر أقساط مفصل: استعرض كل دفعة مسددة والرصيد المتبقي بعدها بدقة.',
      'معالجة تغير سعر الصرف عند السداد: إمكانية السداد بسعر يوم البيع أو بسعر الصرف المحدث.',
      'توثيق صور الإشعارات: إرفاق صور إشعارات التحويل البنكي لكل دفعة.',
    ],
    practicalTipEn:
      'Tip: Filter the Customer Directory by "Has Debt" to prioritize accounts receivable collections.',
    practicalTipAr:
      'نصيحة عملية: فلتر قائمة العملاء حسب "عليه دين" لمتابعة تحصيل الذمم المدينة بسرعة.',
    roleRelevance: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'step-expenses-accounting',
    stepNumber: 7,
    categoryKey: 'expenses_accounting',
    tab: 'sales',
    targetSelector: '[data-testid="sales-history-view"]',
    requiredCapability: 'sales.view',
    restrictedExplanationEn: 'Full P&L and cost accounting require "accounting.view_financial_reports" permission.',
    restrictedExplanationAr: 'عرض التقارير المالية التفصيلية وتكلفة البضاعة يتطلب صلاحية المحاسبة والتقارير المالية.',
    titleEn: '7. Invoices, Refunds & Financial Accounting Reconciliation',
    titleAr: '7. الفواتير والمرتجعات والمطابقة المحاسبية',
    subtitleEn: 'Gross-to-Net Sales Bridge, Historical COGS & Cash Collections',
    subtitleAr: 'مطابقة إجمالي وصافي المبيعات، تكلفة البضاعة، والتحصيل النقدي',
    descriptionEn:
      'Audit completed and voided invoices, process full or partial merchandise returns, and reconcile checkout cash collections, subsequent debt collections, and net profit.',
    descriptionAr:
      'راجع الفواتير المكتملة والملغاة، ونفّذ المرتجعات الكلية أو الجزئية، وطابق التحصيل النقدي عند البيع وتحصيل الديون اللاحق وصافي الأرباح.',
    keyPointsEn: [
      'Sale-Time Rate Preservation: Historical invoices never silently rewrite their sale-time totals.',
      '4-Tier Historical COGS: Resolves exact cost at sale time without fabricating fallback percentages.',
      'Cash vs. Accrual Separation: Distinguishes invoice revenue from actual cash collected.',
    ],
    keyPointsAr: [
      'حماية الفواتير التاريخية: لا يتم تغيير قيم الفواتير السابقة تلقائياً عند تغير سعر الصرف.',
      'حساب دقيق لتكلفة البضاعة (COGS): يعتمد على التكلفة الفعلية وقت البيع وسجل أسعار الشراء.',
      'فصل المبيعات عن التدفق النقدي: يميز بدقة بين قيمة الفواتير والنقد المحصل فعلياً.',
    ],
    practicalTipEn:
      'Tip: Open any invoice card in the Sales tab to inspect its locked exchange-rate snapshot and installment history.',
    practicalTipAr:
      'نصيحة عملية: افتح أي فاتورة في سجل المبيعات لمعاينة سعر الصرف المحفوظ وقت البيع وسجل الدفعات.',
    roleRelevance: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'step-branch-management',
    stepNumber: 8,
    categoryKey: 'branch_management',
    tab: 'reports',
    targetSelector: '[data-testid="bi-primary-section-branches"]',
    requiredCapability: 'analytics.view',
    titleEn: '8. Multi-Branch Performance & Stock Transfers',
    titleAr: '8. إدارة الفروع ومقارنة الأداء والتحويلات المخزنية',
    subtitleEn: 'Branch Health Scores, Surplus/Shortage Detection & Scoping',
    subtitleAr: 'مؤشر صحة الفروع، رصد الفائض والعجز، وصلاحيات الفروع',
    descriptionEn:
      'Compare revenue, stock coverage, and unmet customer demand across branches, and identify inter-branch stock transfer opportunities before ordering from external suppliers.',
    descriptionAr:
      'قارن الإيرادات وتغطية المخزون والطلبات غير المتوفرة بين الفروع، واكتشف فرص تحويل الفائض المخزني من فرع لآخر قبل الشراء من المورد.',
    keyPointsEn: [
      'Branch Health Scorecard: Evaluates sales velocity, stockout risk, and margin per branch.',
      'Smart Transfer Recommendations: Matches surplus stock in Branch A with shortages in Branch B.',
      'Server-Side Branch Isolation: Restricts branch staff to their assigned branch data.',
    ],
    keyPointsAr: [
      'بطاقة صحة الفرع: تقييم شامل لسرعة المبيعات ومخاطر النفاد لكل فرع.',
      'توصيات التحويل الذكي: ربط الفائض المخزني في فرع بالعجز والطلب الكامن في فرع آخر.',
      'عزل بيانات الفروع أمنياً: يقتصر وصول موظف الفرع على بيانات الفروع المصرح له بها فقط.',
    ],
    practicalTipEn:
      'Tip: You can create additional company branches and assign employees to specific branches in Settings → Company & Branches.',
    practicalTipAr:
      'نصيحة عملية: يمكنك إنشاء فروع جديدة وتعيين الموظفين لكل فرع من صفحة الإعدادات ← الفروع.',
    roleRelevance: ['admin', 'manager'],
  },
  {
    id: 'step-reports-analytics',
    stepNumber: 9,
    categoryKey: 'reports_analytics',
    tab: 'reports',
    targetSelector: '[data-testid="bi-primary-sections-nav"]',
    requiredCapability: 'analytics.view',
    titleEn: '9. Business Intelligence & Predictive Demand Forecasting',
    titleAr: '9. ذكاء الأعمال والتوقعات الإحصائية للطلب (7/30/90 يوم)',
    subtitleEn: '7-Section BI Navigation, Unmet Demand & Latent Forecasting',
    subtitleAr: 'الأقسام السبعة للتحليلات، الطلب غير المتوفر، والتوقع الكامن',
    descriptionEn:
      'Navigate across the 7 primary BI sections: Business Overview, Sales, Inventory & Demand, Financial Overview, Branch Performance, Intelligence Center, and Reports & Signals.',
    descriptionAr:
      'تنقّل بسهولة بين الأقسام السبعة: نظرة عامة، المبيعات، المخزون والطلب، الملخص المالي، أداء الفروع، مركز الذكاء، والتقارير والإشارات.',
    keyPointsEn: [
      'Stockout-Censored Forecasting: Compares baseline sales forecasts against latent demand (including unmet inquiries).',
      'Conservative Lost Revenue Model: Discounts repeat 24h inquiries and weights confirmed purchase intent.',
      'Multi-Currency Valuation Modes: Analyze reports in Live, Indexed, or Historical Sale-Time rates.',
    ],
    keyPointsAr: [
      'توقعات تعالج فترات نفاد المخزون: مقارنة التوقع المبني على المبيعات فقط مقابل الطلب الحقيقي الكامن.',
      'تقدير متحفظ للمبيعات الضائعة: يستبعد التكرار خلال 24 ساعة ويزن نية الشراء المؤكدة.',
      'أوضاع تقييم متعددة للعملات: استعرض التقارير بالسعر اللحظي أو المؤشر أو التاريخي وقت البيع.',
    ],
    practicalTipEn:
      'Tip: On mobile and tablet screens, use the collapsible "Filters" button to keep charts and KPIs front and center.',
    practicalTipAr:
      'نصيحة عملية: في شاشات الجوال والتابلت، استخدم زر "الفلاتر" القابل للطي لإبقاء المخططات واضحة في أعلى الشاشة.',
    roleRelevance: ['admin', 'manager'],
  },
  {
    id: 'step-intelligence-center',
    stepNumber: 10,
    categoryKey: 'intelligence_center',
    tab: 'reports',
    targetSelector: '[data-testid="bi-primary-section-intelligence"]',
    requiredCapability: 'intelligence.view',
    titleEn: '10. Intelligence Center & Persistent Alert Lifecycle',
    titleAr: '10. مركز الذكاء التشغيلي وإدارة دورة حياة التوصيات',
    subtitleEn: 'Active, Acknowledged, Resolved, Dismissed & Full Audit History',
    subtitleAr: 'التنبيهات النشطة، قيد المتابعة، المحلولة، المستبعدة، والسجل الكامل',
    descriptionEn:
      'Manage every operational alert, replenishment recommendation, and branch transfer through a persistent database-backed workflow with full operator attribution and notes.',
    descriptionAr:
      'أدر جميع التنبيهات وتوصيات التزويد والتحويلات عبر دورة حياة محفوظة في قاعدة البيانات مع توثيق اسم الموظف والوقت والملاحظات.',
    keyPointsEn: [
      '5 Lifecycle Tabs: Switch between Active, Acknowledged, Resolved, Dismissed, and All History.',
      'Non-Reactivation Guarantee: Resolved or dismissed alerts stay closed across page reloads.',
      'Chronological Event Drawer: Inspect every status transition, note, and operator timestamp.',
    ],
    keyPointsAr: [
      'خمسة تبويبات لدورة الحياة: النشطة، قيد المتابعة، تم الحل، المستبعدة، والسجل الكامل.',
      'ضمان عدم إعادة التفعيل العشوائي: التنبيهات المحلولة أو المستبعدة تبقى مغلقة حتى بعد تحديث الصفحة.',
      'نافذة السجل الزمني: استعرض تاريخ كل إجراء وملاحظة واسم الموظف بالتفصيل.',
    ],
    practicalTipEn:
      'Tip: Click "Resolve" on an alert after ordering stock and record the Purchase Order number in the resolution note for future audits.',
    practicalTipAr:
      'نصيحة عملية: اضغط "تم الحل" بعد إصدار أمر الشراء واكتب رقم أمر الشراء في ملاحظة الحل للرجوع إليها لاحقاً.',
    roleRelevance: ['admin', 'manager', 'cashier', 'inventory_clerk'],
  },
  {
    id: 'step-notifications-recommendations',
    stepNumber: 11,
    categoryKey: 'notifications_recommendations',
    tab: 'reports',
    targetSelector: '[data-testid="bi-primary-section-signals"]',
    requiredCapability: 'intelligence.view',
    titleEn: '11. Smart Notifications & Replenishment Formulas',
    titleAr: '11. الإشعارات الذكية ومعادلات إعادة التزويد',
    subtitleEn: 'Explainable Signals, Reorder Point (ROP) & Safety Stock',
    subtitleAr: 'تنبيهات مفسّرة علمياً، نقطة إعادة الطلب (ROP)، ومخزون الأمان',
    descriptionEn:
      'Inspect the transparent mathematical formula behind every recommendation: Current Stock, Blended Daily Demand, Lead Time, Safety Stock, and Protected Revenue.',
    descriptionAr:
      'اطّلع على المعادلة الرياضية الشفافة خلف كل توصية: المخزون الحالي، الطلب اليومي المدمج، فترة التوريد، مخزون الأمان، والإيراد المحمي.',
    keyPointsEn: [
      'Header Bell Popover: Access top-priority alerts from anywhere in the POS.',
      'Zero Black-Box AI: Every insight cites exact observed metrics, time windows, and confidence scores.',
      'Human-in-the-Loop Safety: Recommendations never auto-mutate stock without operator action.',
    ],
    keyPointsAr: [
      'جرس الإشعارات العلوي: الوصول السريع لأهم التنبيهات من أي شاشة في النظام.',
      'شفافية كاملة دون تخمين: كل توصية تعرض الأرقام الفعلية وفترة الرصد ودرجة الثقة.',
      'قرار بشري آمن: لا يقوم النظام بتعديل المخزون تلقائياً دون اعتماد المسؤول.',
    ],
    practicalTipEn:
      'Tip: Use the top header bell icon to jump straight to critical stockout or margin alerts.',
    practicalTipAr:
      'نصيحة عملية: اضغط على أيقونة الجرس في أعلى الشاشة للانتقال المباشر للتنبيهات الحرجة.',
    roleRelevance: ['admin', 'manager', 'cashier', 'inventory_clerk'],
  },
  {
    id: 'step-users-permissions',
    stepNumber: 12,
    categoryKey: 'users_permissions',
    tab: 'settings',
    targetSelector: '[data-testid="open-add-user-btn"]',
    requiredCapability: 'users.view',
    restrictedExplanationEn: 'Managing employee accounts and granular capabilities requires Owner/Admin permissions.',
    restrictedExplanationAr: 'إدارة حسابات الموظفين والصلاحيات التفصيلية تتطلب صلاحية مالك الشركة أو مدير النظام.',
    titleEn: '12. Employee Management & Granular RBAC Permissions',
    titleAr: '12. إدارة الموظفين والأدوار والصلاحيات التفصيلية',
    subtitleEn: '9 Roles, 46 Capabilities, Branch Assignment & Safe Deactivation',
    subtitleAr: '9 أدوار وظيفية، 46 صلاحية دقيقة، تعيين الفروع، والإيقاف الآمن للحسابات',
    descriptionEn:
      'Create employee accounts, assign roles (Owner, Admin, Manager, Cashier, Inventory Manager, Accountant, Purchasing Manager, Report Viewer, Custom Role), assign branches, and customize capabilities.',
    descriptionAr:
      'أنشئ حسابات الموظفين، وعيّن الأدوار الوظيفية والفروع المسموحة، وخصّص الصلاحيات الدقيقة مع حماية المالك الأساسي وسجل التدقيق.',
    keyPointsEn: [
      'Safe Account Deactivation: Deactivate former employees without deleting historical sales or audit logs.',
      'Last-Owner Protection: Prevents accidentally deactivating or demoting the last active Company Owner.',
      'Multi-Branch Scoping: Assign employees to one specific branch or multiple branches.',
    ],
    keyPointsAr: [
      'إيقاف آمن دون حذف السجلات: إيقاف حساب الموظف مع الحفاظ الكامل على فواتيره وسجلاته السابقة.',
      'حماية مالك الشركة: يمنع النظام إيقاف أو خفض صلاحيات آخر مالك نشط للشركة.',
      'تخصيص الفروع للموظف: ربط الموظف بفرع محدد أو عدة فروع.',
    ],
    practicalTipEn:
      'Tip: Prefer deactivating an employee account over deletion so all historical invoices retain accurate cashier attribution.',
    practicalTipAr:
      'نصيحة عملية: استخدم إيقاف الحساب بدلاً من الحذف للحفاظ على دقة تقارير الكاشير التاريخية.',
    roleRelevance: ['admin', 'manager'],
  },
  {
    id: 'step-company-settings',
    stepNumber: 13,
    categoryKey: 'company_settings',
    tab: 'settings',
    targetSelector: '[data-testid="training-center-section"]',
    requiredCapability: 'company.view',
    titleEn: '13. Company Settings, Multi-Currency & Practice Mode',
    titleAr: '13. إعدادات الشركة والعملات ووضع التدريب التجريبي',
    subtitleEn: 'Company Profile, SDG Base Currency, Exchange Rates & Practice Sandbox',
    subtitleAr: 'ملف الشركة، العملة الأساسية (SDG)، أسعار الصرف، وبيئة التدريب المعزولة',
    descriptionEn:
      'Configure company legal identity, logo, tax policy, base currency (SDG), exchange rates, and switch safely into Practice Mode anytime to train new staff without touching production data.',
    descriptionAr:
      'اضبط الاسم القانوني للشركة والشعار والضرائب وأسعار الصرف، وانتقل بأمان إلى "وضع التدريب التجريبي" لتدريب الموظفين الجدد دون التأثير على بيانات الشركة الحقيقية.',
    keyPointsEn: [
      'Isolated Practice Mode: Train staff on realistic synthetic data with a safe one-click Demo Reset.',
      'Historical Rate Integrity: Updating exchange rates never rewrites past transactions.',
      'Onboarding Checklist: Track your company setup completion step by step.',
    ],
    keyPointsAr: [
      'وضع تدريب معزول تماماً: درّب الموظفين على بيانات افتراضية مع إمكانية إعادة ضبط بيانات التدريب بأمان.',
      'سلامة أسعار الصرف التاريخية: تحديث سعر الصرف يطبق على العمليات الجديدة دون تغيير الفواتير السابقة.',
      'قائمة التحقق التأسيسية: تابع اكتمال خطوات تهيئة الشركة خطوة بخطوة.',
    ],
    practicalTipEn:
      'Tip: You can relaunch the full guided tour or any of the 13 individual module tours anytime from the top header or Settings!',
    practicalTipAr:
      'نصيحة عملية: يمكنك إعادة تشغيل الجولة الشاملة أو اختيار أي قسم من الأقسام الـ 13 في أي وقت من الشريط العلوي أو الإعدادات!',
    roleRelevance: ['admin', 'manager', 'cashier', 'inventory_clerk'],
  },
];

export function createInitialTourProgress(): TrainingTourProgressState {
  return {
    completed: false,
    isCompleted: false,
    lastStepIndex: 0,
    completedStepIds: [],
    updatedAt: new Date().toISOString(),
  };
}

export function clampTourStepIndex(index: number, totalSteps = TRAINING_TOUR_STEPS.length): number {
  if (totalSteps <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(totalSteps - 1, Math.floor(index)));
}

export function markTourStepVisited(
  state: TrainingTourProgressState,
  stepIndex: number,
  steps: TrainingTourStep[] = TRAINING_TOUR_STEPS
): TrainingTourProgressState {
  const safeIndex = clampTourStepIndex(stepIndex, steps.length);
  const step = steps[safeIndex];
  if (!step) return state;

  const set = new Set(state.completedStepIds);
  set.add(step.id);

  return {
    ...state,
    lastStepIndex: safeIndex,
    completedStepIds: Array.from(set),
    updatedAt: new Date().toISOString(),
  };
}

export function markTourCompleted(
  state: TrainingTourProgressState,
  steps: TrainingTourStep[] = TRAINING_TOUR_STEPS
): TrainingTourProgressState {
  const allIds = steps.map((s) => s.id);
  return {
    completed: true,
    isCompleted: true,
    lastStepIndex: Math.max(0, steps.length - 1),
    completedStepIds: Array.from(new Set([...state.completedStepIds, ...allIds])),
    updatedAt: new Date().toISOString(),
  };
}

export function calculateTourCompletionPercent(
  state: TrainingTourProgressState,
  steps: TrainingTourStep[] = TRAINING_TOUR_STEPS
): number {
  if (!steps.length) return 100;
  if (state.completed || state.isCompleted) return 100;
  const validIds = new Set(steps.map((s) => s.id));
  const completedCount = state.completedStepIds.filter((id) => validIds.has(id)).length;
  return Math.min(100, Math.round((completedCount / steps.length) * 100));
}

export function getTourStepsForRole(
  role?: 'admin' | 'manager' | 'cashier' | 'inventory_clerk',
  steps: TrainingTourStep[] = TRAINING_TOUR_STEPS
): TrainingTourStep[] {
  if (!role || role === 'admin' || role === 'manager') {
    return steps;
  }
  return steps.filter((step) => step.roleRelevance.includes(role));
}

export function isTourStepAccessibleForUser(
  step: TrainingTourStep,
  user?: Pick<POSUser, 'id' | 'role' | 'systemRole' | 'capabilities' | 'permissions'> | null
): boolean {
  if (!step?.requiredCapability) return true;
  if (!user) return true;
  return userHasCapability(user as any, step.requiredCapability);
}

/**
 * Computes real, non-fabricated onboarding checklist completion status from actual workspace data.
 */
export function computeOnboardingChecklistStatus(params: {
  companyProfileConfigured?: boolean;
  currenciesConfigured?: boolean;
  branchCreated?: boolean;
  productsCount?: number;
  employeesCount?: number;
  salesCount?: number;
  inventoryReviewed?: boolean;
  guidedTourCompleted?: boolean;
  settings?: AppSettings;
  currencies?: Currency[];
  exchangeRates?: Record<string, number>;
  branches?: BranchRecord[];
  products?: Product[];
  users?: POSUser[];
  stockMovements?: StockMovement[];
  tourProgress?: TrainingTourProgressState;
}): OnboardingChecklistStatus {
  const companyProfileCompleted =
    params.companyProfileConfigured !== undefined
      ? Boolean(params.companyProfileConfigured)
      : Boolean(
          params.settings?.storeName &&
            params.settings.storeName.trim().length >= 2 &&
            (params.settings.phone?.trim() || params.settings.address?.trim())
        );

  const currencyConfigured =
    params.currenciesConfigured !== undefined
      ? Boolean(params.currenciesConfigured)
      : Boolean(
          params.settings?.currency &&
            (params.currencies?.length ?? 1) >= 1 &&
            Object.keys(params.exchangeRates || {}).length >= 1
        );

  const branchesCreated =
    params.branchCreated !== undefined
      ? Boolean(params.branchCreated)
      : (params.branches?.length ?? 0) >= 1 ||
        Boolean(params.users?.some((u) => Boolean(u.terminalName)));

  const productsAdded =
    params.productsCount !== undefined
      ? params.productsCount > 0
      : (params.products?.length ?? 0) > 0;

  const activeUsersCount =
    params.employeesCount !== undefined
      ? params.employeesCount
      : (params.users || []).filter((u) => u.isActive !== false).length;
  const employeesAdded = activeUsersCount >= 1;

  const permissionsAssigned =
    params.salesCount !== undefined
      ? params.salesCount > 0
      : (params.users || []).some(
          (u) =>
            (Array.isArray(u.capabilities) && u.capabilities.length > 0) ||
            Boolean(u.permissions && Object.values(u.permissions).some(Boolean))
        );

  const openingInventoryConfigured =
    params.inventoryReviewed !== undefined
      ? Boolean(params.inventoryReviewed)
      : Boolean(
          (params.products || []).some((p) => Number(p.stock) > 0) ||
            (params.stockMovements?.length ?? 0) > 0
        );

  const guidedTourCompleted =
    params.guidedTourCompleted !== undefined
      ? Boolean(params.guidedTourCompleted)
      : Boolean(
          params.tourProgress?.completed ||
            params.tourProgress?.isCompleted ||
            (params.tourProgress?.completedStepIds?.length ?? 0) >= 5
        );

  const flags = [
    companyProfileCompleted,
    currencyConfigured,
    branchesCreated,
    productsAdded,
    employeesAdded,
    permissionsAssigned,
    openingInventoryConfigured,
    guidedTourCompleted,
  ];

  const completedCount = flags.filter(Boolean).length;
  const totalCount = flags.length;
  const completionPercent = Math.round((completedCount / totalCount) * 100);

  return {
    companyProfileCompleted,
    companyProfileConfigured: companyProfileCompleted,
    currencyConfigured,
    currenciesConfigured: currencyConfigured,
    branchesCreated,
    branchCreated: branchesCreated,
    productsAdded,
    firstProductsAdded: productsAdded,
    employeesAdded,
    firstEmployeeCreated: employeesAdded,
    permissionsAssigned,
    firstSaleCompleted: permissionsAssigned,
    openingInventoryConfigured,
    inventoryReviewed: openingInventoryConfigured,
    guidedTourCompleted,
    completedCount,
    totalCount,
    completionPercent,
  };
}
