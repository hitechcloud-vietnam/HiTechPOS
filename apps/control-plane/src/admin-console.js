'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { PLANS, getPlan } = require('./plans');
const { createTenantService } = require('./tenants');

/*
 * Operator console API, mounted under /api/admin behind the X-Admin-Key
 * check of app.js. Adds what app.js does not already serve:
 *
 *   GET  /tenants/search                  filter + paginate tenants
 *   GET  /tenants/:id                     detail (never any secret)
 *   POST /tenants/:id/actions/suspend     { reason }
 *   POST /tenants/:id/actions/resume      { reason }
 *   POST /tenants/:id/actions/extend      { days, reason }
 *   POST /tenants/:id/actions/change-plan { plan, reason }
 *   POST /tenants/:id/actions/resend-welcome   { reason? }
 *   POST /tenants/:id/actions/reset-password   { reason? }
 *   POST /tenants/:id/notes               { text }
 *   GET  /audit                           audit log, newest first
 *   GET  /revenue?months=12               paid subscriptions, MRR, conversion, churn
 *
 * Every action writes an audit entry (who, what, when, before/after) through
 * store.adminConsole. The actor is the X-Admin-Actor header (percent-encoded
 * allowed, since browsers cannot send non-Latin-1 header values) or "admin".
 *
 * State changes reuse the existing services: suspension through
 * tenants.setSuspended (the `suspended` flag the shard reads), plan changes
 * mirror billing.activate (plan record + shopBridge.setLimits), period
 * extension mirrors activate's "from the later of now and the current end"
 * rule, and email goes through the notifier.
 */

const DAY = 86400000;
const VN_OFFSET_MS = 7 * 3600000;
const SYSTEM_SUSPEND_REASONS = new Set(['subscription_expired', 'install_failed']);
const ACTIONS = ['suspend', 'resume', 'extend', 'change-plan', 'resend-welcome', 'reset-password', 'note'];
const STATES = ['trialing', 'active', 'expired', 'suspended', 'install_failed'];

/* Errors carry a Vietnamese message: app.js's handler shows err.message for
   codes it has no translation for. */
function httpError(code, status, message) {
  return Object.assign(new Error(message || code), { code, status });
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const int = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
/* Calendar month in Vietnam time (UTC+7, no DST). */
const monthOf = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + VN_OFFSET_MS).toISOString().slice(0, 7) : null;
};
function lastMonths(now, n) {
  const d = new Date(now.getTime() + VN_OFFSET_MS);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}
const dayStart = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? Date.parse(`${s}T00:00:00+07:00`) : NaN);

function actorOf(req) {
  let a = String(req.headers['x-admin-actor'] || '').trim();
  if (a.includes('%')) {
    try { a = decodeURIComponent(a); } catch { a = ''; }
  }
  a = a.normalize('NFC').trim();
  return /^[\p{L}\p{N} ._@+-]{1,64}$/u.test(a) ? a : 'admin';
}

function reasonOf(body, { required = true } = {}) {
  const r = String((body && body.reason) || '').trim().slice(0, 500);
  if (required && r.length < 3) throw httpError('reason_required', 422, 'Cần nhập lý do (ít nhất 3 ký tự).');
  return r || null;
}

/* What an audit entry keeps of a tenant: the fields admin actions change. */
function snapshot(t) {
  if (!t) return null;
  return {
    status: t.status || null,
    suspended: !!t.suspended,
    suspendedReason: t.suspendedReason ?? null,
    plan: (t.plan && t.plan.id) || null,
    subscription: t.subscription ? { status: t.subscription.status || null, currentPeriodEnd: t.subscription.currentPeriodEnd || null } : null,
  };
}

/* Non-exclusive filter predicates for the status filter. */
function matchesState(t, state, nowMs) {
  const sub = t.subscription || {};
  const end = sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : NaN;
  switch (state) {
    case 'trialing': return sub.status === 'trialing' && !t.suspended;
    case 'active': return sub.status === 'active' && !t.suspended;
    case 'expired': return sub.status === 'expired' || (Number.isFinite(end) && end < nowMs);
    case 'suspended': return !!t.suspended;
    case 'install_failed': return t.status === 'install_failed';
    default: return true;
  }
}

