/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { POSUser, RolePermissions, UserRole } from './types';

export type SystemRoleCode =
  | 'COMPANY_OWNER'
  | 'ADMIN'
  | 'MANAGER'
  | 'CASHIER'
  | 'INVENTORY_MANAGER'
  | 'ACCOUNTANT'
  | 'PURCHASING_MANAGER'
  | 'REPORT_VIEWER'
  | 'CUSTOM_ROLE';

export type CapabilityCode =
  // Dashboard
  | 'dashboard.view'
  // Sales
  | 'sales.view'
  | 'sales.create'
  | 'sales.edit'
  | 'sales.cancel'
  | 'sales.refund'
  | 'sales.discount'
  | 'sales.view_cost'
  // Products
  | 'products.view'
  | 'products.create'
  | 'products.edit'
  | 'products.delete'
  // Inventory
  | 'inventory.view'
  | 'inventory.adjust'
  | 'inventory.receive'
  | 'inventory.transfer'
  | 'inventory.approve_adjustments'
  // Purchasing
  | 'purchases.view'
  | 'purchases.create'
  | 'purchases.approve'
  | 'purchases.receive'
  | 'suppliers.manage'
  // Customers
  | 'customers.view'
  | 'customers.create'
  | 'customers.edit'
  | 'customers.view_debts'
  // Accounting
  | 'accounting.view'
  | 'accounting.create_expense'
  | 'accounting.manage_payables'
  | 'accounting.manage_receivables'
  | 'accounting.view_financial_reports'
  // Analytics
  | 'analytics.view'
  | 'analytics.financial.view'
  | 'analytics.inventory.view'
  | 'analytics.export'
  // Intelligence
  | 'intelligence.view'
  | 'intelligence.acknowledge'
  | 'intelligence.resolve'
  | 'intelligence.dismiss'
  | 'intelligence.reopen'
  // Users & RBAC
  | 'users.view'
  | 'users.create'
  | 'users.edit'
  | 'users.deactivate'
  | 'roles.manage'
  | 'permissions.manage'
  // Company Settings
  | 'company.view'
  | 'company.edit'
  | 'company.currency.manage'
  | 'company.branches.manage'
  // Backup, Restore & Data Migration
  | 'backup.view'
  | 'backup.create'
  | 'backup.download'
  | 'backup.restore'
  | 'backup.import'
  | 'backup.merge'
  | 'backup.manage'
  | 'backup.delete';

export interface CapabilityGroupDefinition {
  groupKey: string;
  labelEn: string;
  labelAr: string;
  capabilities: {
    code: CapabilityCode;
    labelEn: string;
    labelAr: string;
    sensitive?: boolean;
  }[];
}

