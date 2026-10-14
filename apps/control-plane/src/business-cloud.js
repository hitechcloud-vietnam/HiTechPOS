'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { rateLimit } = require('./security');
const { hashPassword, verifyPassword } = require('./passwords');
const { verifyToken } = require('./tokens');

/*
 * "Continue with HiTechPOS Cloud" for the owner app (upstream/business),
 * mounted at /api/business/v1 on the control plane. The contract is
 * upstream/business/docs/HITECHPOS_SERVER_CONTRACT.md, read off the app:
 *
 *   GET  /discovery          strict body, authorization business-cloud-pkce-v1
 *   POST /requests           phone starts: { codeChallenge, deviceName, stepUp? }
 *   GET  /authorize          browser page: control-plane owner signs in, picks
 *                            a shop, Allow / Deny (public/business-signin.*)
 *   POST /token              phone polls with its PKCE verifier; once approved
 *                            it gets { handoff: { origin, request } } exactly once
 *
 * The cloud never issues a reporting session. On hand-over it writes an
 * approved `business_authorizations` row (business-handoff.js) into the
 * shop's own database; the phone redeems it at the shop origin with the same
 * verifier and the shard issues its own pb1_ session after re-checking the
 * user, branches and ACL. Request rows live in the control DB
 * (store.businessRequests) keyed by sha256 of the opaque request, TTL 10 min.
 *
 * Request row states: pending -> approved | denied; approved -> handing_off
 * -> handed_off | revoked (password changed, shop suspended, owner user gone).
 */

const PATH = '/api/business/v1';
const REQUEST_TTL_S = 600;
const POLL_S = 5;
const DEFAULT_APP_LINK = 'vn.hitechpos.business://authorized';
const CONSENT_COOKIE = 'hb_consent';
const PHONE_PATHS = new Set(['/discovery', '/requests', '/token']);

/* Shown by the sign-in page; phone endpoints answer with the code only. */
const MESSAGES = {
  invalid_request: 'Yêu cầu không hợp lệ.',
  request_expired: 'Yêu cầu kết nối đã hết hạn. Hãy quay lại ứng dụng và bắt đầu lại.',
  request_already_handled: 'Yêu cầu kết nối này đã được xử lý. Hãy quay lại ứng dụng.',
  invalid_consent: 'Trang xác nhận không còn hiệu lực. Hãy mở lại liên kết từ ứng dụng.',
  credentials_invalid: 'Email hoặc mật khẩu không đúng.',
  sign_in_required: 'Vui lòng đăng nhập tài khoản HiTechPOS.',
  step_up_required: 'Vui lòng nhập lại mật khẩu để xác nhận danh tính.',
  shop_not_found: 'Không tìm thấy cửa hàng.',
  shop_suspended: 'Cửa hàng đang bị tạm khoá.',
  shop_unavailable: 'Cửa hàng chưa sẵn sàng sử dụng.',
  shop_owner_missing: 'Không tìm thấy tài khoản quản trị của cửa hàng có cùng email. Hãy kết nối trực tiếp bằng địa chỉ cửa hàng.',
  shop_link_unavailable: 'Máy chủ này chưa hỗ trợ kết nối ứng dụng chủ cửa hàng.',
  rate_limited: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
  not_found: 'Không tìm thấy.',
  server_unavailable: 'Lỗi hệ thống, vui lòng thử lại.',
};

const opaque = () => crypto.randomBytes(32).toString('base64url');
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const proof = (v) => crypto.createHash('sha256').update(String(v)).digest('base64url');
const validOpaque = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
/* Constant-time equality of two secrets of any length. */
const sameSecret = (a, b) =>
  typeof a === 'string' && typeof b === 'string' &&
  crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const time = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
const jsonForHtml = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/* `own` marks a deliberate answer, as opposed to an unexpected failure. */
function fail(code, status) {
  throw Object.assign(new Error(code), { code, status, own: true });
}