/* The one label shown in the list. */
function stateOf(t, nowMs) {
  if (t.status === 'install_failed') return 'install_failed';
  if (t.suspended) return 'suspended';
  if (matchesState(t, 'expired', nowMs)) return 'expired';
  return (t.subscription && t.subscription.status) === 'active' ? 'active' : 'trialing';
}

/*
 * Pure filter/sort/paginate over tenant rows. `owners` maps ownerAccountId to
 * { email, name, phone }.
 */
function searchTenants(rows, owners, query = {}, now = new Date()) {
  const nowMs = now.getTime();
  const q = fold(query.q).trim();
  const state = STATES.includes(query.status) ? query.status : '';
  const plan = String(query.plan || '').trim();
  const from = dayStart(query.from);
  const to = dayStart(query.to);
  const filtered = rows.filter((t) => {
    if (q) {
      const o = owners.get(String(t.ownerAccountId)) || {};
      const hay = fold([t.subdomain, t.businessName, o.email, o.name, o.phone, t.taxCode, ...(t.hosts || [])].filter(Boolean).join(' '));
      if (!hay.includes(q)) return false;
    }
    if (state && !matchesState(t, state, nowMs)) return false;
    if (plan && (!t.plan || t.plan.id !== plan)) return false;
    const created = Date.parse(t.createdAt);
    if (Number.isFinite(from) && !(created >= from)) return false;
    if (Number.isFinite(to) && !(created < to + DAY)) return false;
    return true;
  });
  const sorters = {
    created: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    'created-asc': (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
    'period-end': (a, b) => String((a.subscription || {}).currentPeriodEnd || '9').localeCompare(String((b.subscription || {}).currentPeriodEnd || '9')),
    name: (a, b) => String(a.businessName || '').localeCompare(String(b.businessName || ''), 'vi'),
  };
  filtered.sort(sorters[query.sort] || sorters.created);
  const limit = int(query.limit, 25, 1, 100);
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const page = int(query.page, 1, 1, pages);
  const counts = Object.fromEntries(STATES.map((s) => [s, rows.filter((t) => matchesState(t, s, nowMs)).length]));
  return { total: filtered.length, page, pages, limit, counts: { all: rows.length, ...counts }, items: filtered.slice((page - 1) * limit, page * limit) };
}

/*
 * Revenue figures in integer VND. `payments` are paid subscription journal
 * rows; `suspendAudit` the audit entries of admin suspensions (the tenant
 * document itself does not record when it was suspended).
 */
function computeRevenue({ tenants, payments, suspendAudit = [], now = new Date(), months = 12, graceDays = 7 }) {
  const window = lastMonths(now, months);
  const inWindow = new Set(window);
  const nowMs = now.getTime();
  const blank = () => ({ total: 0, count: 0 });
  const byMonth = new Map(window.map((m) => [m, { month: m, total: 0, count: 0, byPlan: {}, byProvider: {} }]));
  const byPlan = {};
  const byProvider = {};
  let total = 0;
  let count = 0;
  const paidTenants = new Set();
  const byOrderCode = new Map();
  for (const p of payments) {
    if (p.status !== 'paid' || p.purpose !== 'subscription' || !Number.isSafeInteger(p.amount)) continue;
    paidTenants.add(String(p.reference));
    byOrderCode.set(Number(p.orderCode), p);
    const m = monthOf(p.paidAt || p.updatedAt || p.createdAt);
    if (!inWindow.has(m)) continue;
    const plan = (p.metadata && p.metadata.quote && p.metadata.quote.planId) || 'unknown';
    const provider = p.provider || 'unknown';
    const row = byMonth.get(m);
    row.total += p.amount;
    row.count += 1;
    row.byPlan[plan] = (row.byPlan[plan] || 0) + p.amount;
    row.byProvider[provider] = (row.byProvider[provider] || 0) + p.amount;
    byPlan[plan] = byPlan[plan] || blank();
    byPlan[plan].total += p.amount;
    byPlan[plan].count += 1;
    byProvider[provider] = byProvider[provider] || blank();
    byProvider[provider].total += p.amount;
    byProvider[provider].count += 1;
    total += p.amount;
    count += 1;
  }

  /* MRR: each paying, unsuspended shop at the monthly value of its last
     payment (net of discount, VAT excluded), list price when unknown. */
  let estimate = 0;
  let listPrice = 0;
  let activeSubscriptions = 0;
  for (const t of tenants) {
    const sub = t.subscription || {};
    if (sub.status !== 'active' || t.suspended) continue;
    const end = Date.parse(sub.currentPeriodEnd);
    if (Number.isFinite(end) && end + graceDays * DAY < nowMs) continue;
    const plan = PLANS.find((p) => p.id === (t.plan && t.plan.id));
    const list = plan ? plan.monthlyPrice : 0;
    const last = byOrderCode.get(Number(sub.lastPaymentOrderCode));
    const q = last && last.metadata && last.metadata.quote;
    const monthly = q && Number.isSafeInteger(q.months) && q.months > 0 ? Math.floor((Number.isSafeInteger(q.net) ? q.net : last.amount) / q.months) : list;
    estimate += monthly;
    listPrice += list;
    activeSubscriptions += 1;
  }

  /* Trial -> paid: shops (install failures excluded) with at least one paid
     subscription payment, overall and by signup month. */
  const real = tenants.filter((t) => t.status !== 'install_failed');
  const cohorts = new Map(window.map((m) => [m, { month: m, signups: 0, converted: 0 }]));
  for (const t of real) {
    const c = cohorts.get(monthOf(t.createdAt));
    if (!c) continue;
    c.signups += 1;
    if (paidTenants.has(String(t._id))) c.converted += 1;
  }
  const converted = real.filter((t) => paidTenants.has(String(t._id))).length;
  const rate = (a, b) => (b ? Math.round((a / b) * 10000) / 10000 : 0);

  /* Churn by month: expiry dated by the period end that lapsed (paid vs.
     trial that never paid), admin suspensions by their audit entry. */
  const churn = new Map(window.map((m) => [m, { month: m, expiredPaid: 0, expiredTrial: 0, suspended: 0 }]));
  for (const t of tenants) {
    const sub = t.subscription || {};
    if (sub.status !== 'expired') continue;
    const row = churn.get(monthOf(sub.currentPeriodEnd));
    if (!row) continue;
    if (paidTenants.has(String(t._id))) row.expiredPaid += 1;
    else row.expiredTrial += 1;
  }
  const lastSuspend = new Map();
  for (const e of suspendAudit) {
    const prev = lastSuspend.get(e.tenantId);
    if (!prev || String(e.at) > String(prev)) lastSuspend.set(e.tenantId, e.at);
  }
  let suspendedUndated = 0;
  for (const t of tenants) {
    if (!t.suspended || SYSTEM_SUSPEND_REASONS.has(t.suspendedReason)) continue;
    const at = lastSuspend.get(String(t._id));
    const row = at && churn.get(monthOf(at));
    if (row) row.suspended += 1;
    else if (!at) suspendedUndated += 1;
  }

  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    months: window,
    total,
    count,
    byMonth: [...byMonth.values()],
    byPlan,
    byProvider,
    mrr: { estimate, listPrice, activeSubscriptions },
    conversion: {
      trials: real.length,
      converted,
      rate: rate(converted, real.length),
      cohorts: [...cohorts.values()].map((c) => ({ ...c, rate: rate(c.converted, c.signups) })),
    },
    churn: [...churn.values()],
    suspendedUndated,
  };
}

