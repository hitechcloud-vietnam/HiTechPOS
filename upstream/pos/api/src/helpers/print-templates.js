'use strict';
/*
 * HiTechPOS: which receipt template a shop starts with.
 *
 * Posnic seeds every new branch with api/src/json/print_standard_html.txt
 * (thermal) and print_a4html.txt (A4), copied into the branch document as
 * thermal_body_print / regular_body_print, and offers the same files as the
 * print_standard_html / print_a4html fallback when a branch has none.
 *
 * A Vietnamese shop (country Vietnam, or VND) gets print_standard_html_vi.txt
 * instead: Vietnamese labels, MST, HOÁ ĐƠN BÁN HÀNG, four item columns, VAT per
 * rate and the total in words (finished in the till by
 * frontend/static/script/js/core/vn-bill-print.js). Every other shop keeps the
 * stock template, byte for byte.
 */

const fs = require('fs');
const path = require('path');
const { isVietnamese } = require('./vn-bill');

const JSON_DIR = path.join(__dirname, '..', 'json');
const FILES = Object.freeze({
  standard: 'print_standard_html.txt',
  vi: 'print_standard_html_vi.txt',
  a4: 'print_a4html.txt',
});

const cache = new Map();
function read(file) {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(JSON_DIR, file), 'utf8'));
  return cache.get(file);
}

/*
 * The shop as the installer and the branch form describe it. Accepts a branch
 * document ({ country, country_id, currency_value }) or the install payload
 * ({ register_country, register_countryid, register_currency }).
 */
function shopOf(input) {
  const s = input || {};
  return {
    country: s.country != null ? s.country : s.register_country,
    country_id: s.country_id != null ? s.country_id : s.register_countryid,
    currency_value: s.currency_value,
    currency_code: s.currency_code || s.register_currency,
  };
}

function thermalFileFor(shop) {
  return isVietnamese(shopOf(shop)) ? FILES.vi : FILES.standard;
}

/** The thermal template a new branch of this shop is seeded with. */
function thermalTemplateFor(shop) {
  return read(thermalFileFor(shop));
}

/** The A4 template (not localised: A4 sales print through the receipt designer). */
function a4Template() {
  return read(FILES.a4);
}

/*
 * The English labels HiTechPOS onboarding translates in a freshly installed
 * shop's template (apps/control-plane/src/onboarding.js, RECEIPT_LABELS and
 * translateReceiptTemplate). Repeated here because upstream code cannot
 * require the control plane; the test
 * api/tests/unit/helpers/print-templates.test.js compares the two when both
 * are present, so they cannot drift apart unnoticed.
 */
const ONBOARDING_LABELS = Object.freeze({
  Receipt: 'Phiếu thanh toán',
  Product: 'Sản phẩm',
  Item: 'Mặt hàng',
  'Qty.': 'SL',
  Qty: 'SL',
  Price: 'Đơn giá',
  Disc: 'CK',
  Tax: 'Thuế',
  Total: 'Thành tiền',
  Hsn: 'Mã',
  Payment: 'Thanh toán',
  'Payments/Credits': 'Đã thanh toán',
  'Balance Due': 'Còn lại',
  'Payment Status': 'Trạng thái',
  'Total Qty': 'Tổng SL',
  'Sub Total': 'Tạm tính',
  Subtotal: 'Tạm tính',
  Discount: 'Chiết khấu',
  'Tax Details': 'Chi tiết thuế',
  'TAX DETAILS': 'CHI TIẾT THUẾ',
  'Tax Total': 'Tổng thuế',
  'Grand Total': 'Tổng cộng',
  'SALE NOTES': 'GHI CHÚ',
  Tel: 'ĐT',
  'CELL NO': 'ĐT',
  EMAIL: 'Email',
  GSTIN: 'MST',
});

function onboardingTranslation(html) {
  return String(html || '').replace(/>([^<>]*)</g, (whole, text) => {
    const key = text
      .replace(/&nbsp;/g, ' ')
      .trim()
      .replace(/:$/, '')
      .trim();
    const vi = ONBOARDING_LABELS[key];
    if (!vi) return whole;
    const i = text.indexOf(key);
    if (i < 0) return whole;
    return '>' + text.slice(0, i) + vi + text.slice(i + key.length) + '<';
  });
}

/* Line endings and trailing blanks are not a customisation. */
function normalise(html) {
  return String(html || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

/**
 * Is this thermal template still the stock one, untouched by the shop?
 * The stock English file, or that file after HiTechPOS onboarding translated
 * its labels - nothing else. A template the shop (or support) changed in any
 * other way is the shop's, and is never replaced.
 */
function isStockThermal(html) {
  const current = normalise(html);
  if (!current) return false;
  const stock = read(FILES.standard);
  return current === normalise(stock) || current === normalise(onboardingTranslation(stock));
}

/**
 * Give Vietnamese branches still on the stock thermal template the
 * Vietnamese one. Idempotent: a branch already on it is no longer "stock".
 * Stamps updated_date, because the sync gateway only ships branch rows whose
 * updated_date moved (setting.model.js).
 *
 * @param {import('mongodb').Db} db a shop's database
 * @param {{dryRun?: boolean, now?: Date}} [options]
 * @returns {Promise<{checked:number, upgraded:Array<string>}>}
 */
async function upgradeVietnameseThermalTemplates(db, options = {}) {
  const branches = db.collection('branches');
  const vi = read(FILES.vi);
  const cursor = branches.find(
    {},
    {
      projection: {
        thermal_body_print: 1,
        country: 1,
        country_id: 1,
        currency_value: 1,
        branch_name: 1,
      },
    }
  );
  const upgraded = [];
  let checked = 0;
  for await (const branch of cursor) {
    checked++;
    if (!isVietnamese(shopOf(branch))) continue;
    if (!isStockThermal(branch.thermal_body_print)) continue;
    upgraded.push(String(branch._id));
    if (options.dryRun) continue;
    await branches.updateOne(
      // Guarded on the value just read: a template changed meanwhile is left alone.
      { _id: branch._id, thermal_body_print: branch.thermal_body_print },
      { $set: { thermal_body_print: vi, updated_date: options.now || new Date() } }
    );
  }
  return { checked, upgraded };
}

module.exports = {
  FILES,
  thermalFileFor,
  thermalTemplateFor,
  a4Template,
  isStockThermal,
  onboardingTranslation,
  upgradeVietnameseThermalTemplates,
};
