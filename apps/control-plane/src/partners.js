'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { fail, isEmail, trimTrailingSlashes } = require('@hitechpos/payment-core');
const { isValidVNPhone, normalizeVNPhone } = require('@hitechpos/vn-locale');
const { hashPassword, verifyPassword } = require('./passwords');
const { signToken, verifyToken } = require('./tokens');
const { rateLimit } = require('./security');

/*
 * Partner / referral program (đại lý, cộng tác viên). See docs/DOI-TAC.md.
 *
 *   attribution   a signup carrying a partner's referral code is attributed to
 *                 that partner once (store.partnerAttributions, unique per
 *                 tenant) and mirrored on the tenant as `referral`; it never
 *                 changes afterwards. Unknown/inactive codes and self-referral
 *                 are ignored silently.
 *   discount      adjustQuote() is the billing hook that takes an extra
 *                 percentage off the first paid period of an attributed shop.
 *                 With no partner it returns the quote object untouched.
 *   commission    onPaid() is the billing hook run when a subscription payment
 *                 became paid. One ledger entry per payment, keyed
 *                 "C<orderCode>" (insert-unique, so webhook replays and
 *                 concurrent callers cannot double it). pending -> approved ->
 *                 paid; a refund reverses: an unpaid entry becomes 'reversed',
 *                 a paid one gets a negative "R<orderCode>" entry that goes
 *                 through the same approval.
 *
 * Money is integer VND. Percentages are stored as basis points (1% = 100) so
 * the arithmetic stays integer; every division floors explicitly.
 *
 * Partner sessions use tokens.js with a key derived from the session secret
 * and their own audience, so a partner token is not a valid owner token and
 * an owner token is not a valid partner token. Admin routes require the
 * X-Admin-Key, which no token can stand in for.
 */

const CODE_RE = /^[A-Z0-9]{4,20}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY_RE = /^[CR][1-9]\d{0,15}$/;
const PARTNER_STATUSES = Object.freeze(['active', 'suspended', 'terminated']);
const PARTNER_TYPES = Object.freeze(['dai_ly', 'cong_tac_vien']);
const COMMISSION_STATUSES = Object.freeze(['pending', 'approved', 'paid', 'reversed']);
const TOKEN_AUDIENCE = 'hitechpos:partner';
const REF_COOKIE = 'htp_ref';
const BPS = 10000;

const MESSAGES = {
  unauthorized: 'Vui lòng đăng nhập.',
  credentials_invalid: 'Email hoặc mật khẩu không đúng.',
  password_weak: 'Mật khẩu cần ít nhất 8 ký tự.',
  email_invalid: 'Email không hợp lệ.',
  phone_invalid: 'Số điện thoại di động không hợp lệ.',
  rate_limited: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
  partner_not_found: 'Không tìm thấy đối tác.',
  partner_name_invalid: 'Vui lòng nhập tên đối tác (2–120 ký tự).',
  partner_type_invalid: 'Loại đối tác không hợp lệ.',
  partner_status_invalid: 'Trạng thái đối tác không hợp lệ.',
  partner_code_invalid: 'Mã giới thiệu chỉ gồm chữ in hoa và số (4–20 ký tự).',
  partner_code_taken: 'Mã giới thiệu này đã được dùng.',
  partner_email_taken: 'Email này đã được dùng cho đối tác khác.',
  commission_percent_invalid: 'Tỷ lệ hoa hồng phải từ 0 đến 100, tối đa 2 chữ số thập phân.',
  commission_months_invalid: 'Số tháng tính hoa hồng phải là số nguyên dương.',
  discount_percent_invalid: 'Tỷ lệ ưu đãi cho khách phải từ 0 đến dưới 100, tối đa 2 chữ số thập phân.',
  commission_not_found: 'Không tìm thấy khoản hoa hồng.',
  commission_transition_invalid: 'Không thể chuyển khoản hoa hồng sang trạng thái này.',
  payout_ref_invalid: 'Mã chứng từ chi trả tối đa 100 ký tự.',
};

/* ---------- pure helpers ---------- */

function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

