'use strict';

/* Partner portal (doi-tac.html). Builds the DOM with textContent only, so
   nothing a shop or partner typed is ever parsed as HTML. The partner token
   is kept apart from the shop owner's session. */
(function () {
  const TOKEN_KEY = 'hitechpos_partner_token';
  const $ = (s) => document.querySelector(s);
  const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + ' ₫';
  const day = (s) => (s ? new Date(s).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '–');
  const PLAN = { trial: 'Dùng thử', basic: 'Cơ bản', pro: 'Chuyên nghiệp', enterprise: 'Doanh nghiệp' };
  const STATUS = {
    active: 'Hoạt động', trialing: 'Dùng thử', expired: 'Hết hạn', suspended: 'Tạm khoá', install_failed: 'Lỗi khởi tạo', provisioning: 'Đang khởi tạo',
    pending: 'Chờ duyệt', approved: 'Đã duyệt', paid: 'Đã chi trả', reversed: 'Đã huỷ (hoàn tiền)', terminated: 'Đã chấm dứt',
  };
  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* storage blocked */ }

  function saveToken(t) {
    token = t || '';
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* storage blocked */ }
  }

  async function api(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    if (res.status === 401 && path !== '/api/partners/auth/login') {
      saveToken('');
      showLogin();
    }
    if (!res.ok) throw new Error((json && json.message) || 'Lỗi ' + res.status);
    return json;
  }

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }

  function pill(status) {
    return el('span', STATUS[status] || status, 'pill ' + (/^[a-z_]+$/.test(status || '') ? status : ''));
  }

  function row(cells) {
    const tr = document.createElement('tr');
    for (const c of cells) {
      if (c instanceof Node) {
        const td = document.createElement('td');
        td.appendChild(c);
        tr.appendChild(td);
      } else if (c && typeof c === 'object') {
        tr.appendChild(el('td', c.text, c.cls));
      } else tr.appendChild(el('td', c));
    }
    return tr;
  }

  function emptyRow(tbody, cols, text) {
    const tr = document.createElement('tr');
    const td = el('td', text, 'muted');
    td.colSpan = cols;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  function ruleText(c) {
    if (!c) return '–';
    let s = c.percent + '% doanh thu thuê bao';
    if (c.firstMonths) s += ', ' + c.firstMonths + ' tháng trả phí đầu tiên';
    s += c.recurring ? ' (mỗi lần gia hạn)' : ' (lần thanh toán đầu tiên)';
    return s;
  }

  function showLogin() {
    $('#app').hidden = true;
    $('#logout').hidden = true;
    $('#who').textContent = '';
    $('#login').hidden = false;
  }

  async function load() {
    const [me, shops, commissions] = await Promise.all([
      api('GET', '/api/partners/me'), api('GET', '/api/partners/me/shops'), api('GET', '/api/partners/me/commissions'),
    ]);
    const p = me.partner;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#logout').hidden = false;
    $('#who').textContent = p.name;
    $('#refLink').value = p.referralUrl;
    $('#refCode').textContent = p.code;
    $('#ruleText').textContent = ruleText(p.commission);
    $('#discountText').textContent = p.customerDiscount ? 'Giảm thêm ' + p.customerDiscount.percent + '% kỳ trả phí đầu tiên' : 'Không áp dụng';
    const st = $('#partnerStatus');
    st.textContent = STATUS[p.status] || p.status;
    st.className = 'pill ' + p.status;

    const t = commissions.totals || {};
    $('#tPending').textContent = vnd(t.pending);
    $('#tApproved').textContent = vnd(t.approved);
    $('#tPaid').textContent = vnd(t.paid);

    const cBody = $('#commissions');
    cBody.replaceChildren();
    for (const c of commissions.items) {
      const label = c.kind === 'reversal' ? 'Điều chỉnh hoàn tiền' : PLAN[c.planId] || c.planId || '–';
      cBody.appendChild(row([
        day(c.createdAt), c.businessName || '–', label, { text: c.eligibleMonths + '/' + c.months, cls: 'num' },
        { text: vnd(c.base), cls: 'num' }, { text: c.percent + '%', cls: 'num' }, { text: vnd(c.amount), cls: 'num' }, pill(c.status),
      ]));
    }
    if (!commissions.items.length) emptyRow(cBody, 8, 'Chưa có hoa hồng. Hoa hồng phát sinh khi cửa hàng bạn giới thiệu thanh toán gói cước.');

    const sBody = $('#shops');
    sBody.replaceChildren();
    for (const s of shops) {
      sBody.appendChild(row([s.businessName, PLAN[s.plan] || s.plan || '–', pill(s.status), day(s.currentPeriodEnd), day(s.attributedAt)]));
    }
    if (!shops.length) emptyRow(sBody, 5, 'Chưa có cửa hàng nào đăng ký qua liên kết của bạn.');
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = $('#loginMsg');
    msg.className = 'msg';
    msg.textContent = 'Đang đăng nhập…';
    try {
      const r = await api('POST', '/api/partners/auth/login', { email: f.get('email'), password: f.get('password') });
      saveToken(r.token);
      msg.textContent = '';
      e.target.reset();
      await load();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  $('#logout').addEventListener('click', (e) => {
    e.preventDefault();
    saveToken('');
    showLogin();
  });

  $('#copyLink').addEventListener('click', async () => {
    const msg = $('#copyMsg');
    try {
      await navigator.clipboard.writeText($('#refLink').value);
      msg.className = 'msg ok';
      msg.textContent = 'Đã sao chép liên kết.';
    } catch {
      $('#refLink').select();
      msg.className = 'msg';
      msg.textContent = 'Nhấn Ctrl+C (hoặc giữ để sao chép) liên kết đã chọn.';
    }
  });

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = $('#pwMsg');
    try {
      const r = await api('POST', '/api/partners/me/password', { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') });
      saveToken(r.token);
      e.target.reset();
      msg.className = 'msg ok';
      msg.textContent = 'Đã đổi mật khẩu. Các phiên đăng nhập cũ đã bị đăng xuất.';
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  if (token) load().catch(() => showLogin());
  else showLogin();
})();
