# ذاكرة المشروع — Daily Bake (etoile-menu)

> خريطة الكود كي لا يُعاد استكشافه. اسم المجلد تاريخي: بدأ كنسخة من Étoile ثم تحوّل لمخبز **Daily Bake** (برتقالي `#F26722`).

## البنية
موقع طلبات ثابت + لوحة تحكم — **HTML/ES Modules خام بلا build**، الباك-إند كله **Firebase**:
مشروع `mahbaz-12e0c`، RTDB + Auth (email/password للمدراء، anonymous للعملاء) + Hosting + Functions (nodejs20).
- تشغيل محلي: `preview_start` باسم `etoile-menu` (منفذ 4173) — أو `node serve.js`. لا تشغّل سيرفر عبر Bash.
- النشر: `firebase deploy` (`firebase.json` → hosting من جذر المجلد، القواعد من `firebase-rules.json`).
- الصور: **عقدة `assets/{hash}` منفصلة** — المنيو يحمل إشارة `a:{hash}` فقط. لا Firebase Storage.
  `js/assets.js` (`imgSrc` في القوالب + `wireAssets` بعد كل render) يحمّل كل صورة عند اقترابها من الشاشة
  ويخزّنها في Cache Storage للأبد (المفتاح بصمة المحتوى). الرفع من اللوحة عبر `dashboard/js/assetStore.js`.

## واجهة العميل — `index.html` + `js/`
- `app.js` (~628) — الإقلاع والعرض والتوجيه وربط كل الوحدات.
- `cart.js` (~529) — السلة، إتمام الطلب `submitOrder`، تتبّع الطلب `openOrderTracking`، طلباتي `watchMyOrders`.
- `firebase-config.js` — تهيئة Firebase + `loadMenuFromFirebase` / `loadPublicSettings` (بمهلة 4 ثوانٍ ثم fallback).
- `defaults.js` — `EGYPT_GOVERNORATES`، `DEFAULT_PAYMENTS`، `DEFAULT_FEATURES`، `ORDER_STATUSES` (new/preparing/ready/completed/cancelled).
- `notify.js` (~206) — اشتراك الإشعارات، feed الرسائل، صندوق الوارد، تثبيت PWA (`setupPwa`).
- `push.js` FCM · `broadcast.js` إرسال رسالة جماعية · `telegram.js` إشعار الطلبات للبوت · `pricing.js` الخصومات
- `escape.js` **تهريب إجباري لأي نص من بره قبل عرضه في HTML** (`esc`/`escName`/`escNum`/`safeUrl`/`safeTel`) — الطلبات والآراء بيكتبها ناس مش مسجّلين دخول.
- `imageUtils.js` ضغط/حقول الصور · `bgRemoval.js` إزالة الخلفية في المتصفح (@imgly عبر esm.sh؛ قطع الموديل تُخزَّن في Cache Storage باسم `dailybake-bgmodel-v1` عبر تغليف مؤقت لـ fetch، وتُسخَّن تلقائياً لو كانت مخزَّنة) · `translate.js` ترجمة عربي→إنجليزي · `icons.js` · `data.js`.

## لوحة التحكم — `dashboard/` (نفس النمط: `index.html` + `js/`)
`app.js` الهيكل والتوجيه · `auth.js` الصلاحيات (`PERMISSIONS`, `can`, `createStaffAdmin`, `bootstrapOwner`) ·
`session.js` ربط جهاز واحد لكل مدير (`boundDevice` / `deviceRequest`) ·
`backup.js` تنزيل/استرجاع نسخة احتياطية (JSON) — للمالك فقط، يقرأ عبر REST وسجل العمليات في `backups/log` ·
`admins.js` المالك ينشئ حسابات الأدمنز مباشرة (لا يوجد نظام دعوات؛ والقائمة تُقرأ عبر REST لأن SDK يرجّع عقدة `admins` ناقصة) · `menuEditor.js` (~283) · `settings.js` (~312: الهوية، البانرات، التواصل، الدفع، المحافظات، المزايا، تليجرام) ·
`orders.js` · `overview.js` · `branches.js` · `discounts.js` · `customers.js` · `admins.js` · `feedback.js`.

