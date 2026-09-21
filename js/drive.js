/* رفع صور الموقع إلى Google Drive بحساب المحل.
   ==================================================================
   ليه الدرايف أصلاً؟
   قاعدة فايربيز المجانية سقفها ١ جيجا تخزين + ١٠ جيجا تحميل في الشهر،
   والصور هي أتقل حاجة فيها بفارق كبير. الدرايف بيدي ١٥ جيجا على حساب
   جوجل العادي، وبيخدم الصورة من شبكة جوجل نفسها — يعني أسرع من إننا
   ننزّلها base64 من القاعدة زي دلوقتي.

   القاعدة اللي بنمشي عليها (التفاصيل في dashboard/js/assetStore.js):
     صورة صغيرة  → تفضل في القاعدة (`a:<هاش>`) — طلب واحد، بلا اعتماد على بره
     صورة كبيرة  → تروح الدرايف     (`g:<معرّف>~<هاش>`) والقاعدة تحتفظ بمعاينة
                                      صغيرة مموّهة بس، فمافيش لحظة فراغ أبداً

   "تسجيل دخول مرة واحدة" بيشتغل إزاي؟
   بنستخدم Google Identity Services. أول مرة بس بتظهر نافذة اختيار الحساب
   والموافقة (`prompt: 'consent'`). بعد كده بنطلب التوكن بصمت (`prompt: ''`)
   — جوجل بيرجّعه من غير أي نافذة طول ما المستخدم لسه داخل بحسابه في
   المتصفح ده والموافقة متسجّلة على الحساب. فالمالك بيشوف شاشة جوجل مرة
   واحدة في عمر الجهاز، وكل رفع بعدها بيحصل في الخلفية.

   تنبيهات لازم تفضل مظبوطة عشان ده يشتغل:
   - `Cross-Origin-Opener-Policy` لازم يكون `same-origin-allow-popups` مش
     `same-origin`، وإلا نافذة جوجل بتتفتح وتقفل من غير ما ترجّع حاجة.
   - CSP لازم تسمح بـ accounts.google.com في script-src و connect-src.
   - الصلاحية المطلوبة `drive.file` = "الملفات اللي التطبيق ده عملها بس".
     مابتشوفش أي ملف تاني في درايف المالك، وجوجل مابيطلبش مراجعة عليها. */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Daily Bake - صور الموقع';
const LS_GRANTED = 'db_drive_granted';   // اتوافق قبل كده على الجهاز ده؟
const LS_FOLDER = 'db_drive_folder';     // معرّف المجلد، عشان مانسألش كل مرة

let gisPromise = null;
let tokenClient = null;
let token = null;        // { value, expiresAt }
let clientId = '';

/* ---------- تحميل مكتبة جوجل ---------- */
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('تعذّر تحميل مكتبة جوجل — اتأكد من الإنترنت'));
    document.head.appendChild(s);
  }).catch((e) => { gisPromise = null; throw e; });
  return gisPromise;
}

export function setClientId(id) {
  const v = String(id || '').trim();
  if (v !== clientId) { clientId = v; tokenClient = null; token = null; }
}

export function isConfigured() { return !!clientId; }

export function wasGranted() {
  try { return localStorage.getItem(LS_GRANTED) === '1'; } catch (e) { return false; }
}

/* ---------- التوكن ---------- */
/* التوكن بيعيش ساعة. بنجدّده قبل ما يخلص بدقيقة عشان رفع طويل مايقعش في النص. */
function fresh() { return token && token.expiresAt - 60000 > Date.now(); }

async function client() {
  if (tokenClient) return tokenClient;
  if (!clientId) throw new Error('ربط جوجل درايف مش متظبّط — حط معرّف العميل في الإعدادات');
  await loadGis();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    /* بيتبدّلوا قبل كل طلب — GIS مابيدعمش وعود، فبنلفّها بنفسنا */
    callback: () => {},
    error_callback: () => {},
  });
  return tokenClient;
}

/* interactive=false معناها: جرّب بصمت وارجّع null لو محتاج تدخّل المستخدم.
   ده اللي بيخلّي الرفع "في الخلفية" — مافيش نافذة بتقفز في وش المالك. */
export async function getToken({ interactive = false } = {}) {
  if (fresh()) return token.value;
  const tc = await client();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const giveUp = (msg) => finish(interactive ? reject : resolve, interactive ? new Error(msg) : null);

    tc.callback = (res) => {
      if (res && res.access_token) {
        token = { value: res.access_token, expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 };
        try { localStorage.setItem(LS_GRANTED, '1'); } catch (e) { /* تصفح خاص */ }
        finish(resolve, token.value);
      } else {
        giveUp('تسجيل الدخول اتلغى');
      }
    };
    tc.error_callback = (err) => {
      /* الطلب الصامت بيفشل لما المستخدم يكون خارج من جوجل أو الموافقة اتسحبت */
      const type = err && err.type;
      giveUp(type === 'popup_closed' ? 'قفلت نافذة جوجل قبل ما تخلّص'
        : type === 'popup_failed_to_open' ? 'المتصفح منع نافذة جوجل — اسمح بالنوافذ المنبثقة للموقع ده'
        : 'تعذّر الاتصال بجوجل');
    };

    /* المفتاح كله في السطر ده:
       '' = بصمت لو الموافقة موجودة، 'consent' = اسأل المستخدم صراحةً. */
    try {
      tc.requestAccessToken({ prompt: interactive && !wasGranted() ? 'consent' : '' });
    } catch (e) {
      giveUp(e && e.message ? e.message : 'تعذّر الاتصال بجوجل');
    }

    /* شبكة أمان: لو جوجل ماردّش خالص مانعلّقش الرفع للأبد */
    setTimeout(() => giveUp('جوجل ماردّش — جرّب تاني'), interactive ? 120000 : 15000);
  });
}

