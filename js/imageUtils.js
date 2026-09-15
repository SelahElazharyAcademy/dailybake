import { esc } from './escape.js';
import { imgSrc, isAssetRef, wireAssets } from './assets.js';
/* Normalises any image link into something an <img> can render.
   Google Drive share links become lh3 direct links. */
export function toDirectImageUrl(url) {
  if (!url) return url;
  const u = url.trim();
  if (u.startsWith('data:') || u.includes('lh3.googleusercontent.com')) return u;

  const m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/)
    || u.match(/drive\.google\.com\/open\?id=([^&]+)/)
    || (u.includes('drive.google.com') ? u.match(/[?&]id=([^&]+)/) : null);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;

  /* دروب بوكس: لينك المشاركة بيفتح صفحة HTML مش الصورة — raw=1 بيدي الملف نفسه */
  if (u.includes('dropbox.com')) return u.replace(/[?&]dl=\d/, '').replace(/\?.*$/, '') + '?raw=1';

  return u;
}

/* Shrinks a picked image in the browser so it can be stored inline — no cloud
   storage, no API keys, nothing to configure. */

/* سقف حجم الصورة المخزّنة.
   قاعدة `assets/$id` في firebase-rules.json بترفض أي نص أطول من 900,000 حرف،
   وفايربيز بيرد على رفض الـ validate بنفس كود PERMISSION_DENIED — فالمستخدم
   كان بيشوف "مفيش صلاحية للحفظ" والمشكلة حجم مش صلاحيات.
   بنشتغل تحت الحد بهامش أمان. */
export const MAX_IMAGE_CHARS = 760000;

/* WebP بيدعم الشفافية زي PNG لكن بضغط مفقود — يعني عُشر الحجم تقريباً.
   بنسأل الكانفس نفسه بدل ما نفترض، وبنخزّن الإجابة. */
let webpOk = null;
function supportsWebp() {
  if (webpOk === null) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    try { webpOk = c.toDataURL('image/webp').startsWith('data:image/webp'); }
    catch (e) { webpOk = false; }
  }
  return webpOk;
}

/* المحرّك المشترك: بيرسم المصدر على كانفس ويصغّر الجودة ثم المقاس
   لحد ما الناتج يدخل في الميزانية.
   تحذير مهم: `canvas.toDataURL('image/png', q)` **بيتجاهل الجودة تماماً** —
   PNG بلا فقد، فمستحيل نوصل لميزانية بيه. لو المتصفح مابيعرفش يكتب WebP
   بنضطر نسطّح الشفافية على أبيض ونطلع JPEG — أحسن من إن الصورة تضيع. */
function encodeWithin(source, { maxSide, quality, maxBytes, keepAlpha }) {
  const sw = source.width, sh = source.height;
  const alphaType = supportsWebp() ? 'image/webp' : 'image/png';
  let type = keepAlpha ? alphaType : (supportsWebp() ? 'image/webp' : 'image/jpeg');

  const render = (side, q) => {
    const scale = Math.min(1, side / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, q);
  };

  let side = maxSide, q = quality;
  let out = render(side, q);
  let guard = 0;
  while (out.length > maxBytes && guard++ < 16) {
    if (type === 'image/png') { type = 'image/jpeg'; }   // PNG مايستجيبش للجودة — نسطّح
    else if (q > 0.45) q = Math.max(0.4, q - 0.12);
    else side = Math.max(300, Math.round(side * 0.82));
    out = render(side, q);
    if (q <= 0.4 && side <= 300) break;
  }
  return out;
}

/* ضغط صورة مختارة من الجهاز لحد الميزانية (بالافتراض سقف القاعدة). */
export async function compressImage(file, { maxSide = 900, quality = 0.82, maxBytes = MAX_IMAGE_CHARS, forceJpeg = false } = {}) {
  const bitmap = await createImageBitmap(file);
  const keepAlpha = !forceJpeg && (file.type === 'image/png' || file.type === 'image/webp');
  const out = encodeWithin(bitmap, { maxSide, quality, maxBytes, keepAlpha });
  if (bitmap.close) bitmap.close();
  return out;
}

/* نفس المعالجة لكن لـ data URL جاهز (ناتج إزالة الخلفية مثلاً — بيطلع PNG ضخم). */
export async function fitDataUrl(dataUrl, { maxSide = 900, quality = 0.82, maxBytes = MAX_IMAGE_CHARS } = {}) {
  if (!dataUrl || !dataUrl.startsWith('data:') || dataUrl.length <= maxBytes) return dataUrl;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('تعذر قراءة الصورة'));
    img.src = dataUrl;
  });
  return encodeWithin(img, { maxSide, quality, maxBytes, keepAlpha: true });
}

export function dataUrlSizeKb(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return 0;
  return Math.round((dataUrl.length * 3) / 4 / 1024);
}

