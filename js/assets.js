/* مخزن صور منفصل عن عقدة المنيو.
   ------------------------------------------------------------------
   المشكلة اللي بيحلّها: الصور كانت متخزّنة base64 جوّه `menu` نفسها، فعقدة
   المنيو وصلت 1.7 ميجا، والموقع كان بينزّلها كاملة مرتين (REST + WebSocket)
   قبل ما يعرض أي حاجة — حتى صور أقسام العميل عمره ما فتحها.

   الحل: الصورة بتتخزّن في `assets/{id}` والمنيو بيحمل إشارة `a:{id}` بس.
   - عقدة المنيو بقت ~20KB → الصفحة بتظهر فوراً.
   - كل صورة بتتحمّل لوحدها وقت ما تقرب من الشاشة (IntersectionObserver).
   - الـ id هو بصمة المحتوى (hash)، يعني الصورة الواحدة عمرها ما تتحمّل مرتين
     وتقدر تتخزّن في كاش المتصفح للأبد من غير إعادة تحقق. */

import { db } from './firebase-config.js';

const PREFIX = 'a:';
const DRIVE_PREFIX = 'g:';
const CACHE_NAME = 'dailybake-assets-v1';
const MEM = new Map();       // id -> data URL
const INFLIGHT = new Map();  // id -> Promise
/* بكسل شفاف — بيشغل مكان الصورة لحد ما تتحمّل فمفيش قفزة في التخطيط */
export const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* الموقع مش دايماً على جذر النطاق: GitHub Pages بينشره تحت `/backer/`،
   واللوحة شغالة تحت `/dashboard/`. فالمسار المخزّن في القاعدة (`assets/x.webp`
   أو `/assets/x.webp`) لازم يتحل على **جذر الموقع** — لا على مسار الصفحة
   الحالية (يبقى /dashboard/assets/…) ولا على جذر النطاق (يبقى /assets/… بره /backer/). */
const SITE_BASE = new URL(
  location.pathname.replace(/\/dashboard(\/.*)?$/, '/').replace(/[^/]*$/, ''),
  location.origin
).href;

export function siteUrl(v) {
  const s = String(v == null ? '' : v);
  if (!s || /^(https?:|data:|blob:)/i.test(s)) return s;
  try { return new URL(s.replace(/^\/+/, ''), SITE_BASE).href; } catch (e) { return s; }
}

export function isAssetRef(v) {
  return typeof v === 'string' && (v.startsWith(PREFIX) || v.startsWith(DRIVE_PREFIX));
}
export function assetId(v) { return String(v).slice(PREFIX.length); }

/* إشارة صورة على جوجل درايف: `g:<معرّف الملف>~<هاش المعاينة>`
   الجزء التاني اختياري — معاينة صغيرة مموّهة متخزّنة في القاعدة بتتعرض
   فوراً لحد ما صورة الدرايف توصل، فمافيش مربع فاضي ولا قفزة في التخطيط. */
export function isDriveRef(v) { return typeof v === 'string' && v.startsWith(DRIVE_PREFIX); }

export function parseDriveRef(v) {
  const rest = String(v).slice(DRIVE_PREFIX.length);
  const cut = rest.indexOf('~');
  return cut < 0
    ? { fileId: rest, lqip: '' }
    : { fileId: rest.slice(0, cut), lqip: rest.slice(cut + 1) };
}

const safeId = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '');

/* جوجل بيخدم ملفات الدرايف العامة من عنوانين مختلفين. الأول أسرع لكنه
   بيتخنق أحياناً تحت ضغط، والتاني أبطأ شوية لكنه أثبت — فبنجرّب الاتنين
   بالترتيب قبل ما نستسلم ونسيب المعاينة المموّهة مكانها. */
export function driveUrls(fileId, width = 1000) {
  const id = safeId(fileId);
  return [
    'https://lh3.googleusercontent.com/d/' + id + '=w' + width,
    'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + width,
  ];
}

