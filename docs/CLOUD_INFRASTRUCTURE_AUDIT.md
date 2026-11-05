# تقرير التدقيق الشامل للبنية التحتية السحابية (POS Cloud Infrastructure – Phase 1 Audit)

- **المشروع:** Dqnamo POS (`com.dqnamo.pos`) — نظام نقاط البيع المتقدم (Web & Android APK)
- **تاريخ التدقيق:** 2026-11-02
- **نوع المرحلة:** المرحلة الأولى — تدقيق معماري وأمني ومالي شامل (Audit Only — بدون تعديل الكود أو قاعدة البيانات أو إنشاء موارد سحابية)
- **البنية المستهدفة:**
  - **الاستضافة (Hosting):** Google Cloud Run
  - **قاعدة البيانات (Database):** Google Cloud SQL for PostgreSQL 16
  - **المصادقة (Authentication):** Firebase Authentication + PostgreSQL RBAC
  - **الخادم الخلفي (Backend):** Node.js + Express (`server.ts`)
  - **طبقة البيانات (ORM):** Drizzle ORM (`drizzle-orm/node-postgres`)
  - **الواجهة الأمامية (Frontend):** React 19 + TypeScript + Vite
  - **تطبيق الهاتف (Mobile):** Capacitor 8 (`@capacitor/android`)
  - **إدارة الأسرار (Secrets):** Google Secret Manager
  - **المراقبة والسجلات (Monitoring):** Google Cloud Logging
  - **العمل دون اتصال (Offline):** SQLite + Sync Queue

---

## 1. الوضع الحالي (Current Architecture State)

يعمل المشروع حالياً كنظام **هجبي (Hybrid Local / Partial-Cloud)** يجمع بين خادم Node.js/Express وقاعدة بيانات PostgreSQL من جهة، وتخزين محلي في المتصفح (`localStorage`) وملفات JSON محلية على القرص (`.data/`) من جهة أخرى:

### 1.1 تفصيل طبقات النظام الحالية
| الطبقة | التقنية الحالية | الحالة الفعلية في الكود |
| :--- | :--- | :--- |
| **Frontend SPA** | React 19 + TypeScript + Tailwind CSS 4 | مكتملة الغالبية، ولكن معظم العمليات المحاسبية (البيع، خصم المخزون، تسديد الديون، العملاء) تُنفذ داخل `POSContext.tsx` في الذاكرة و`localStorage` ثم تُزامن جزئياً. |
| **Mobile Runtime** | Capacitor 8 + ML Kit Barcode Scanner | مهيأ في `android/` و`capacitor.config.ts`، لكنه يستدعي مسارات نسبية `fetch('/api/...')` تفشل داخل APK ما لم يتم ضبط `VITE_API_BASE_URL` و`CORS`. |
| **Backend Server** | Express 4 (`server.ts`) | يعمل على المنفذ `PORT` (`0.0.0.0:3000`)، ويقدم مسارات للمنتجات والعملات وأسعار الصرف ومزامنة مبسطة عبر ملف `.data/store-state.json`. |
| **Database & ORM** | PostgreSQL + Drizzle ORM (`src/db/schema.ts`) | يحتوي المخطط على **22 جدولاً** مصممة بشكل احترافي، ولكن الخادم لا يقرأ/يكتب فعلياً في PostgreSQL إلا لجداول: `products`, `product_barcodes`, `currencies`, `exchange_rates`, `units_of_measure`, `custom_field_definitions`. |
| **Authentication** | تبديل محلي للمستخدمين في الواجهة + ترويسة `x-user-role` | مكتبتا `firebase` و`firebase-admin` مثبتتان ومهيأتان في `src/lib/firebase.ts` و`src/lib/firebase-admin.ts`، لكنهما **غير مربوطتين** بمسارات الخادم أو شاشة تسجيل الدخول بعد. |
| **Offline Storage** | `localStorage` + `.data/*.json` | لا يوجد SQLite محلي ولا طابور عمليات (Outbox Sync Queue) حقيقي على مستوى العميل حتى الآن. |

---

## 2. الخدمات الموجودة فعلياً (Existing Services & Assets)

### 2.1 مسارات الـ Backend الموجودة في `server.ts`
1. **فحص الحالة:**
   - `GET /api/health` — يعيد حالة الخادم وما إذا كانت متغيرات بيئة PostgreSQL متوفرة (`hasDatabaseCredentials()`).