const ICON_UP = '<svg viewBox="0 0 24 24" fill="none" style="width:15px;height:15px"><path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---------- Shared image field ----------
   One button to upload from the device, or paste a link. An optional switch
   removes the background locally before saving. */
/* How an image sits inside its frame: zoom plus a nudge in each direction.
   Stored next to the picture and replayed by the storefront, so the original
   file is never re-encoded or cropped away. */
export const DEFAULT_FIT = { scale: 1, x: 0, y: 0 };

export function fitStyle(fit) {
  if (!fit) return '';
  const s = Number(fit.scale) || 1;
  const x = Number(fit.x) || 0;
  const y = Number(fit.y) || 0;
  if (s === 1 && !x && !y) return '';
  return `transform:translate(${x}%, ${y}%) scale(${s});`;
}

export function imageFieldTemplate(id, currentUrl, label = 'الصورة', fit = null) {
  /* الصورة المخزّنة إما data URL أو إشارة لعقدة assets — الاتنين مش لينك
     يتكتب في خانة اللينك، فبنحتفظ بالقيمة الأصلية على العنصر نفسه. */
  const inline = (currentUrl || '').startsWith('data:') || isAssetRef(currentUrl);
  const f = Object.assign({}, DEFAULT_FIT, fit || {});
  return `
    <div class="ex-eg-field ex-eg-image-field" data-field="${id}" data-scale="${f.scale}" data-x="${f.x}" data-y="${f.y}" data-original="${esc(inline ? currentUrl : '')}">
      <label>${label}</label>
      <div class="ex-eg-img-box">
        <div class="ex-eg-img-thumb" id="${id}-preview">${currentUrl ? `<img ${imgSrc(toDirectImageUrl(currentUrl))} style="${fitStyle(f)}">` : '<span>لا توجد صورة</span>'}</div>
        <div class="ex-eg-img-side">
          <label class="ex-eg-img-upload-btn">
            <span>${ICON_UP} ارفع صورة من جهازك</span>
            <input type="file" accept="image/*" id="${id}-file" hidden>
          </label>
          <button type="button" class="ex-eg-img-remove-bg-btn" id="${id}-remove-bg">إزالة الخلفية</button>
          <label class="ex-eg-img-switch">
            <input type="checkbox" id="${id}-nobg"><span class="ex-eg-switch"></span>
            <span>إزالة خلفية الصورة</span>
          </label>
          <div class="ex-eg-img-status" id="${id}-status">${inline ? 'صورة محفوظة على الموقع' : ''}</div>
        </div>
      </div>
      <div class="ex-eg-img-fit" id="${id}-fit">
        <div class="ex-eg-img-fit-row">
          <span>حجم الصورة داخل الإطار</span>
          <button type="button" class="ex-eg-fit-reset" id="${id}-fit-reset">إعادة ضبط</button>
        </div>
        <div class="ex-eg-img-fit-row">
          <button type="button" class="ex-eg-fit-btn" data-zoom="out">−</button>
          <input type="range" id="${id}-zoom" min="1" max="3" step="0.05" value="${esc(f.scale)}">
          <button type="button" class="ex-eg-fit-btn" data-zoom="in">+</button>
          <b id="${id}-zoom-val">${Math.round(f.scale * 100)}%</b>
        </div>
        <div class="ex-eg-img-fit-hint">اسحب الصورة بالماوس لتحريكها داخل الإطار</div>
      </div>
      <div class="ex-eg-img-link-details">
        <label for="${id}">أو أضف صورة عبر رابط</label>
        <div class="ex-eg-img-link-row">
          <input class="ex-eg-img-link-input" id="${id}" dir="ltr" placeholder="https://..." value="${esc(inline ? '' : (currentUrl || ''))}">
          <button type="button" class="ex-eg-btn ex-eg-sm ex-eg-ghost" id="${id}-link-check">تحقق</button>
        </div>
        <div class="ex-eg-img-link-status" id="${id}-link-status"></div>
        <div class="ex-eg-img-fit-hint">الصورة بتفضل متخزّنة على الموقع اللي جاية منه — لو الرابط وقع الصورة هتختفي. روابط جوجل درايف ودروب بوكس بتتحوّل لرابط مباشر تلقائياً.</div>
      </div>
    </div>
  `;
}