## عُقد RTDB
```
menu  orders  settings  admins  branches  broadcasts  subscribers  feedback
settings/features   مفاتيح تشغيل المزايا (notifications, notifyNewProducts, notifyDiscounts, pwaInstall)
settings/adminConfigured   يمنع إنشاء owner ثانٍ بعد التهيئة الأولى
settings/payments/{method}/scope   both|inside|outside — لمين تظهر بوابة الدفع
settings/payments/requireProof     يطلب سكرين التحويل من العميل (order.paymentProof = data URL)
settings/features/workerHeartbeat  نبضة وركر بايثون؛ لو أقدم من 90 ثانية اللوحة هي اللي ترد على أزرار البوت
orderProofs/{orderId}   سكرين التحويل (قراءة/كتابة للأدمن؛ العميل يكتبه مرة واحدة) — `orders/{id}/hasProof` علم فقط
backups/log   سجل عمليات النسخ الاحتياطي (للمالك)
menu/../imageFit + banners[].fit + logoFit   {scale,x,y} تكبير/تحريك الصورة داخل الفريم
menu/homeBackground + homeBgHasLogo   خلفية الصفحة الرئيسية (لو فيها اللوجو بنخفي لوجو الصفحة)
settings/telegram/botUsername + settings/features/telegramBot   يوزر البوت (العام) للينك ربط العملاء
subscribers/{id}/telegramChatId   العميل ربط تليجرامه — الإشعارات بتوصله كرسائل من البوت
admins/{uid}   role: owner|staff  +  permissions.{menu,branches,orders,settings,...}  +  branchId ('' = كل الفروع؛ لو محدد يشوف/يعدّل طلبات فرعه فقط — القواعد تمنع تعديل طلب فرع آخر)
branches/{id}  name, address, governorateId, phone, mapUrl, image (data URL ≤700KB), enabled, order — تظهر للعميل في "فروعنا" بالرئيسية
orders/{id}/branchId + branchName   الفرع وقت الطلب (فلتر الفرع في قسم الطلبات)
```

## Cloud Functions — `functions/index.js`
`onBroadcastCreated` · `onOrderCreated` · `onOrderStatusChanged` (تدفع FCM/تليجرام) · `cleanupSubscribers` (كل 24 ساعة، `europe-west1`).

## قواعد عند التعديل
1. أي عقدة أو حقل جديد في RTDB يحتاج قاعدة مقابلة في `firebase-rules.json` (القواعد تتحقق من `admins/{uid}/role === 'owner'` أو `permissions/{section} === true`).
2. أي مِزة جديدة تُضاف إلى `DEFAULT_FEATURES` في `js/defaults.js` **و** إلى `renderFeatures` في `dashboard/js/settings.js`.
3. الواجهة عربية RTL؛ الحقول الإنجليزية تُملأ عبر `translate.js`.
4. عند تغيير ملفات مكشوفة للعميل: راجع `sw.js` (صغير، بلا نسخ كاش معقّدة).
5. **أي بيانات من المستخدم تُعرض في HTML يجب أن تمر على `esc()`** من `js/escape.js`، وأي رابط/صورة على `safeUrl()`. ممنوع `${...}` خام داخل قالب HTML.
6. **ممنوع `onclick=`/`onload=`/`onerror=` داخل HTML** — الـ CSP في `firebase.json` تمنع أي سكربت مضمَّن؛ استخدم `addEventListener`.
7. عند إضافة نطاق خارجي جديد (CDN/API): حدّث `Content-Security-Policy` في `firebase.json` وإلا سيُحجب.
8. صور التحويل تُخزَّن في `orderProofs/{orderId}` (قراءة للأدمن فقط) وليس داخل الطلب — الطلب نفسه مقروء برقمه للتتبّع.
9. `subscribers/{id}`: الحقول العامة قابلة للكتابة بدون تسجيل دخول، أما `telegramChatId` فللأدمن فقط؛ العميل يقرأ العلم `linked` فقط.
10. مقايضات مقبولة ومعروفة: توكن تليجرام مقروء لأي أدمن (بما فيهم staff بصلاحية orders)، والإجمالي يُتحقق منه حسابياً فقط (`total == subtotal + deliveryFee`) بدون مطابقة أسعار المنيو.

للقرارات المنتجية وخطوات Firebase Console المعلّقة: راجع ذاكرة `daily-bake-ordering-platform` العامة.

11. **`snapshot.forEach` في Firebase يوقف اللفة إذا أعادت الدالة قيمة truthy** — اكتب `snap.forEach(c => { list.push(...); })` بالأقواس دائماً؛ الصيغة المختصرة `c => list.push(...)` تُرجع طول المصفوفة فتقف عند أول عنصر (كانت سبب "إجمالي الطلبات 1" واختفاء الفروع الجديدة).