function generateCode(length = 8) {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

/* A percentage with at most two decimals -> integer basis points. */
function percentToBps(value, { max = 100, exclusiveMax = false } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  const bps = Math.round(n * 100);
  if (Math.abs(bps - n * 100) > 1e-6) return null;
  if (bps > max * 100 || (exclusiveMax && bps >= max * 100)) return null;
  return bps;
}

/* Commission on `base` VND at `bps` basis points, rounded down. */
function commissionAmount(base, bps) {
  if (!Number.isSafeInteger(base) || !Number.isSafeInteger(bps) || base < 0 || bps < 0 || bps > BPS) fail('commission_input_invalid', 422);
  return Math.floor((base * bps) / BPS);
}

/*
 * The partner's customer discount, applied on the net amount after the
 * prepay-cycle discount, rounded down; VAT is recomputed on the new net with
 * the same rule as plans.js. Returns a new quote; the input is not changed.
 */
function applyPartnerDiscount(q, bps, partner = {}) {
  if (!Number.isSafeInteger(bps) || bps <= 0 || bps >= BPS) return q;
  const partnerDiscount = Math.floor((q.net * bps) / BPS);
  const net = q.net - partnerDiscount;
  const vat = typeof q.vatRate === 'number' ? Math.round((net * q.vatRate) / 100) : 0;
  return { ...q, partnerDiscountPercent: bps / 100, partnerDiscount, net, vat, total: net + vat, partner: { id: partner.id || null, code: partner.code || null } };
}

/* Spreadsheet-safe CSV: text cells that a spreadsheet would read as a
   formula are prefixed with an apostrophe; numbers are written as is. */
function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/* The signup's referral code: the body field (the page forwards ?ref=),
   else ?ref= on the request, else the cookie set by GET /r/:code. */
function referralCodeFromRequest(req) {
  const b = (req && req.body) || {};
  const q = (req && req.query) || {};
  return normalizeCode(b.referralCode) || normalizeCode(q.ref) || normalizeCode(readCookie(req && req.headers && req.headers.cookie, REF_COOKIE));
}

function partnerTokenSecret(sessionSecret) {
  if (!sessionSecret) fail('session_secret_missing', 500);
  return crypto.createHmac('sha256', String(sessionSecret)).update('hitechpos/partner-session/v1').digest('hex');
}

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const httpError = (code, status) => Object.assign(new Error(code), { code, status });

/* ---------- service ---------- */

function createPartnerService({ store, config = {}, now = () => new Date() }) {
  const tokenSecret = partnerTokenSecret(config.sessionSecret);
  const opts = config.partners || {};
  let dummyHash = null;

  const findPartner = async (id) => {
    const p = await store.partners.findById(String(id));
    if (!p) fail('partner_not_found', 404);
    return p;
  };

  function validateRules(input, current = {}) {
    const out = {};
    if (input.commission !== undefined) {
      const c = input.commission || {};
      const percentBps = percentToBps(c.percent);
      if (percentBps === null) fail('commission_percent_invalid', 422);
      let firstMonths = null;
      if (c.firstMonths != null && c.firstMonths !== '') {
        firstMonths = Number(c.firstMonths);
        if (!Number.isSafeInteger(firstMonths) || firstMonths < 1 || firstMonths > 600) fail('commission_months_invalid', 422);
      }
      out.commission = { percentBps, firstMonths, recurring: c.recurring === true || c.recurring === 'true' };
    } else if (!current.commission) {
      /* No company default is assumed: the rate is a business decision. */
      fail('commission_percent_invalid', 422);
    }
    if (input.customerDiscount !== undefined) {
      const d = input.customerDiscount;
      if (d == null || d === '' || (typeof d === 'object' && (d.percent == null || d.percent === '' || Number(d.percent) === 0))) out.customerDiscount = null;
      else {
        const percentBps = percentToBps(typeof d === 'object' ? d.percent : d, { exclusiveMax: true });
        if (percentBps === null) fail('discount_percent_invalid', 422);
        out.customerDiscount = percentBps ? { percentBps } : null;
      }
    }
    return out;
  }

  function validateContact(input, { partial }) {
    const out = {};
    if (!partial || input.name !== undefined) {
      const name = str(input.name, 200);
      if (name.length < 2 || name.length > 120) fail('partner_name_invalid', 422);
      out.name = name;
    }
    if (!partial || input.email !== undefined) {
      const email = str(input.email, 254).toLowerCase();
      if (!isEmail(email)) fail('email_invalid', 422);
      out.email = email;
    }
    if (input.phone !== undefined && input.phone !== null && input.phone !== '') {
      if (!isValidVNPhone(input.phone)) fail('phone_invalid', 422);
      out.phone = normalizeVNPhone(input.phone);
    } else if (!partial) out.phone = null;
    if (!partial || input.type !== undefined) {
      const type = input.type == null ? 'dai_ly' : input.type;
      if (!PARTNER_TYPES.includes(type)) fail('partner_type_invalid', 422);
      out.type = type;
    }
    if (input.status !== undefined) {
      if (!PARTNER_STATUSES.includes(input.status)) fail('partner_status_invalid', 422);
      out.status = input.status;
    } else if (!partial) out.status = 'active';
    if (input.payoutInfo !== undefined || !partial) out.payoutInfo = str(input.payoutInfo, 300) || null;
    if (input.note !== undefined || !partial) out.note = str(input.note, 500) || null;
    return out;
  }

  const duplicateError = (e) => {
    if (e && e.code === 'duplicate') fail(e.field === 'email' ? 'partner_email_taken' : 'partner_code_taken', 409);
    throw e;
  };

  /* Admin: create a partner. Without a password a random one is generated
     and returned once, for staff to hand over. */
  async function createPartner(input = {}) {
    const doc = { ...validateContact(input, { partial: false }), ...validateRules(input) };
    let initialPassword = null;
    let password = input.password;
    if (password === undefined || password === null || password === '') {
      initialPassword = crypto.randomBytes(9).toString('base64url');
      password = initialPassword;
    } else if (typeof password !== 'string' || password.length < 8) fail('password_weak', 422);
    const explicit = input.code !== undefined && input.code !== null && input.code !== '';
    const code = explicit ? normalizeCode(input.code) : null;
    if (explicit && !code) fail('partner_code_invalid', 422);
    const at = now().toISOString();
    const base = { ...doc, customerDiscount: doc.customerDiscount || null, passwordHash: hashPassword(password), createdAt: at, updatedAt: at };
    for (let attempt = 0; ; attempt++) {
      try {
        const partner = await store.partners.insert({ ...base, code: code || generateCode() });
        return { partner: adminView(partner), initialPassword };
      } catch (e) {
        /* a generated code may collide; an explicit one is the caller's */
        if (e && e.code === 'duplicate' && e.field === 'code' && !explicit && attempt < 5) continue;
        duplicateError(e);
      }
    }
  }

  /* Admin: contact, status, rules, password reset. The code never changes:
     links carrying it are already out there. Rule changes apply to
     payments made afterwards; existing entries keep their snapshot. */
  async function updatePartner(id, input = {}) {
    const current = await findPartner(id);
    const patch = { ...validateContact(input, { partial: true }), ...validateRules(input, current), updatedAt: now().toISOString() };
    if (input.password !== undefined) {
      if (typeof input.password !== 'string' || input.password.length < 8) fail('password_weak', 422);
      patch.passwordHash = hashPassword(input.password);
      patch.passwordChangedAt = patch.updatedAt;
    }
    const updated = await store.partners.update(current._id, patch).catch(duplicateError);
    return adminView(updated);
  }

  function referralUrl(code) {
    return `${trimTrailingSlashes(config.publicUrl || '')}/r/${code}`;
  }

  function ruleView(p) {
    const c = p.commission || {};
    return {
      commission: { percent: (c.percentBps || 0) / 100, firstMonths: c.firstMonths ?? null, recurring: !!c.recurring },
      customerDiscount: p.customerDiscount ? { percent: p.customerDiscount.percentBps / 100 } : null,
    };
  }

  function portalView(p) {
    return { id: String(p._id), name: p.name, email: p.email, phone: p.phone || null, type: p.type, code: p.code, status: p.status, referralUrl: referralUrl(p.code), ...ruleView(p), createdAt: p.createdAt };
  }

  function adminView(p) {
    return p && { ...portalView(p), payoutInfo: p.payoutInfo || null, note: p.note || null, updatedAt: p.updatedAt || null };
  }

  /* ---- sessions ---- */

  async function login(email, password) {
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const partner = isEmail(e) ? await store.partners.findOne({ email: e }) : null;
    if (!partner) {
      /* same work as a real check, so timing does not reveal partner emails */
      dummyHash = dummyHash || hashPassword(crypto.randomBytes(16).toString('hex'));
      verifyPassword(String(password || ''), dummyHash);
      fail('credentials_invalid', 401);
    }
    if (partner.status === 'terminated' || !verifyPassword(String(password || ''), partner.passwordHash)) fail('credentials_invalid', 401);
    return issueToken(partner, now().getTime());
  }

  const issueToken = (partner, at) => signToken({ sub: String(partner._id), role: 'partner', aud: TOKEN_AUDIENCE }, tokenSecret, { now: at, ttlSeconds: opts.tokenTtlSeconds || 7 * 24 * 3600 });

  async function authenticate(token) {
    const claims = verifyToken(token, tokenSecret, { now: now().getTime() });
    if (!claims || claims.aud !== TOKEN_AUDIENCE || claims.role !== 'partner' || typeof claims.sub !== 'string') return null;
    const partner = await store.partners.findById(claims.sub);
    if (!partner || partner.status === 'terminated') return null;
    if (partner.passwordChangedAt && claims.iat * 1000 < new Date(partner.passwordChangedAt).getTime() - 1000) return null;
    return partner;
  }

  async function changePassword(partnerId, currentPassword, newPassword) {
    const partner = await findPartner(partnerId);
    if (!verifyPassword(String(currentPassword || ''), partner.passwordHash)) fail('credentials_invalid', 401);
    if (typeof newPassword !== 'string' || newPassword.length < 8) fail('password_weak', 422);
    const at = now();
    await store.partners.update(partner._id, { passwordHash: hashPassword(newPassword), passwordChangedAt: at.toISOString(), updatedAt: at.toISOString() });
    return issueToken(partner, at.getTime() + 1000);
  }

  /* ---- attribution ---- */

  function isSelfReferral(partner, owner = {}) {
    const email = typeof owner.email === 'string' ? owner.email.trim().toLowerCase() : '';
    if (email && partner.email === email) return true;
    const phone = owner.phone && isValidVNPhone(owner.phone) ? normalizeVNPhone(owner.phone) : null;
    return !!(phone && partner.phone && partner.phone === phone);
  }

  /*
   * Signup hook (tenants.js): `input` is the signup input ({ referralCode,
   * owner: { email, phone } }). Returns the attribution, or null when the
   * code is missing, unknown, not active, a self-referral, or the tenant is
   * already attributed - the first attribution always stands.
   */
  async function attribute(tenant, input = {}) {
    const code = normalizeCode(input.referralCode);
    if (!code || !tenant || tenant.referral) return null;
    const partner = await store.partners.findOne({ code });
    if (!partner || partner.status !== 'active' || isSelfReferral(partner, input.owner)) return null;
    const row = { tenantId: String(tenant._id), partnerId: String(partner._id), code, attributedAt: now().toISOString() };
    try {
      await store.partnerAttributions.insert(row);
    } catch (e) {
      if (e && e.code === 'duplicate') return null;
      throw e;
    }
    await store.tenants.update(row.tenantId, { referral: { partnerId: row.partnerId, code, attributedAt: row.attributedAt } });
    return row;
  }

  /* ---- billing hooks ---- */

  const paidSubscriptions = (tenantId) => store.payments.list({ reference: String(tenantId), purpose: 'subscription', status: 'paid' });

  /* billing.checkout hook: the partner's customer discount on the shop's
     first paid period. Anything else returns `q` itself, unchanged. */
  async function adjustQuote({ tenant, quote: q }) {
    if (!tenant || !q) return q;
    const attribution = await store.partnerAttributions.findByTenant(String(tenant._id));
    if (!attribution) return q;
    const partner = await store.partners.findById(attribution.partnerId);
    const bps = partner && partner.status === 'active' && partner.customerDiscount ? partner.customerDiscount.percentBps : 0;
    if (!bps) return q;
    if (tenant.subscription && tenant.subscription.lastPaymentOrderCode) return q;
    if ((await paidSubscriptions(tenant._id)).length) return q;
    return applyPartnerDiscount(q, bps, { id: String(partner._id), code: partner.code });
  }

  const paidOrder = (p) => [String(p.paidAt || p.updatedAt || ''), Number(p.orderCode)];
  const paidBefore = (a, b) => {
    const [ta, oa] = paidOrder(a);
    const [tb, ob] = paidOrder(b);
    return ta < tb || (ta === tb && oa < ob);
  };

  /*
   * billing.activate hook: one commission entry for a paid subscription
   * payment of an attributed shop. Idempotent by orderCode; returns the
   * entry (existing or new) or null when none is due.
   *
   * Base = the payment's quote net (after all discounts, before VAT).
   * "First N months" and "not recurring" are counted over the shop's earlier
   * paid subscription payments (journal order), minus refunded ones, so the
   * result does not depend on the order hooks or the reconcile job run in.
   */
  async function onPaid(payment) {
    if (!payment || payment.status !== 'paid' || payment.purpose !== 'subscription') return null;
    const orderCode = Number(payment.orderCode);
    if (!Number.isSafeInteger(orderCode) || orderCode <= 0) return null;
    const key = `C${orderCode}`;
    const existing = await store.partnerCommissions.get(key);
    if (existing) return existing;
    const meta = payment.metadata || {};
    const tenantId = String(meta.tenantId || payment.reference || '');
    const attribution = tenantId ? await store.partnerAttributions.findByTenant(tenantId) : null;
    if (!attribution) return null;
    const partner = await store.partners.findById(attribution.partnerId);
    if (!partner || partner.status !== 'active') return null;
    const rule = partner.commission || {};
    if (!Number.isSafeInteger(rule.percentBps) || rule.percentBps <= 0) return null;
    const q = meta.quote || {};
    const months = Number(q.months);
    const net = Number(q.net);
    if (!Number.isSafeInteger(months) || months <= 0 || !Number.isSafeInteger(net) || net < 0) return null;

    const entries = await store.partnerCommissions.list({ tenantId });
    const refunded = new Set(entries.filter((c) => c.kind === 'commission' && (c.status === 'reversed' || c.reversedBy)).map((c) => c.orderCode));
    const prior = (await paidSubscriptions(tenantId)).filter((p) => Number(p.orderCode) !== orderCode && !refunded.has(Number(p.orderCode)) && paidBefore(p, payment));
    if (!rule.recurring && prior.length) return null;
    const used = prior.reduce((s, p) => s + (Number(p.metadata && p.metadata.quote && p.metadata.quote.months) || 0), 0);
    const eligibleMonths = rule.firstMonths ? Math.min(months, Math.max(0, rule.firstMonths - used)) : months;
    if (eligibleMonths <= 0) return null;
    const base = eligibleMonths === months ? net : Math.floor((net * eligibleMonths) / months);
    const tenant = await store.tenants.findById(tenantId);
    const at = now().toISOString();
    const row = {
      key, orderCode, kind: 'commission', partnerId: String(partner._id), partnerCode: partner.code, tenantId,
      businessName: tenant ? tenant.businessName : null, planId: q.planId || null, months, eligibleMonths,
      paymentAmount: payment.amount, base, percentBps: rule.percentBps, amount: commissionAmount(base, rule.percentBps),
      rule: { percentBps: rule.percentBps, firstMonths: rule.firstMonths ?? null, recurring: !!rule.recurring },
      status: 'pending', paymentPaidAt: payment.paidAt || null, createdAt: at, updatedAt: at,
    };
    try {
      return await store.partnerCommissions.insert(row);
    } catch (e) {
      if (e && e.code === 'duplicate') return store.partnerCommissions.get(key);
      throw e;
    }
  }

  /* Safety net for a lost hook (process died between the journal write and
     the commission insert): replays onPaid over paid subscription payments,
     oldest first. Safe to run any number of times. */
  async function reconcile() {
    const payments = (await store.payments.list({ purpose: 'subscription', status: 'paid' })).sort((a, b) => (paidBefore(a, b) ? -1 : paidBefore(b, a) ? 1 : 0));
    let created = 0;
    for (const p of payments) {
      if (await store.partnerCommissions.get(`C${Number(p.orderCode)}`)) continue;
      if (await onPaid(p)) created++;
    }
    return { scanned: payments.length, created };
  }

  /* ---- ledger transitions ---- */

  const toKey = (v) => {
    const s = String(v || '').toUpperCase();
    const key = /^\d+$/.test(s) ? `C${s}` : s;
    if (!KEY_RE.test(key)) fail('commission_not_found', 404);
    return key;
  };

  async function transition(keyLike, from, to, extra = {}) {
    const key = toKey(keyLike);
    const current = await store.partnerCommissions.get(key);
    if (!current) fail('commission_not_found', 404);
    if (current.status === to) return current;
    if (current.status !== from) fail('commission_transition_invalid', 409);
    const at = now().toISOString();
    const updated = await store.partnerCommissions.update(key, { status: to, [`${to}At`]: at, updatedAt: at, ...extra }, from);
    if (!updated) fail('commission_transition_invalid', 409);
    return updated;
  }

  const approve = (key) => transition(key, 'pending', 'approved');

  function markPaid(key, { payoutRef } = {}) {
    if (payoutRef != null && (typeof payoutRef !== 'string' || payoutRef.length > 100)) fail('payout_ref_invalid', 422);
    return transition(key, 'approved', 'paid', { payoutRef: payoutRef ? payoutRef.trim() : null });
  }

  /*
   * Refund of the subscription payment `orderCode`. Unpaid commission: the
   * entry becomes 'reversed' (nothing is owed). Already paid out: a negative
   * entry R<orderCode> is opened, to be approved and settled (deducted from
   * the next payout) like any other. Idempotent.
   */
  async function reverse(orderCodeLike, { reason } = {}) {
    const key = toKey(orderCodeLike);
    if (!key.startsWith('C')) fail('commission_not_found', 404);
    const why = str(reason, 200) || null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await store.partnerCommissions.get(key);
      if (!current) fail('commission_not_found', 404);
      if (current.status === 'reversed') return { commission: current, reversal: null };
      if (current.status === 'paid') {
        const rKey = `R${current.orderCode}`;
        const at = now().toISOString();
        let reversal;
        try {
          reversal = await store.partnerCommissions.insert({
            key: rKey, orderCode: current.orderCode, kind: 'reversal', reverses: key, partnerId: current.partnerId, partnerCode: current.partnerCode,
            tenantId: current.tenantId, businessName: current.businessName, planId: current.planId, months: current.months, eligibleMonths: current.eligibleMonths,
            paymentAmount: current.paymentAmount, base: -current.base, percentBps: current.percentBps, amount: -current.amount,
            reason: why, status: 'pending', createdAt: at, updatedAt: at,
          });
        } catch (e) {
          if (!(e && e.code === 'duplicate')) throw e;
          reversal = await store.partnerCommissions.get(rKey);
        }
        const commission = (await store.partnerCommissions.update(key, { reversedBy: rKey, reversedAt: current.reversedAt || at, updatedAt: at }, 'paid')) || current;
        return { commission, reversal };
      }
      const at = now().toISOString();
      const updated = await store.partnerCommissions.update(key, { status: 'reversed', reversedAt: at, reason: why, updatedAt: at }, current.status);
      if (updated) return { commission: updated, reversal: null };
    }
    fail('commission_transition_invalid', 409);
  }

  /* ---- views ---- */

  function totals(entries) {
    const t = { pending: 0, approved: 0, paid: 0, reversed: 0 };
    for (const c of entries) if (Object.hasOwn(t, c.status)) t[c.status] += c.amount;
    return t;
  }

  const commissionView = (c) => ({
    key: c.key, orderCode: c.orderCode, kind: c.kind, businessName: c.businessName, planId: c.planId, months: c.months, eligibleMonths: c.eligibleMonths,
    base: c.base, percent: c.percentBps / 100, amount: c.amount, status: c.status, reversedBy: c.reversedBy || null,
    createdAt: c.createdAt, approvedAt: c.approvedAt || null, paidAt: c.paidAt || null, payoutRef: c.payoutRef || null, reason: c.reason || null,
  });

  const newestFirst = (rows) => rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.key < b.key ? 1 : -1));

  /* Portal: the partner's shops, only name, plan and status. */
  async function partnerShops(partnerId) {
    const rows = await store.partnerAttributions.list({ partnerId: String(partnerId) });
    const shops = [];
    for (const a of rows) {
      const t = await store.tenants.findById(a.tenantId);
      if (!t) continue;
      const sub = t.subscription || {};
      shops.push({
        businessName: t.businessName, plan: t.plan ? t.plan.id : null,
        status: t.status !== 'active' ? t.status : t.suspended ? 'suspended' : sub.status || 'active',
        currentPeriodEnd: sub.currentPeriodEnd || null, attributedAt: a.attributedAt,
      });
    }
    return shops.sort((a, b) => (a.attributedAt < b.attributedAt ? 1 : -1));
  }

  async function partnerCommissions(partnerId) {
    const rows = await store.partnerCommissions.list({ partnerId: String(partnerId) });
    return { totals: totals(rows), items: newestFirst(rows).map(commissionView) };
  }

  async function listCommissions({ status, partnerId } = {}) {
    const query = {};
    if (status) {
      if (!COMMISSION_STATUSES.includes(status)) return [];
      query.status = status;
    }
    if (partnerId) query.partnerId = String(partnerId);
    return newestFirst(await store.partnerCommissions.list(query));
  }

  async function listPartners() {
    const [all, attributions, entries] = await Promise.all([store.partners.list(), store.partnerAttributions.list(), store.partnerCommissions.list()]);
    return all.map((p) => {
      const id = String(p._id);
      return { ...adminView(p), shops: attributions.filter((a) => a.partnerId === id).length, totals: totals(entries.filter((c) => c.partnerId === id)) };
    });
  }

  async function getPartner(id) {
    const p = await findPartner(id);
    const [shops, commissions] = await Promise.all([partnerShops(p._id), partnerCommissions(p._id)]);
    return { ...adminView(p), shops, commissions };
  }

  const CSV_HEADER = ['key', 'orderCode', 'kind', 'partnerCode', 'partnerName', 'businessName', 'planId', 'months', 'eligibleMonths', 'baseVnd', 'percent', 'amountVnd', 'status', 'createdAt', 'approvedAt', 'paidAt', 'payoutRef', 'reversedBy', 'reason'];

  async function commissionsCsv(filter = {}) {
    const [rows, all] = await Promise.all([listCommissions(filter), store.partners.list()]);
    const names = new Map(all.map((p) => [String(p._id), p.name]));
    return toCsv(CSV_HEADER, rows.map((c) => [
      c.key, c.orderCode, c.kind, c.partnerCode, names.get(c.partnerId) || '', c.businessName || '', c.planId || '', c.months, c.eligibleMonths,
      c.base, (c.percentBps / 100).toFixed(2), c.amount, c.status, c.createdAt, c.approvedAt || '', c.paidAt || '', c.payoutRef || '', c.reversedBy || '', c.reason || '',
    ]));
  }

  return {
    createPartner, updatePartner, listPartners, getPartner, portalView, adminView,
    login, authenticate, changePassword,
    attribute, adjustQuote, onPaid, reconcile,
    approve, markPaid, reverse, listCommissions, commissionView, commissionsCsv,
    partnerShops, partnerCommissions,
    cookieMaxAgeMs: (Number(opts.cookieDays) > 0 ? Number(opts.cookieDays) : 30) * 86400000,
  };
}