2. **إدارة العملات وأسعار الصرف (`src/db/currencies-repo.ts`):**
   - `GET /api/currencies`، `POST /api/currencies`، `DELETE /api/currencies/:code`
   - `GET /api/exchange-rates`، `GET /api/exchange-rates/history`، `POST /api/exchange-rates`، `PUT /api/exchange-rates/:id`، `DELETE /api/exchange-rates/:id`
   - `GET /api/convert` — تحويل المبالغ المالية تاريخياً أو لحظياً.
3. **إدارة المنتجات (`src/db/products-repo.ts`):**
   - `GET /api/products`، `GET /api/products/:id`، `POST /api/products`، `PUT /api/products/:id`، `DELETE /api/products/:id`
4. **مزامنة المتجر المؤقتة (`server.ts`):**
   - `GET /api/store-sync` و`POST /api/store-sync` — تقرأ وتكتب في ملف محلي `.data/store-state.json` فقط ولا تحفظ الفواتير أو العملاء في PostgreSQL.

### 2.2 الجداول المعرّفة في `src/db/schema.ts` (22 جدولاً)
تم تعريف الجداول التالية في Drizzle Schema مع العلاقات والفهارس:
1. `branches` (الفروع)
2. `roles` (الأدوار والصلاحيات)
3. `users` (المستخدمون والكاشيرات)
4. `categories` (التصنيفات)
5. `products` (المنتجات)
6. `suppliers` (الموردون)
7. `purchases` و`purchase_items` (فواتير المشتريات وبنودها)
8. `stock_movements` (حركات المخزون)
9. `customers` (العملاء)
10. `sales` و`sale_items` (فواتير المبيعات وبنودها مع `idempotency_key`)
11. `payments` (المدفوعات)
12. `returns` و`return_items` (المرتجعات وبنودها)
13. `branch_transfers` و`branch_transfer_items` (التحويلات المخزنية بين الفروع)
14. `store_settings` (إعدادات المتجر والضرائب)
15. `audit_logs` (سجل التدقيق الأمني)
16. `currencies` و`exchange_rates` (العملات وأسعار الصرف)
17. `units_of_measure` و`product_unit_conversions` (وحدات القياس ومعاملات التحويل بين الباكو والشريط)
18. `product_barcodes` (تعدد الباركودات للمنتج الواحد)
19. `custom_field_definitions` و`product_custom_field_values` (الحقول المخصصة الديناميكية)

### 2.3 إعداد الاتصال بقاعدة البيانات (`src/db/index.ts`)
- يستخدم `pg.Pool` مع `drizzle-orm/node-postgres`.
- يدعم الاتصال عبر مقبس Cloud SQL Unix Socket (`SQL_HOST="/app/cloudsql/..."`) أو `DATABASE_URL` أو متغيرات `PGHOST/PGUSER`.
- يحدد حجم المجمع `max: 10` و`connectionTimeoutMillis: 15000`.

---

## 3. الخدمات الناقصة والفجوات المعمارية (Missing Services & Gaps)

### 3.1 على مستوى الـ Backend API (`server.ts`)
1. **غياب مسارات المبيعات والفواتير الفعلية في PostgreSQL (`/api/sales`)**:
   - الفواتير، بنود الفواتير، الدفعات الجزئية، وصور إشعارات الدفع لا تُحفظ في جداول `sales` و`sale_items` و`payments` داخل PostgreSQL، بل تبقى في `localStorage` وملف `.data/store-state.json`.
2. **غياب مسارات تسديد الديون والأقساط (`/api/sales/:id/settle` و`/api/customers`)**:
   - جدول `customers` موجود في `schema.ts` لكن لا يوجد `customers-repo.ts` ولا مسارات Express لإدارة العملاء أو ديونهم في PostgreSQL.
   - جدول `sales` في `schema.ts` ينقصه أعمدة حيوية مستخدمة في الواجهة مثل: `currency`، `sale_exchange_rate`، `paid_amount`، `debt_amount`، `payment_status`، وجدول/حقل لتفاصيل دفعات تسديد الدين (`settlement_history`) وصور الإشعارات.
3. **غياب مسارات المخزون والتوريد والمرتجعات (`/api/inventory/*`, `/api/purchases/*`, `/api/returns/*`)**:
   - حركات المخزون (`stock_movements`) وأذونات الاستلام (`purchases`) تُعالج في ذاكرة المتصفح فقط ولا تُقيد في PostgreSQL.