## ملاحظات تشغيلية (2026-09-14)
- **مفاتيح الصلاحيات** في `admins/{uid}/permissions` بالشرطة السفلية (`settings_identity`…) — النقطة ممنوعة كاسم حقل في RTDB. `can()` تقبل الشكلين، وحفظ الأدمن يضبط `settings: true` تلقائياً لأن القواعد تفحصه.
- **الأقسام لازم يكون لها `id`** (رقمي). `saveMenu` و`applyData` يعطيان id تلقائياً لأي قسم قديم بدونه — بدونه تتعطل التبويبات والقائمة الجانبية.
- **إنشاء الطلب مفتوح لأي حالة تسجيل** (زائر أو أدمن) — التحقق من البيانات يبقى. تحديث الطلب للأدمن فقط.
- الموقع لحظي: `onValue('menu')` يحدّث المنيو المفتوح ويزامن أسعار العربة (`syncCartPrices`)، و`onValue('settings/features')` يخفي/يظهر الإشعارات فوراً.
- CSP: واجهة العملاء بدون `unsafe-eval`؛ `/dashboard/**` تسمح بها لأداة إزالة الخلفية (onnxruntime) — أي نطاق جديد يُضاف في `firebase.json`.
- **مسح حساب من Firebase Auth وإعادة إنشائه يعطيه UID جديداً** — سجل `admins/{uid}` القديم يصبح يتيماً والقواعد ترفض القراءة (401). المالك الحالي `selahelazhary4@gmail.com` = uid `aRkIBkBJu4czCKma0rlvbzRVyf12`. للاستعادة الذاتية: `settings/ownerEmail` (يقرؤه فقط الحساب المطابق) + قاعدة تسمح لحساب بإيميل **متأكَّد** مطابق أن يكتب سجل owner لنفسه (`recoverOwner` في `dashboard/js/auth.js`، زر "استعادة حساب المالك" في شاشة "لا توجد صلاحية").
- `readViaRest` في `auth.js`: 401/403 = "غير مضاف" (null)، أما أخطاء الشبكة فترمي استثناءً → `getAdminProfile` يرجّع `undefined` → شاشة "تعذر الوصول" بدل "لا توجد صلاحية".
- حساب الوركر `mesbahclaude@gmail.com` (بوت تليجرام والإشعارات) حُذف من Auth في 2026-09-14 — يجب إعادة إنشائه من قسم الأدمنز (staff: orders+menu) وتحديث `push-worker/config.json` (محلي) وإلا يقف البوت.
- شريط الفلاتر الموحّد: `dashboard/js/filters.js` (`filterBarHtml`/`wireFilterBar`/`inDateRange`/`matchesText`). عرّف `flt` قبل أي `onValue` لأن الكاش يستدعي `paint()` فوراً.


## الأداء (2026-09-14) — لا تتراجع عنه
- **ممنوع تخزين صور base64 داخل `menu`**. كانت العقدة 1.7MB وكان الموقع ينزّلها **مرتين**
  (REST في `loadMenuFromFirebase` + WebSocket في `onValue`) قبل عرض أي شيء. بعد الفصل: **1.2KB**.
- `assets/logo.png` كان 783KB (أكبر ملف في الموقع ويُحمَّل أولاً). بعد التصغير والتكميم: **17.7KB**.
  الخلفية `home-bg-bread.webp` 83KB بدل 182KB.
- `index.html` يعمل `preload` للّوجو والخلفية بـ `fetchpriority="high"`، و`css/style.css` يحمل
  نسخة LQIP مموّهة (~330 بايت inline) فالشاشة تتلوّن فوراً بدل الوميض.
- حاويات الصور لها `aspect-ratio` ثابت ⇒ انزياح التخطيط (CLS) = صفر.
- `assets/**` عليها `Cache-Control: immutable` لسنة.

## الأمان — راجع `SECURITY.md`
- **فحص الجهاز يفشل مغلقاً**: `bindOrVerifyDevice` يجرّب SDK ثم REST، ولو فشل الاثنان يمنع الدخول
  (`renderDeviceUnverified`). قبل ذلك كان يسمح بالدخول عند أي خطأ قراءة فكان الربط بلا معنى.
- نقل المالك لحسابه لجهاز جديد يشترط `email_verified` — والشرط مطبَّق في **القواعد** لا الواجهة فقط.
- قيود منع الإغراق في القواعد: `createdAt`/`at` لازم تكون وقت الآن، وحدود أطوال على كل حقل يكتبه زائر.
- `ensureGuest()` في `firebase-config.js` تسجّل دخول مجهول **في صفحة العميل فقط** (لو نادتها اللوحة
  ستستبدل جلسة الأدمن). تعمل بلا ضرر إذا كانت الميزة مقفولة في الكونسول.
