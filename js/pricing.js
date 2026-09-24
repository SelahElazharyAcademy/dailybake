/* Discount helpers shared by the storefront and the dashboard.
   product.discount = { type: 'percent'|'fixed', value, until: ms|null, campaignId?, label? } */

export function activeDiscount(product, now = Date.now()) {
  const d = product && product.discount;
  if (!d || !(Number(d.value) > 0)) return null;
  if (d.until && now > Number(d.until)) return null;
  return d;
}

export function discountedPrice(price, d) {
  if (!d) return price;
  const p = Number(price) || 0;
  if (d.type === 'fixed') return Math.max(0, p - Number(d.value));
  return Math.max(0, Math.round(p * (1 - Number(d.value) / 100) * 100) / 100);
}

/* اسم العملة اللي بيظهر للعميل — بالعربي "جنيه مصري" بعد الرقم، وبالإنجليزي الكود قبله */
const CURRENCY_AR = { EGP: 'جنيه مصري' };

export function money(amount, currencyCode, lang = 'ar') {
  const code = currencyCode || 'EGP';
  if (lang === 'ar' && CURRENCY_AR[code]) return `${amount} ${CURRENCY_AR[code]}`;
  return `${code} ${amount}`;
}

export function discountBadge(d, currencyCode, lang) {
  if (!d) return '';
  return d.type === 'fixed' ? (lang ? `-${money(Number(d.value), currencyCode, lang)}` : `-${Number(d.value)} ${currencyCode || ''}`.trim()) : `-${Number(d.value)}%`;
}

export function fmtDateShort(ts, lang = 'ar') {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' });
}
