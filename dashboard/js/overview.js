import { ICONS } from '../../js/icons.js';
import { db, ref, onValue } from '../../js/firebase-config.js';
import { summarize } from '../../js/visits.js';

function tName(obj) { if (!obj) return ''; return obj.ar || obj.en || ''; }
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function renderOverview(container, { profile } = {}) {
  /* أدمن مربوط بفرع: الإحصائيات بتاعة فرعه بس */
  const myBranch = profile && profile.role !== 'owner' && profile.branchId ? String(profile.branchId) : '';
  container.innerHTML = `
    <div class="ex-eg-stat-grid" id="stat-grid"></div>
    <div class="ex-eg-card ex-eg-visits" id="visits-card">
      <div class="ex-eg-visits-head">
        <h3>${ICONS.users} زيارات الموقع</h3>
        <span class="ex-eg-hint">الزيارة = جهاز واحد في اليوم، مش كل فتحة للصفحة</span>
      </div>
      <div id="visits-body"><div class="ex-eg-empty-d">جاري التحميل...</div></div>
    </div>
    <div class="ex-eg-row-2">
      <div class="ex-eg-card">
        <h3 style="margin:0 0 12px;font-size:14px;">أحدث الطلبات</h3>
        <div id="recent-orders"></div>
      </div>
      <div class="ex-eg-card">
        <h3 style="margin:0 0 12px;font-size:14px;">الأكثر طلباً</h3>
        <div id="top-items"></div>
      </div>
    </div>
  `;

  wireVisits(container);

  onValue(ref(db, 'orders'), (snap) => {
    let orders = [];
    snap.forEach(child => { orders.push({ id: child.key, ...child.val() }); });
    if (myBranch) orders = orders.filter(o => o.branchId === myBranch);
    orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const today = startOfToday();
    const todays = orders.filter(o => (o.createdAt || 0) >= today);
    const revenueToday = todays.reduce((s, o) => s + (o.total || 0), 0);
    const pending = orders.filter(o => o.status === 'new' || o.status === 'preparing').length;

    container.querySelector('#stat-grid').innerHTML = `
      ${statCard(ICONS.bag, 'طلبات اليوم', todays.length)}
      ${statCard(ICONS.chart, 'إيراد اليوم', `${todays[0]?.currencyCode || ''} ${revenueToday}`)}
      ${statCard(ICONS.clock, 'طلبات قيد التنفيذ', pending)}
      ${statCard(ICONS.list, 'إجمالي الطلبات', orders.length)}
    `;

    const recent = orders.slice(0, 6);
    container.querySelector('#recent-orders').innerHTML = recent.length ? `
      <div class="ex-eg-table-wrap"><table><tbody>
        ${recent.map(o => `
          <tr>
            <td><b>#${o.id.slice(-5)}</b></td>
            <td>${o.customerName || '-'}</td>
            <td>${o.currencyCode || ''} ${o.total || 0}</td>
            <td><span class="ex-eg-badge-status ${o.status}">${statusLabel(o.status)}</span></td>
          </tr>
        `).join('')}
      </tbody></table></div>
    ` : `<div class="ex-eg-empty-d">لسه مفيش طلبات</div>`;

    const counts = {};
    orders.forEach(o => (o.items || []).forEach(i => {
      const key = tName(i.name);
      counts[key] = (counts[key] || 0) + i.qty;
    }));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    container.querySelector('#top-items').innerHTML = top.length ? `
      <div class="ex-eg-table-wrap"><table><tbody>
        ${top.map(([name, qty]) => `<tr><td>${name}</td><td><b>${qty}</b></td></tr>`).join('')}
      </tbody></table></div>
    ` : `<div class="ex-eg-empty-d">لسه مفيش بيانات</div>`;
  });
}

/* ---------- زيارات الموقع ----------
   العقدة بتتقري كاملة مرة واحدة وبتتحدّث لحظياً. حجمها صغير جداً (رقم
   لكل يوم) فمفيش داعي لأي تقسيم أو استعلام. */
function wireVisits(container) {
  const box = container.querySelector('#visits-body');
  if (!box) return;
  onValue(ref(db, 'visits'), (snap) => {
    const v = summarize(snap.exists() ? snap.val() : null);
    if (!v.total) {
      box.innerHTML = `<div class="ex-eg-empty-d">لسه مفيش زيارات متسجّلة.<br>
        <small>العدّاد بيشتغل بعد رفع قواعد الأمان الجديدة على القاعدة.</small></div>`;
      return;
    }
    const peak = Math.max(1, ...v.last7.map(d => d.count));
    const dayName = (k) => new Date(k + 'T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short' });
    box.innerHTML = `
      <div class="ex-eg-visit-nums">
        ${visitNum('النهارده', v.today)}
        ${visitNum('آخر ٧ أيام', v.week)}
        ${visitNum('الشهر ده', v.month)}
        ${visitNum('الإجمالي', v.total)}
      </div>
      <div class="ex-eg-visit-bars">
        ${v.last7.map(d => `
          <div class="ex-eg-vb" title="${d.day}">
            <b>${d.count}</b>
            <i style="height:${Math.round((d.count / peak) * 100)}%"></i>
            <span>${dayName(d.day)}</span>
          </div>`).join('')}
      </div>`;
  }, () => {
    /* القراءة اترفضت — القواعد لسه مارفعتش، أو الحساب مش أدمن */
    box.innerHTML = `<div class="ex-eg-empty-d">تعذّر قراءة الزيارات — اتأكد إن قواعد الأمان اترفعت.</div>`;
  });
}

function visitNum(label, n) {
  return `<div class="ex-eg-vn"><b>${Number(n).toLocaleString('ar-EG')}</b><span>${label}</span></div>`;
}

function statCard(icon, label, value) {
  return `
    <div class="ex-eg-stat-card">
      <div class="ex-eg-stat-icon">${icon}</div>
      <div class="ex-eg-stat-label">${label}</div>
      <div class="ex-eg-stat-value">${value}</div>
    </div>
  `;
}

function statusLabel(s) {
  return { new: 'جديد', preparing: 'قيد التجهيز', ready: 'جاهز', completed: 'مكتمل', cancelled: 'ملغي' }[s] || s || '-';
}

export { statusLabel };
