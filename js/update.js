/* وصول التحديث للزائر.
   ==================================================================
   المشكلة اللي بيحلّها:
   الـ service worker كان بيتسجّل وخلاص، من غير أي متابعة. اللي بيحصل بعد
   أي نشر:
     ١) الزائر يفتح الموقع → الـSW القديم بيقدّمله الصفحة القديمة من الكاش.
     ٢) المتصفح يلاقي sw.js اتغيّر → ينزّل الجديد → skipWaiting → يمسك الصفحة.
     ٣) لكن الصفحة **كانت خلاص حمّلت الكود القديم** — فالزائر شايف القديم،
        ولازم يفتح الموقع **مرة تانية** عشان يشوف الجديد.
   وأسوأ حالة: تطبيق مثبّت على الموبايل مابيتقفلش — مافيش "فتحة جديدة"
   أصلاً، فيفضل على نسخة قديمة أيام.

   الهيدرز كانت سليمة من الأول (`no-cache` على js/css/html) — المشكلة
   مكانتش في الكاش نفسه، كانت إن مفيش حد بيتابع.

   الحل تلات حاجات:
     • `updateViaCache:'none'` — ملف sw.js نفسه عمره ما يتقرا من كاش المتصفح.
     • سؤال عن تحديث عند الفتح، وكل ما التطبيق يرجع قدّام، وكل ربع ساعة.
     • أول ما نسخة جديدة تمسك الصفحة: ريفرش **مرة واحدة** — بس بشرط الزائر
       ما يكونش في نص حاجة (نافذة مفتوحة أو بيكتب في الشيك أوت)، وساعتها
       بنوريه شريط صغير يضغطه لما يخلّص. حد في نص طلب ماينفعش الصفحة تعيد
       تحميل نفسها تحت إيده. */

import { siteUrl } from './assets.js';

const RELOAD_FLAG = 'db_reloaded_for_update';
const CHECK_EVERY_MS = 15 * 60 * 1000;

let registration = null;
let bannerEl = null;

/* الصفحة «مشغولة» لو في نافذة مفتوحة أو الزائر كاتب حاجة */
function pageIsBusy() {
  if (document.querySelector('.ex-eg-modal-overlay, .ex-eg-search-overlay, .ex-eg-drawer-overlay')) return true;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value) return true;
  return false;
}

function showBanner() {
  if (bannerEl) return;
  const ar = document.documentElement.lang !== 'en';
  bannerEl = document.createElement('div');
  bannerEl.className = 'ex-eg-update-bar';
  bannerEl.innerHTML = `<span>${ar ? 'في نسخة جديدة من الموقع' : 'A new version is available'}</span>
    <button type="button">${ar ? 'حدّث دلوقتي' : 'Refresh'}</button>`;
  bannerEl.querySelector('button').addEventListener('click', () => doReload());
  document.body.appendChild(bannerEl);
}

function doReload() {
  try { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); } catch (e) { /* تصفّح خاص */ }
  location.reload();
}

/* حارس ضد حلقة ريفرش لا تنتهي لو حصلت لخبطة في الـSW.
   بالوقت مش بعلامة دائمة: لو منعنا الريفرش للأبد بعد أول مرة، أي نشرة
   تانية في نفس الجلسة مكانتش هتوصل. دقيقة كفاية تكسر أي حلقة. */
function reloadedJustNow() {
  try { return Date.now() - Number(sessionStorage.getItem(RELOAD_FLAG) || 0) < 60000; }
  catch (e) { return false; }
}

function onNewVersionActive() {
  if (reloadedJustNow()) return;
  if (pageIsBusy()) { showBanner(); return; }
  doReload();
}

export async function setupUpdates() {
  if (!('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  } catch (e) { return; }

  /* أول ما نسخة جديدة تمسك الصفحة */
  navigator.serviceWorker.addEventListener('controllerchange', onNewVersionActive);

  /* لو في نسخة مستنية من زيارة سابقة، خلّيها تمسك دلوقتي */
  if (registration.waiting && navigator.serviceWorker.controller) {
    try { registration.waiting.postMessage({ type: 'skip-waiting' }); } catch (e) { /* ignore */ }
  }

  const check = () => { try { registration.update(); } catch (e) { /* ignore */ } };
  check();
  /* التطبيق المثبّت بيفضل مفتوح أيام — فبنسأل كل ما يرجع قدّام */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
  setInterval(check, CHECK_EVERY_MS);
}

/* ---------- فحص نسخة من غير service worker — للوحة التحكم ----------
   اللوحة مالهاش SW خالص. بعض الشبكات والوسطاء بيتجاهلوا `no-cache`،
   فبنسأل ملف صغير بـ`no-store` ونقارنه بالرقم المحقون في الصفحة وقت النشر. */
export function currentBuild() {
  const m = document.querySelector('meta[name="app-build"]');
  return (m && m.content) || null;
}

export function watchBuild({ onStale } = {}) {
  const current = currentBuild();
  if (!current) return;                   // تشغيل محلي من غير نشر — مفيش رقم
  /* المسار لازم يتحل على جذر الموقع: الموقع منشور كمان على GitHub Pages
     تحت `/backer/`، و`/version.json` المطلق كان هيروح لجذر النطاق الغلط. */
  const url = siteUrl('version.json');
  const check = async () => {
    try {
      const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const { build } = await r.json();
      if (build && build !== current) { if (onStale) onStale(build); else showBanner(); }
    } catch (e) { /* الشبكة وقعت — نسأل تاني بعدين */ }
  };
  check();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, CHECK_EVERY_MS);
}