function createAdminConsoleRouter({
  store, config, billing = null, notifier, tenants = null, shopBridge = store.shopBridge || null,
  now = () => new Date(), logger = console,
}) {
  if (!store.adminConsole) throw new Error('store.adminConsole repository missing');
  const repo = store.adminConsole;
  const tenantService = tenants || createTenantService({ store, config, installer: null, now, logger });
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  const allTenants = () => (repo.listTenants ? repo.listTenants() : store.tenants.list());
  const ownersMap = async () => {
    const rows = repo.listAccounts ? await repo.listAccounts() : [];
    return new Map(rows.map((a) => [String(a._id), { email: a.email || null, name: a.name || null, phone: a.phone || null }]));
  };
  const paidSubscriptions = () => (repo.listPaidSubscriptions ? repo.listPaidSubscriptions() : store.payments.list({ purpose: 'subscription', status: 'paid' }));

  async function tenantOr404(id) {
    const t = await store.tenants.findById(id);
    if (!t) throw httpError('tenant_not_found', 404, 'Không tìm thấy cửa hàng.');
    return t;
  }

  const audit = (req, tenant, action, fields) => repo.insertAudit({
    at: now().toISOString(),
    actor: actorOf(req),
    action,
    tenantId: tenant ? String(tenant._id) : null,
    subdomain: tenant ? tenant.subdomain : null,
    ...fields,
  });

  /* The enforce-expiry job suspends any unsuspended shop whose period ended
     more than graceDays ago; the console warns before an action it undoes. */
  const willResuspend = (t) => {
    const end = t && t.subscription && Date.parse(t.subscription.currentPeriodEnd);
    return !!(t && !t.suspended && Number.isFinite(end) && end + (config.graceDays ?? 7) * DAY < now().getTime());
  };

  const row = (t, owners) => {
    const o = owners.get(String(t.ownerAccountId)) || {};
    return {
      id: String(t._id), subdomain: t.subdomain, businessName: t.businessName, industry: t.industry,
      status: t.status, state: stateOf(t, now().getTime()), suspended: !!t.suspended, suspendedReason: t.suspendedReason || null,
      plan: (t.plan && t.plan.id) || null, subscription: t.subscription ? { status: t.subscription.status, currentPeriodEnd: t.subscription.currentPeriodEnd } : null,
      ownerEmail: o.email || null, ownerName: o.name || null, createdAt: t.createdAt || null,
      url: `https://${tenantService.hostsOf(t)[0]}`,
    };
  };

  router.get('/tenants/search', async (req, res) => {
    const [rows, owners] = await Promise.all([allTenants(), ownersMap()]);
    const result = searchTenants(rows, owners, req.query || {}, now());
    res.set('cache-control', 'no-store').json({
      ...result,
      items: result.items.map((t) => row(t, owners)),
      plans: PLANS.map((p) => ({ id: p.id, name: p.name, monthlyPrice: p.monthlyPrice })),
    });
  });

  router.get('/tenants/:id', async (req, res) => {
    const t = await tenantOr404(req.params.id);
    const id = String(t._id);
    const [account, payments, auditLog] = await Promise.all([
      t.ownerAccountId ? store.accounts.findById(t.ownerAccountId) : null,
      store.payments.list({ reference: id, purpose: 'subscription' }),
      repo.listAudit({ tenantId: id }, { limit: 100 }),
    ]);
    const ps = t.paymentSettings || {};
    res.set('cache-control', 'no-store').json({
      tenant: {
        id, subdomain: t.subdomain, businessName: t.businessName, industry: t.industry, taxCode: t.taxCode || null, province: t.province || null,
        status: t.status, state: stateOf(t, now().getTime()), suspended: !!t.suspended, suspendedReason: t.suspendedReason || null,
        tenantDb: t.tenantDb, createdAt: t.createdAt || null, activatedAt: t.activatedAt || null, installError: t.installError || null,
        urls: tenantService.hostsOf(t).map((h) => `https://${h}`),
      },
      owner: account ? { email: account.email, name: account.name || null, phone: account.phone || null, createdAt: account.createdAt || null } : null,
      plan: t.plan || null,
      subscription: t.subscription || null,
      willResuspend: willResuspend(t),
      payments: payments.slice(0, 50).map((p) => ({
        orderCode: p.orderCode, status: p.status, amount: p.amount, provider: p.provider, createdAt: p.createdAt, paidAt: p.paidAt || null,
        planId: (p.metadata && p.metadata.quote && p.metadata.quote.planId) || null, months: (p.metadata && p.metadata.quote && p.metadata.quote.months) || null,
        reviewReason: p.reviewReason || null,
      })),
      onboarding: t.onboarding || null,
      customDomains: (t.customDomains || []).map((d) => ({ domain: d.domain, verified: !!d.verifiedAt, verifiedAt: d.verifiedAt || null, addedAt: d.addedAt || null })),
      einvoice: t.einvoiceSettings
        ? { configured: true, provider: t.einvoiceSettings.provider || null, environment: t.einvoiceSettings.environment || null, autoIssue: !!t.einvoiceSettings.autoIssue }
        : { configured: false },
      paymentMethods: ['vietqr', 'payos', 'pay2s'].filter((m) => ps[m]),
      bankFeed: !!ps.bankFeed,
      notices: Object.entries(t.notices || {}).map(([key, at]) => ({ key, at })).sort((a, b) => String(b.at).localeCompare(String(a.at))),
      notes: auditLog.items.filter((e) => e.action === 'note'),
      audit: auditLog.items,
    });
  });

  /* ---- actions ---------------------------------------------------------- */

  async function suspend(req, t) {
    if (t.suspended) throw httpError('already_suspended', 409, 'Cửa hàng đang bị khoá.');
    const reason = reasonOf(req.body);
    /* System reasons have meaning elsewhere (billing.activate lifts an
       expiry suspension on payment), so a typed reason never equals one. */
    const stored = SYSTEM_SUSPEND_REASONS.has(reason) ? `manual: ${reason}` : reason;
    const after = await tenantService.setSuspended(t._id, true, stored.slice(0, 200));
    return { after, reason };
  }

  async function resume(req, t) {
    if (!t.suspended) throw httpError('not_suspended', 409, 'Cửa hàng không bị khoá.');
    const reason = reasonOf(req.body);
    /* A failed install was suspended so a half-built shop is never served. */
    if (t.status === 'install_failed' && !(req.body && req.body.force === true)) {
      throw httpError('install_failed_resume', 409, 'Cửa hàng cài đặt lỗi; chỉ mở khoá sau khi đã khắc phục (xác nhận bắt buộc).');
    }
    const after = await tenantService.setSuspended(t._id, false);
    return { after, reason, extra: { willResuspend: willResuspend(after) } };
  }

  /* Same rule as billing.activate: extend from the later of now and the
     current end, so early extension never loses days and late extension
     does not back-date; an expiry suspension is lifted, a manual one kept. */
  async function extend(req, t) {
    const days = Number((req.body || {}).days);
    if (!Number.isInteger(days) || days < 1 || days > 366) throw httpError('days_invalid', 422, 'Số ngày gia hạn phải là số nguyên từ 1 đến 366.');
    const reason = reasonOf(req.body);
    const sub = t.subscription || {};
    const currentEnd = Date.parse(sub.currentPeriodEnd);
    const from = Number.isFinite(currentEnd) && sub.status !== 'expired' ? Math.max(currentEnd, now().getTime()) : now().getTime();
    const end = new Date(from + days * DAY).toISOString();
    const status = sub.status === 'expired' || !sub.status ? ((t.plan && t.plan.id) === 'trial' ? 'trialing' : 'active') : sub.status;
    const lift = t.suspendedReason === 'subscription_expired';
    const after = await store.tenants.update(t._id, {
      subscription: { ...sub, status, currentPeriodEnd: end },
      suspended: lift ? false : !!t.suspended,
      suspendedReason: lift ? null : t.suspendedReason ?? null,
    });
    if (!after) throw httpError('tenant_not_found', 404, 'Không tìm thấy cửa hàng.');
    return { after, reason, details: { days } };
  }

  /* Same plan record as billing.activate, then the shop's own limits. */
  async function changePlan(req, t) {
    const plan = getPlan(String((req.body || {}).plan || ''));
    if (t.plan && t.plan.id === plan.id) throw httpError('plan_unchanged', 409, 'Cửa hàng đang dùng gói này.');
    const reason = reasonOf(req.body);
    const after = await store.tenants.update(t._id, { plan: { id: plan.id, limits: plan.limits, features: plan.features } });
    if (!after) throw httpError('tenant_not_found', 404, 'Không tìm thấy cửa hàng.');
    let limitsSynced = null;
    if (shopBridge && shopBridge.setLimits) {
      try {
        await shopBridge.setLimits(after, plan.limits);
        limitsSynced = true;
      } catch {
        limitsSynced = false;
        logger.warn('[admin-console] plan limits not written to the shop database');
      }
    }
    return { after, reason, details: { from: (t.plan && t.plan.id) || null, to: plan.id, limitsSynced }, extra: { limitsSynced } };
  }

  async function resendWelcome(req, t) {
    const reason = reasonOf(req.body, { required: false });
    if (!notifier) throw httpError('notifier_unavailable', 501, 'Chưa cấu hình gửi email.');
    /* A fresh key: notifier.send() sends each key once. */
    const result = await notifier.send(t, 'welcome', `welcome:resend:${now().toISOString()}`);
    if (result === 'no-recipient') throw httpError('owner_missing', 409, 'Cửa hàng chưa có email chủ cửa hàng.');
    return { after: await store.tenants.findById(t._id), reason, details: { result }, extra: { result } };
  }

  /* Same token scheme as POST /api/auth/forgot (hash stored, one hour,
     single use), so /reset accepts the emailed link. */
  async function resetPassword(req, t) {
    const reason = reasonOf(req.body, { required: false });
    if (!notifier) throw httpError('notifier_unavailable', 501, 'Chưa cấu hình gửi email.');
    const account = t.ownerAccountId ? await store.accounts.findById(t.ownerAccountId) : null;
    if (!account || !account.email) throw httpError('owner_missing', 409, 'Cửa hàng chưa có email chủ cửa hàng.');
    const token = crypto.randomBytes(32).toString('base64url');
    await store.accounts.update(account._id, {
      resetTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      resetExpiresAt: new Date(now().getTime() + 3600000).toISOString(),
    });
    const result = await notifier.sendTo(account.email, 'passwordReset', { token });
    return { after: t, reason, details: { result }, extra: { result } };
  }

  const handlers = { suspend, resume, extend, 'change-plan': changePlan, 'resend-welcome': resendWelcome, 'reset-password': resetPassword };

  router.post('/tenants/:id/actions/:action', async (req, res) => {
    const handler = Object.hasOwn(handlers, req.params.action) ? handlers[req.params.action] : null;
    if (!handler) throw httpError('action_unknown', 404, 'Thao tác không hợp lệ.');
    const t = await tenantOr404(req.params.id);
    const { after, reason, details, extra } = await handler(req, t);
    const entry = await audit(req, t, req.params.action, { reason, before: snapshot(t), after: snapshot(after), ...(details ? { details } : {}) });
    res.json({ ok: true, action: req.params.action, tenant: snapshot(after), audit: entry, ...(extra || {}) });
  });

  router.post('/tenants/:id/notes', async (req, res) => {
    const t = await tenantOr404(req.params.id);
    const text = String((req.body || {}).text || '').trim().slice(0, 2000);
    if (!text) throw httpError('note_empty', 422, 'Ghi chú không được để trống.');
    const entry = await audit(req, t, 'note', { note: text, before: null, after: null });
    res.status(201).json(entry);
  });

  router.get('/audit', async (req, res) => {
    const query = {};
    for (const k of ['tenantId', 'action', 'actor']) {
      const v = req.query[k];
      if (typeof v === 'string' && v && v.length <= 64) query[k] = v;
    }
    if (query.action && !ACTIONS.includes(query.action)) throw httpError('action_unknown', 422, 'Thao tác không hợp lệ.');
    const limit = int(req.query.limit, 50, 1, 200);
    const page = int(req.query.page, 1, 1, 100000);
    const { total, items } = await repo.listAudit(query, { limit, skip: (page - 1) * limit });
    res.set('cache-control', 'no-store').json({ total, page, pages: Math.max(1, Math.ceil(total / limit)), limit, items });
  });

  router.get('/revenue', async (req, res) => {
    const months = int(req.query.months, 12, 1, 36);
    const [tenantRows, payments, suspendAudit] = await Promise.all([
      allTenants(), paidSubscriptions(), repo.listAudit({ action: 'suspend' }, { limit: 100000 }).then((r) => r.items),
    ]);
    res.set('cache-control', 'no-store').json(computeRevenue({ tenants: tenantRows, payments, suspendAudit, now: now(), months, graceDays: config.graceDays ?? 7 }));
  });

  return router;
}

module.exports = { createAdminConsoleRouter, searchTenants, computeRevenue, actorOf, snapshot, stateOf };
