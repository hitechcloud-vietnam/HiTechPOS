'use strict';

/* Operator console (admin.html). Talks to /api/admin/* with X-Admin-Key; the
   operator's name goes in X-Admin-Actor for the audit log. Every value from
   the server is escaped before it reaches innerHTML. */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const nf = new Intl.NumberFormat('vi-VN');
const vnd = (n) => nf.format(n || 0) + ' ₫';
const TZ = { timeZone: 'Asia/Ho_Chi_Minh' };
const dt = (s) => (s ? new Date(s).toLocaleString('vi-VN', TZ) : '–');
const day = (s) => (s ? new Date(s).toLocaleDateString('vi-VN', TZ) : '–');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (r) => (Math.round((r || 0) * 1000) / 10).toLocaleString('vi-VN') + ' %';
const monthLabel = (m) => `T${Number(m.slice(5))}/${m.slice(2, 4)}`;

const STATE = {
  trialing: ['Dùng thử', 'warn'], active: ['Đang trả phí', 'ok'], expired: ['Hết hạn', 'bad'],
  suspended: ['Bị khoá', 'bad'], install_failed: ['Cài lỗi', 'bad'],
};
const ACTION = {
  suspend: 'Khoá cửa hàng', resume: 'Mở khoá', extend: 'Gia hạn', 'change-plan': 'Đổi gói',
  'resend-welcome': 'Gửi lại email chào mừng', 'reset-password': 'Gửi email đặt lại mật khẩu', note: 'Ghi chú nội bộ',
};
const MAIL_RESULT = { sent: 'đã gửi', logged: 'chưa cấu hình SMTP, chỉ ghi log', failed: 'gửi thất bại', 'no-recipient': 'không có người nhận' };
const ONBOARDING_STEP = { users: 'Người dùng', branch: 'Chi nhánh', taxes: 'Thuế', modules: 'Mô-đun', settings: 'Cài đặt', demo: 'Dữ liệu mẫu', error: 'Lỗi' };

let key = '';
let actor = '';
try { key = sessionStorage.getItem('hitechpos_admin') || ''; } catch {}
try { actor = localStorage.getItem('hitechpos_admin_actor') || ''; } catch {}
$('#actor').value = actor;
let plans = [];
const tenantQuery = { page: 1 };
const auditQuery = { page: 1 };
let current = null; // tenant detail shown in the drawer

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 4000);
}

async function api(method, path, body) {
  const headers = { 'content-type': 'application/json', 'x-admin-key': key };
  if (actor) headers['x-admin-actor'] = encodeURIComponent(actor);
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && json.message) || 'Lỗi ' + res.status);
  return json;
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

$('#keyForm').onsubmit = (e) => {
  e.preventDefault();
  key = $('#adminKey').value.trim() || key;
  actor = $('#actor').value.trim();
  try { sessionStorage.setItem('hitechpos_admin', key); } catch {}
  try { localStorage.setItem('hitechpos_admin_actor', actor); } catch {}
  start();
};