/* ربط صريح من زر في اللوحة — هنا بس بنسمح للنافذة تظهر */
export async function connect() {
  await getToken({ interactive: true });
  const folder = await ensureFolder({ interactive: true });
  return { folder };
}

export function disconnect() {
  token = null;
  try {
    localStorage.removeItem(LS_GRANTED);
    localStorage.removeItem(LS_FOLDER);
  } catch (e) { /* لا شيء */ }
}

/* ---------- نداء واجهة درايف ---------- */
async function api(url, { method = 'GET', headers = {}, body = null, interactive = false } = {}) {
  const t = await getToken({ interactive });
  if (!t) return null;                       // مش مربوط — المنادي بيتصرّف
  const send = (bearer) => fetch(url, { method, headers: { Authorization: 'Bearer ' + bearer, ...headers }, body });

  let res = await send(t);
  if (res.status === 401) {                  // التوكن باظ — نجدّده ونعيد مرة واحدة
    token = null;
    const t2 = await getToken({ interactive });
    if (!t2) return null;
    res = await send(t2);
  }
  if (!res.ok) throw new Error(await message(res));
  return res.json();
}

async function message(res) {
  try {
    const j = await res.json();
    const m = j && j.error && (j.error.message || j.error);
    if (res.status === 403 && /quota|storage/i.test(String(m))) {
      return 'مساحة الدرايف خلصت — فضّي مساحة أو استخدم حساب تاني';
    }
    return 'درايف رفض الطلب: ' + (m || res.status);
  } catch (e) {
    return 'درايف رفض الطلب (' + res.status + ')';
  }
}

/* ---------- المجلد ---------- */
/* بنسأل الدرايف مرة واحدة بس وبنفتكر المعرّف. `drive.file` بيخلّي البحث
   يشوف الملفات اللي التطبيق ده عملها بس — يعني مفيش خلط مع ملفات المالك. */
export async function ensureFolder({ interactive = false } = {}) {
  let cached = '';
  try { cached = localStorage.getItem(LS_FOLDER) || ''; } catch (e) { /* لا شيء */ }
  if (cached) return cached;

  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.folder' and name='" + FOLDER_NAME.replace(/'/g, "\\'") + "' and trashed=false"
  );
  const found = await api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)&pageSize=1', { interactive });
  if (!found) return '';
  let id = found.files && found.files[0] && found.files[0].id;

  if (!id) {
    const made = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      interactive,
    });
    if (!made) return '';
    id = made.id;
  }
  try { localStorage.setItem(LS_FOLDER, id); } catch (e) { /* لا شيء */ }
  return id;
}

/* ---------- الرفع ---------- */
function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl).split(',');
  const mime = (parts[0].match(/data:([^;]+)/) || [, 'image/jpeg'])[1];
  const bin = atob(parts[1] || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* بيرفع الصورة ويخلّيها متاحة للعامة ويرجّع معرّف الملف.
   بيرجّع null لو الحساب مش مربوط — المنادي وقتها بيرجع لتخزين القاعدة. */
export async function uploadImage(dataUrl, { name = 'image', interactive = false } = {}) {
  const t = await getToken({ interactive });
  if (!t) return null;

  const folder = await ensureFolder({ interactive });
  const blob = dataUrlToBlob(dataUrl);
  const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');

  const meta = { name: name + '.' + ext, mimeType: blob.type };
  if (folder) meta.parents = [folder];

  /* رفع multipart: البيانات الوصفية والملف في طلب واحد — أبسط بكتير من
     resumable وكفاية تماماً للصور (أقل من ٥ ميجا). */
  const boundary = 'db' + Math.random().toString(36).slice(2);
  const body = new Blob([
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n',
    '--' + boundary + '\r\nContent-Type: ' + blob.type + '\r\n\r\n',
    blob,
    '\r\n--' + boundary + '--',
  ], { type: 'multipart/related; boundary=' + boundary });

  const up = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', body, interactive,
  });
  if (!up || !up.id) return null;

  /* من غير الصلاحية دي الصورة تتشاف من المالك بس — الزبون هيلاقي مربع فاضي */
  await api('https://www.googleapis.com/drive/v3/files/' + up.id + '/permissions?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    interactive,
  });

  return up.id;
}

/* حالة الحساب والمساحة — بتتعرض في قسم الإعدادات */
export async function usage() {
  const j = await api('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user');
  if (!j) return null;
  const q = j.storageQuota || {};
  return {
    email: (j.user || {}).emailAddress || '',
    usedBytes: Number(q.usage || 0),
    limitBytes: Number(q.limit || 0),
  };
}
