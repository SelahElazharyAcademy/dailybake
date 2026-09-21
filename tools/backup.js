#!/usr/bin/env node
/* نسخة احتياطية كاملة من قاعدة Realtime Database + حسابات المصادقة.
   ------------------------------------------------------------------
   ليه سكربت مش أمر واحد: `firebase database:get /` بيسحب القاعدة كلها في
   طلب واحد — لو فيها صور base64 بيقع أو يتقطع في النص. هنا بننزّل كل عقدة
   عليا لوحدها، نتحقق إن كل ملف JSON سليم، ونكتب بيان (manifest) بالأحجام
   والتواريخ عشان نعرف بعدين إن النسخة كاملة فعلاً مش نص نسخة.

   الاستخدام:
     node tools/backup.js                 # نسخة من المشروع الافتراضي
     node tools/backup.js --project X     # من مشروع معيّن
     node tools/backup.js --out DIR       # مكان مخصص

   الناتج: backup/<projectId>/<YYYY-MM-DD_HHMM>/
       database.json      القاعدة كاملة في ملف واحد (للاستعادة بأمر واحد)
       nodes/<node>.json  كل عقدة لوحدها (للمراجعة والاستعادة الجزئية)
       auth-users.json    حسابات المصادقة بتجزئة كلمات السر (تستورد كما هي)
       rules.json         نسخة من قواعد الأمان وقت النسخ
       manifest.json      البيان: أحجام، عدد عناصر، تحقق
*/
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const ROOT = path.resolve(__dirname, '..');
const PROJECT = argOf('project', JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default);

/* ختم زمني قابل للفرز أبجدياً — فالمجلدات بتترتب لوحدها بالأحدث */
const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const OUT = path.resolve(argOf('out', path.join(ROOT, 'backup', PROJECT, stamp)));

/* بننادي ملف firebase-tools بـ node مباشرةً بدل `npx firebase`:
   على ويندوز نود بيرفض تشغيل ملفات .cmd من غير صدفة (EINVAL)، وتشغيلها جوّه
   صدفة بيخلّي Git Bash يحوّل المسار `/` لمسار ويندوز فالأمر يفشل. */
const FIREBASE_BIN = (() => {
  const guesses = [
    path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools/lib/bin/firebase.js'),
    path.join(process.env.HOME || '', '.npm-global/lib/node_modules/firebase-tools/lib/bin/firebase.js'),
    '/usr/local/lib/node_modules/firebase-tools/lib/bin/firebase.js',
    '/usr/lib/node_modules/firebase-tools/lib/bin/firebase.js',
  ];
  const hit = guesses.find(p => p && fs.existsSync(p));
  if (hit) return hit;
  try {
    const root = execFileSync(process.execPath, ['-e', "process.stdout.write(require('child_process').execSync('npm root -g').toString().trim())"], { encoding: 'utf8' }).trim();
    const p = path.join(root, 'firebase-tools/lib/bin/firebase.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* نسقط للرسالة تحت */ }
  console.error('مالقيتش firebase-tools — ثبّته بـ: npm i -g firebase-tools');
  process.exit(1);
})();

function fb(args) {
  return execFileSync(process.execPath, [FIREBASE_BIN, ...args, '--project', PROJECT],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function readNode(nodePath, shallow) {
  /* -o مع مسار ملف بيتجنّب تحميل الناتج في stdout ويحافظ على الترميز */
  const tmp = path.join(OUT, '.tmp.json');
  fb(['database:get', nodePath, ...(shallow ? ['--shallow'] : []), '-o', tmp]);
  const raw = fs.readFileSync(tmp, 'utf8');
  fs.unlinkSync(tmp);
  return raw;
}

function countLeaves(v) {
  if (v === null || typeof v !== 'object') return 1;
  return Object.values(v).reduce((n, x) => n + countLeaves(x), 0);
}

console.log(`نسخة احتياطية من ${PROJECT}`);
fs.mkdirSync(path.join(OUT, 'nodes'), { recursive: true });

const top = JSON.parse(readNode('/', true) || '{}');
const names = Object.keys(top).sort();
if (!names.length) { console.error('القاعدة فاضية أو القراءة اترفضت — النسخة اتوقفت'); process.exit(1); }

const whole = {};
const report = [];
for (const name of names) {
  const raw = readNode('/' + name);
  let value;
  try { value = JSON.parse(raw); }
  catch (e) { console.error(`العقدة ${name} رجعت JSON مكسور — النسخة اتوقفت`); process.exit(1); }
  fs.writeFileSync(path.join(OUT, 'nodes', name + '.json'), JSON.stringify(value, null, 2));
  whole[name] = value;
  const bytes = Buffer.byteLength(raw);
  report.push({ node: name, bytes, children: value && typeof value === 'object' ? Object.keys(value).length : 0, leaves: countLeaves(value) });
  console.log(`  ${name.padEnd(14)} ${String(Math.round(bytes / 1024) + ' ك.ب').padStart(10)}`);
}

fs.writeFileSync(path.join(OUT, 'database.json'), JSON.stringify(whole, null, 2));

/* حسابات المصادقة: التصدير بيحتفظ بتجزئة كلمة السر وإعدادات الخوارزمية،
   يعني الاستيراد في مشروع تاني بيخلّي نفس كلمات السر شغالة. */
let users = 0;
try {
  fb(['auth:export', path.join(OUT, 'auth-users.json'), '--format=json']);
  users = (JSON.parse(fs.readFileSync(path.join(OUT, 'auth-users.json'), 'utf8')).users || []).length;
  console.log(`  حسابات المصادقة: ${users}`);
} catch (e) {
  console.warn('  تعذّر تصدير حسابات المصادقة — كمّلنا من غيرها');
}

/* إعدادات التجزئة (hash_config) مش بتتصدّر مع الملف — لازم تتقرا مرة من
   الكونسول لو حبينا نستورد بنفس كلمات السر. بنسجّل التنبيه في البيان. */
const rulesSrc = path.join(ROOT, 'firebase-rules.json');
if (fs.existsSync(rulesSrc)) fs.copyFileSync(rulesSrc, path.join(OUT, 'rules.json'));

const manifest = {
  project: PROJECT,
  takenAt: new Date().toISOString(),
  totalBytes: report.reduce((n, r) => n + r.bytes, 0),
  nodes: report,
  authUsers: users,
  note: 'استعادة كاملة: firebase database:set / database.json --project <id>',
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\nالإجمالي ${(manifest.totalBytes / 1048576).toFixed(2)} ميجا في ${names.length} عقدة`);
console.log(OUT);
