'use strict';

/*
 * Money as a document the server writes shows it - a PDF, a mailed receipt,
 * a figure handed to a page that has no shop settings of its own.
 *
 * Two things come from the branch: the currency's precision (ISO 4217, via
 * utils/currency - the dong has none, the dinar has three) and the digit
 * grouping of the shop's country. A shop in Vietnam reads "₫ 1.250.000",
 * never "1,250,000.00" and never a dollar sign; an Indian shop keeps
 * "₹ 1,250.50". The symbol goes in front with a space, as the till's
 * money-format.js writes it, so a printout and the screen agree.
 *
 * Display only. Nothing here is stored, summed or sent to a payment.
 */

const Money = require('./currency');

const PLAIN = Object.freeze({ group: ',', decimal: '.' });

/*
 * The country decides the separators. A branch with no country falls back to
 * the region inside its currency code (VND -> VN), and anything Intl cannot
 * place keeps the plain 1,234.50.
 */
function marks(branch) {
  const country = String((branch && branch.country_id) || '')
    .trim()
    .toUpperCase();
  const code = Money.policy(branch || {}).currencyCode;
  const region = /^[A-Z]{2}$/.test(country) ? country : code ? code.slice(0, 2) : '';
  if (!/^[A-Z]{2}$/.test(region)) return { ...PLAIN };
  try {
    const locale = new Intl.Locale('und', { region }).maximize().baseName;
    const parts = new Intl.NumberFormat([locale, 'en'], {
      minimumFractionDigits: 1,
      numberingSystem: 'latn',
    }).formatToParts(1234567.5);
    const part = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    const decimal = part('decimal');
    const group = /\s/.test(part('group')) ? ' ' : part('group');
    if (!/^[.,]$/.test(decimal) || !/^[.,' ]$/.test(group) || group === decimal) return { ...PLAIN };
    return { group, decimal };
  } catch {
    return { ...PLAIN };
  }
}

/* Half away from zero at the currency's precision; 1.005 -> 1.01, not 1.00. */
function round(value, places) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Number(Math.round(Number(Math.abs(n) + 'e' + places)) + 'e-' + places) * (n < 0 ? -1 : 1);
  return r === 0 ? 0 : r;
}

/** "1250000" -> "1.250.000" for a Vietnamese branch, "1,250,000.00" for a US one. */
function number(value, branch, places) {
  const digits = Number.isInteger(places) ? places : Money.policy(branch || {}).currencyDigits;
  const seps = marks(branch);
  const fixed = round(value, digits).toFixed(digits);
  const negative = fixed.charAt(0) === '-';
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split('.');
  return (
    (negative ? '-' : '') +
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, seps.group) +
    (fraction ? seps.decimal + fraction : '')
  );
}

/*
 * What goes in front of the figure. `ascii` is for a font without the glyph
 * (pdfkit's built-in Helvetica has neither ₹ nor ₫): the ISO code is printed
 * instead - "VND 1.250.000" - and "Rs." for a rupee, as the invoice always did.
 */
function symbol(branch, { ascii = false } = {}) {
  const policy = Money.policy(branch || {});
  const sign = String(policy.currencySymbol || '').trim();
  if (!ascii || /^[\x20-\x7E]*$/.test(sign)) return sign;
  if (policy.currencyCode === 'INR' || !policy.currencyCode) return 'Rs.';
  return policy.currencyCode;
}

/** "₫ 1.250.000" - the symbol, a space, the figure. */
function text(value, branch, options = {}) {
  const sign = symbol(branch, options);
  const figure = number(value, branch, options.places);
  return sign ? `${sign} ${figure}` : figure;
}

/* For a page that has no shop settings of its own (the mailed receipt). */
function describe(branch) {
  const policy = Money.policy(branch || {});
  const seps = marks(branch);
  return {
    currencyCode: policy.currencyCode,
    currencyDigits: policy.currencyDigits,
    currencyGroup: seps.group,
    currencyDecimal: seps.decimal,
  };
}

module.exports = { marks, round, number, symbol, text, describe };
