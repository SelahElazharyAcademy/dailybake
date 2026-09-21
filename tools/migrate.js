#!/usr/bin/env node
/* نقل المشروع من قاعدة لقاعدة — بيانات + حسابات + قواعد + إعدادات الاتصال.
   ==================================================================
   بيشتغل على آخر نسخة احتياطية عملها `tools/backup.js`، مش على القاعدة
   الحية مباشرةً. ليه؟ عشان اللي بيتنقل يبقى حاجة اتحفظت على القرص
   واتراجعت، مش لقطة بتتسحب وتتكتب في نفس اللحظة — لو النقل وقع في النص
   النسخة لسه موجودة وتقدر تعيده من غير ما تلمس القاعدة القديمة.

   الاستخدام:
     node tools/migrate.js --to <معرّف المشروع الجديد>
     node tools/migrate.js --to X --from backup/mahbaz-12e0c/2026-09-21_1020
     node tools/migrate.js --to X --force        # اكتب فوق قاعدة فيها بيانات

   حسابات المصادقة (اختياري لكن مهم):
     من كونسول المشروع القديم ← Authentication ← Users ← القايمة (⋮) ←
     "Password hash parameters"، وانقل الأربع قيم:
     node tools/migrate.js --to X --hash-key <..> --salt-sep <..> --rounds <..> --mem-cost <..>
     من غيرها الحسابات هتتنقل من غير كلمات سر والمستخدمين هيحتاجوا يعيدوا تعيينها.

   اللي السكربت مابيعملوش (لأنها كونسول بس):
     • تفعيل Email/Password في Authentication
     • إنشاء قاعدة Realtime Database لو مش موجودة  */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const arg = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const ROOT = path.resolve(__dirname, '..');
const TO = arg('to');
const ACCOUNT = arg('account');
if (!TO) { console.error('لازم تحدد المشروع الهدف: --to <projectId>'); process.exit(1); }

/* ---------- تشغيل firebase ---------- */
const FIREBASE_BIN = (() => {
  const guesses = [
    path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools/lib/bin/firebase.js'),
    '/usr/local/lib/node_modules/firebase-tools/lib/bin/firebase.js',
    '/usr/lib/node_modules/firebase-tools/lib/bin/firebase.js',
  ];
  const hit = guesses.find(p => p && fs.existsSync(p));
  if (hit) return hit;
  console.error('مالقيتش firebase-tools — ثبّته بـ: npm i -g firebase-tools');
  process.exit(1);
})();

function fb(args, { project = TO, quiet = false } = {}) {
  const full = [FIREBASE_BIN, ...args];
  if (project) full.push('--project', project);
  if (ACCOUNT) full.push('--account', ACCOUNT);
  return execFileSync(process.execPath, full, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  });
}

/* ---------- أحدث نسخة احتياطية ---------- */
function latestBackup() {
  const base = path.join(ROOT, 'backup');
  if (!fs.existsSync(base)) return '';
  const all = [];
  for (const proj of fs.readdirSync(base)) {
    const dir = path.join(base, proj);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const stamp of fs.readdirSync(dir)) {
      const full = path.join(dir, stamp);
      if (fs.existsSync(path.join(full, 'database.json'))) all.push(full);
    }
  }
  /* أسماء المجلدات بختم زمني قابل للفرز أبجدياً، فالأخير هو الأحدث */
  return all.sort().pop() || '';
}

const FROM = path.resolve(arg('from', latestBackup()));
if (!FROM || !fs.existsSync(path.join(FROM, 'database.json'))) {
  console.error('مفيش نسخة احتياطية — شغّل الأول: node tools/backup.js');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(FROM, 'manifest.json'), 'utf8'));
console.log(`النقل: ${manifest.project}  ←  ${TO}`);
console.log(`النسخة: ${path.relative(ROOT, FROM)} (${new Date(manifest.takenAt).toLocaleString('ar-EG')})`);
console.log(`المحتوى: ${manifest.nodes.length} عقدة، ${(manifest.totalBytes / 1048576).toFixed(2)} ميجا، ${manifest.authUsers} حساب\n`);

/* ---------- ١) القاعدة الهدف لازم تكون فاضية ---------- */
/* الخطوة دي مقصودة تكون صعبة التخطّي: `database:set /` بيمسح كل حاجة في
   الهدف. لو المشروع الجديد فيه أي حاجة بنوقف ونسأل بدل ما نمحيها. */
process.stdout.write('١) بنتأكد إن القاعدة الجديدة فاضية... ');
let existing = null;
try {
  existing = JSON.parse(fb(['database:get', '/', '--shallow'], { quiet: true }) || 'null');
} catch (e) {
  console.log('\n   القراءة فشلت — يغلب إن Realtime Database لسه ماتعملتش في المشروع.');
  console.log('   افتحه في الكونسول ← Build ← Realtime Database ← Create Database (وضع locked كويس، إحنا هنرفع القواعد).');
  process.exit(1);
}
if (existing && Object.keys(existing).length && !flag('force')) {
  console.log('لأ');
  console.log('   القاعدة الجديدة فيها: ' + Object.keys(existing).join(', '));
  console.log('   لو متأكد إنك عايز تكتب فوقها ضيف --force');
  process.exit(1);
}
console.log('تمام');