function originOf(value) {
  const url = new URL(String(value));
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('an origin has no path, query or credentials');
  return url.origin;
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* Same rule as the session middleware in app.js: a password change or reset
   invalidates every sign-in made before it (iat has one-second resolution). */
function passwordChangedSince(account, authenticatedAt) {
  return !!(account.passwordChangedAt && time(authenticatedAt) < new Date(account.passwordChangedAt).getTime() - 1000);
}

function loadPage(publicDir) {
  const html = fs.readFileSync(path.join(publicDir, 'business-signin.html'), 'utf8');
  const markers = ['<meta name="hb-csrf" content="">', '<script id="hb-state" type="application/json">{}</script>', 'nonce=""'];
  for (const m of markers) if (!html.includes(m)) throw new Error('business-signin.html is missing a template marker');
  return {
    render: ({ nonce, csrf, state }) => html
      .replace(markers[0], `<meta name="hb-csrf" content="${csrf}">`)
      .replace(markers[1], `<script id="hb-state" type="application/json">${jsonForHtml(state)}</script>`)
      .replaceAll(markers[2], `nonce="${nonce}"`),
    assets: {
      'business-signin.js': { type: 'text/javascript; charset=utf-8', body: fs.readFileSync(path.join(publicDir, 'business-signin.js'), 'utf8') },
      'business-signin.css': { type: 'text/css; charset=utf-8', body: fs.readFileSync(path.join(publicDir, 'business-signin.css'), 'utf8') },
    },
  };
}

/*
 * Options:
 *   store      control store with accounts, tenants and businessRequests
 *   config     config.publicUrl (issuer unless config.businessCloud.issuer),
 *              config.sessionSecret, config.shopBaseDomains, config.rateLimits,
 *              config.businessCloud.{issuer, corsOrigins, appLink}
 *   shopLink   { businessOwner(tenant, {email, userId, now}),
 *                insertBusinessAuthorization(tenant, fields) };
 *              defaults to store.shopBridge (store/mongo.js)
 */
function createBusinessCloudRouter({ store, config, now = () => new Date(), logger = console, shopLink, publicDir = path.join(__dirname, '..', 'public') }) {
  const settings = config.businessCloud || {};
  const issuer = originOf(settings.issuer || config.publicUrl);
  const shopDomain = String((config.shopBaseDomains || [])[0] || 'hitechpos.vn').toLowerCase();
  const corsOrigins = new Set((settings.corsOrigins || []).map((o) => originOf(o)));
  const appLink = settings.appLink || DEFAULT_APP_LINK;
  const secureCookie = issuer.startsWith('https:');
  const limits = config.rateLimits || {};
  const repo = store.businessRequests;
  const link = shopLink === undefined ? store.shopBridge || null : shopLink;
  if (!repo) throw new Error('store.businessRequests is required');
  const page = loadPage(publicDir);
  let dummyHash = null;

  const shopHost = (t) => `${t.subdomain}.${shopDomain}`;
  function shopOrigin(t) {
    const origin = `https://${shopHost(t)}`;
    if (originOf(origin) !== origin || origin === issuer) fail('shop_unavailable', 403);
    return origin;
  }
  function shopProblem(t, accountId) {
    if (!t || String(t.ownerAccountId) !== String(accountId)) return 'shop_not_found';
    if (t.suspended) return 'shop_suspended';
    if (!t.provisioned || t.status !== 'active' || !t.subdomain) return 'shop_unavailable';
    return null;
  }
  async function shopsOf(account) {
    const rows = await store.tenants.list({ ownerAccountId: String(account._id) });
    return rows.map((t) => {
      const reason = shopProblem(t, account._id);
      return { id: String(t._id), name: t.businessName || t.subdomain, host: shopHost(t), available: !reason, reason };
    });
  }
  /* Unknown emails still pay for one scrypt, so timing does not reveal
     which addresses have accounts. */
  function checkPassword(password, stored) {
    try {
      if (stored) return verifyPassword(password, stored);
      verifyPassword(password, dummyHash || (dummyHash = hashPassword(opaque())));
    } catch { /* malformed hash: not a match */ }
    return false;
  }

  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
    /* Native apps send no Origin; the Expo web preview needs CORS on the
       three phone endpoints only, never on the sign-in page APIs. */
    if (corsOrigins.size && PHONE_PATHS.has(req.path)) {
      res.vary('Origin');
      const origin = req.get('origin');
      if (origin && corsOrigins.has(origin)) {
        res.set('access-control-allow-origin', origin);
        if (req.method === 'OPTIONS') {
          res.set({ 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'Accept, Content-Type', 'access-control-max-age': '600' });
          return res.status(204).end();
        }
      }
    }
    next();
  });
  router.use(express.json({ limit: '16kb' }));

  const requestLimit = rateLimit({ windowMs: 60_000, max: limits.businessRequests ?? 20 });
  const tokenIpLimit = rateLimit({ windowMs: 60_000, max: limits.businessTokenIp ?? 240 });
  /* One phone polls every 5 s; many phones can share a carrier NAT address,
     so the tight limit is per request, the loose one per address. */
  const tokenLimit = rateLimit({ windowMs: 60_000, max: limits.businessToken ?? 30, key: (req) => `${req.ip}|${hash(String(plain(req.body).request)).slice(0, 32)}` });
  const pageLimit = rateLimit({ windowMs: 60_000, max: limits.businessPages ?? 60 });
  const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: limits.businessLogin ?? limits.login ?? 20 });

  router.get('/discovery', (_req, res) => {
    res.json({ product: 'posnic-business', apiVersion: 1, issuer, authorization: 'business-cloud-pkce-v1', audience: 'posnic-business', reporting: 'unavailable' });
  });

  router.post('/requests', requestLimit, async (req, res) => {
    const body = plain(req.body);
    if (body.stepUp !== undefined && typeof body.stepUp !== 'boolean') fail('invalid_request', 400);
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (!validOpaque(body.codeChallenge) || !deviceName || body.deviceName.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(deviceName)) fail('invalid_request', 400);
    const request = opaque();
    const created = now();
    await repo.insert({
      _id: hash(request),
      codeChallenge: body.codeChallenge,
      deviceName,
      stepUp: body.stepUp === true,
      status: 'pending',
      createdAt: created,
      expiresAt: new Date(created.getTime() + REQUEST_TTL_S * 1000),
    });
    res.json({ request, authorizationUrl: `${issuer}${PATH}/authorize?request=${request}`, expiresIn: REQUEST_TTL_S, interval: POLL_S });
  });

  /* Everything that can still stop an approved request from being handed
     over; a failure is final for this request. */
  async function checkApproved(row, at) {
    const revoke = async (reason) => {
      await repo.update(row._id, { status: 'approved' }, { status: 'revoked', revokedReason: reason, revokedAt: at });
      fail('access_denied', 403);
    };
    const account = await store.accounts.findById(row.accountId);
    if (!account || passwordChangedSince(account, row.authenticatedAt)) return revoke('password_changed');
    const tenant = await store.tenants.findById(row.tenantId);
    const problem = shopProblem(tenant, row.accountId);
    if (problem) return revoke(problem);
    if (!link || typeof link.insertBusinessAuthorization !== 'function') fail('server_unavailable', 503);
    return { tenant, origin: shopOrigin(tenant) };
  }

  router.post('/token', tokenIpLimit, tokenLimit, async (req, res) => {
    const { request, codeVerifier } = plain(req.body);
    if (!validOpaque(request) || !validOpaque(codeVerifier)) fail('invalid_request', 400);
    const id = hash(request);
    const at = now();
    const row = await repo.findById(id);
    /* A wrong verifier looks like an unknown request and does not burn it:
       guessing a 256-bit verifier is not a threat, a lock-out by anyone who
       saw the link would be. */
    if (!row || !(time(row.expiresAt) > at.getTime()) || !sameSecret(proof(codeVerifier), row.codeChallenge)) fail('request_expired', 410);
    if (row.status === 'pending') return res.status(202).json({ error: { code: 'authorization_pending' } });
    if (row.status === 'denied' || row.status === 'revoked') fail('access_denied', 403);
    if (row.status !== 'approved') fail('request_expired', 410);

    const { tenant, origin } = await checkApproved(row, at);
    if (!(await repo.update(id, { status: 'approved' }, { status: 'handing_off', claimedAt: at }))) fail('request_expired', 410);
    const handoff = opaque();
    let written;
    try {
      written = await link.insertBusinessAuthorization(tenant, {
        userId: row.shopUserId,
        requestHash: hash(handoff),
        codeChallenge: row.codeChallenge,
        deviceName: row.deviceName,
        stepUp: row.stepUp === true,
        authenticatedAt: new Date(row.authenticatedAt),
        now: at,
      });
    } catch {
      /* Nothing reached the phone: put the approval back so the next poll
         can try again. */
      await repo.update(id, { status: 'handing_off' }, { status: 'approved' }).catch(() => {});
      fail('server_unavailable', 503);
    }
    if (!written) {
      await repo.update(id, { status: 'handing_off' }, { status: 'revoked', revokedReason: 'owner_ineligible', revokedAt: at });
      fail('access_denied', 403);
    }
    await repo.update(id, { status: 'handing_off' }, { status: 'handed_off', handedOffAt: at });
    res.json({ handoff: { origin, request: handoff } });
  });

  /* ---- browser sign-in page ---- */

  router.get('/assets/:name', pageLimit, (req, res) => {
    const asset = Object.hasOwn(page.assets, req.params.name) ? page.assets[req.params.name] : null;
    if (!asset) fail('not_found', 404);
    res.set('cache-control', 'no-cache').type(asset.type).send(asset.body);
  });

  router.get('/authorize', pageLimit, async (req, res) => {
    const request = req.query.request;
    const at = now();
    let state = { error: 'invalid_request' };
    let status = 400;
    let csrf = '';
    if (validOpaque(request)) {
      state = { error: 'request_expired' };
      status = 410;
      const row = await repo.findById(hash(request));
      if (row && row.status === 'pending' && time(row.expiresAt) > at.getTime()) {
        csrf = opaque();
        /* Opening the page again replaces the earlier page and its sign-in,
           so only the newest browser tab can approve. */
        if (await repo.update(row._id, { status: 'pending' }, { consentHash: hash(csrf), login: null })) {
          status = 200;
          state = {
            request,
            deviceName: row.deviceName,
            matchingCode: request.slice(-6).toUpperCase(),
            stepUp: row.stepUp === true,
            expiresAt: new Date(row.expiresAt).toISOString(),
            appLink,
          };
          const maxAge = Math.max(1, Math.ceil((time(row.expiresAt) - at.getTime()) / 1000));
          res.append('set-cookie', `${CONSENT_COOKIE}=${csrf}; Path=${PATH}/authorize; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secureCookie ? '; Secure' : ''}`);
        } else {
          csrf = '';
        }
      }
    }
    const nonce = opaque();
    res.status(status).set({
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      'cross-origin-opener-policy': 'same-origin',
    }).type('html').send(page.render({ nonce, csrf, state }));
  });

  /* Every page API: same-origin JSON post carrying the page's CSRF token,
     which must equal the HttpOnly cookie set with the page and the hash
     stored on the request. */
  async function consent(req) {
    const body = plain(req.body);
    if (req.get('origin') !== issuer || !req.is('application/json')) fail('invalid_consent', 403);
    if (!validOpaque(body.request) || !validOpaque(body.csrf) || !sameSecret(readCookie(req, CONSENT_COOKIE) || '', body.csrf)) fail('invalid_consent', 403);
    const row = await repo.findById(hash(body.request));
    if (!row || !(time(row.expiresAt) > now().getTime())) fail('request_expired', 410);
    if (row.status !== 'pending') fail('request_already_handled', 409);
    if (!row.consentHash || !sameSecret(hash(body.csrf), row.consentHash)) fail('invalid_consent', 403);
    return { body, row };
  }

  async function bindLogin(row, account, method, authenticatedAt) {
    const login = { consentHash: row.consentHash, accountId: String(account._id), method, authenticatedAt };
    if (!(await repo.update(row._id, { status: 'pending', consentHash: row.consentHash }, { login }))) fail('request_already_handled', 409);
    return { account: { email: account.email, name: account.name || '' }, stepUp: row.stepUp === true, shops: await shopsOf(account) };
  }

  router.post('/authorize/login', loginLimit, async (req, res) => {
    const { body, row } = await consent(req);
    const email = typeof body.email === 'string' && body.email.length <= 254 ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' && body.password.length <= 256 ? body.password : '';
    const account = email ? await store.accounts.findByEmail(email) : null;
    const ok = checkPassword(password, account && account.passwordHash);
    if (!account || !ok || !password) fail('credentials_invalid', 401);
    res.json(await bindLogin(row, account, 'password', now()));
  });

  /* The owner is already signed in on this origin (account page token).
     Not enough for a step-up request, which always asks for the password. */
  router.post('/authorize/session', loginLimit, async (req, res) => {
    const { row } = await consent(req);
    if (row.stepUp === true) fail('step_up_required', 401);
    const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const claims = verifyToken(token, config.sessionSecret, { now: now().getTime() });
    if (!claims || typeof claims.sub !== 'string' || !Number.isFinite(claims.iat)) fail('sign_in_required', 401);
    const account = await store.accounts.findById(claims.sub);
    const authenticatedAt = new Date(claims.iat * 1000);
    if (!account || passwordChangedSince(account, authenticatedAt)) fail('sign_in_required', 401);
    res.json(await bindLogin(row, account, 'session', authenticatedAt));
  });

  router.post('/authorize/decision', pageLimit, async (req, res) => {
    const { body, row } = await consent(req);
    const at = now();
    const login = row.login;
    if (!login || !login.accountId || !sameSecret(String(login.consentHash || ''), row.consentHash)) fail('sign_in_required', 401);
    if (row.stepUp === true && login.method !== 'password') fail('step_up_required', 401);
    const account = await store.accounts.findById(login.accountId);
    if (!account || passwordChangedSince(account, login.authenticatedAt)) fail('sign_in_required', 401);
    const expected = { status: 'pending', consentHash: row.consentHash };

    if (body.decision === 'deny') {
      if (!(await repo.update(row._id, expected, { status: 'denied', decidedAt: at }))) fail('request_already_handled', 409);
      return res.json({ status: 'denied' });
    }
    if (body.decision !== 'allow') fail('invalid_request', 400);
    const tenant = typeof body.shopId === 'string' && body.shopId.length <= 64 ? await store.tenants.findById(body.shopId) : null;
    const problem = shopProblem(tenant, login.accountId);
    if (problem) fail(problem, problem === 'shop_not_found' ? 404 : 403);
    shopOrigin(tenant);
    if (!link || typeof link.businessOwner !== 'function') fail('shop_link_unavailable', 503);
    const owner = await link.businessOwner(tenant, { email: account.email, userId: tenant.businessOwnerUserId || null, now: at });
    if (!owner || typeof owner.userId !== 'string') fail('shop_owner_missing', 409);
    const approved = await repo.update(row._id, expected, {
      status: 'approved',
      accountId: String(login.accountId),
      authenticatedAt: new Date(login.authenticatedAt),
      tenantId: String(tenant._id),
      shopUserId: owner.userId,
      approvedAt: at,
    });
    if (!approved) fail('request_already_handled', 409);
    /* Remember which shop user the owner maps to, so a later email change
       inside the shop does not break the next sign-in. */
    if (tenant.businessOwnerUserId !== owner.userId) {
      await store.tenants.update(tenant._id, { businessOwnerUserId: owner.userId }).catch(() => {});
    }
    res.json({ status: 'approved', shop: { name: tenant.businessName || tenant.subdomain, host: shopHost(tenant) }, appLink });
  });

  router.use((_req, _res, next) => next(Object.assign(new Error('not_found'), { code: 'not_found', status: 404 })));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, _next) => {
    let status = Number(err.status || err.statusCode) || 500;
    let code = err.code;
    if (err.type && typeof err.type === 'string' && err.type.startsWith('entity.')) code = 'invalid_request';
    if (status >= 500 && !err.own) {
      /* Fixed text only: never request-derived values in logs. */
      logger.error(`[business-cloud] internal error ${/^[A-Za-z]{1,40}$/.test(String(err.name)) ? err.name : 'Error'}`);
      status = 500;
      code = 'server_unavailable';
    }
    if (typeof code !== 'string' || !/^[a-z0-9_]{1,64}$/.test(code)) code = status >= 500 ? 'server_unavailable' : 'invalid_request';
    const error = { code };
    if (req.path.startsWith('/authorize')) error.message = MESSAGES[code] || MESSAGES.server_unavailable;
    res.status(status).json({ error });
  });

  return router;
}

module.exports = { createBusinessCloudRouter, MESSAGES, REQUEST_TTL_S, POLL_S };