/* ---------- HTTP ---------- */

/*
 * /r/:code                     referral link: remembers the code in a cookie
 * /api/partners/*              partner portal (partner bearer token)
 * /api/admin/partners/*        staff (X-Admin-Key; pass app.js's `admin`)
 *
 * Self-contained: parses its own JSON and answers its own errors, so it can
 * be mounted anywhere before the static files.
 */
function createPartnersRouter({ partners, admin = null, config = {}, logger = console }) {
  const router = express.Router();
  const limits = config.rateLimits || {};
  const loginLimit = rateLimit({ windowMs: 15 * 60000, max: limits.login ?? 20 });
  /* The admin check (X-Admin-Key, rate limited) is the app's own; this
     router never mounts its admin routes without it. */
  if (typeof admin !== 'function') throw new Error('createPartnersRouter: admin middleware is required');
  const adminGuard = admin;

  const noStore = (_req, res, next) => {
    res.set('cache-control', 'no-store');
    next();
  };
  router.use(['/api/partners', '/api/admin/partners'], noStore, express.json({ limit: '64kb' }));
  router.use('/api/admin/partners', adminGuard);

  const partnerAuth = async (req, _res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const partner = token ? await partners.authenticate(token) : null;
    if (!partner) return next(httpError('unauthorized', 401));
    req.partner = partner;
    next();
  };

  router.get('/r/:code', (req, res) => {
    const code = normalizeCode(req.params.code);
    if (!code) return res.redirect(302, '/');
    res.cookie(REF_COOKIE, code, { maxAge: partners.cookieMaxAgeMs, httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
    res.redirect(302, `/?ref=${code}`);
  });

  /* ---- portal ---- */
  router.post('/api/partners/auth/login', loginLimit, async (req, res) => {
    const b = req.body || {};
    res.json({ token: await partners.login(b.email, b.password) });
  });
  router.get('/api/partners/me', partnerAuth, async (req, res) => {
    const { totals } = await partners.partnerCommissions(req.partner._id);
    res.json({ partner: partners.portalView(req.partner), totals });
  });
  router.get('/api/partners/me/shops', partnerAuth, async (req, res) => res.json(await partners.partnerShops(req.partner._id)));
  router.get('/api/partners/me/commissions', partnerAuth, async (req, res) => res.json(await partners.partnerCommissions(req.partner._id)));
  router.post('/api/partners/me/password', partnerAuth, async (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, token: await partners.changePassword(req.partner._id, b.currentPassword, b.newPassword) });
  });

  /* ---- admin (adminGuard applied above) ---- */
  const filter = (q) => ({ status: typeof q.status === 'string' ? q.status : undefined, partnerId: typeof q.partnerId === 'string' ? q.partnerId : undefined });
  router.get('/api/admin/partners', async (_req, res) => res.json(await partners.listPartners()));
  router.post('/api/admin/partners', async (req, res) => res.status(201).json(await partners.createPartner(req.body || {})));
  router.get('/api/admin/partners/commissions', async (req, res) => res.json((await partners.listCommissions(filter(req.query))).map(partners.commissionView)));
  router.get('/api/admin/partners/commissions.csv', async (req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="hoa-hong-doi-tac-${day}.csv"` });
    res.send(await partners.commissionsCsv(filter(req.query)));
  });
  router.post('/api/admin/partners/commissions/:key/approve', async (req, res) => res.json(partners.commissionView(await partners.approve(req.params.key))));
  router.post('/api/admin/partners/commissions/:key/pay', async (req, res) => res.json(partners.commissionView(await partners.markPaid(req.params.key, req.body || {}))));
  router.post('/api/admin/partners/commissions/:key/reverse', async (req, res) => {
    const r = await partners.reverse(req.params.key, req.body || {});
    res.json({ commission: partners.commissionView(r.commission), reversal: r.reversal && partners.commissionView(r.reversal) });
  });
  router.post('/api/admin/partners/jobs/reconcile', async (_req, res) => res.json(await partners.reconcile()));
  router.get('/api/admin/partners/:id', async (req, res) => res.json(await partners.getPartner(req.params.id)));
  router.patch('/api/admin/partners/:id', async (req, res) => res.json(await partners.updatePartner(req.params.id, req.body || {})));

  /* Errors of these routes only. Logged by code from our own vocabulary,
     never with request-derived text. */
  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    const code = status >= 500 ? 'internal_error' : typeof err.code === 'string' && /^[a-z0-9_]{1,64}$/.test(err.code) ? err.code : 'error';
    if (status >= 500) logger.error(`[partners] internal error: ${typeof err.code === 'string' && /^[a-z0-9_]{1,64}$/.test(err.code) ? err.code : 'unknown'}`);
    res.status(status).json({ error: code, message: MESSAGES[code] || (status >= 500 ? 'Lỗi hệ thống, vui lòng thử lại.' : code) });
  });

  return router;
}

module.exports = {
  createPartnerService, createPartnersRouter, referralCodeFromRequest,
  normalizeCode, percentToBps, commissionAmount, applyPartnerDiscount, toCsv, csvCell, partnerTokenSecret,
  REF_COOKIE, TOKEN_AUDIENCE, PARTNER_STATUSES, PARTNER_TYPES, COMMISSION_STATUSES, MESSAGES,
};