4. **غياب جدول رصيد المخزون لكل فرع (`branch_inventory`)**:
   - حالياً الكمية `stock` مخزنة كعمود واحد داخل جدول `products`، مما يمنع معرفة رصيد كل فرع على حدة عند تعدد الفروع.
5. **غياب مسارات الفروع والمستخدمين وسجل التدقيق (`/api/branches`, `/api/users`, `/api/audit-logs`)**.

### 3.2 على مستوى البنية التحتية والتشغيل
1. **غياب `Dockerfile` و`.dockerignore`** لبناء حاوية إنتاجية معزولة لـ Cloud Run.
2. **غياب مجلد الترحيلات `drizzle/` (Migrations)**:
   - على الرغم من وجود `src/db/drizzle.config.ts`، لا توجد ملفات SQL Migrations مولّدة أو آلية ترحيل آمنة عند النشر.
3. **غياب تخزين الكائنات السحابي (Cloud Storage / Firebase Storage)**:
   - صور المنتجات وصور إشعارات الدفع البنكي تُحفظ حالياً كـ Base64 Data URLs داخل JSON، مما يضخم حجم قاعدة البيانات والـ Payload بشكل خطير مع مرور الوقت.
4. **غياب SQLite وSync Queue في تطبيق Android**:
   - لا توجد حزمة `@capacitor-community/sqlite` ولا جدول `sync_outbox` محلي لإعادة إرسال العمليات الفاشلة بترتيب زمني مع `idempotency_key`.

---

## 4. التدقيق الأمني (Security Audit)

> **تنبيه أمني:** تم فحص جميع ملفات الإعداد والبيئة دون طباعة أي مفاتيح أو كلمات مرور في هذا التقرير.

### 4.1 الثغرات والمخاطر الحرجة (Critical & High Severity)

| الرقم | المشكلة الأمنية | الموقع في الكود | درجة الخطورة | التفصيل والتأثير |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **تزوير الصلاحيات عبر الترويسة (`Header Spoofing`)** | `server.ts` (الأسطر 44–52) | **حرجة (Critical)** | يعتمد الميدلوير `requireAdminOrManager` فقط على قراءة `req.headers['x-user-role']` دون أي تحقق من هوية المرسل.Moreover، إذا لم تُرسل الترويسة أصلاً (`undefined`)، يسمح الكود بالمرور! |
| **SEC-02** | **مسارات كتابة وحذف بدون أي مصادقة** | `server.ts` (الأسطر 257–350، 414–467) | **حرجة (Critical)** | مسارات `POST /api/products`، `PUT /api/products/:id`، `DELETE /api/products/:id`، و`POST /api/store-sync` مفتوحة بالكامل للعامة بدون أي رمز مصادقة (Bearer Token). |
| **SEC-03** | **مفتاح Firebase API مضمّن في ملف إعداد مستودع الكود** | `firebase-applet-config.json` | **متوسطة (Medium)** | رغم أن مفاتيح Firebase Web العامة مصممة لتكون في العميل، إلا أنه يجب تقييدها بنطاقات HTTP Referrers وبصمة SHA-1/SHA-256 لتطبيق الأندرويد في Google Cloud Console، ونقل إعدادات الخادم إلى متغيرات البيئة. |
| **SEC-04** | **تخزين رموز PIN للمستخدمين كنص صريح (Plaintext)** | `src/lib/initial-data.ts` & `src/db/schema.ts` | **عالية (High)** | عمود `pin_code` في جدول `users` وحالة الواجهة يُخزن كنص عادي (`1234`) بدلاً من تجزئة مشفرة (`bcrypt` / `argon2` أو SHA-256 مع Salt). |
| **SEC-05** | **غياب إعدادات CORS ومكتبة Helmet** | `server.ts` | **عالية (High)** | لا يوجد ميدلوير `cors` ولا ترويسات أمان `helmet`. عند تشغيل APK على هاتف حقيقي (`https://localhost`) والاتصال بـ Cloud Run، سيرفض المتصفح/WebView الطلبات بسبب سياسة CORS. |
| **SEC-06** | **غياب تحديد معدل الطلبات (Rate Limiting)** | `server.ts` | **عالية (High)** | لا يوجد `express-rate-limit` لحماية نقاط النهاية من هجمات الإغراق (DoS) أو تخمين رموز PIN، وهو أمر يرفع أيضاً فاتورة Cloud Run عند الهجوم. |
| **SEC-07** | **حجم Payload كبير (`10mb`) بدون التحقق المهيكل (Zod)** | `server.ts` (سطر 41) | **متوسطة (Medium)** | `express.json({ limit: '10mb' })` مفعل على جميع المسارات دون مخطط تحقق صارم (`zod`)، مما يسمح بإرسال كائنات ضخمة داخل `customFields` أو `/api/store-sync`. |
| **SEC-08** | **غياب العزل الفعلي بين الفروع (Branch Isolation)** | `src/db/products-repo.ts` & `server.ts` | **عالية (High)** | الاستعلامات لا تفلتر البيانات بناءً على `branch_id` المستخرج من رمز المستخدم الموثق، مما يسمح لأي فرع برؤية أو تعديل بيانات الفروع الأخرى. |
| **SEC-09** | **عدم تفعيل سجل التدقيق الأمني (`audit_logs`)** | `src/db/schema.ts` (سطر 283) | **متوسطة (Medium)** | جدول `audit_logs` موجود في قاعدة البيانات، لكن لا يتم إدراج أي سجل فيه عند تعديل الأسعار أو حذف المنتجات أو تغيير أسعار الصرف. |
| **SEC-10** | **مخاطر SQL Injection** | `src/db/*-repo.ts` | **منخفضة / آمنة حالياً (Low)** | جميع الاستعلامات الحالية تستخدم Drizzle ORM Parameterized Queries (`eq`, `and`)، مما يحمي من SQL Injection، بشرط عدم إضافة استعلامات `sql.raw()` غير معقمة مستقبلاً. |