/* ---- tabs -------------------------------------------------------------- */
function showTab(name) {
  $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  try { sessionStorage.setItem('hitechpos_admin_tab', name); } catch {}
  if (name === 'overview') loadOverview();
  if (name === 'tenants') loadTenants();
  if (name === 'revenue') loadRevenue();
  if (name === 'audit') loadAudit();
}
$('#tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };

/* ---- overview: stats, jobs, payments in review ------------------------- */
async function loadOverview() {
  try {
    const [stats, review] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/payments?status=review')]);
    $('#stats').innerHTML = [['Cửa hàng', stats.tenants], ['Đang hoạt động', stats.active], ['Dùng thử', stats.trialing], ['Trả phí', stats.paying], ['Bị khoá', stats.suspended], ['Cài lỗi', stats.installFailed], ['MRR (giá niêm yết)', vnd(stats.mrr)]]
      .map(([l, v]) => `<div class="stat"><span class="muted">${esc(l)}</span><b>${esc(v)}</b></div>`).join('');
    $('#review').innerHTML = review.map((p) => {
      const received = (p.events || []).filter((e) => e.amount != null).map((e) => e.amount).pop();
      return `<tr><td>${dt(p.createdAt)}</td><td>${esc(p.orderCode)}</td><td>${p.purpose === 'subscription' ? 'Thuê bao' : 'Tại quầy'}</td><td>${esc(p.provider)}</td>
        <td class="num">${vnd(p.amount)}</td><td class="num">${vnd(received)}</td><td><button class="ghost" data-accept="${esc(p.orderCode)}">Chấp nhận</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">Không có giao dịch cần đối soát</td></tr>';
  } catch (e) { toast(e.message); }
}
$('#review').onclick = async (e) => {
  const b = e.target.closest('[data-accept]');
  if (!b) return;
  const note = prompt('Ghi chú đối soát (mã giao dịch ngân hàng…)');
  if (note === null) return;
  try {
    await api('POST', `/api/admin/payments/${encodeURIComponent(b.dataset.accept)}/accept`, { note });
    toast('Đã chấp nhận giao dịch.');
    loadOverview();
  } catch (err) { toast(err.message); }
};
$('#jobExpiry').onclick = async () => {
  if (!confirm('Khoá các cửa hàng đã hết hạn quá thời gian gia hạn?')) return;
  try {
    const r = await api('POST', '/api/admin/jobs/enforce-expiry');
    toast(r.suspended.length ? 'Đã khoá: ' + r.suspended.join(', ') : 'Không có cửa hàng nào hết hạn.');
    loadOverview();
  } catch (e) { toast(e.message); }
};
$('#jobReminders').onclick = async () => {
  try {
    const r = await api('POST', '/api/admin/jobs/reminders');
    toast(r.sent.length ? `Đã gửi ${r.sent.length} email nhắc.` : 'Không có email nhắc cần gửi.');
  } catch (e) { toast(e.message); }
};

/* ---- tenants: filters, list, pagination -------------------------------- */
const statePill = (s, reason) => {
  const [label, cls] = STATE[s] || [s, ''];
  return `<span class="pill ${cls}">${esc(label)}${s === 'suspended' && reason ? ' · ' + esc(reason) : ''}</span>`;
};
const planName = (id) => (plans.find((p) => p.id === id) || {}).name || id || '–';

function pager(el, data, onPage) {
  el.innerHTML = `<span class="muted">${esc(data.total)} mục · trang ${esc(data.page)}/${esc(data.pages)}</span>
    <button class="ghost" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>‹ Trước</button>
    <button class="ghost" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Sau ›</button>`;
  el.onclick = (e) => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) onPage(Number(b.dataset.page)); };
}

async function loadTenants() {
  try {
    const data = await api('GET', '/api/admin/tenants/search?' + qs(tenantQuery));
    if (!plans.length) {
      plans = data.plans;
      $('#filters [name=plan]').insertAdjacentHTML('beforeend', plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''));
    }
    const c = data.counts;
    $('#counts').textContent = `Tổng ${c.all} · dùng thử ${c.trialing} · trả phí ${c.active} · hết hạn ${c.expired} · bị khoá ${c.suspended} · cài lỗi ${c.install_failed}`;
    $('#tenants').innerHTML = data.items.map((t) => `<tr class="click" data-open="${esc(t.id)}" tabindex="0">
      <td><b>${esc(t.businessName)}</b><br><span class="muted">${esc(t.subdomain)}</span></td>
      <td>${esc(t.ownerEmail || '–')}${t.ownerName ? `<br><span class="muted">${esc(t.ownerName)}</span>` : ''}</td>
      <td>${esc(planName(t.plan))}</td>
      <td>${t.subscription ? day(t.subscription.currentPeriodEnd) : '–'}</td>
      <td>${statePill(t.state, t.suspendedReason)}</td>
      <td>${day(t.createdAt)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Không có cửa hàng phù hợp</td></tr>';
    pager($('#tenantPager'), data, (p) => { tenantQuery.page = p; loadTenants(); });
  } catch (e) { toast(e.message); }
}
$('#filters').onsubmit = (e) => {
  e.preventDefault();
  Object.assign(tenantQuery, Object.fromEntries(new FormData(e.target)), { page: 1 });
  loadTenants();
};
$('#filters').onreset = () => {
  for (const k of Object.keys(tenantQuery)) delete tenantQuery[k];
  tenantQuery.page = 1;
  setTimeout(loadTenants);
};
$('#tenants').onclick = (e) => { const r = e.target.closest('[data-open]'); if (r) openTenant(r.dataset.open); };
$('#tenants').onkeydown = (e) => { const r = e.target.closest('[data-open]'); if (r && e.key === 'Enter') openTenant(r.dataset.open); };

/* ---- tenant detail drawer ---------------------------------------------- */
function closeDrawer() { $('#drawer').hidden = true; $('#backdrop').hidden = true; current = null; }
$('#backdrop').onclick = closeDrawer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#actionDialog').open && !$('#drawer').hidden) closeDrawer(); });

const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const changeText = (e) => {
  const b = e.before || {};
  const a = e.after || {};
  const parts = [];
  if (b.suspended !== a.suspended) parts.push(a.suspended ? 'mở → khoá' : 'khoá → mở');
  if (b.plan !== a.plan) parts.push(`gói ${planName(b.plan)} → ${planName(a.plan)}`);
  const be = b.subscription && b.subscription.currentPeriodEnd;
  const ae = a.subscription && a.subscription.currentPeriodEnd;
  if (be !== ae) parts.push(`hết hạn ${day(be)} → ${day(ae)}`);
  if (e.details && e.details.result) parts.push(`email: ${MAIL_RESULT[e.details.result] || e.details.result}`);
  if (e.details && e.details.limitsSynced === false) parts.push('chưa ghi được giới hạn vào CSDL cửa hàng');
  return parts.map(esc).join('; ') || '–';
};

async function openTenant(id) {
  try {
    current = await api('GET', `/api/admin/tenants/${encodeURIComponent(id)}`);
  } catch (e) { toast(e.message); return; }
  renderDrawer();
  $('#backdrop').hidden = false;
  $('#drawer').hidden = false;
  $('#drawer').focus();
}

function renderDrawer() {
  const d = current;
  const t = d.tenant;
  const sub = d.subscription || {};
  const onboarding = d.onboarding ? Object.entries(d.onboarding).filter(([k]) => !['at', 'preset'].includes(k)) : [];
  const actions = [
    t.suspended ? ['resume', 'ghost'] : ['suspend', 'danger'],
    ['extend', 'ghost'], ['change-plan', 'ghost'], ['resend-welcome', 'ghost'], ['reset-password', 'ghost'], ['note', 'ghost'],
  ];
  $('#drawer').innerHTML = `
    <div class="drawer-head">
      <div><h2 style="margin:0">${esc(t.businessName)}</h2>
        <div class="muted">${t.urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace('https://', ''))}</a>`).join(' · ')}</div>
        <div style="margin-top:4px">${statePill(t.state, t.suspendedReason)}</div></div>
      <button class="ghost" data-close>Đóng</button>
    </div>
    ${d.willResuspend ? '<div class="warnbox">Kỳ thuê bao đã hết quá thời gian gia hạn: tác vụ kiểm tra hết hạn sẽ khoá lại cửa hàng. Gia hạn trước khi mở khoá.</div>' : ''}
    <div class="actions">${actions.map(([a, cls]) => `<button class="${cls}" data-action="${a}">${esc(ACTION[a])}</button>`).join('')}</div>

    <h3>Thông tin</h3>
    ${kv([
      ['Mã cửa hàng', `<code>${esc(t.id)}</code>`], ['Tên miền', esc(t.subdomain)], ['CSDL', `<code>${esc(t.tenantDb)}</code>`],
      ['Ngành', esc(t.industry)], ['Mã số thuế', esc(t.taxCode || '–')], ['Tỉnh/thành', esc(t.province || '–')],
      ['Chủ cửa hàng', d.owner ? `${esc(d.owner.name || '')} &lt;${esc(d.owner.email)}&gt; ${esc(d.owner.phone || '')}` : '–'],
      ['Tạo lúc', dt(t.createdAt)], ['Kích hoạt', dt(t.activatedAt)],
      ...(t.installError ? [['Lỗi cài đặt', `<span class="pill bad">${esc(t.installError)}</span>`]] : []),
    ])}

    <h3>Thuê bao</h3>
    ${kv([
      ['Gói', esc(planName(d.plan && d.plan.id))],
      ['Trạng thái', esc(sub.status || '–')],
      ['Hết hạn', dt(sub.currentPeriodEnd)],
      ['Giới hạn', d.plan && d.plan.limits ? esc(Object.entries(d.plan.limits).map(([k, v]) => `${k}: ${v ?? '∞'}`).join(', ')) : '–'],
    ])}

    <h3>Thanh toán thuê bao</h3>
    <div class="wrap"><table><thead><tr><th>Mã đơn</th><th>Gói</th><th>Cổng</th><th>Trạng thái</th><th class="num">Số tiền</th><th>Thời gian</th></tr></thead><tbody>
      ${d.payments.map((p) => `<tr><td>${esc(p.orderCode)}</td><td>${esc(planName(p.planId))}${p.months ? ` · ${esc(p.months)} tháng` : ''}</td><td>${esc(p.provider)}</td>
        <td><span class="pill ${p.status === 'paid' ? 'ok' : p.status === 'review' ? 'warn' : ''}">${esc(p.status)}</span></td><td class="num">${vnd(p.amount)}</td><td>${dt(p.paidAt || p.createdAt)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có giao dịch</td></tr>'}
    </tbody></table></div>

    <h3>Tích hợp</h3>
    ${kv([
      ['Thanh toán tại quầy', d.paymentMethods.length || d.bankFeed ? [...d.paymentMethods, ...(d.bankFeed ? ['bank-feed'] : [])].map((m) => `<span class="pill">${esc(m)}</span>`).join(' ') : '–'],
      ['Hoá đơn điện tử', d.einvoice.configured ? `<span class="pill ok">${esc(d.einvoice.provider)} · ${esc(d.einvoice.environment)}${d.einvoice.autoIssue ? ' · tự động' : ''}</span>` : 'Chưa cấu hình'],
      ['Tên miền riêng', d.customDomains.length ? d.customDomains.map((c) => `<span class="pill ${c.verified ? 'ok' : 'warn'}">${esc(c.domain)}${c.verified ? '' : ' · chưa xác minh'}</span>`).join(' ') : '–'],
    ])}

    <h3>Khởi tạo (onboarding)</h3>
    ${onboarding.length ? kv(onboarding.map(([k, v]) => [ONBOARDING_STEP[k] || k, `<span class="${String(v).startsWith('failed') ? 'pill bad' : ''}">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`])) : '<p class="muted">Không có báo cáo.</p>'}

    <h3>Email đã gửi</h3>
    ${d.notices.length ? kv(d.notices.map((n) => [n.key, dt(n.at)])) : '<p class="muted">Chưa có.</p>'}

    <h3>Ghi chú nội bộ</h3>
    ${d.notes.length ? d.notes.map((n) => `<p style="margin:0 0 8px"><span class="muted">${dt(n.at)} · ${esc(n.actor)}</span><br>${esc(n.note)}</p>`).join('') : '<p class="muted">Chưa có ghi chú.</p>'}

    <h3>Lịch sử thao tác</h3>
    <div class="wrap"><table><tbody>
      ${d.audit.filter((e) => e.action !== 'note').map((e) => `<tr><td>${dt(e.at)}</td><td>${esc(e.actor)}</td><td>${esc(ACTION[e.action] || e.action)}</td><td>${esc(e.reason || '')}</td><td>${changeText(e)}</td></tr>`).join('') || '<tr><td class="muted">Chưa có thao tác.</td></tr>'}
    </tbody></table></div>`;
}
$('#drawer').tabIndex = -1;
$('#drawer').onclick = (e) => {
  if (e.target.closest('[data-close]')) return closeDrawer();
  const b = e.target.closest('[data-action]');
  if (b) openAction(b.dataset.action);
};

/* ---- action dialog: confirm + reason ----------------------------------- */
const ACTION_TEXT = {
  suspend: 'Cửa hàng sẽ ngừng phục vụ ngay (máy bán hàng và trang web). Dữ liệu được giữ nguyên.',
  resume: 'Cửa hàng được phục vụ trở lại ngay.',
  extend: 'Cộng thêm số ngày vào kỳ hiện tại (tính từ ngày hết hạn, hoặc từ hôm nay nếu đã hết hạn). Không tạo giao dịch thanh toán.',
  'change-plan': 'Đổi gói và ghi lại giới hạn (chi nhánh, người dùng, sản phẩm) vào CSDL cửa hàng. Không đổi ngày hết hạn, không tạo giao dịch.',
  'resend-welcome': 'Gửi lại email chào mừng tới email chủ cửa hàng.',
  'reset-password': 'Gửi email chứa liên kết đặt lại mật khẩu (hiệu lực 60 phút) tới chủ cửa hàng. Mật khẩu hiện tại vẫn dùng được cho tới khi đặt lại.',
  note: 'Ghi chú chỉ nhân viên HiTechCloud thấy.',
};
let pendingAction = null;

function openAction(action) {
  const d = current;
  pendingAction = action;
  const f = $('#actionForm');
  f.reset();
  $('#dlgTitle').textContent = `${ACTION[action]} – ${d.tenant.businessName}`;
  $('#dlgText').textContent = ACTION_TEXT[action];
  $('#dlgError').hidden = true;
  $('#dlgDaysWrap').hidden = action !== 'extend';
  $('#dlgPlanWrap').hidden = action !== 'change-plan';
  $('#dlgForceWrap').hidden = !(action === 'resume' && d.tenant.status === 'install_failed');
  const warn = action === 'resume' && d.willResuspend ? 'Kỳ thuê bao đã hết: cửa hàng sẽ bị khoá lại ở lần kiểm tra hết hạn kế tiếp. Nên gia hạn trước.' : '';
  $('#dlgWarn').textContent = warn;
  $('#dlgWarn').hidden = !warn;
  const optional = ['resend-welcome', 'reset-password'].includes(action);
  $('#dlgReasonLabel').textContent = action === 'note' ? 'Nội dung ghi chú' : optional ? 'Lý do (không bắt buộc)' : 'Lý do (bắt buộc, ghi vào nhật ký)';
  f.reason.maxLength = action === 'note' ? 2000 : 500;
  if (action === 'change-plan') {
    f.plan.innerHTML = '<option value="">– Chọn gói –</option>' + plans.map((p) => `<option value="${esc(p.id)}" ${d.plan && d.plan.id === p.id ? 'disabled' : ''}>${esc(p.name)} – ${vnd(p.monthlyPrice)}/tháng${d.plan && d.plan.id === p.id ? ' (đang dùng)' : ''}</option>`).join('');
    f.plan.value = '';
  }
  $('#dlgOk').className = action === 'suspend' ? 'danger' : '';
  $('#dlgOk').disabled = false;
  $('#actionDialog').showModal();
}

$('#actionForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!e.submitter || e.submitter.value !== 'ok') return $('#actionDialog').close();
  const f = e.target;
  const reason = f.reason.value.trim();
  const showError = (m) => { $('#dlgError').textContent = m; $('#dlgError').hidden = false; };
  const optional = ['resend-welcome', 'reset-password'].includes(pendingAction);
  if (pendingAction === 'note' ? !reason : !optional && reason.length < 3) return showError(pendingAction === 'note' ? 'Nhập nội dung ghi chú.' : 'Cần nhập lý do (ít nhất 3 ký tự).');
  if (pendingAction === 'change-plan' && !f.plan.value) return showError('Chọn gói mới.');
  const id = encodeURIComponent(current.tenant.id);
  $('#dlgOk').disabled = true;
  try {
    let r;
    if (pendingAction === 'note') {
      r = await api('POST', `/api/admin/tenants/${id}/notes`, { text: reason });
    } else {
      const body = { reason };
      if (pendingAction === 'extend') body.days = Number(f.days.value);
      if (pendingAction === 'change-plan') body.plan = f.plan.value;
      if (pendingAction === 'resume' && f.force.checked) body.force = true;
      r = await api('POST', `/api/admin/tenants/${id}/actions/${pendingAction}`, body);
    }
    $('#actionDialog').close();
    let msg = `${ACTION[pendingAction]}: xong.`;
    if (r.result) msg += ` Email ${MAIL_RESULT[r.result] || r.result}.`;
    if (r.limitsSynced === false) msg += ' Chưa ghi được giới hạn vào CSDL cửa hàng, cần kiểm tra.';
    if (r.willResuspend) msg += ' Lưu ý: cửa hàng sẽ bị khoá lại do đã hết hạn.';
    toast(msg);
    await openTenant(current.tenant.id);
    if (!$('[data-panel="tenants"]').hidden) loadTenants();
  } catch (err) {
    $('#dlgOk').disabled = false;
    showError(err.message);
  }
};

/* ---- revenue dashboard ------------------------------------------------- */
const PLAN_COLORS = { basic: 'var(--c1)', pro: 'var(--c2)', enterprise: 'var(--c3)', trial: 'var(--c4)', unknown: 'var(--c5)' };
const colorOf = (p) => PLAN_COLORS[p] || 'var(--c5)';
const short = (n) => (n >= 1e9 ? (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ' : n >= 1e6 ? (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n));

function revenueChart(rows) {
  const W = 760; const H = 250; const L = 56; const B = 24; const T = 22;
  const max = Math.max(1, ...rows.map((r) => r.total));
  const step = (W - L) / rows.length;
  const bw = Math.max(6, Math.min(40, step * 0.6));
  const y = (v) => H - B - ((H - B - T) * v) / max;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Doanh thu theo tháng">`;
  for (const v of ticks) svg += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#dde5ee"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(short(v))}</text>`;
  rows.forEach((r, i) => {
    const x = L + i * step + (step - bw) / 2;
    let base = 0;
    for (const [plan, amount] of Object.entries(r.byPlan)) {
      svg += `<rect x="${x}" y="${y(base + amount)}" width="${bw}" height="${y(base) - y(base + amount)}" fill="${colorOf(plan)}"><title>${esc(monthLabel(r.month))} · ${esc(planName(plan))}: ${esc(vnd(amount))}</title></rect>`;
      base += amount;
    }
    svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(monthLabel(r.month))}</text>`;
    if (r.total) svg += `<text x="${x + bw / 2}" y="${y(r.total) - 4}" text-anchor="middle">${esc(short(r.total))}</text>`;
  });
  return svg + '</svg>';
}

async function loadRevenue() {
  try {
    const r = await api('GET', '/api/admin/revenue?months=' + encodeURIComponent($('#revMonths').value));
    if (!plans.length) plans = (await api('GET', '/api/admin/tenants/search?limit=1')).plans;
    $('#revStats').innerHTML = [
      [`Doanh thu ${r.months.length} tháng`, vnd(r.total)], ['Số giao dịch', nf.format(r.count)],
      ['MRR ước tính', vnd(r.mrr.estimate)], ['MRR giá niêm yết', vnd(r.mrr.listPrice)], ['Thuê bao đang trả phí', nf.format(r.mrr.activeSubscriptions)],
      ['Chuyển đổi dùng thử → trả phí', `${pct(r.conversion.rate)}`], ['Cửa hàng đã trả phí', `${nf.format(r.conversion.converted)}/${nf.format(r.conversion.trials)}`],
    ].map(([l, v]) => `<div class="stat"><span class="muted">${esc(l)}</span><b>${esc(v)}</b></div>`).join('');
    const used = [...new Set(r.byMonth.flatMap((m) => Object.keys(m.byPlan)))];
    $('#revLegend').innerHTML = used.map((p) => `<span><i style="background:${colorOf(p)}"></i>${esc(planName(p))}</span>`).join('');
    $('#revChart').innerHTML = revenueChart(r.byMonth);
    const table = (obj, label) => Object.entries(obj).sort((a, b) => b[1].total - a[1].total)
      .map(([k, v]) => `<tr><td>${esc(label(k))}</td><td class="num">${nf.format(v.count)}</td><td class="num">${vnd(v.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Chưa có</td></tr>';
    $('#revPlans').innerHTML = table(r.byPlan, planName);
    $('#revProviders').innerHTML = table(r.byProvider, (k) => k);
    $('#revCohorts').innerHTML = r.conversion.cohorts.slice().reverse().map((c) => `<tr><td>${esc(monthLabel(c.month))}</td><td class="num">${nf.format(c.signups)}</td><td class="num">${nf.format(c.converted)}</td><td class="num">${pct(c.rate)}</td>
      <td>${c.rate ? `<div class="bar" style="width:${Math.round(c.rate * 100)}%"></div>` : ''}</td></tr>`).join('');
    const churnMax = Math.max(1, ...r.churn.map((c) => c.expiredPaid + c.expiredTrial + c.suspended));
    const churnBar = (n, cls) => (n ? `<div class="bar ${cls}" style="width:${Math.round((n / churnMax) * 100)}%;margin-left:auto"></div>` : '');
    $('#revChurn').innerHTML = r.churn.slice().reverse().map((c) => `<tr><td>${esc(monthLabel(c.month))}</td>
      <td class="num">${nf.format(c.expiredPaid)}${churnBar(c.expiredPaid, 'red')}</td>
      <td class="num">${nf.format(c.expiredTrial)}${churnBar(c.expiredTrial, 'amber')}</td>
      <td class="num">${nf.format(c.suspended)}</td></tr>`).join('');
    $('#revChurnNote').textContent = 'Hết hạn tính theo tháng của ngày hết hạn kỳ thuê bao; bị khoá tính theo nhật ký thao tác.' +
      (r.suspendedUndated ? ` ${r.suspendedUndated} cửa hàng bị khoá thủ công không có trong nhật ký (khoá trước khi có nhật ký).` : '');
  } catch (e) { toast(e.message); }
}
$('#revMonths').onchange = loadRevenue;

/* ---- audit log --------------------------------------------------------- */
$('#auditFilters [name=action]').insertAdjacentHTML('beforeend', Object.entries(ACTION).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join(''));
async function loadAudit() {
  try {
    const data = await api('GET', '/api/admin/audit?' + qs(auditQuery));
    $('#auditRows').innerHTML = data.items.map((e) => `<tr><td>${dt(e.at)}</td><td>${esc(e.actor)}</td>
      <td>${e.tenantId ? `<a href="#" data-open="${esc(e.tenantId)}">${esc(e.subdomain || e.tenantId)}</a>` : '–'}</td>
      <td>${esc(ACTION[e.action] || e.action)}</td><td>${esc(e.reason || e.note || '')}</td><td>${changeText(e)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có thao tác nào</td></tr>';
    pager($('#auditPager'), data, (p) => { auditQuery.page = p; loadAudit(); });
  } catch (e) { toast(e.message); }
}
$('#auditFilters').onsubmit = (e) => {
  e.preventDefault();
  Object.assign(auditQuery, Object.fromEntries(new FormData(e.target)), { page: 1 });
  loadAudit();
};
$('#auditFilters').onreset = () => {
  for (const k of Object.keys(auditQuery)) delete auditQuery[k];
  auditQuery.page = 1;
  setTimeout(loadAudit);
};
$('#auditRows').onclick = (e) => {
  const a = e.target.closest('[data-open]');
  if (!a) return;
  e.preventDefault();
  openTenant(a.dataset.open);
};

/* ---- start ------------------------------------------------------------- */
async function start() {
  try {
    await api('GET', '/api/admin/stats');
  } catch (e) { toast(e.message); return; }
  $('#tabs').hidden = false;
  $('#app').hidden = false;
  let tab = 'overview';
  try { tab = sessionStorage.getItem('hitechpos_admin_tab') || 'overview'; } catch {}
  showTab(['overview', 'tenants', 'revenue', 'audit'].includes(tab) ? tab : 'overview');
}
if (key) start();
