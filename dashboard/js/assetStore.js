/* أين تُخزَّن صورة رفعها المالك — وليه.
   ==================================================================
   قبل كده: كل صورة كانت بتتحط base64 جوّه عقدة `assets` في فايربيز.
   ده اشتغل وإحنا صور قليلة، لكن فيه سقفين بيقربوا بسرعة:
     • ١ جيجا تخزين للقاعدة كلها
     • ١٠ جيجا تحميل في الشهر — وده الخطر الحقيقي: ١٠ ميجا صور × ألف زائر
       = عشر جيجا، يعني الموقع يقف في نص الشهر.

   دلوقتي القسمة كالتالي:
     صورة صغيرة (أقل من الحد)  → تفضل في القاعدة   `a:<هاش>`
     صورة كبيرة                → تروح جوجل درايف   `g:<معرّف>~<هاش معاينة>`

   ليه الجزء التاني من إشارة الدرايف؟ معاينة صغيرة جداً (٤٠ بكسل، بضعة
   كيلوبايت) بتفضل في القاعدة. صفحة العميل بتعرضها فوراً مموّهة لحد ما
   صورة الدرايف توصل. لو الدرايف اتأخّر أو وقع، الزبون بيشوف صورة مموّهة
   مش مربع فاضي — وده الفرق بين "الموقع بطيء" و"الموقع مكسور".

   ولو الدرايف مش مربوط خالص؟ بنرجع للسلوك القديم بالظبط. مفيش صورة
   بتضيع بسبب إعداد ناقص. */

import { db, ref, set, get } from '../../js/firebase-config.js';
import { isAssetRef } from '../../js/assets.js';
import { fitDataUrl, MAX_IMAGE_CHARS } from '../../js/imageUtils.js';
import * as drive from '../../js/drive.js';

/* الحد الافتراضي: ٣٠ ك.ب. أصغر من كده يستاهل يفضل في القاعدة (طلب واحد،
   بلا اعتماد على خدمة بره)، وأكبر من كده مايستاهلش من حصة التحميل. */
const DEFAULT_THRESHOLD_KB = 30;
const kbToChars = (kb) => Math.round(kb * 1024 * 4 / 3);

/* حجم المعاينة المموّهة — ٤٠ بكسل كفاية تماماً لأنها بتتعرض مكبّرة ومموّهة */
const LQIP_SIDE = 40;
const LQIP_MAX_CHARS = 6000;

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- إعدادات الربط ---------- */
/* معرّف عميل OAuth مش سر — هو معلن بطبيعته في أي تطبيق ويب. بنخزّنه في
   القاعدة بدل الكود عشان المالك يقدر يغيّره من اللوحة من غير إعادة نشر. */
let configPromise = null;

export function loadDriveConfig({ force = false } = {}) {
  if (force) configPromise = null;
  if (configPromise) return configPromise;
  configPromise = (async () => {
    let cfg = {};
    try {
      const snap = await get(ref(db, 'settings/drive'));
      if (snap.exists()) cfg = snap.val() || {};
    } catch (e) { /* مش أدمن أو القراءة اترفضت — بنكمّل بالقاعدة بس */ }
    drive.setClientId(cfg.clientId || '');
    return {
      clientId: cfg.clientId || '',
      enabled: cfg.enabled !== false,
      thresholdKb: Number(cfg.thresholdKb) > 0 ? Number(cfg.thresholdKb) : DEFAULT_THRESHOLD_KB,
      account: cfg.account || '',
    };
  })();
  return configPromise;
}

/* بيشتغل الدرايف دلوقتي فعلاً؟ = متظبّط + مفعّل + الجهاز ده وافق قبل كده.
   شرط "وافق قبل كده" هو اللي بيمنع نافذة جوجل إنها تقفز أثناء الحفظ. */
async function driveReady() {
  const cfg = await loadDriveConfig();
  return !!(cfg.clientId && cfg.enabled && drive.wasGranted());
}

/* ---------- الكتابة في القاعدة ---------- */
/* الـ id بصمة المحتوى، فرفع نفس الصورة مرتين ما بيكرّرهاش، وصفحة العميل
   بتقدر تخزّنها في كاش المتصفح للأبد من غير إعادة تحقق. */
async function storeInDb(dataUrl) {
  let v = dataUrl;
  /* حاجز أخير: قاعدة assets بترفض أي نص > 900,000 حرف وبترد PERMISSION_DENIED،
     فالرسالة اللي كانت بتوصل للمستخدم "مفيش صلاحية للحفظ" والسبب الحجم. */
  if (v.length > MAX_IMAGE_CHARS) {
    v = await fitDataUrl(v, { maxBytes: MAX_IMAGE_CHARS });
    if (v.length > MAX_IMAGE_CHARS) {
      throw new Error('الصورة كبيرة جداً ومعرفناش نصغّرها — جرّب صورة أصغر');
    }
  }
  const id = (await sha1Hex(v)).slice(0, 16);
  const slot = ref(db, `assets/${id}`);
  try {
    const snap = await get(slot);
    if (!snap.exists()) await set(slot, v);
  } catch (e) {
    await set(slot, v);   // القراءة فشلت — نكتب على أي حال
  }
  return id;
}

async function makeLqip(dataUrl) {
  try {
    const small = await fitDataUrl(dataUrl, { maxSide: LQIP_SIDE, quality: 0.6, maxBytes: LQIP_MAX_CHARS });
    if (!small || small.length > LQIP_MAX_CHARS) return '';
    return await storeInDb(small);
  } catch (e) {
    return '';   // من غير معاينة الصورة لسه هتشتغل، بس من غير التدرّج
  }
}

/* ---------- الواجهة المستخدَمة من باقي اللوحة ---------- */
/* بتاخد قيمة حقل صورة وبترجّع القيمة اللي تتخزّن في المنيو:
   - إشارة أصل أو رابط عادي → زي ما هي
   - data URL → بتتخزّن في المكان المناسب وبترجّع الإشارة */
export async function publishImage(value, { onProgress = null } = {}) {
  const v = String(value || '');
  if (!v || !v.startsWith('data:')) return v;

  const cfg = await loadDriveConfig();
  const limit = kbToChars(cfg.thresholdKb);

  if (v.length <= limit) return 'a:' + await storeInDb(v);

  if (await driveReady()) {
    try {
      if (onProgress) onProgress('بنرفع الصورة على درايف...');
      const fileId = await drive.uploadImage(v, { name: 'img-' + Date.now() });
      if (fileId) {
        const lqip = await makeLqip(v);
        return 'g:' + fileId + (lqip ? '~' + lqip : '');
      }
    } catch (e) {
      /* الدرايف رفض (مساحة خلصت، نت وقع، التوكن اتسحب) — مانوقفش الحفظ.
         بنرجع للقاعدة وبنقول للمستخدم إيه اللي حصل. */
      if (onProgress) onProgress('درايف مارديش — حفظنا الصورة في القاعدة: ' + (e.message || ''));
    }
  }

  if (onProgress) onProgress('جاري الحفظ...');
  return 'a:' + await storeInDb(v);
}

/* نفس الحاجة لمجموعة صور مرة واحدة */
export async function publishImages(values) {
  return Promise.all((values || []).map(v => publishImage(v)));
}

export { isAssetRef, drive, DEFAULT_THRESHOLD_KB };
