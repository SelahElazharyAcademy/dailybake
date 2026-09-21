/* عدّاد زيارات الموقع.
   ==================================================================
   بيعدّ حاجتين مختلفتين عن بعض:
     visits/total          إجمالي الزيارات من يوم ما الموقع اشتغل
     visits/days/{اليوم}   زيارات كل يوم — منها بيتحسب "النهارده" و"آخر ٧ أيام"

   الزيارة = **جهاز واحد في اليوم الواحد**، مش كل فتحة للصفحة. لو الزبون
   فتح الموقع خمس مرات النهارده يتحسب واحد. ليه؟ لأن الرقم ده بيتقري في
   اللوحة كـ"كام واحد دخل"، ولو عدّينا كل ريفرش هيبقى رقم متضخّم ومالوش
   معنى — والزبون بيعمل ريفرش كتير وهو بيتصفّح المنيو.

   العلامة متخزّنة في localStorage بمفتاح فيه تاريخ اليوم، والمفاتيح
   القديمة بتتمسح لوحدها فمابنسيبش قمامة على جهاز الزائر.

   ملحوظة أمان مقبولة: الكتابة على العدّاد مفتوحة للزائر (زي إنشاء الطلب
   والتقييم بالظبط) لأنه مفيش تسجيل دخول للعملاء. القواعد بتسمح بـ**زيادة
   واحد بس** ومابتسمحش بأي قيمة تانية — فأسوأ حاجة ممكن تحصل إن حد يكرّر
   الطلب ويضخّم رقم إحصائي، مش إنه يقرا أو يغيّر بيانات. */

import { db, ref, increment, update } from './firebase-config.js';

const PREFIX = 'db_visit_';

/* تاريخ اليوم بتوقيت الجهاز بصيغة YYYY-MM-DD.
   بنبنيه بالإيد مش بـtoISOString لأن الأخيرة بتحوّل لـUTC — فزيارة الساعة
   ٢ بالليل في مصر كانت هتتحسب على اليوم اللي فات. */
function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* اتعدّت النهارده على الجهاز ده؟ (وبنشيل علامات الأيام اللي فاتت) */
function countedToday() {
  const key = PREFIX + dayKey();
  try {
    if (localStorage.getItem(key)) return true;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== key) localStorage.removeItem(k);
    }
    return false;
  } catch (e) {
    /* تصفّح خاص أو تخزين مقفول — نعدّ ونكمّل */
    return false;
  }
}

function markToday() {
  try { localStorage.setItem(PREFIX + dayKey(), '1'); } catch (e) { /* لا شيء */ }
}

/* بتتنادى مرة واحدة عند إقلاع صفحة العميل.
   بتفشل في صمت: عدّاد إحصائي عمره ما يعطّل الموقع لو القواعد مارفعتش
   أو النت وقع.

   ترتيب مقصود: **العلامة بتتحط بعد ما الكتابة تنجح**، مش قبلها. لو حطيناها
   الأول وفشلت الكتابة (قواعد لسه مانشرتش، نت وقع) الزيارة كانت بتضيع
   والجهاز مش هيحاول تاني النهارده خالص.
   وعشان مانعيدش المحاولة مع كل فتحة صفحة في نفس الجلسة، فيه علامة جلسة
   منفصلة — يعني محاولة واحدة بالكتير في الجلسة. */
const SESSION_FLAG = 'db_visit_tried';

export function countVisit() {
  if (countedToday()) return;
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) return;
    sessionStorage.setItem(SESSION_FLAG, '1');
  } catch (e) { /* لا شيء */ }

  /* تحديث واحد للاتنين مع بعض — طلب شبكة واحد بدل اتنين */
  update(ref(db), {
    'visits/total': increment(1),
    [`visits/days/${dayKey()}`]: increment(1),
  }).then(markToday).catch(() => { /* هنحاول تاني في جلسة جاية */ });
}

/* بتلخّص عقدة visits لأرقام جاهزة للعرض في اللوحة */
export function summarize(node) {
  const days = (node && node.days) || {};
  const today = Number(days[dayKey()] || 0);

  let week = 0;
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    const n = Number(days[k] || 0);
    week += n;
    last7.push({ day: k, count: n });
  }

  const month = Object.entries(days).reduce((sum, [k, v]) => {
    return k.startsWith(dayKey().slice(0, 7)) ? sum + Number(v || 0) : sum;
  }, 0);

  return { today, week, month, total: Number((node && node.total) || 0), last7 };
}
