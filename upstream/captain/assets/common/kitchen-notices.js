/* Ready food belongs to the Captain who placed that round. Never navigate or
 * modify an order in response to a notification. */
(function () {
  'use strict';
  let busy = false, notice, context;
  const t = text => window.I18N?.t(text) || text;
  const memory = new Map();
  function remember(key, signature) {
    let previous = memory.get(key);
    try { previous = sessionStorage.getItem(key) || previous; } catch {}
    if (previous === signature) return false;
    memory.set(key, signature);
    try { sessionStorage.setItem(key, signature); } catch {}
    return true;
  }
  function ring() {
    window.CaptainPhone?.vibrate([100, 80, 100]);
    if (!window.CaptainPhone?.enabled('sound')) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context ||= new Audio();
      void context.resume().catch(() => {});
      const tone = context.createOscillator(), gain = context.createGain();
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.06, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
      tone.connect(gain); gain.connect(context.destination);
      tone.start(); tone.stop(context.currentTime + 0.4);
    } catch { /* The visible notice works even when audio is unavailable. */ }
  }
  function consume(data) {
    if (!data?.actor || !data.scope || !Array.isArray(data.tickets)) return;
    const messages = [];
    for (const ticket of data.tickets) {
      if (String(ticket.owner) !== String(data.actor)) continue;
      const fresh = [];
      for (const item of ticket.items || []) {
        const count = Math.max(0, Number(item.ready) - Number(item.collected || item.served || 0));
        if (!count) continue;
        const key = 'captain.ready:' + data.scope + ':' + ticket.id + ':' + item.id;
        if (remember(key, String(item.readyVersion || item.ready))) fresh.push(`${count} × ${item.name}`);
      }
      if (fresh.length) messages.push((ticket.takeaway ? t('Take Away') + ' ' + (ticket.orderNumber || '') : t('Table') + ' ' + ticket.table) + ': ' + fresh.join(', '));
    }
    if (!messages.length) return;
    notice?.remove();
    notice = document.createElement('aside');
    notice.className = 'kitchen-ready-notice';
    notice.setAttribute('role', 'status');
    const content = document.createElement('div');
    const heading = document.createElement('strong'); heading.textContent = t('Ready');
    const text = document.createElement('p'); text.textContent = messages.join(' · '); text.setAttribute('translate', 'no');
    content.append(heading, text);
    const view = document.createElement('a'); view.href = 'kot-management.html?filter=ready'; view.textContent = t('View');
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', t('Close'));
    dismiss.onclick = () => notice.remove();
    notice.append(content, view, dismiss); document.body.append(notice);
    ring();
  }
  async function refresh() {
    if (busy || document.hidden || !window.POSNIC?.api) return;
    busy = true;
    try { consume(await POSNIC.api.get('/captain/v1/kitchen-ready')); }
    catch { /* A failed read does not acknowledge a notification. */ }
    finally { busy = false; }
  }
  function start() {
    void refresh();
    setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
  }
  window.CaptainKitchenNotices = { consume, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