export const CAPABILITY_GROUPS: CapabilityGroupDefinition[] = [
  {
    groupKey: 'dashboard',
    labelEn: 'Dashboard',
    labelAr: 'لوحة التحكم',
    capabilities: [
      { code: 'dashboard.view', labelEn: 'View Executive Dashboard', labelAr: 'عرض لوحة التحكم الرئيسية' },
    ],
  },
  {
    groupKey: 'sales',
    labelEn: 'Sales & Checkout',
    labelAr: 'المبيعات والكاشير',
    capabilities: [
      { code: 'sales.view', labelEn: 'View Sales & Invoices', labelAr: 'عرض سجل المبيعات والفواتير' },
      { code: 'sales.create', labelEn: 'Create POS Sales', labelAr: 'إجراء المبيعات وإصدار الفواتير' },
      { code: 'sales.edit', labelEn: 'Edit Invoices & Fulfillment', labelAr: 'تعديل حالة استلام الفواتير' },
      { code: 'sales.cancel', labelEn: 'Cancel / Void Invoices', labelAr: 'إلغاء الفواتير', sensitive: true },
      { code: 'sales.refund', labelEn: 'Process Merchandise Refunds', labelAr: 'تنفيذ مرتجعات المبيعات', sensitive: true },
      { code: 'sales.discount', labelEn: 'Apply Cart & Item Discounts', labelAr: 'منح الخصومات على السلة والأصناف' },
      { code: 'sales.view_cost', labelEn: 'View Unit Cost & Margin', labelAr: 'عرض سعر التكلفة وهامش الربح', sensitive: true },
    ],
  },
  {
    groupKey: 'products',
    labelEn: 'Products & Catalog',
    labelAr: 'المنتجات والباركود',
    capabilities: [
      { code: 'products.view', labelEn: 'View Product Catalog', labelAr: 'عرض دليل المنتجات' },
      { code: 'products.create', labelEn: 'Create Products & Barcodes', labelAr: 'إضافة منتجات وباركود جديد' },
      { code: 'products.edit', labelEn: 'Edit Products & Prices', labelAr: 'تعديل المنتجات والأسعار' },
      { code: 'products.delete', labelEn: 'Delete / Archive Products', labelAr: 'حذف أو أرشفة المنتجات', sensitive: true },
    ],
  },
  {
    groupKey: 'inventory',
    labelEn: 'Inventory & Stock',
    labelAr: 'المخزون والحركات المخزنية',
    capabilities: [
      { code: 'inventory.view', labelEn: 'View Stock Levels & Movements', labelAr: 'عرض أرصدة وحركات المخزون' },
      { code: 'inventory.adjust', labelEn: 'Record Stock Adjustments & Damage', labelAr: 'تسجيل تسويات الجرد والتالف' },
      { code: 'inventory.receive', labelEn: 'Receive Inbound Goods', labelAr: 'استلام البضائع الواردة' },
      { code: 'inventory.transfer', labelEn: 'Initiate Branch Stock Transfers', labelAr: 'تحويل المخزون بين الفروع' },
      { code: 'inventory.approve_adjustments', labelEn: 'Approve Stock Adjustments', labelAr: 'اعتماد تسويات المخزون', sensitive: true },
    ],
  },
  {
    groupKey: 'purchases',
    labelEn: 'Purchasing & Suppliers',
    labelAr: 'المشتريات والموردون',
    capabilities: [
      { code: 'purchases.view', labelEn: 'View Purchase Orders', labelAr: 'عرض أوامر وفواتير الشراء' },
      { code: 'purchases.create', labelEn: 'Create Purchase Orders', labelAr: 'إنشاء أوامر شراء جديدة' },
      { code: 'purchases.approve', labelEn: 'Approve Purchase Orders', labelAr: 'اعتماد أوامر الشراء', sensitive: true },
      { code: 'purchases.receive', labelEn: 'Receive Supplier Shipments', labelAr: 'استلام شحنات الموردين' },
      { code: 'suppliers.manage', labelEn: 'Manage Suppliers Directory', labelAr: 'إدارة بيانات الموردين' },
    ],
  },
  {
    groupKey: 'customers',
    labelEn: 'Customers & Receivables',
    labelAr: 'العملاء والديون',
    capabilities: [
      { code: 'customers.view', labelEn: 'View Customer Directory', labelAr: 'عرض سجل العملاء' },
      { code: 'customers.create', labelEn: 'Create New Customers', labelAr: 'إضافة عملاء جدد' },
      { code: 'customers.edit', labelEn: 'Edit Customer Profiles', labelAr: 'تعديل بيانات العملاء' },
      { code: 'customers.view_debts', labelEn: 'View & Settle Customer Debts', labelAr: 'عرض وتسديد ديون العملاء' },
    ],
  },
  {
    groupKey: 'accounting',
    labelEn: 'Accounting & Finance',
    labelAr: 'المحاسبة والمالية',
    capabilities: [
      { code: 'accounting.view', labelEn: 'View Accounting Ledger', labelAr: 'عرض الدفتر المحاسبي' },
      { code: 'accounting.create_expense', labelEn: 'Record Operating Expenses', labelAr: 'تسجيل المصروفات التشغيلية' },
      { code: 'accounting.manage_payables', labelEn: 'Manage Supplier Payables', labelAr: 'إدارة مستحقات الموردين' },
      { code: 'accounting.manage_receivables', labelEn: 'Manage Customer Receivables', labelAr: 'إدارة الذمم المدينة والتحصيل' },
      { code: 'accounting.view_financial_reports', labelEn: 'View P&L & Financial Statements', labelAr: 'عرض قائمة الدخل والتقارير المالية', sensitive: true },
    ],
  },
  {
    groupKey: 'analytics',
    labelEn: 'Analytics & Forecasting',
    labelAr: 'التحليلات والتوقعات الذكية',
    capabilities: [
      { code: 'analytics.view', labelEn: 'View Operational Analytics', labelAr: 'عرض التحليلات التشغيلية' },
      { code: 'analytics.financial.view', labelEn: 'View Financial & Margin Analytics', labelAr: 'عرض التحليلات المالية والهوامش', sensitive: true },
      { code: 'analytics.inventory.view', labelEn: 'View Inventory & Demand Analytics', labelAr: 'عرض تحليلات المخزون والطلب' },
      { code: 'analytics.export', labelEn: 'Export Analytics & CSV Reports', labelAr: 'تصدير التقارير والبيانات (CSV)' },
    ],
  },
  {
    groupKey: 'intelligence',
    labelEn: 'Intelligence Center & Alerts',
    labelAr: 'مركز الذكاء ودورة حياة التنبيهات',
    capabilities: [
      { code: 'intelligence.view', labelEn: 'View Smart Alerts & Recommendations', labelAr: 'عرض التنبيهات والتوصيات الذكية' },
      { code: 'intelligence.acknowledge', labelEn: 'Acknowledge Alerts', labelAr: 'تأكيد الاطلاع والمتابعة للتنبيهات' },
      { code: 'intelligence.resolve', labelEn: 'Resolve Alerts & Recommendations', labelAr: 'إغلاق وحل التنبيهات مع التوثيق' },
      { code: 'intelligence.dismiss', labelEn: 'Dismiss Non-Actionable Alerts', labelAr: 'استبعاد التنبيهات غير اللازمة' },
      { code: 'intelligence.reopen', labelEn: 'Reopen Resolved/Dismissed Items', labelAr: 'إعادة فتح التنبيهات المغلقة', sensitive: true },
    ],
  },
  {
    groupKey: 'users',
    labelEn: 'Users & Access Control',
    labelAr: 'المستخدمون والصلاحيات',
    capabilities: [
      { code: 'users.view', labelEn: 'View Employee Directory & Sessions', labelAr: 'عرض قائمة الموظفين والجلسات' },
      { code: 'users.create', labelEn: 'Create Employee Accounts', labelAr: 'إنشاء حسابات موظفين جديدة', sensitive: true },
      { code: 'users.edit', labelEn: 'Edit Employee Profiles & Branches', labelAr: 'تعديل بيانات وفروع الموظفين', sensitive: true },
      { code: 'users.deactivate', labelEn: 'Activate / Deactivate Employees', labelAr: 'تفعيل أو إيقاف حسابات الموظفين', sensitive: true },
      { code: 'roles.manage', labelEn: 'Assign & Manage Roles', labelAr: 'إدارة وتعيين الأدوار الوظيفية', sensitive: true },
      { code: 'permissions.manage', labelEn: 'Customize Granular Permissions', labelAr: 'تخصيص الصلاحيات التفصيلية', sensitive: true },
    ],
  },
  {
    groupKey: 'company',
    labelEn: 'Company, Branches & Currencies',
    labelAr: 'إعدادات الشركة والفروع والعملات',
    capabilities: [
      { code: 'company.view', labelEn: 'View Company Profile & Settings', labelAr: 'عرض ملف وإعدادات الشركة' },
      { code: 'company.edit', labelEn: 'Edit Company Profile & Tax Policy', labelAr: 'تعديل بيانات الشركة والضرائب', sensitive: true },
      { code: 'company.currency.manage', labelEn: 'Manage Currencies & Exchange Rates', labelAr: 'إدارة العملات وأسعار الصرف', sensitive: true },
      { code: 'company.branches.manage', labelEn: 'Create & Manage Company Branches', labelAr: 'إنشاء وإدارة فروع الشركة', sensitive: true },
    ],
  },
  {
    groupKey: 'backup',
    labelEn: 'Backup, Restore & Data Migration',
    labelAr: 'النسخ الاحتياطي والاستعادة والدمج الذكي',
    capabilities: [
      { code: 'backup.view', labelEn: 'View Backups, Checkpoints & Manifests', labelAr: 'عرض النسخ الاحتياطية ونقاط الاستعادة' },
      { code: 'backup.create', labelEn: 'Create Full & Selective Backups', labelAr: 'إنشاء نسخ احتياطية كاملة أو انتقائية', sensitive: true },
      { code: 'backup.download', labelEn: 'Download Backup Packages', labelAr: 'تنزيل ملفات النسخ الاحتياطي (.backup)', sensitive: true },
      { code: 'backup.restore', labelEn: 'Restore Company Backup', labelAr: 'استعادة النسخة الاحتياطية للشركة', sensitive: true },
      { code: 'backup.import', labelEn: 'Import & Inspect External Backups', labelAr: 'استيراد وفحص ملفات النسخ الاحتياطي', sensitive: true },
      { code: 'backup.merge', labelEn: 'Execute Intelligent Data Merge', labelAr: 'تنفيذ الدمج الذكي للبيانات ومعالجة التعارضات', sensitive: true },
      { code: 'backup.manage', labelEn: 'Manage Encryption & Recovery Checkpoints', labelAr: 'إدارة تشفير النسخ الاحتياطية ونقاط الاستعادة', sensitive: true },
      { code: 'backup.delete', labelEn: 'Delete Stored Backup Checkpoints', labelAr: 'حذف النسخ الاحتياطية المخزنة', sensitive: true },
    ],
  },
];

