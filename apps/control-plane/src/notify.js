'use strict';

const { formatVND, formatDateVN } = require('@hitechpos/vn-locale');
const { stripTags } = require('@hitechpos/payment-core');

/*
 * Owner notifications by email. Every message is keyed (`notices.<key>` on the
 * tenant) so a retry, a restart or two processes running the same job send it
 * once. Delivery failures are logged and never fail the action that caused
 * them - a shop must not lose a payment because SMTP was down.
 *
 *   SMTP_URL   smtp(s)://user:pass@host:port  (unset: messages are logged only)
 *   MAIL_FROM  "HiTechPOS <no-reply@hitechpos.vn>"
 */
const DAY = 86400000;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(title, paragraphs, cta) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join('');
  const button = cta ? `<p><a href="${esc(cta.href)}" style="display:inline-block;background:#0b6bcb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(cta.label)}</a></p>` : '';
  return `<!doctype html><html lang="vi"><body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#1d2733;background:#f5f8fb;padding:16px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px"><h2 style="margin-top:0">${esc(title)}</h2>${body}${button}
<p style="color:#5d6b7a;font-size:13px;margin-top:24px">HiTechPOS – HiTechCloud-VN · Phố Tuệ Software Solutions JSC</p></div></body></html>`;
}

/* Templates return { subject, html, text }; values are escaped. */
const TEMPLATES = {
  welcome: ({ tenant, urls, config }) => ({
    subject: `Chào mừng ${tenant.businessName} đến với HiTechPOS`,
    paragraphs: [
      `Cửa hàng <b>${esc(tenant.businessName)}</b> đã sẵn sàng bán hàng tại <a href="${esc(urls[0])}">${esc(urls[0])}</a>.`,
      `Bạn được dùng thử miễn phí đến hết ngày <b>${esc(formatDateVN(tenant.subscription.currentPeriodEnd))}</b>.`,
      'Đăng nhập bằng email và mật khẩu vừa đăng ký. Cấu hình thanh toán QR, hoá đơn điện tử và gói cước tại trang quản lý.',
    ],
    cta: { href: `${config.publicUrl}/account`, label: 'Mở trang quản lý' },
  }),
  trialEnding: ({ tenant, config, daysLeft }) => ({
    subject: `Thời gian dùng thử HiTechPOS còn ${daysLeft} ngày`,
    paragraphs: [
      `Thời gian dùng thử của <b>${esc(tenant.businessName)}</b> kết thúc ngày <b>${esc(formatDateVN(tenant.subscription.currentPeriodEnd))}</b>.`,
      'Chọn gói cước để tiếp tục bán hàng không gián đoạn. Thanh toán bằng chuyển khoản QR qua payOS hoặc Pay2S.',
    ],
    cta: { href: `${config.publicUrl}/account`, label: 'Gia hạn ngay' },
  }),
  paymentReceived: ({ tenant, config, payment }) => ({
    subject: `HiTechPOS đã nhận thanh toán ${formatVND(payment.amount)}`,
    paragraphs: [
      `Đã nhận <b>${esc(formatVND(payment.amount))}</b> cho gói <b>${esc(payment.metadata.quote.planName)}</b> ${esc(payment.metadata.quote.months)} tháng (mã ${esc(payment.orderCode)}).`,
      `Cửa hàng <b>${esc(tenant.businessName)}</b> được sử dụng đến ngày <b>${esc(formatDateVN(tenant.subscription.currentPeriodEnd))}</b>.`,
    ],
    cta: { href: `${config.publicUrl}/account`, label: 'Xem lịch sử thanh toán' },
  }),
  passwordReset: ({ config, token }) => ({
    subject: 'Đặt lại mật khẩu HiTechPOS',
    paragraphs: [
      'Có yêu cầu đặt lại mật khẩu trang quản lý HiTechPOS cho email này.',
      'Liên kết có hiệu lực trong 60 phút và chỉ dùng được một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này.',
    ],
    cta: { href: `${config.publicUrl}/reset?token=${encodeURIComponent(token)}`, label: 'Đặt lại mật khẩu' },
  }),
  suspended: ({ tenant, config }) => ({
    subject: `Cửa hàng ${tenant.businessName} tạm ngưng do hết hạn`,
    paragraphs: [
      `Gói cước của <b>${esc(tenant.businessName)}</b> đã hết hạn và quá thời gian gia hạn, cửa hàng tạm ngưng truy cập.`,
      'Dữ liệu bán hàng vẫn được giữ nguyên. Gia hạn để mở lại ngay lập tức.',
    ],
    cta: { href: `${config.publicUrl}/account`, label: 'Gia hạn' },
  }),
};