function restUrl(id) {
  const base = String(db.app.options.databaseURL || '').replace(/\/$/, '');
  return `${base}/assets/${encodeURIComponent(id)}.json`;
}

let cachePromise = null;
function openCache() {
  if (!('caches' in window)) return Promise.resolve(null);
  if (!cachePromise) cachePromise = caches.open(CACHE_NAME).catch(() => null);
  return cachePromise;
}

/* بيرجّع الـ data URL بتاع الصورة — من الذاكرة، وبعدين كاش المتصفح، وآخر حاجة الشبكة */
export async function getAsset(id) {
  if (!id) return null;
  if (MEM.has(id)) return MEM.get(id);
  if (INFLIGHT.has(id)) return INFLIGHT.get(id);

  const job = (async () => {
    const key = `/__asset/${id}`;
    const cache = await openCache();
    if (cache) {
      try {
        const hit = await cache.match(key);
        if (hit) { const v = await hit.text(); if (v) { MEM.set(id, v); return v; } }
      } catch (e) { /* الكاش مش متاح — نكمل على الشبكة */ }
    }
    try {
      const res = await fetch(restUrl(id));
      if (!res.ok) return null;
      const v = await res.json();
      if (typeof v !== 'string' || !v) return null;
      MEM.set(id, v);
      /* المحتوى ثابت (الـ id بصمته) فالتخزين آمن للأبد */
      if (cache) cache.put(key, new Response(v, { headers: { 'content-type': 'text/plain' } })).catch(() => {});
      return v;
    } catch (e) { return null; }
  })();

  INFLIGHT.set(id, job);
  try { return await job; } finally { INFLIGHT.delete(id); }
}

/* بتتحط مكان src داخل قوالب الـ HTML:
   - رابط عادي  → src مباشر
   - إشارة a:id → بكسل فاضي + data-asset عشان يتحمّل وقت ما يقرب من الشاشة */
export function imgSrc(value, fallback = '') {
  if (isDriveRef(value)) {
    const { fileId, lqip } = parseDriveRef(value);
    /* المعاينة (لو موجودة) بتتحمّل من القاعدة الأول، وصورة الدرايف بتحل
       محلها لما تجهز — الاتنين بيتظبطوا في paint() تحت. */
    return `src="${BLANK}" data-drive="${safeId(fileId)}"${lqip ? ` data-asset="${safeId(lqip)}"` : ''}`;
  }
  if (isAssetRef(value)) return `src="${BLANK}" data-asset="${safeId(assetId(value))}"`;
  const v = siteUrl(value || fallback || '');
  return v ? `src="${String(v).replace(/"/g, '&quot;')}"` : `src="${BLANK}"`;
}

/* نفس الفكرة لخلفية CSS (بانرات/خلفية الصفحة) */
export function bgRef(value) {
  if (isDriveRef(value)) {
    const { fileId, lqip } = parseDriveRef(value);
    return ` data-drive-bg="${safeId(fileId)}"${lqip ? ` data-asset-bg="${safeId(lqip)}"` : ''}`;
  }
  return isAssetRef(value) ? ` data-asset-bg="${safeId(assetId(value))}"` : '';
}

const MARGIN = 600;   // بنبدأ التحميل قبل ما الصورة توصل الشاشة بالمسافة دي

/* أي عنصر لسه مستني صورة — من القاعدة أو من الدرايف، صورة كانت أو خلفية */
const SELECTOR = ['data-asset', 'data-asset-bg', 'data-drive', 'data-drive-bg']
  .map(a => `[${a}]:not([data-asset-done])`).join(',');

function near(el) {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return true;     // عنصر مخفي/بدون مقاس — حمّله على طول
  return r.top < window.innerHeight + MARGIN && r.bottom > -MARGIN;
}