export const ALL_CAPABILITY_CODES: CapabilityCode[] = CAPABILITY_GROUPS.flatMap((g) =>
  g.capabilities.map((c) => c.code)
);

export const SYSTEM_ROLE_DEFINITIONS: {
  code: SystemRoleCode;
  legacyRole: UserRole;
  labelEn: string;
  labelAr: string;
  descriptionEn: string;
  descriptionAr: string;
  badgeClass: string;
  defaultCapabilities: CapabilityCode[];
}[] = [
  {
    code: 'COMPANY_OWNER',
    legacyRole: 'admin',
    labelEn: 'Company Owner',
    labelAr: 'مالك الشركة (صلاحيات مطلقة)',
    descriptionEn: 'Full administrative control over company profile, branches, currencies, users, and financial intelligence.',
    descriptionAr: 'تحكم كامل بملف الشركة، الفروع، العملات، الموظفين، الصلاحيات، والتقارير المالية.',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    defaultCapabilities: [...ALL_CAPABILITY_CODES],
  },
  {
    code: 'ADMIN',
    legacyRole: 'admin',
    labelEn: 'System Administrator',
    labelAr: 'مدير النظام',
    descriptionEn: 'Full operational and user management access across all branches.',
    descriptionAr: 'صلاحيات إدارية وتشغيلية شاملة عبر جميع الفروع والمستخدمين.',
    badgeClass: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
    defaultCapabilities: [...ALL_CAPABILITY_CODES],
  },
  {
    code: 'MANAGER',
    legacyRole: 'manager',
    labelEn: 'Branch / Store Manager',
    labelAr: 'مدير فرع / متجر',
    descriptionEn: 'Manages daily store operations, pricing, inventory, refunds, exchange rates, and intelligence workflows.',
    descriptionAr: 'إدارة العمليات اليومية، التسعير، المخزون، المرتجعات، أسعار الصرف، ومركز الذكاء.',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    defaultCapabilities: ALL_CAPABILITY_CODES.filter(
      (c) =>
        c !== 'roles.manage' &&
        c !== 'permissions.manage' &&
        c !== 'company.branches.manage' &&
        c !== 'users.deactivate' &&
        c !== 'backup.restore' &&
        c !== 'backup.merge' &&
        c !== 'backup.manage' &&
        c !== 'backup.delete'
    ),
  },
  {
    code: 'CASHIER',
    legacyRole: 'cashier',
    labelEn: 'Sales Cashier',
    labelAr: 'كاشير مبيعات',
    descriptionEn: 'Executes POS checkout, barcode scanning, customer selection, debt collection, and unmet demand logging.',
    descriptionAr: 'إجراء عمليات البيع، مسح الباركود، تحصيل دفعات العملاء، وتسجيل الطلبات غير المتوفرة.',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    defaultCapabilities: [
      'dashboard.view',
      'sales.view',
      'sales.create',
      'sales.edit',
      'sales.discount',
      'products.view',
      'customers.view',
      'customers.create',
      'customers.edit',
      'customers.view_debts',
      'intelligence.view',
      'intelligence.acknowledge',
      'company.view',
    ],
  },
  {
    code: 'INVENTORY_MANAGER',
    legacyRole: 'inventory_clerk',
    labelEn: 'Inventory Manager',
    labelAr: 'مدير المخزون والمستودع',
    descriptionEn: 'Controls product catalog, barcodes, stock adjustments, inbound goods receipts, and branch transfers.',
    descriptionAr: 'إدارة المنتجات والباركود، الجرد المخزني، استلام البضائع، والتحويلات بين الفروع.',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    defaultCapabilities: [
      'dashboard.view',
      'products.view',
      'products.create',
      'products.edit',
      'inventory.view',
      'inventory.adjust',
      'inventory.receive',
      'inventory.transfer',
      'inventory.approve_adjustments',
      'purchases.view',
      'purchases.receive',
      'analytics.view',
      'analytics.inventory.view',
      'intelligence.view',
      'intelligence.acknowledge',
      'intelligence.resolve',
      'company.view',
    ],
  },
  {
    code: 'ACCOUNTANT',
    legacyRole: 'manager',
    labelEn: 'Accountant & Financial Auditor',
    labelAr: 'محاسب ومدقق مالي',
    descriptionEn: 'Audits sales, COGS, profit margins, expenses, receivables/payables, and multi-currency exchange rates.',
    descriptionAr: 'مراجعة المبيعات، تكلفة البضاعة، الأرباح، المصروفات، الديون، وتقارير العملات.',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    defaultCapabilities: [
      'dashboard.view',
      'sales.view',
      'sales.view_cost',
      'products.view',
      'inventory.view',
      'purchases.view',
      'customers.view',
      'customers.view_debts',
      'accounting.view',
      'accounting.create_expense',
      'accounting.manage_payables',
      'accounting.manage_receivables',
      'accounting.view_financial_reports',
      'analytics.view',
      'analytics.financial.view',
      'analytics.inventory.view',
      'analytics.export',
      'intelligence.view',
      'company.view',
      'company.currency.manage',
    ],
  },
  {
    code: 'PURCHASING_MANAGER',
    legacyRole: 'inventory_clerk',
    labelEn: 'Purchasing & Supply Manager',
    labelAr: 'مدير المشتريات والتوريد',
    descriptionEn: 'Manages suppliers, purchase orders, inbound stock receipts, cost prices, and replenishment recommendations.',
    descriptionAr: 'إدارة الموردين وأوامر الشراء واستلام البضائع وتوصيات إعادة التزويد.',
    badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    defaultCapabilities: [
      'dashboard.view',
      'sales.view_cost',
      'products.view',
      'products.create',
      'products.edit',
      'inventory.view',
      'inventory.receive',
      'purchases.view',
      'purchases.create',
      'purchases.approve',
      'purchases.receive',
      'suppliers.manage',
      'analytics.view',
      'analytics.inventory.view',
      'intelligence.view',
      'intelligence.acknowledge',
      'intelligence.resolve',
      'company.view',
    ],
  },
  {
    code: 'REPORT_VIEWER',
    legacyRole: 'cashier',
    labelEn: 'Report & Analytics Viewer',
    labelAr: 'مستعرض التقارير والتحليلات',
    descriptionEn: 'Read-only access to dashboards, operational analytics, inventory health, and intelligence reports.',
    descriptionAr: 'صلاحية قراءة فقط للوحات التحكم، التحليلات التشغيلية، وتقارير الأداء.',
    badgeClass: 'bg-neutral-700/40 text-neutral-300 border-neutral-600/50',
    defaultCapabilities: [
      'dashboard.view',
      'sales.view',
      'products.view',
      'inventory.view',
      'purchases.view',
      'customers.view',
      'analytics.view',
      'analytics.inventory.view',
      'intelligence.view',
      'company.view',
    ],
  },
  {
    code: 'CUSTOM_ROLE',
    legacyRole: 'cashier',
    labelEn: 'Custom Role',
    labelAr: 'دور مخصص',
    descriptionEn: 'Tailored capability set configured per employee.',
    descriptionAr: 'مجموعة صلاحيات مخصصة يتم تحديدها حسب مهام الموظف.',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    defaultCapabilities: ['dashboard.view', 'sales.view', 'products.view', 'company.view'],
  },
];