---

## 5. تدقيق المصادقة والصلاحيات (Authentication Audit)

### 5.1 تشخيص الوضع الراهن
1. **هل يستخدم النظام Firebase Authentication حالياً؟**
   - الحزم `firebase@^13.1.0` و`firebase-admin@^14.5.0` مثبتة، وتم تهيئة `auth` في `src/lib/firebase.ts` و`adminAuth` في `src/lib/firebase-admin.ts`، **ولكن لم يتم استخدامهما في أي مكون React أو ميدلوير Express حتى الآن**.
2. **هل يستخدم النظام JWT؟**
   - لا يتم إصدار أو فحص أي JWT حالياً.
3. **هل توجد حسابات مستخدمين في PostgreSQL؟**
   - يوجد جدولا `users` و`roles` في `src/db/schema.ts` (الأسطر 35–54)، ولكن التطبيق يعتمد حالياً على مصفوفة `INITIAL_USERS` المخزنة في `localStorage` داخل `POSContext.tsx`.
4. **كيف تتم إدارة الصلاحيات وربط الفروع حالياً؟**
   - الصلاحيات (`RolePermissions`) تُفحص في الواجهة الأمامية فقط عبر الدالة `hasPermission()` في `POSContext.tsx`، واسم الفرع/الطرفية محفوظ كنص (`terminalName`) دون ربط بجدول `branches`.

### 5.2 التوصية المعمارية الموحدة (لمنع تعارض نظامي مصادقة)
> **التوصية الحاسمة (Single Unified Auth Architecture):**
> اعتماد **Firebase Authentication كمصدر وحيد للهوية والمصادقة (Identity Provider - IdP)**، واعتماد **PostgreSQL (`users`, `roles`, `branches`) كمصدر وحيد للصلاحيات وربط الفروع (Authorization & Tenancy Store)**:
> 1. يسجل المستخدم الدخول عبر **Firebase Auth** (البريد الإلكتروني/كلمة المرور أو Google)، ويحصل العميل على **Firebase ID Token (JWT)**.
> 2. يرسل العميل (Web أو Capacitor APK) الرمز في ترويسة `Authorization: Bearer <Firebase_ID_Token>` مع كل طلب API.
> 3. يتحقق خادم Express من الرمز عبر `adminAuth.verifyIdToken(token)`، ثم يجلب ملف المستخدم من جدول `users` في PostgreSQL بواسطة عمود `firebase_uid TEXT UNIQUE NOT NULL` لمعرفة `role_id` و`branch_id` والصلاحيات الدقيقة.
> 4. **لدعم التبديل السريع للكاشير على نفس جهاز الكاشير (Fast Cashier PIN Switch):** يتم التحقق من رمز PIN المجزأ (`bcrypt`) عبر نقطة نهاية محمية في الخادم (`POST /api/auth/switch-cashier`) بشرط أن يكون الجهاز نفسه موثقاً بحساب المتجر/الفرع عبر Firebase Auth، دون إنشاء نظام JWT موازٍ أو مستقل عن Firebase.