function render(name, ctx) {
  const t = TEMPLATES[name](ctx);
  const text = t.paragraphs.map((p) => stripTags(p)).join('\n\n') + (t.cta ? `\n\n${t.cta.label}: ${t.cta.href}` : '');
  return { subject: t.subject, html: layout(t.subject, t.paragraphs, t.cta), text };
}

function smtpTransport(url) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport(url);
}

function createNotifier({ store, config, now = () => new Date(), transport, logger = console, hostsOf }) {
  const mailer = transport || (config.smtpUrl ? smtpTransport(config.smtpUrl) : null);
  const from = config.mailFrom || 'HiTechPOS <no-reply@hitechpos.vn>';

  async function ownerEmail(tenant) {
    const account = tenant.ownerAccountId ? await store.accounts.findById(tenant.ownerAccountId) : null;
    return account && account.email;
  }

  /* Sends `name` to the shop owner once per key. Returns 'sent' | 'logged' |
     'duplicate' | 'no-recipient' | 'failed'. */
  async function send(tenant, name, key, extra = {}) {
    const notices = tenant.notices || {};
    if (notices[key]) return 'duplicate';
    const to = await ownerEmail(tenant);
    if (!to) return 'no-recipient';
    const message = render(name, { tenant, config, urls: hostsOf(tenant).map((h) => `https://${h}`), ...extra });
    /* Claimed before sending: a crash after this line loses one email rather
       than sending it twice on every retry. */
    await store.tenants.update(tenant._id, { notices: { ...notices, [key]: now().toISOString() } });
    if (!mailer) {
      logger.info?.(`[notify] (no SMTP) ${name} -> ${to}: ${message.subject}`);
      return 'logged';
    }
    try {
      await mailer.sendMail({ from, to, subject: message.subject, html: message.html, text: message.text });
      return 'sent';
    } catch (e) {
      logger.warn(`[notify] ${name} to ${to} failed: ${e.message}`);
      return 'failed';
    }
  }

  /* One-off message to an address (no once-per-key bookkeeping). */
  async function sendTo(to, name, ctx = {}) {
    const message = render(name, { config, ...ctx });
    if (!mailer) {
      logger.info?.(`[notify] (no SMTP) ${name} -> ${to}: ${message.subject}`);
      return 'logged';
    }
    try {
      await mailer.sendMail({ from, to, subject: message.subject, html: message.html, text: message.text });
      return 'sent';
    } catch (e) {
      logger.warn(`[notify] ${name} to ${to} failed: ${e.message}`);
      return 'failed';
    }
  }

  /* Daily: trial reminders 3 days and 1 day before the end. */
  async function runReminders() {
    const out = [];
    for (const t of await store.tenants.list({ suspended: false })) {
      const s = t.subscription;
      if (!s || s.status !== 'trialing' || !s.currentPeriodEnd) continue;
      const daysLeft = Math.ceil((new Date(s.currentPeriodEnd).getTime() - now().getTime()) / DAY);
      /* Closest threshold first, so the 1-day reminder is not shadowed by the 3-day one. */
      for (const threshold of [1, 3]) {
        if (daysLeft > 0 && daysLeft <= threshold) {
          const r = await send(t, 'trialEnding', `trialEnding${threshold}:${s.currentPeriodEnd}`, { daysLeft });
          if (r !== 'duplicate') out.push({ subdomain: t.subdomain, threshold, result: r });
          break;
        }
      }
    }
    return out;
  }

  return { send, sendTo, runReminders, render };
}

module.exports = { createNotifier, render, TEMPLATES };