export function wireImageField(root, id) {
  const wrapper = root.querySelector(`.ex-eg-image-field[data-field="${id}"]`);
  const linkInput = root.querySelector(`#${id}`);
  const file = root.querySelector(`#${id}-file`);
  const nobg = root.querySelector(`#${id}-nobg`);
  const preview = root.querySelector(`#${id}-preview`);
  const status = root.querySelector(`#${id}-status`);
  const removeBgButton = root.querySelector(`#${id}-remove-bg`);
  if (!wrapper || !linkInput) return;

  /* القيمة الأصلية (data URL أو a:id) هي اللي تترجّع لو المستخدم ماغيّرش الصورة —
     مش الـ src المعروض، لأن صورة الأصل بتتعرض من كاش منفصل. */
  const existing = preview.querySelector('img');
  if (wrapper.dataset.original) wrapper.dataset.inline = wrapper.dataset.original;
  else if (existing && !(linkInput.value || '').trim()) wrapper.dataset.inline = existing.getAttribute('src');
  wireAssets(wrapper);

  /* لو الموديل متخزّن خلاص من قبل، بنحمّله في الذاكرة في الهدوء دلوقتي —
     من غير أي تحميل من النت — فلما يضغط "إزالة الخلفية" تبقى فورية.
     لو مش متخزّن مابنعملش حاجة عشان مانستهلكش نت المستخدم من غير داعي. */
  setTimeout(() => {
    import('./bgRemoval.js')
      .then(async m => { if (await m.isModelCached()) m.warmUpBackgroundRemoval(); })
      .catch(() => { /* مش مشكلة */ });
  }, 800);

  /* ---- zoom / pan inside the frame ---- */
  const zoom = root.querySelector(`#${id}-zoom`);
  const zoomVal = root.querySelector(`#${id}-zoom-val`);
  const applyFit = () => {
    const img = preview.querySelector('img');
    if (!img) return;
    img.style.cssText = fitStyle({ scale: wrapper.dataset.scale, x: wrapper.dataset.x, y: wrapper.dataset.y });
    if (zoomVal) zoomVal.textContent = `${Math.round(Number(wrapper.dataset.scale) * 100)}%`;
  };
  const setScale = (v) => {
    wrapper.dataset.scale = Math.min(3, Math.max(1, Number(v) || 1)).toFixed(2);
    if (zoom) zoom.value = wrapper.dataset.scale;
    applyFit();
  };
  if (zoom) zoom.addEventListener('input', () => setScale(zoom.value));
  wrapper.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
    setScale(Number(wrapper.dataset.scale) + (b.dataset.zoom === 'in' ? 0.15 : -0.15));
  }));
  const resetBtn = root.querySelector(`#${id}-fit-reset`);
  if (resetBtn) resetBtn.addEventListener('click', () => {
    wrapper.dataset.scale = 1; wrapper.dataset.x = 0; wrapper.dataset.y = 0;
    if (zoom) zoom.value = 1;
    applyFit();
  });

  let drag = null;
  preview.addEventListener('pointerdown', (e) => {
    const img = preview.querySelector('img');
    if (!img) return;
    drag = { sx: e.clientX, sy: e.clientY, x: Number(wrapper.dataset.x) || 0, y: Number(wrapper.dataset.y) || 0, w: preview.clientWidth || 1 };
    preview.setPointerCapture(e.pointerId);
    preview.classList.add('ex-eg-dragging');
  });
  preview.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const lim = 60;
    wrapper.dataset.x = Math.max(-lim, Math.min(lim, drag.x + ((e.clientX - drag.sx) / drag.w) * 100)).toFixed(1);
    wrapper.dataset.y = Math.max(-lim, Math.min(lim, drag.y + ((e.clientY - drag.sy) / drag.w) * 100)).toFixed(1);
    applyFit();
  });
  const endDrag = () => { drag = null; preview.classList.remove('ex-eg-dragging'); };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);

  const show = (url) => {
    preview.innerHTML = url ? `<img src="${url}" style="${fitStyle({ scale: wrapper.dataset.scale, x: wrapper.dataset.x, y: wrapper.dataset.y })}">` : '<span>لا توجد صورة</span>';
  };

  /* أول ما يفعّل المفتاح نبدأ نحمّل أداة إزالة الخلفية في الخلفية،
     فلما يختار الصورة تبقى الأداة جاهزة. */
  if (nobg) nobg.addEventListener('change', async () => {
    if (!nobg.checked) { status.textContent = ''; return; }
    try {
      const m = await import('./bgRemoval.js');
      if (await m.isModelCached()) { status.textContent = 'الأداة جاهزة ✓ — اختار الصورة'; return; }
      status.textContent = 'بنحمّل أداة إزالة الخلفية (أول مرة بس)...';
      m.warmUpBackgroundRemoval((pct) => {
        status.textContent = `تحميل الأداة ${pct}% — أول مرة بس، بعد كده فورية`;
      }).then(() => { status.textContent = 'الأداة جاهزة ✓ — اختار الصورة'; });
    } catch (e) { status.textContent = 'تعذر تحميل الأداة — اتأكد من الإنترنت'; }
  });

  if (removeBgButton) removeBgButton.addEventListener('click', () => {
    if (nobg && !nobg.checked) {
      nobg.checked = true;
      // نبدأ تحميل الأداة وهو بيختار الصورة، فالاتنين بيمشوا مع بعض
      nobg.dispatchEvent(new Event('change'));
    }
    file.click();
  });

  /* ---- صورة عبر رابط ----
     بنجرّب نحمّل الرابط فعلاً ونقول للمستخدم شغال ولا لأ، بدل ما يحفظ
     رابط مكسور ويكتشف إن المنتج بلا صورة بعدين. */
  const linkStatus = root.querySelector(`#${id}-link-status`);
  const setLinkStatus = (text, kind) => {
    if (!linkStatus) return;
    linkStatus.textContent = text;
    linkStatus.className = 'ex-eg-img-link-status' + (kind ? ' is-' + kind : '');
  };

  const checkLink = () => {
    const raw = linkInput.value.trim();
    if (!raw) { setLinkStatus(''); show(''); return; }
    const url = toDirectImageUrl(raw);
    if (!/^https?:\/\//i.test(url)) { setLinkStatus('الرابط لازم يبدأ بـ https://', 'bad'); return; }
    setLinkStatus('بنتأكد من الرابط...');
    const probe = new Image();
    probe.onload = () => {
      show(url);
      setLinkStatus(`الرابط شغال ✓ (${probe.naturalWidth}×${probe.naturalHeight})`, 'ok');
    };
    probe.onerror = () => setLinkStatus('الرابط مش بيفتح صورة — اتأكد إنه رابط مباشر للصورة ومتاح للعامة', 'bad');
    probe.src = url;
  };

  let linkTimer = null;
  linkInput.addEventListener('input', () => {
    delete wrapper.dataset.inline;
    status.textContent = '';
    show(toDirectImageUrl(linkInput.value.trim()));
    clearTimeout(linkTimer);
    linkTimer = setTimeout(checkLink, 600);
  });
  const checkBtn = root.querySelector(`#${id}-link-check`);
  if (checkBtn) checkBtn.addEventListener('click', checkLink);
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checkLink(); } });

  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      let dataUrl;
      if (nobg.checked) {
        const bg = await import('./bgRemoval.js');
        const cached = await bg.isModelCached();
        status.textContent = cached
          ? 'جاري إزالة الخلفية...'
          : 'بنحمّل أداة إزالة الخلفية (40 ميجا) — أول مرة بس، استنى شوية...';
        try {
          dataUrl = await bg.removeImageBackground(f, (pct, key) => {
            status.textContent = key && key.includes('fetch')
              ? `تحميل الأداة ${pct}% — أول مرة بس، بعد كده فورية`
              : `إزالة الخلفية ${pct}%`;
          });
          status.textContent = 'اتشالت الخلفية ✓';
        } catch (e) {
          // مانرفعش صورة بخلفية والمستخدم فاكر إنها اتشالت — نقوله الحقيقة
          status.textContent = (e && e.message ? e.message : 'تعذر إزالة الخلفية') + ' — جرب تاني أو اقفل المفتاح وارفعها زي ما هي';
          file.value = '';
          return;
        }
      } else {
        status.textContent = 'جاري تجهيز الصورة...';
        dataUrl = await compressImage(f);
      }
      /* إزالة الخلفية بتطلع PNG بالحجم الأصلي — لازم يعدّي على نفس الميزانية
         وإلا القاعدة ترفض الحفظ وتقول "مفيش صلاحية" */
      dataUrl = await fitDataUrl(dataUrl);
      show(dataUrl);
      wrapper.dataset.inline = dataUrl;
      linkInput.value = '';
      status.textContent = `تم ✓ (${dataUrlSizeKb(dataUrl)} ك.ب)`;
    } catch (e) {
      status.textContent = e && e.message ? e.message : 'تعذر تجهيز الصورة — اتأكد من الإنترنت وجرب صورة تانية';
    }
    file.value = '';
  });
}

export function getImageFieldValue(root, id) {
  const wrapper = root.querySelector(`.ex-eg-image-field[data-field="${id}"]`);
  const input = root.querySelector(`#${id}`);
  if (!input) return '';
  if (wrapper && wrapper.dataset.inline) return wrapper.dataset.inline;
  return toDirectImageUrl(input.value.trim());
}

/* null when the picture sits at its natural fit, so nothing extra is stored. */
export function getImageFitValue(root, id) {
  const wrapper = root.querySelector(`.ex-eg-image-field[data-field="${id}"]`);
  if (!wrapper) return null;
  const scale = Number(wrapper.dataset.scale) || 1;
  const x = Number(wrapper.dataset.x) || 0;
  const y = Number(wrapper.dataset.y) || 0;
  if (scale === 1 && !x && !y) return null;
  return { scale, x, y };
}