let io = null;
function observer() {
  if (io !== null) return io;
  if (!('IntersectionObserver' in window)) { io = false; return io; }
  io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      paint(e.target);
    });
  }, { rootMargin: MARGIN + 'px 0px' });
  return io;
}

/* شبكة أمان: في بعض الحالات (تبويب مخفي، متصفح قديم، صفحة مُسبقة التحميل)
   الـ IntersectionObserver مابيشتغلش خالص — فبنفحص بنفسنا كمان عند التمرير. */
let sweepQueued = false;
function sweep() {
  if (sweepQueued) return;
  sweepQueued = true;
  requestAnimationFrame(() => {
    sweepQueued = false;
    document.querySelectorAll(SELECTOR)
      .forEach((el) => { if (near(el)) paint(el); });
  });
}

let sweepBound = false;
function bindSweep() {
  if (sweepBound) return;
  sweepBound = true;
  addEventListener('scroll', sweep, { passive: true });
  addEventListener('resize', sweep, { passive: true });
}

/* بنجرّب عناوين الدرايف بالترتيب وبنفتكر اللي اشتغل، فباقي صور نفس الصفحة
   تروح على العنوان الصح من أول مرة بدل ما كل واحدة تجرّب من الأول. */
let drivePick = 0;
const DRIVE_OK = new Map();   // fileId -> عنوان شغال

function firstWorking(urls) {
  return new Promise((resolve) => {
    let i = drivePick;
    let tried = 0;
    const attempt = () => {
      if (tried++ >= urls.length) return resolve('');
      const url = urls[i % urls.length];
      const probe = new Image();
      probe.onload = () => { drivePick = i % urls.length; resolve(url); };
      probe.onerror = () => { i++; attempt(); };
      probe.src = url;
    };
    attempt();
  });
}

async function paint(el) {
  if (el.dataset.assetDone) return;
  const lqipId = el.dataset.asset || el.dataset.assetBg;
  const fileId = el.dataset.drive || el.dataset.driveBg;
  if (!lqipId && !fileId) return;
  el.dataset.assetDone = '1';

  const isBg = !!(el.dataset.assetBg || el.dataset.driveBg);
  const show = (url) => {
    if (isBg) el.style.backgroundImage = `url('${url}')`;
    else el.src = url;
  };

  /* المعاينة الصغيرة الأول — بتوصل في أقل من عُشر ثانية وبتمنع المربع الفاضي */
  if (lqipId) {
    const small = await getAsset(lqipId);
    if (small) { show(small); if (fileId) el.classList.add('is-lqip'); }
  }
  if (!fileId) return;

  const cached = DRIVE_OK.get(fileId);
  const url = cached || await firstWorking(driveUrls(fileId));
  /* الدرايف مش راد؟ المعاينة المموّهة بتفضل مكانها — الصفحة ماتبانش مكسورة */
  if (!url) return;
  DRIVE_OK.set(fileId, url);
  show(url);
  el.classList.remove('is-lqip');
}

/* بتتنادى بعد أي render — بتربط كل الصور الجديدة.
   اللي قريّب من الشاشة بيتحمّل فوراً، والباقي بيستنى التمرير. */
export function wireAssets(root) {
  if (!root || !root.querySelectorAll) return;
  bindSweep();
  const ob = observer();
  root.querySelectorAll(SELECTOR)
    .forEach((el) => {
      if (near(el)) { paint(el); return; }
      if (ob) ob.observe(el); else paint(el);
    });
}

/* تحميل مبكر لصور مهمة (أول بانر مثلاً) من غير انتظار التمرير */
export function preloadAssets(values) {
  (values || []).forEach((v) => {
    if (isDriveRef(v)) {
      const { fileId, lqip } = parseDriveRef(v);
      if (lqip) getAsset(lqip);
      if (fileId) firstWorking(driveUrls(fileId)).then((u) => { if (u) DRIVE_OK.set(fileId, u); });
      return;
    }
    if (isAssetRef(v)) getAsset(assetId(v));
  });
}