export function normalizeSystemRoleCode(
  roleCodeOrLegacy?: string | null
): SystemRoleCode {
  const upper = (roleCodeOrLegacy || '').trim().toUpperCase();
  const matched = SYSTEM_ROLE_DEFINITIONS.find((r) => r.code === upper);
  if (matched) return matched.code;

  switch ((roleCodeOrLegacy || '').trim().toLowerCase()) {
    case 'owner':
    case 'company_owner':
      return 'COMPANY_OWNER';
    case 'admin':
      return 'ADMIN';
    case 'manager':
      return 'MANAGER';
    case 'inventory_clerk':
    case 'inventory_manager':
      return 'INVENTORY_MANAGER';
    case 'accountant':
      return 'ACCOUNTANT';
    case 'purchasing_manager':
      return 'PURCHASING_MANAGER';
    case 'report_viewer':
      return 'REPORT_VIEWER';
    case 'custom_role':
      return 'CUSTOM_ROLE';
    default:
      return 'CASHIER';
  }
}

export function mapLegacyRoleToSystemRole(
  roleCodeOrLegacy?: string | null
): SystemRoleCode {
  return normalizeSystemRoleCode(roleCodeOrLegacy);
}

export function mapSystemRoleToLegacyRole(systemRole?: SystemRoleCode | string | null): UserRole {
  const normalized = normalizeSystemRoleCode(systemRole);
  const found = SYSTEM_ROLE_DEFINITIONS.find((r) => r.code === normalized);
  return found ? found.legacyRole : 'cashier';
}