---

## 6. جاهزية النشر على Google Cloud Run (Cloud Run Readiness Audit)

| معيار الجاهزية | الحالة الحالية | التقييم التفصيلي |
| :--- | :--- | :--- |
| **الاستماع على `process.env.PORT`** | **جاهز** | الكود في `server.ts` (سطر 39) يقرأ `const PORT = parseInt(process.env.PORT || '3000', 10);`. |
| **الارتباط بالعنوان `0.0.0.0`** | **جاهز** | الكود في `server.ts` (سطر 485) ينفذ `app.listen(PORT, '0.0.0.0', ...)`. |
| **تقديم ملفات الإنتاج الثابتة (`dist/`)** | **جاهز جزئياً** | عندما يكون `NODE_ENV === 'production'`، يقدم الخادم مجلد `dist` عبر `express.static`. |
| **أمر التشغيل الإنتاجي (`npm start`)** | **غير جاهز للإنتاج** | `"start": "tsx server.ts"` يشغل مترجم TypeScript في وقت التشغيل، كما أن `server.ts` يستورد ملفات بامتداد `.ts`. الأفضل في الإنتاج تجميع الخادم عبر `esbuild` إلى `dist-server/server.mjs` وتشغيله بـ `node dist-server/server.mjs` لتقليل زمن الإقلاع (Cold Start) واستهلاك الذاكرة. |
| **وجود `Dockerfile`** | **غير موجود** | يحتاج المشروع إلى `Dockerfile` متعدد المراحل (Multi-stage build) لتجنب الاعتماد على Buildpacks البطيئة ولضمان تضمين الحزم الإنتاجية فقط. |
| **التعامل مع إشارة الإيقاف (`SIGTERM`)** | **غير موجود** | عند قيام Cloud Run بإيقاف الحاوية، يرسل إشارة `SIGTERM`. حالياً لا يستمع `server.ts` لـ `SIGTERM` لإغلاق اتصالات `pg.Pool` (`pool.end()`) وإنهاء الطلبات الجارية بأمان. |
| **الاعتماد على ملفات محلية دائمة (`.data/`)** | **خطر حرج (Blocker)** | يكتب الخادم في `.data/products.json` و`.data/store-state.json`. في Cloud Run نظام الملفات مؤقت في الذاكرة (In-memory tmpfs) ويُمسح تماماً عند إعادة تشغيل الحاوية أو تقليصها للصفر. |
| **التشغيل مع أكثر من نسخة (Multi-Instance)** | **غير متوافق حالياً** | بسبب الاعتماد على `.data/store-state.json` المحلي وعدم وجود جلسات مركزية، إذا قام Cloud Run بتشغيل نسختين (2 Instances)، ستحصل كل نسخة على بيانات مختلفة (Split-Brain). يجب نقل كل الحالة إلى Cloud SQL PostgreSQL. |
| **نقطة فحص الصحة (`/api/health`)** | **تحتاج لتحسين** | تفحص حالياً وجود المتغيرات النصية فقط (`hasDatabaseCredentials()`) ولا تنفذ استعلام `SELECT 1` للتأكد من سلامة الاتصال الفعلي بـ Cloud SQL. |

---

## 7. تدقيق قاعدة البيانات ومخاطر فقدان البيانات (Database & Data Loss Risks)

### 7.1 تحليل إعدادات PostgreSQL وDrizzle الحالية
1. **إدارة مجمع الاتصالات (`Connection Pooling`):**
   - في `src/db/index.ts`، تم تعيين `max: 10` لكل حاوية، ولكن ينقصه `idleTimeoutMillis: 30000` و`allowExitOnIdle: false`.
   - إذا توسع Cloud Run إلى 20 حاوية × 10 اتصالات = 200 اتصال، قد يتجاوز الحد الأقصى لاتصالات نسخة Cloud SQL الصغيرة (`db-f1-micro` أو `db-g1-small` تدعم ~25 إلى 100 اتصال). يجب جعل `max` قابلاً للضبط عبر متغير بيئة `DB_POOL_MAX=5`.
