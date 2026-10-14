/* Menu suggestions only. The server remains authoritative about order acceptance. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ServingPeriods = api;
})(globalThis, function () {
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  function active(period, day, minute) {
    if (!period.hours) return true;
    const today = period.hours[days[day]] || [], yesterday = period.hours[days[(day + 6) % 7]] || [];
    return today.some(w => w.close > w.open ? minute >= w.open && minute < w.close : w.close < w.open && minute >= w.open) || yesterday.some(w => w.close < w.open && minute < w.close);
  }
  function describe(product, now = new Date()) {
    let day, minute;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {timeZone:product.serving_time_zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
      const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
      day = days.indexOf(values.weekday.toLowerCase()); minute = Number(values.hour)*60+Number(values.minute);
    } catch { /* An invalid zone must not suggest the phone's own local time. */ }
    return (Array.isArray(product.serving_periods) ? product.serving_periods : []).filter(p=>p && typeof p.name==='string').map(p=>({name:p.name,active:!!product.serving_time_zone && day>=0 && Number.isFinite(minute) && active(p,day,minute)}));
  }
  function refresh() {
    if (globalThis.document?.hidden) return;
    globalThis.document?.querySelectorAll('[data-serving]').forEach(node => {
      try {
        const periods = describe(JSON.parse(node.dataset.serving));
        node.querySelectorAll('.dish-serving').forEach((badge,index) => {
          const current = periods[index]?.active === true;
          badge.classList.toggle('is-current', current);
          badge.querySelector('[data-serving-active]').hidden = !current;
        });
      } catch { /* A malformed row never stops the rest of the menu. */ }
    });
    globalThis.dispatchEvent?.(new Event('posnic:serving-periods')) ;
  }
  if (globalThis.document) {
    document.addEventListener('visibilitychange', refresh);
    let timer;
    const start = () => { clearInterval(timer); refresh(); timer = setInterval(refresh, 30000); };
    globalThis.addEventListener('pagehide', () => clearInterval(timer));
    globalThis.addEventListener('pageshow', start);
    start();
  }
  return {describe,refresh};
});
