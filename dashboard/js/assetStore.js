/* رفع صور اللوحة إلى عقدة assets بدل ما تتحط جوّه المنيو.
   الـ id بصمة المحتوى، فرفع نفس الصورة مرتين ما بيكرّرهاش، وصفحة العميل
   بتقدر تخزّنها في كاش المتصفح للأبد من غير إعادة تحقق. */
import { db, ref, set, get } from '../../js/firebase-config.js';
import { isAssetRef } from '../../js/assets.js';
import { fitDataUrl, MAX_IMAGE_CHARS } from '../../js/imageUtils.js';

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* بتاخد قيمة حقل صورة وبترجّع القيمة اللي تتخزّن في المنيو:
   - إشارة أصل أو رابط عادي → زي ما هي
   - data URL → بترفعها لعقدة assets وبترجّع "a:<id>" */
export async function publishImage(value) {
  let v = String(value || '');
  if (!v || !v.startsWith('data:')) return v;

  /* حاجز أخير: قاعدة assets بترفض أي نص > 900,000 حرف وبترد PERMISSION_DENIED،
     فالرسالة اللي كانت بتوصل للمستخدم "مفيش صلاحية للحفظ" والسبب الحجم.
     أي صورة جاية من مسار قديم (أو محفوظة قبل الإصلاح) بتتصغّر هنا قبل الكتابة. */
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

  return 'a:' + id;
}

/* نفس الحاجة لمجموعة صور مرة واحدة */
export async function publishImages(values) {
  return Promise.all((values || []).map(publishImage));
}

export { isAssetRef };