2. **إدارة المعاملات (`Transaction Management`):**
   - لا يوجد أي استخدام لـ `db.transaction(async (tx) => { ... })` في المستودعات الحالية (`products-repo.ts` و`currencies-repo.ts`).
   - عملية البيع يجب أن تتم حصرياً داخل معاملة قاعدة بيانات ذرية (`ACID Transaction`) تقوم بقفل صفوف المخزون (`SELECT ... FOR UPDATE`)، خصم الكمية، إنشاء الفاتورة وبنودها، تسجيل الدفعة، وتسجيل حركة المخزون في خطوة واحدة لا تتجزأ.

### 7.2 مخاطر فقدان البيانات الخمسة (Top 5 Data Loss Risks)
1. **فقدان الفواتير والديون عند إعادة تشغيل حاوية Cloud Run:** لأن `/api/store-sync` يحفظ الفواتير والعملاء في `.data/store-state.json` داخل الحاوية المؤقتة بدلاً من جداول PostgreSQL (`sales`, `customers`).
2. **فقدان بيانات الكاشير على الهاتف عند مسح الكاش أو تحديث WebView:** لأن التطبيق يعتمد على `localStorage` بدلاً من قاعدة بيانات SQLite أصلية على نظام Android.
3. **الكتابة الفوقية للبيانات (Lost Updates) في `/api/store-sync`:** الدالة `mergeById()` تستبدل الكائن بالكامل بأحدث نسخة مرسلة من أي جهاز، فإذا قام جهاز غير متصل بالإنترنت بمزامنة فاتورة أو رصيد عميل قديم، قد يطغى على تسديد دين تم في جهاز آخر.
4. **مشكلة قيد التفرد (`UNIQUE NOT NULL`) على الباركود الفارغ في جدول `products`:**
   - في `src/db/schema.ts` (سطر 73): `barcode: text('barcode').notNull().unique()`.
   - إذا أضاف المستخدم منتجين بدون باركود (حيث القيمة `""` نص فارغ)، سيرفض PostgreSQL إدراج المنتج الثاني بسبب تكرار القيمة الفارغة `""`! يجب تحويل العمود إلى قابلاً للقيمة الفارغة `NULL` أو الاكتفاء بجدول `product_barcodes` للباركودات غير الفارغة.
5. **غياب التحقق من النسخ الاحتياطي التلقائي (Automated Backups & PITR):** يجب التأكد من تفعيل النسخ الاحتياطي اليومي الآلي وخاصية الاسترجاع الزمني (Point-in-Time Recovery - PITR) على نسخة Cloud SQL قبل الانتقال للإنتاج.

---

## 8. التدقيق المالي وتكاليف السحابة المحتملة (Cost Audit)

فيما يلي تفصيل دقيق للخدمات التي قد تسبب رسوماً في Google Cloud وكيفية ضبطها بأقل تكلفة ممكنة:

| الخدمة السحابية | محرك التكلفة الأساسي | مستوى خطورة التكلفة | توصية خفض التكلفة (Cost Optimization) |
| :--- | :--- | :--- | :--- |
| **Google Cloud SQL (PostgreSQL 16)** | يعمل بنظام الساعة (أكبر مصدر للتكلفة الثابتة: المعالج، الذاكرة، مساحة SSD، والـ Public IP). | **عالية (إن لم تضبط)** | استخدام إصدار Cloud SQL Developer / Enterprise بفئة صغيرة (`db-f1-micro` أو `db-g1-small`) في البداية، وتفعيل Storage Auto-increase بحذر، والاتصال عبر **Cloud SQL Auth Proxy (Unix Socket)** لتجنب تكلفة VPC Serverless Connector الثابتة. |
| **Google Cloud Run** | وقت المعالج (CPU) والذاكرة أثناء معالجة الطلبات فقط + عدد الطلبات (بعد تجاوز الطبقة المجانية: 2 مليون طلب/شهر). | **منخفضة جداً** | ضبط `--min-instances=0` (Scale to Zero عند عدم الاستخدام) و`--max-instances=3` (سقف أمان لمنع الفواتير المفاجئة) و`--cpu-throttling` (تخصيص المعالج أثناء الطلب فقط). |
| **Google Cloud Build** | دقائق البناء (أول 120 دقيقة يومياً مجانية). | **منخفضة / مجانية** | استخدام `Dockerfile` محسّن مع التخزين المؤقت للطبقات (Layer Caching) بحيث لا يتجاوز البناء دقيقة إلى دقيقتين. |
| **Artifact Registry** | مساحة تخزين صور الحاويات ($0.10 لكل جيجابايت شهرياً بعد 0.5 GB مجانية). | **منخفضة جداً** | إضافة سياسة تنظيف تلقائية (Cleanup Policy) للاحتفاظ بآخر 3 نسخ فقط من صور Docker وحذف الصور القديمة تلقائياً. |
| **Secret Manager** | $0.06 لكل نسخة سر نشطة شهرياً + $0.03 لكل 10,000 عملية وصول (أول 6 أسرار مجانية). | **شبه مجانية** | قراءة الأسرار مرة واحدة فقط عند إقلاع حاوية Cloud Run (عبر ربط المتغيرات البيئية بـ Secret Manager) وليس مع كل طلب API. |
| **Cloud Logging** | حجم السجلات المخزنة (أول 50 جيجابايت شهرياً مجانية تماماً). | **مجانية عملياً** | تسجيل الأحداث المهمة والأخطاء بصيغة JSON مختصرة، وضبط مدة الاحتفاظ (Retention) على 30 يوماً، وتجنب طباعة الكائنات الضخمة أو الصور Base64 في `console.log`. |
| **Networking & Egress** | حركة البيانات الخارجة (Egress) أو استخدام Serverless VPC Access Connector (يكلف ~$15/شهر إن فُعّل). | **متوسطة إذا فُعّل VPC Connector** | **لا تنشئ Serverless VPC Connector**؛ استخدم ميزة التكامل المدمج لـ Cloud Run مع Cloud SQL (`--add-cloudsql-instances`) التي تنشئ نفقاً مشفراً مجانياً عبر مقبس `/cloudsql/...`. |