/* ---------- ٢) البيانات ---------- */
process.stdout.write('٢) بنرفع البيانات... ');
fb(['database:set', '/', path.join(FROM, 'database.json'), '--force'], { quiet: true });
console.log('تمام');

/* ---------- ٣) التحقق ---------- */
/* مانقولش "اتنقل" على أساس إن الأمر ماطلعش خطأ — بنعد العقد في الاتنين. */
process.stdout.write('٣) بنتحقق... ');
const after = JSON.parse(fb(['database:get', '/', '--shallow'], { quiet: true }) || '{}');
const want = manifest.nodes.map(n => n.node).sort();
const got = Object.keys(after).sort();
const missing = want.filter(n => !got.includes(n));
if (missing.length) { console.log('ناقص: ' + missing.join(', ')); process.exit(1); }
console.log(`تمام (${got.length} عقدة)`);

/* ---------- ٤) القواعد ---------- */
process.stdout.write('٤) بنرفع قواعد الأمان... ');
try {
  fb(['deploy', '--only', 'database'], { quiet: true });
  console.log('تمام');
} catch (e) {
  console.log('اترفضت — ارفعها يدوياً: انسخ firebase-rules.json في الكونسول ← Realtime Database ← Rules');
}

/* ---------- ٥) الحسابات ---------- */
const usersFile = path.join(FROM, 'auth-users.json');
if (fs.existsSync(usersFile)) {
  process.stdout.write('٥) بنستورد الحسابات... ');
  const hashKey = arg('hash-key');
  const extra = hashKey ? [
    '--hash-algo=SCRYPT', '--hash-key=' + hashKey,
    '--salt-separator=' + arg('salt-sep', 'Bw=='),
    '--rounds=' + arg('rounds', '8'),
    '--mem-cost=' + arg('mem-cost', '14'),
  ] : [];
  try {
    fb(['auth:import', usersFile, '--hash-algo=' + (hashKey ? 'SCRYPT' : 'HMAC_SHA256'), ...extra.slice(1)], { quiet: true });
    console.log(hashKey ? 'تمام — كلمات السر شغالة زي ما هي' : 'تمام (بدون كلمات سر)');
  } catch (e) {
    console.log('فشل — الحسابات محفوظة في ' + path.relative(ROOT, usersFile));
    console.log('   الأغلب إن Email/Password لسه مش مفعّل: الكونسول ← Authentication ← Sign-in method');
  }
} else {
  console.log('٥) مفيش ملف حسابات في النسخة — اتخطّى');
}

/* ---------- ٦) إعدادات الاتصال ---------- */
/* بنجيب إعدادات تطبيق الويب من المشروع الجديد ونكتبها في firebase-config.js
   بدل ما تتنسخ باليد — أكتر مكان بيغلط فيه الناس في النقل. */
process.stdout.write('٦) بنجهّز إعدادات الاتصال... ');
let sdk = null;
try {
  const raw = fb(['apps:sdkconfig', 'WEB', '--json'], { quiet: true });
  sdk = JSON.parse(raw).result.sdkConfig;
} catch (e) {
  try {
    fb(['apps:create', 'WEB', 'Daily Bake'], { quiet: true });
    sdk = JSON.parse(fb(['apps:sdkconfig', 'WEB', '--json'], { quiet: true })).result.sdkConfig;
  } catch (e2) { /* نطبع تنبيه تحت */ }
}

if (!sdk) {
  console.log('فشل — هات الإعدادات من الكونسول ← Project settings ← Your apps، وحطها في js/firebase-config.js');
} else {
  if (!sdk.databaseURL) sdk.databaseURL = `https://${TO}-default-rtdb.firebaseio.com`;
  const cfgPath = path.join(ROOT, 'js/firebase-config.js');
  let src = fs.readFileSync(cfgPath, 'utf8');
  const block = 'const firebaseConfig = {\n'
    + ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId']
      .filter(k => sdk[k]).map(k => `  ${k}: ${JSON.stringify(sdk[k])},`).join('\n')
    + '\n};';
  const replaced = src.replace(/const firebaseConfig = \{[\s\S]*?\n\};/, block);
  if (replaced === src) {
    console.log('مالقيتش كتلة firebaseConfig — عدّلها بإيدك');
  } else {
    fs.writeFileSync(cfgPath + '.bak', src);
    fs.writeFileSync(cfgPath, replaced);
    console.log('تمام (النسخة القديمة في js/firebase-config.js.bak)');
  }
}

console.log('\nفاضل عليك:');
console.log('  • الكونسول ← Authentication ← Sign-in method ← فعّل Email/Password' + (fs.existsSync(usersFile) ? ' وبعدين أعِد الخطوة ٥' : ''));
console.log('  • غيّر "default" في .firebaserc لـ ' + TO);
console.log('  • node seo/publish.js   ثم   git push origin main');