- `js/appcheck.js` جاهز؛ ينقصه `RECAPTCHA_SITE_KEY` من الكونسول.

## لوحة التحكم — الإقلاع (2026-09-14، الحل النهائي)
- **حارس الإقلاع يقيس التوقّف لا الوقت الكلي.** `boot-guard.js` كان يعرض
  "اللوحة مش راضية تفتح" بعد ١٤ ثانية ثابتة، بينما `getAdminProfile` وحدها لها مهلة ٢٠ ثانية —
  فكانت الرسالة تظهر والإقلاع سليم. الآن `bootProgress(stage)` تُستدعى عند كل خطوة وتصفّر
  المؤقّت، والحارس يستسلم فقط بعد ١١ ثانية **بدون أي تقدّم** (أو ٤٥ ثانية إجمالاً).
- اسم الخطوة يظهر تحت اللوجو أثناء التحميل وفي شاشة الفشل ("وقفت عند: …").
- شاشة الفشل فيها **"سجّل خروج وادخل من جديد"**، ولو ظهرت مرتين متتاليتين
  (`dash_fail_count` في sessionStorage) تنفّذ ذلك تلقائياً — فلا يعلق المستخدم في حلقة.
- **`Cache-Control` على عناوين الصفحات**: `cleanUrls` يجعل `/` و`/dashboard/` بلا امتداد
  فلا تطابقها قاعدة `**/*.html` وكانت تأخذ `max-age=3600` الافتراضي — أي أن أي نشر لا يصل
  للمستخدم لمدة ساعة. أُضيفت قواعد صريحة: `/` → `no-cache`، `/dashboard/` → `no-store`.
- App Check مقفول عمداً (`APPCHECK_ENABLED=false`) — تفاصيل السبب في `SECURITY.md`.

## حذف البيانات (قسم "نسخة احتياطية" داخل مجموعة الإدارة)
- `WIPE_PARTS` في `dashboard/js/backup.js`. ثلاث بوابات معاً لتفعيل الزر: اختيار جزء +
  إقرار بالنسخة الاحتياطية + كتابة عبارة `احذف البيانات` حرفياً.
- **`PROTECTED`** (`admins`, `settings/adminConfigured`, `settings/ownerEmail`) لا تُمسح أبداً —
  مسحها يقفل المالك خارج اللوحة.
- **`perChild: true`** لأن قواعد الأمان تمنح الكتابة على الأبناء (`$id`) لا على العقدة نفسها؛
  مسح `/orders` ككل يسقط إلى `.write: false` في الجذر ويُرفض. المسح يتم عبر
  `update(ref(node), {id1: null, id2: null})` في دفعات ١٥٠.
- `ratings` عمقها مستويان (`$pid/$rater`) ⇒ `deep: true`.
- أُضيف للقواعد: الأدمن يستطيع **حذف** تقييم (`!newData.exists()`) لكن لا يستطيع تزويره —
  بدون ذلك كان مسح التقييمات يُرفض.
- `orders` يمسح معه `orderProofs`، و`menu` يمسح معه `assets` (حقل `also`).

## أخطاء متكرّرة اتصلحت (2026-09-15)
- **فايربيز يحذف المصفوفات والكائنات الفاضية.** قسم بلا منتجات يرجع بلا حقل `products` أصلاً،
  وكان `DATA.categories[0].products[0]` يرمي استثناء **فيترك صفحة العميل فاضية تماماً**.
  `applyData` الآن تُطبّع: تملأ `products: []` وتزيل العناصر الفارغة. أي كود جديد يقرأ
  `c.products` يجب أن يستعمل `(c.products || [])`.
- **`node --check file.js` لا يكفي لملفات ES modules** — مرّت عليه `});` ناقصة قوس ووصلت للإنتاج.
  الفحص الصحيح: انسخ الملف إلى `.mjs` ثم `node --check`. طبّقه على كل ملف قبل أي نشر.
- **أزرار الحفظ تُقفل أثناء الحفظ** (`guardSave` في `menuEditor.js`): الحفظ يستغرق ثوانٍ
  (ترجمة + رفع صورة + كتابة) وكان الزر يبقى نشطاً ⇒ ثلاث ضغطات = ثلاث نسخ من المنتج.
  ويعرض الخطأ عند الفشل بدل الصمت الذي بدا كأن الحفظ "لا يعمل".