---

## 9. خطة التنفيذ المرتبة حسب الأولوية (Prioritized Execution Plan)

### المرحلة 2 (P0 — القصوى): توحيد قاعدة البيانات والمعاملات المحاسبية والمصادقة
1. **تحديث مخطط PostgreSQL (`src/db/schema.ts`) وإنشاء ملفات الترحيل (`drizzle-kit generate`)**:
   - إضافة عمود `firebase_uid` لجدول `users`.
   - جعل `products.barcode` يقبل `NULL` بدلاً من النص الفارغ `""` لمنع تعارض القيد الفريد.
   - استكمال أعمدة جدول `sales` (العملة، سعر الصرف وقت البيع، المدفوع، المتبقي، حالة الدفع) وإنشاء جدول `debt_settlements` وجدول `branch_inventory`.
2. **بناء المستودعات والمسارات المفقودة في Backend مع المعاملات الذرية (`db.transaction`)**:
   - `src/db/sales-repo.ts`: تنفيذ `POST /api/sales` و`POST /api/sales/:id/settle` و`POST /api/sales/:id/void` داخل `db.transaction()` مع فحص `idempotency_key` لمنع تكرار الفواتير عند ضعف الإنترنت.
   - `src/db/customers-repo.ts` و`src/db/inventory-repo.ts` و`src/db/users-repo.ts`.
   - إزالة الاعتماد الكلي على ملفات `.data/products.json` و`.data/store-state.json` في بيئة الإنتاج.
3. **تفعيل مصادقة Firebase Auth وميدلوير الحماية (`src/middleware/auth.ts`)**:
   - التحقق من `Authorization: Bearer <token>` عبر `firebase-admin`.
   - استبدال ترويسة `x-user-role` غير الآمنة ببيانات المستخدم الموثقة من جدول `users` في PostgreSQL وعزل الفروع (`branchId`).
   - إضافة `cors` و`helmet` و`express-rate-limit` والتحقق من المدخلات عبر `zod`.

### المرحلة 3 (P1 — العالية): تجهيز حاوية Cloud Run والإغلاق الآمن
1. **إعداد البناء الإنتاجي للخادم (`build:server`)**:
   - تجميع `server.ts` إلى ملف JavaScript إنتاجي سريع الإقلاع (`dist-server/index.mjs`).
2. **إنشاء `Dockerfile` و`.dockerignore`**:
   - بناء متعدد المراحل (Multi-stage Docker build) على قاعدة `node:22-alpine`.
3. **إضافة معالج `SIGTERM` وتطوير `/api/health`**:
   - إغلاق خادم HTTP ومجمع اتصالات PostgreSQL (`pool.end()`) بأمان عند إيقاف الحاوية، وفحص اتصال قاعدة البيانات فعلياً عبر `SELECT 1`.