export function getDefaultCapabilitiesForRole(roleCodeOrLegacy?: string | null): CapabilityCode[] {
  const code = normalizeSystemRoleCode(roleCodeOrLegacy);
  const found = SYSTEM_ROLE_DEFINITIONS.find((r) => r.code === code);
  return found ? [...found.defaultCapabilities] : [...SYSTEM_ROLE_DEFINITIONS[3].defaultCapabilities];
}

export function deriveLegacyPermissionsFromCapabilities(
  capabilities: CapabilityCode[]
): RolePermissions {
  const set = new Set<CapabilityCode>(capabilities);
  return {
    canCheckout: set.has('sales.create'),
    canApplyDiscounts: set.has('sales.discount'),
    canManageProducts: set.has('products.create') || set.has('products.edit'),
    canEditPrices: set.has('products.edit') || set.has('sales.view_cost'),
    canManageInventory:
      set.has('inventory.adjust') ||
      set.has('inventory.receive') ||
      set.has('inventory.transfer'),
    canVoidTransactions: set.has('sales.cancel') || set.has('sales.refund'),
    canManageExchangeRates: set.has('company.currency.manage'),
    canViewReports:
      set.has('analytics.view') ||
      set.has('accounting.view_financial_reports') ||
      set.has('analytics.financial.view'),
    canManageUsers:
      set.has('users.create') ||
      set.has('users.edit') ||
      set.has('roles.manage') ||
      set.has('permissions.manage'),
  };
}

