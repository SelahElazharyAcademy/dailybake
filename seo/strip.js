#!/usr/bin/env node
/* تجهيز نسخة النشر.
   الكود فيه تعليقات بتشرح بنية الموقع وقرارات التصميم، وهي بتتبعت لأي زائر
   مع الملفات. هنا بنعمل نسخة نضيفة في مجلد dist:
     • التعليقات بتتشال والملفات بتتصغّر (esbuild — أداة حقيقية مش تجريد يدوي)
     • الملفات الداخلية (شروحات، سكربتات، إعدادات الوركر) مابتتنسخش أصلاً
   الأصل مابيتلمسش خالص، والنشر بيتم من dist. */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');


const SKIP_DIRS = new Set(['dist', 'node_modules', '.git', '.firebase', 'functions', 'push-worker', 'seo']);
const SKIP_FILES = new Set(['firebase.json', '.firebaserc', 'build-data.js', 'build-logo.js', 'serve.js', 'source-data.json', 'firebase-seed.json', 'package.json', 'package-lock.json']);
const SKIP_EXT = new Set(['.md', '.bat', '.ps1', '.sh', '.py', '.log']);

function transform(file, loader) {
  /* minifyWhitespace + minifySyntax بيشيلوا التعليقات والمسافات.
     مابنغيّرش أسماء المتغيرات عشان أسماء الـ exports تفضل زي ما هي. */
  const res = esbuild.transformSync(fs.readFileSync(file, 'utf8'), {
    loader,
    format: loader === 'js' ? 'esm' : undefined,
    minifyWhitespace: true,
    minifySyntax: true,
    charset: 'utf8',
  });
  return res.code;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const name = entry.name;
    if (name.startsWith('.')) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(name)) copyTree(src, dst);
      continue;
    }
    if (SKIP_FILES.has(name) || SKIP_EXT.has(path.extname(name))) continue;
    if (/^firebase-rules.*\.json$/.test(name) || name === 'database.rules.json') continue;

    const ext = path.extname(name);
    if (ext === '.js' || ext === '.css') {
      fs.writeFileSync(dst, transform(src, ext.slice(1)));
    } else if (ext === '.html') {
      /* تعليقات HTML بتتشال، بس علامات SEO بتفضل عشان السكربت يلاقيها */
      const html = fs.readFileSync(src, 'utf8')
        .replace(/<!--(?!\s*(SEO:START|SEO:END|\[if))[\s\S]*?-->/g, '');
      fs.writeFileSync(dst, html);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
copyTree(ROOT, DIST);

/* ختم نسخة لكل نشرة.
   ------------------------------------------------------------------
   المشكلة اللي بيحلّها: إصدار كاش الـservice worker كان بيتزوّد **باليد**،
   وأي نشرة يتنسى فيها الرقم بتخلّي الأجهزة قاعدة على نسخة قديمة من غير ما
   حد ياخد باله. دلوقتي كل نشرة بتاخد رقمها لوحدها من التاريخ والوقت،
   فمستحيل يتنسى.
   وكمان بنكتب version.json — اللوحة (مالهاش service worker) بتسأل عنه
   وتقول "في نسخة جديدة" بدل ما تفضل شغّالة على كود قديم. */
const BUILD = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);   // YYYYMMDDHHMMSS
const swPath = path.join(DIST, 'sw.js');
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8').replace(/dailybake-shell-v[\w.-]+/g, `dailybake-shell-${BUILD}`);
  fs.writeFileSync(swPath, sw);
}
fs.writeFileSync(path.join(DIST, 'version.json'), JSON.stringify({ build: BUILD }) + String.fromCharCode(10));
/* الرقم بيتحقن في الصفحات كمان عشان الجافاسكربت يعرف هو شغّال على أنهي نسخة.
   **وسم meta مش سكربت**: الـCSP في firebase.json مابتسمحش بأي سكربت inline،
   فالسكربت كان هيتحجب في صمت والرقم يوصل فاضي. الـmeta مالهاش علاقة بالـCSP. */
['index.html', path.join('dashboard', 'index.html')].forEach((rel) => {
  const p = path.join(DIST, rel);
  if (!fs.existsSync(p)) return;
  const html = fs.readFileSync(p, 'utf8').replace('</head>', `<meta name="app-build" content="${BUILD}"></head>`);
  fs.writeFileSync(p, html);
});
console.log(`   رقم النسخة: ${BUILD}`);

let files = 0, bytes = 0;
(function walk(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) walk(f); else { files++; bytes += fs.statSync(f).size; }
  }
})(DIST);

console.log(`   نسخة النشر: ${files} ملف، ${Math.round(bytes / 1024)} ك.ب — بدون تعليقات ولا ملفات داخلية`);