### المرحلة 4 (P2 — المتوسطة): دعم العمل دون اتصال لتطبيق Android (SQLite + Sync Queue)
1. **تجهيز عميل API في الواجهة (`src/services/api.ts`)**:
   - دعم `VITE_API_BASE_URL` للاتصال بخدمة Cloud Run من داخل تطبيق Android APK، وإرفاق رمز Firebase ID Token تلقائياً.
2. **بناء نظام الطابور المحلي (`Offline Sync Queue`)**:
   - تخزين العمليات التي تتم أثناء انقطاع الإنترنت (مبيعات، تسديد ديون، تعديل مخزون) في جدول طابور محلي (`sync_outbox`) مع `idempotencyKey` وإرسالها تلقائياً للخادم فور عودة الاتصال.

---

## 10. الملفات التي ستحتاج إلى تعديل أو إنشاء في المراحل التالية

### أ. ملفات حالية ستحتاج إلى تعديل:
| الملف | التعديلات المطلوبة في المراحل القادمة |
| :--- | :--- |
| `src/db/schema.ts` | إضافة `firebaseUid` للمستخدمين، تحديث جدول `sales` لدعم أسعار الصرف التاريخية والديون، إضافة `debt_settlements` و`branch_inventory`، وتعديل `products.barcode` ليقبل `NULL`. |
| `src/db/index.ts` | تحسين إعدادات `pg.Pool` (`max`، `idleTimeoutMillis`)، وإضافة دالة `closeDatabasePool()` و`checkDatabaseHealth()`. |
| `src/db/products-repo.ts` | تغليف عمليات الإدراج والتعديل بمعاملات `db.transaction()`، وربط الأرصدة بالفرع، وإيقاف الكتابة في `.data/products.json` في بيئة الإنتاج. |
| `server.ts` | ربط ميدلوير Firebase Auth، إضافة `cors` و`helmet` و`rate-limit`، ربط مسارات المبيعات والعملاء والمخزون الجديدة بـ PostgreSQL، وإضافة معالج `SIGTERM`. |
| `src/services/api.ts` | إضافة `VITE_API_BASE_URL`، إرفاق ترويسة `Authorization: Bearer <token>`، وإضافة دوال استدعاء مسارات المبيعات والعملاء والمخزون. |
| `src/context/POSContext.tsx` | استبدال الاعتماد على `/api/store-sync` المحلي بطلبات API موثقة مع طابور مزامنة ذكي (Offline Outbox Queue). |
| `package.json` | إضافة سكريبت بناء الخادم الإنتاجي وتحديث `"start"` ليعمل بـ `node` مباشرة في حاوية Cloud Run. |
| `.env.example` | توثيق متغيرات `VITE_API_BASE_URL`، `CORS_ALLOWED_ORIGINS`، `DB_POOL_MAX`، ومتغيرات Cloud SQL. |

### ب. ملفات جديدة سيتم إنشاؤها في المراحل القادمة:
| الملف الجديد | الغرض منه |
| :--- | :--- |
| `src/middleware/auth.ts` | ميدلوير التحقق من رمز Firebase ID Token واستخراج دور المستخدم وفرعه من PostgreSQL. |
| `src/db/sales-repo.ts` | مستودع إدارة فواتير المبيعات، خصم المخزون، تسديد الديون، والمرتجعات داخل معاملات PostgreSQL ذرية. |
| `src/db/customers-repo.ts` | مستودع إدارة العملاء وأرصدة الديون ونقاط الولاء في PostgreSQL. |
| `src/db/inventory-repo.ts` | مستودع إدارة حركات المخزون (`stock_movements`) وأرصدة الفروع (`branch_inventory`). |
| `src/db/audit-repo.ts` | خدمة تسجيل العمليات الحساسة في جدول `audit_logs`. |
| `src/lib/offline-sync-queue.ts` | محرك طابور المزامنة دون اتصال (SQLite / IndexedDB Outbox Queue) مع إعادة المحاولة التلقائية وحماية `idempotencyKey`. |
| `Dockerfile` & `.dockerignore` | ملفات بناء الحاوية الإنتاجية للنشر على Google Cloud Run. |

---

> **حالة المرحلة الأولى:** اكتمل التدقيق الشامل بنجاح دون إجراء أي تعديلات على الكود التطبيقي أو قاعدة البيانات أو إنشاء أي موارد سحابية. بانتظار مراجعتكم وموافقتكم للبدء في تنفيذ **المرحلة الثانية**.
