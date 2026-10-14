'use strict';

/* Sổ sách & báo cáo thuế: owner page over /api/shop/tax-ledger
   (src/tax-ledger-router.js). No inline handlers, CSP 'self' only. */
(function () {
  const $ = (s) => document.querySelector(s);
  const API = '/api/shop/tax-ledger';
  const num = (n) => new Intl.NumberFormat('vi-VN').format(n);
  const money = (n) => (n ? num(n) : '');
  const pct = (bp) => `${String(bp / 100).replace('.', ',')}%`;
  const dayLabel = (k) => { const [y, m, d] = String(k).split('-'); return `${d}/${m}/${y}`; };
  const SOURCE = { owner: 'Chủ cửa hàng chọn', preset: 'Theo ngành', default: 'Mặc định' };
  const STATUS = { exceeded: 'Đã vượt ngưỡng', not_exceeded_yet: 'Chưa vượt ngưỡng', not_exceeded: 'Không vượt ngưỡng' };

  let token = null;
  try { token = localStorage.getItem('hitechpos_token'); } catch { /* storage blocked */ }
  let groups = [];

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) e.append(c instanceof Node ? c : document.createTextNode(c == null ? '' : String(c)));
    return e;
  }
  function say(target, text, ok) { target.classList.remove('ok', 'err'); target.classList.add('msg', ok ? 'ok' : 'err'); target.textContent = text; }
  function showLogin() { $('#login').hidden = false; $('#app').hidden = true; $('#logout').hidden = true; }

  async function request(method, path, body) {
    const res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && path !== '/api/auth/login') { showLogin(); throw new Error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'); }
    return res;
  }
  async function api(method, path, body) {
    const res = await request(method, path, body);
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && json.message) || 'Có lỗi xảy ra');
    return json;
  }

  /* ---------------------------------------------------------- period */
  function initPeriod() {
    const now = new Date(Date.now() + 7 * 3600000); // Vietnam calendar
    for (let m = 1; m <= 12; m += 1) $('#pmonth').append(el('option', { value: String(m).padStart(2, '0'), text: `Tháng ${m}` }));
    $('#pmonth').value = String(now.getUTCMonth() + 1).padStart(2, '0');
    $('#pquarter').value = String(Math.floor(now.getUTCMonth() / 3) + 1);
    $('#pyear').value = String(now.getUTCFullYear());
    $('#ptype').addEventListener('change', syncType);
    syncType();
  }
  function syncType() {
    const t = $('#ptype').value;
    $('#monthWrap').hidden = t !== 'month';
    $('#quarterWrap').hidden = t !== 'quarter';
  }
  function periodKey() {
    const y = $('#pyear').value.trim();
    const t = $('#ptype').value;
    return t === 'month' ? `${y}-${$('#pmonth').value}` : t === 'quarter' ? `${y}-Q${$('#pquarter').value}` : y;
  }
  const query = () => `period=${encodeURIComponent(periodKey())}&detail=${encodeURIComponent($('#pdetail').value)}`;

  /* ---------------------------------------------------------- report */
  function renderReport(l) {
    groups = l.groups;
    $('#shopName').textContent = l.shop.name || '–';
    $('#shopTax').textContent = l.shop.taxCode || '–';
    $('#shopAddr').textContent = l.shop.address || '–';
    $('#periodLabel').textContent = `Kỳ: ${l.period.label} (từ ${dayLabel(l.period.fromDay)} đến ${dayLabel(l.period.toDay)}) · Đơn vị tính: đồng`;

    const s = l.summary;
    const sb = $('#summary tbody');
    sb.replaceChildren(...s.groups.map((g) => el('tr', {},
      el('td', { text: `(${g.column}) ${g.label}` }),
      el('td', { class: 'n', text: num(g.revenue) }),
      el('td', { class: 'n', text: pct(g.gtgtRateBp) }),
      el('td', { class: 'n', text: num(g.gtgt) }),
      el('td', { class: 'n', text: pct(g.tncnRateBp) }),
      el('td', { class: 'n', text: num(g.tncn) }))));
    $('#summary tfoot').replaceChildren(el('tr', {},
      el('td', { text: 'Tổng cộng' }), el('td', { class: 'n', text: num(s.totals.revenue) }), el('td'),
      el('td', { class: 'n', text: num(s.totals.gtgt) }), el('td'), el('td', { class: 'n', text: num(s.totals.tncn) })));
    $('#threshold').replaceChildren(
      el('b', { text: `${STATUS[s.threshold.status] || s.threshold.status}. ` }),
      `Ngưỡng ${num(s.threshold.annual)} đ/năm. ${s.threshold.text}`);
    $('#payable').textContent = `${num(s.payable.total)} đ (GTGT ${num(s.payable.gtgt)} đ, TNCN ${num(s.payable.tncn)} đ)`;
    $('#warnings').replaceChildren(...s.warnings.map((w) => el('li', { text: w })));
    const sk = l.book.counts.skipped || {};
    const skipped = Object.values(sk).reduce((a, n) => a + n, 0);
    $('#counts').textContent = `${l.book.counts.sales} đơn bán, ${l.book.counts.returns} lượt trả hàng trong kỳ` +
      (skipped ? `; ${skipped} đơn không tính doanh thu (chưa thanh toán, lưu tạm, đã huỷ…)` : '') + `. Bảng thuế suất: ${s.tableVersion}.`;

    const head1 = el('tr', {}, el('th', { text: 'Ngày ghi sổ' }), el('th', { text: 'Số hiệu chứng từ' }), el('th', { text: 'Ngày chứng từ' }), el('th', { text: 'Diễn giải' }),
      ...groups.map((g) => el('th', { class: 'n', text: `(${g.column}) ${g.label}` })), el('th', { class: 'n', text: 'Tổng cộng' }), el('th', { text: 'Ghi chú' }));
    const head2 = el('tr', { class: 'muted' }, ...['A', 'B', 'C', 'D'].map((c) => el('th', { text: c })), ...groups.map((g) => el('th', { class: 'n', text: String(g.column) })), el('th'), el('th', { text: 'E' }));
    $('#book thead').replaceChildren(head1, head2);
    const rows = l.book.rows.map((r) => el('tr', { class: r.kind === 'return' ? 'ret' : '' },
      el('td', { text: dayLabel(r.postedOn) }), el('td', { text: r.docNo }), el('td', { text: dayLabel(r.docDate) }), el('td', { text: r.description }),
      ...groups.map((g) => el('td', { class: 'n', text: money(r.amounts[g.id]) })), el('td', { class: 'n', text: money(r.total) }), el('td', { text: r.note || '' })));
    if (!rows.length) rows.push(el('tr', {}, el('td', { colspan: String(groups.length + 6), text: 'Không có doanh thu trong kỳ.' })));
    $('#book tbody').replaceChildren(...rows);
    $('#book tfoot').replaceChildren(el('tr', {}, el('td'), el('td'), el('td'), el('td', { text: 'Tổng cộng' }),
      ...groups.map((g) => el('td', { class: 'n', text: num(l.book.totals.amounts[g.id] || 0) })), el('td', { class: 'n', text: num(l.book.totals.total) }), el('td')));
    $('#report').hidden = false;
  }

  async function loadReport() {
    say($('#periodMsg'), 'Đang tổng hợp…', true);
    try {
      renderReport(await api('GET', `${API}?${query()}`));
      say($('#periodMsg'), '', true);
    } catch (err) { say($('#periodMsg'), err.message); }
  }

  async function download(path, fallback) {
    say($('#exportMsg'), 'Đang chuẩn bị tệp…', true);
    try {
      const res = await request('GET', path);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).message) || 'Không tải được tệp');
      const name = (/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '') || [])[1] || fallback;
      const a = el('a', { href: URL.createObjectURL(await res.blob()), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      say($('#exportMsg'), 'Đã tải ' + name, true);
    } catch (err) { say($('#exportMsg'), err.message); }
  }

  /* ---------------------------------------------------------- mapping */
  function groupSelect(name, value, { allowEmpty, emptyLabel } = {}) {
    const s = el('select', { name });
    if (allowEmpty) s.append(el('option', { value: '', text: emptyLabel || '(mặc định)' }));
    for (const g of groups) s.append(el('option', { value: g.id, text: `(${g.column}) ${g.label}` }));
    s.value = value || '';
    return s;
  }
  function fillGroupSelect(sel, value, emptyLabel) {
    sel.replaceChildren(el('option', { value: '', text: emptyLabel }), ...groups.map((g) => el('option', { value: g.id, text: `(${g.column}) ${g.label}` })));
    sel.value = value || '';
  }

  function renderMapping(m) {
    groups = m.groups;
    const label = (id) => { const g = groups.find((x) => x.id === id); return g ? `(${g.column}) ${g.label}` : id; };
    fillGroupSelect($('#defaultGroup'), m.defaultGroup, `Theo ngành: ${label(m.presetGroup)}`);
    fillGroupSelect($('#chargeGroup'), m.chargeGroup, `Như nhóm mặc định`);
    $('#mapTable tbody').replaceChildren(...m.categories.map((c) => {
      const sel = groupSelect('group', c.source === 'owner' ? c.group : '', { allowEmpty: true, emptyLabel: `(tự động: ${label(c.source === 'owner' ? (c.presetGroup || m.effectiveDefaultGroup) : c.group)})` });
      sel.dataset.key = c.key;
      sel.dataset.name = c.name;
      return el('tr', {}, el('td', { text: c.name }), el('td', {}, sel), el('td', {}, el('span', { class: `pill ${c.source}`, text: SOURCE[c.source] || c.source })));
    }));
    if (!m.dataAvailable) say($('#mapMsg'), 'Chưa đọc được danh mục hàng của cửa hàng; chỉ hiển thị các lựa chọn đã lưu.', false);
  }

  async function loadMapping() {
    try { renderMapping(await api('GET', `${API}/settings`)); } catch (err) { say($('#mapMsg'), err.message); }
  }

  /* ---------------------------------------------------------- wiring */
  async function start() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#logout').hidden = false;
    await loadMapping();
    await loadReport();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initPeriod();
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        token = (await api('POST', '/api/auth/login', Object.fromEntries(new FormData(e.target)))).token;
        try { localStorage.setItem('hitechpos_token', token); } catch { /* storage blocked */ }
        start();
      } catch (err) { say($('#loginMsg'), err.message); }
    });
    $('#logout').addEventListener('click', (e) => {
      e.preventDefault();
      token = null;
      try { localStorage.removeItem('hitechpos_token'); } catch { /* storage blocked */ }
      showLogin();
    });
    $('#periodForm').addEventListener('submit', (e) => { e.preventDefault(); loadReport(); });
    $('#csvBtn').addEventListener('click', () => download(`${API}/export.csv?${query()}&sep=${encodeURIComponent($('#csvSep').value)}`, 'so-doanh-thu.csv'));
    $('#htmlBtn').addEventListener('click', () => download(`${API}/export.html?${query()}`, 'so-doanh-thu.html'));
    $('#printBtn').addEventListener('click', () => window.print());
    $('#mapForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const rows = [...document.querySelectorAll('#mapTable select')].map((s) => ({ key: s.dataset.key, name: s.dataset.name, group: s.value || null }));
      try {
        renderMapping(await api('PUT', `${API}/settings`, { defaultGroup: $('#defaultGroup').value || null, chargeGroup: $('#chargeGroup').value || null, categoryGroups: rows }));
        say($('#mapMsg'), 'Đã lưu. Sổ được tính lại theo cách xếp nhóm mới.', true);
        if (!$('#report').hidden) loadReport();
      } catch (err) { say($('#mapMsg'), err.message); }
    });
    if (token) start(); else showLogin();
  });
})();