export function deriveCapabilitiesFromUser(
  user?: Pick<POSUser, 'role' | 'systemRole' | 'capabilities' | 'permissions'> | null
): CapabilityCode[] {
  if (!user) return [];
  if (Array.isArray(user.capabilities) && user.capabilities.length > 0) {
    return Array.from(new Set(user.capabilities as CapabilityCode[]));
  }

  const base = new Set<CapabilityCode>(
    getDefaultCapabilitiesForRole(user.systemRole || user.role)
  );

  // Sync any explicit boolean overrides in `user.permissions`
  if (user.permissions) {
    if (user.permissions.canCheckout) base.add('sales.create');
    else base.delete('sales.create');

    if (user.permissions.canApplyDiscounts) base.add('sales.discount');
    else base.delete('sales.discount');

    if (user.permissions.canManageProducts) {
      base.add('products.create');
      base.add('products.edit');
    }

    if (user.permissions.canEditPrices) {
      base.add('products.edit');
      base.add('sales.view_cost');
    }

    if (user.permissions.canManageInventory) {
      base.add('inventory.adjust');
      base.add('inventory.receive');
    }

    if (user.permissions.canVoidTransactions) {
      base.add('sales.cancel');
      base.add('sales.refund');
    }

    if (user.permissions.canManageExchangeRates) {
      base.add('company.currency.manage');
    } else {
      base.delete('company.currency.manage');
    }

    if (user.permissions.canViewReports) {
      base.add('analytics.view');
      base.add('accounting.view_financial_reports');
      base.add('analytics.financial.view');
    }

    if (user.permissions.canManageUsers) {
      base.add('users.view');
      base.add('users.create');
      base.add('users.edit');
      base.add('roles.manage');
      base.add('permissions.manage');
    }
  }

  return Array.from(base);
}

export function userHasCapability(
  user: Pick<POSUser, 'role' | 'systemRole' | 'capabilities' | 'permissions' | 'isActive'> | null | undefined,
  capability: CapabilityCode
): boolean {
  if (!user || user.isActive === false) return false;
  const sysRole = normalizeSystemRoleCode(user.systemRole || user.role);
  if (sysRole === 'COMPANY_OWNER') return true;
  const caps = deriveCapabilitiesFromUser(user);
  return caps.includes(capability);
}
