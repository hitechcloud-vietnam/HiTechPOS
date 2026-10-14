'use strict';

/*
 * HiTechPOS Cloud sign-in page for the owner app (src/business-cloud.js).
 * Loaded with a CSP nonce; no inline script. The server puts the request
 * state in #hb-state and the page's CSRF token in <meta name="hb-csrf">.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const API = '/api/business/v1/authorize/';
  const status = $('status');
  const say = (text) => { status.textContent = text || ''; };

  let state = {};
  try { state = JSON.parse($('hb-state').textContent || '{}') || {}; } catch { state = {}; }
  const meta = document.querySelector('meta[name="hb-csrf"]');
  const csrf = meta ? meta.getAttribute('content') : '';

  const PAGE_ERRORS = {
    invalid_request: 'Liên kết không hợp lệ. Hãy mở lại liên kết từ ứng dụng HiTechPOS Business.',
    request_expired: 'Yêu cầu kết nối đã hết hạn hoặc đã được xử lý. Hãy quay lại ứng dụng và bắt đầu lại.',
  };
  if (state.error || !state.request || !csrf) {
    say(PAGE_ERRORS[state.error] || PAGE_ERRORS.invalid_request);
    return;
  }

  $('device').textContent = state.deviceName || '';
  $('code').textContent = state.matchingCode || '';
  $('intro').hidden = false;
  if (state.stepUp) {
    $('title').textContent = 'Xác nhận lại danh tính';
    $('stepup-note').hidden = false;
  }

  const REASONS = { shop_suspended: 'đang tạm khoá', shop_unavailable: 'chưa sẵn sàng', shop_not_found: 'không khả dụng' };
  const controls = () => document.querySelectorAll('button, input');
  function busy(on) {
    controls().forEach((el) => { el.disabled = on || el.dataset.off === '1'; });
  }

  async function call(path, body, headers) {
    const response = await fetch(API + path, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers || {}),
      body: JSON.stringify(Object.assign({ request: state.request, csrf }, body)),
    });
    let json = null;
    try { json = await response.json(); } catch { json = null; }
    if (!response.ok) {
      const error = new Error('request failed');
      error.status = response.status;
      error.code = json && json.error && json.error.code;
      error.text = json && json.error && json.error.message;
      throw error;
    }
    return json;
  }

  function fatal(error) {
    $('login').hidden = true;
    $('consent').hidden = true;
    say(error.text || 'Không thể kết nối tới máy chủ. Vui lòng thử lại.');
  }

  function showLogin(message) {
    $('consent').hidden = true;
    $('login').hidden = false;
    say(message || '');
    $('email').focus();
  }

  function showConsent(data) {
    $('login').hidden = true;
    $('password').value = '';
    $('who').textContent = data.account.email;
    const list = $('shop-list');
    list.replaceChildren();
    const usable = data.shops.filter((s) => s.available);
    data.shops.forEach((shop) => {
      const label = document.createElement('label');
      label.className = 'shop' + (shop.available ? '' : ' off');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'shop';
      radio.value = shop.id;
      radio.dataset.off = shop.available ? '0' : '1';
      radio.disabled = !shop.available;
      radio.checked = shop.available && usable.length === 1;
      const text = document.createElement('span');
      text.textContent = shop.name;
      const host = document.createElement('small');
      host.textContent = shop.host + (shop.available ? '' : ' – ' + (REASONS[shop.reason] || 'không khả dụng'));
      text.append(host);
      label.append(radio, text);
      list.append(label);
    });
    $('allow').dataset.off = usable.length ? '0' : '1';
    $('allow').disabled = !usable.length;
    $('consent').hidden = false;
    say(!data.shops.length ? 'Tài khoản này chưa có cửa hàng nào.' : !usable.length ? 'Chưa có cửa hàng nào sẵn sàng để kết nối.' : '');
  }

  function handle(error) {
    if (error.status === 401 && error.code !== 'credentials_invalid') return showLogin(error.text);
    if (error.status === 401 || error.status === 429) return say(error.text);
    if (error.code === 'shop_suspended' || error.code === 'shop_unavailable' || error.code === 'shop_owner_missing' || error.code === 'shop_not_found') return say(error.text);
    return fatal(error);
  }

  $('login').addEventListener('submit', async (event) => {
    event.preventDefault();
    busy(true);
    say('Đang đăng nhập…');
    try {
      showConsent(await call('login', { email: $('email').value, password: $('password').value }));
    } catch (error) {
      $('password').value = '';
      handle(error);
    } finally {
      busy(false);
    }
  });

  $('switch').addEventListener('click', () => showLogin());

  $('consent').addEventListener('submit', async (event) => {
    event.preventDefault();
    const chosen = document.querySelector('input[name="shop"]:checked');
    if (!chosen) return say('Vui lòng chọn cửa hàng.');
    busy(true);
    say('Đang kết nối…');
    try {
      const result = await call('decision', { decision: 'allow', shopId: chosen.value });
      $('consent').hidden = true;
      say('Đã kết nối với ' + result.shop.name + '. Hãy quay lại ứng dụng HiTechPOS Business để tiếp tục.');
      // The app link carries nothing: the phone finishes by polling with its own PKCE verifier.
      if (/^[a-z][a-z0-9+.-]*:\/\/[a-z]*$/.test(result.appLink || '')) {
        const open = $('open-app');
        open.href = result.appLink;
        $('done').hidden = false;
        if (/Android|iPhone|iPad|iPod/.test(navigator.userAgent)) window.location.assign(result.appLink);
      }
    } catch (error) {
      handle(error);
    } finally {
      busy(false);
    }
  });

  $('deny').addEventListener('click', async () => {
    busy(true);
    try {
      await call('decision', { decision: 'deny' });
      $('consent').hidden = true;
      say('Đã từ chối yêu cầu kết nối. Bạn có thể đóng trang này.');
    } catch (error) {
      handle(error);
    } finally {
      busy(false);
    }
  });

  /* Already signed in on app.hitechpos.vn (account page)? Reuse that
     session, except for a step-up which always asks for the password. */
  let token = null;
  try { token = window.localStorage.getItem('hitechpos_token'); } catch { token = null; }
  if (token && !state.stepUp) {
    busy(true);
    call('session', {}, { Authorization: 'Bearer ' + token })
      .then(showConsent, () => showLogin())
      .finally(() => busy(false));
  } else {
    showLogin();
  }
})();