- **`render()` لا تعيد البناء إذا كان الناتج مطابقاً**، وأنيميشن الدخول يعمل فقط عند تغيير
  الصفحة (رئيسية ↔ منيو). كانت تُستدعى ٤ مرات أثناء التحميل (بيانات/تقييمات/مزايا/منيو)
  وكل مرة تعيد تشغيل الأنيميشن ⇒ رعشة واضحة. الآن: صفر إعادة بناء أثناء الخمول.
- **ترتيب بالسحب** للأقسام والمنتجات عبر `wireDragSort` (Pointer Events لأن drag&drop
  في HTML لا يعمل باللمس). مقبض السحب `[data-act="drag"]` للأقسام و`[data-act="pdrag"]` للمنتجات.

## App Check — ملغي (2026-09-15)
اتشال من الكود بالكامل بعد ما عطّل لوحة التحكم مرتين: المفتاح v3 كلاسيكي والتسجيل في
الكونسول Enterprise ⇒ `403 App attestation failed`، والمكتبة بتخزّن الفشل في IndexedDB
٢٤ ساعة وفايربيز بيرفض الاتصال بالقاعدة بسببها. `js/firebase-config.js` فيها تنضيف
لمرة واحدة بيمسح `firebase-app-check-database` من متصفح أي مستخدم.
**درس:** أي طبقة بتتوسّط اتصال فايربيز تتجرّب على صفحة العميل الأول، ولازم يكون في
مفتاح إيقاف فوري من غير نشر.

## حارس الإقلاع — تصحيح ثانٍ (2026-09-15)
الحارس القائم على "التوقّف" كان لسه بيعطي إنذاراً كاذباً: بين تحميل `boot-guard.js`
وأول `bootProgress` داخل `boot()` **لا تُسجَّل أي خطوة** — والفترة دي هي تحميل ~١٥ وحدة
+ مكتبات فايربيز. على اتصال بطيء تتجاوز ١١ ثانية ⇒ تظهر "اللوحة مش راضية تفتح"
والتحميل سليم تماماً.
**الحل:** `networkProgressing()` تقارن عدد `performance.getEntriesByType('resource')`؛
أي ملف جديد يصل = تقدّم ويصفّر المؤقّت. السقف المطلق `HARD_MS` (٤٥ ثانية) يبقى شبكة أمان.

**وسبب مساعد:** `/dashboard/**` كانت `no-store` ⇒ إعادة تنزيل كل الملفات (٤٩ ملفاً) في
كل فتحة. صارت `no-cache, must-revalidate`: نفس ضمان الحداثة، لكن المتصفح يستقبل 304
بدل إعادة التنزيل.
**قاعدة:** لا تستعمل `no-store` لملفات التطبيق؛ `no-cache` كافية للحداثة وأسرع بكثير.

## ربط الجهاز — صار اختيارياً ومقفولاً افتراضياً (2026-09-15، بطلب المالك)
`settings/features/deviceBinding` (مفتاح في "الإشعارات والتطبيق"). `bindOrVerifyDevice`
ترجع `{ok:true, disabled:true}` فوراً إذا كان مقفولاً، وتعتبره مقفولاً أيضاً إذا فشلت قراءة
المفتاح — حتى لا يقفل عطل شبكة أحداً خارج لوحته.
**السبب:** معرّف الجهاز يُخزَّن في `localStorage`، وأي مسح لبيانات الموقع يغيّره ⇒ صاحب
الحساب يُمنع من نفس الجهاز الذي يعمل عليه. تكرّر ذلك مراراً.
**ما يبقى من الحماية:** الإيميل/الباسورد + قواعد RTDB (هي الطبقة الحقيقية) + الهيدرز.

## تحميل اللوحة — `modulepreload` (2026-09-15)
`dashboard/index.html` فيه `modulepreload` لكل شجرة الوحدات (٢٨) + ٣ من مكتبة فايربيز،
لأن الاستيراد كان يتم على **٣ موجات متتابعة** (app.js ثم وارداته ثم وارداتها) — على اتصال
بطيء تتجاوز مهلة الحارس. النتيجة: زمن تحميل الجافاسكربت 1485ms → 469ms.
**تحذير:** روابط `modulepreload` يجب أن تطابق مسار الاستيراد **حرفياً** (بدون `?v=`)،
وإلا نزّل المتصفح كل ملف مرتين (ظهر كـ ٥٨ ملفاً بدل ٣١).
