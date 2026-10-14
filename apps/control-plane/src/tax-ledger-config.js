'use strict';

/*
 * ===========================================================================
 *  TAX REFERENCE TABLE FOR HOUSEHOLD BUSINESSES (hộ kinh doanh)
 *  -- the ONLY place where legal rates / thresholds used by tax-ledger.js live.
 * ===========================================================================
 *
 * Every figure below is reference data for the shop owner and must be
 * confirmed by an accountant before it is used for a real declaration. Each
 * value we are not certain about carries the marker
 *   // UNVERIFIED: cần kế toán xác nhận
 * and every output of tax-ledger.js carries NOTICE so the owner sees it too.
 *
 * Rates are integers in basis points (1/10000, "phần vạn"): 100 = 1%,
 * 50 = 0.5%. Integer rates keep the tax arithmetic exact (see taxOn() in
 * tax-ledger.js); there is no floating point anywhere between revenue and tax.
 *
 * Changing a value: edit this table only, keep the markers until an
 * accountant has confirmed the value, and update docs/SO-SACH-THUE.md.
 */

const NOTICE = 'Số liệu tham khảo – cần kế toán xác nhận';

const TAX_TABLE = Object.freeze({
  /* Free-form label shown on every output so a printed book says which
     table produced it. */
  version: 'tham-khao-2026-10',

  /*
   * Annual revenue at or below which a household business pays neither GTGT
   * nor TNCN under the percentage-on-revenue method.
   */
  // UNVERIFIED: cần kế toán xác nhận — the amount has changed over the years
  // (100 triệu under the earlier household-business guidance, higher amounts
  // under later laws); 500 triệu is the amount we understand applies from
  // 2026, not confirmed.
  annualThreshold: 500000000,

  /*
   * How the threshold applies once the year's revenue exceeds it.
   * 'whole' = tax on the whole revenue of the year (the method of the earlier
   * guidance). Only 'whole' is implemented.
   */
  // UNVERIFIED: cần kế toán xác nhận — later rules may tax only the part of
  // revenue above the threshold for some taxes; not implemented.
  thresholdMode: 'whole',

  /*
   * Percentage-on-revenue rates per industry group (nhóm ngành nghề), in the
   * order and wording of the S1-HKD columns. Revenue is VAT-inclusive (all
   * money collected for the sale).
   */
  // UNVERIFIED: cần kế toán xác nhận — rates as in Phụ lục I of Thông tư
  // 40/2021/TT-BTC; whether they still apply after the 2026 reform of
  // household-business taxation is not confirmed. Sub-activities with their
  // own rates (e.g. property rental, lottery/insurance agency, multi-level
  // sales) are not modelled.
  groups: Object.freeze({
    phan_phoi: Object.freeze({
      column: 1,
      label: 'Phân phối, cung cấp hàng hoá',
      gtgtBp: 100, // UNVERIFIED: cần kế toán xác nhận (1%)
      tncnBp: 50, // UNVERIFIED: cần kế toán xác nhận (0,5%)
    }),
    dich_vu: Object.freeze({
      column: 2,
      label: 'Dịch vụ, xây dựng không bao thầu nguyên vật liệu',
      gtgtBp: 500, // UNVERIFIED: cần kế toán xác nhận (5%)
      tncnBp: 200, // UNVERIFIED: cần kế toán xác nhận (2%)
    }),
    sx_vt: Object.freeze({
      column: 3,
      label: 'Sản xuất, vận tải, dịch vụ có gắn với hàng hoá, xây dựng có bao thầu nguyên vật liệu',
      gtgtBp: 300, // UNVERIFIED: cần kế toán xác nhận (3%)
      tncnBp: 150, // UNVERIFIED: cần kế toán xác nhận (1,5%)
    }),
    khac: Object.freeze({
      column: 4,
      label: 'Hoạt động kinh doanh khác',
      gtgtBp: 200, // UNVERIFIED: cần kế toán xác nhận (2%)
      tncnBp: 100, // UNVERIFIED: cần kế toán xác nhận (1%)
    }),
  }),

  /*
   * Temporary reduction of the GTGT percentage for household businesses, in
   * percent of the rate (20 would turn 1% into 0.8%). Applied to every group
   * when set.
   */
  // UNVERIFIED: cần kế toán xác nhận — VAT-reduction policies have at times
  // granted household businesses a reduction of the percentage for eligible
  // goods/services only; eligibility is per item and not modelled, so the
  // default is 0 (no reduction).
  gtgtReductionPercent: 0,

  /*
   * Rounding, made explicit:
   *  - a sale's revenue is its sales_total rounded half away from zero to 1 đ;
   *  - a sale's revenue is split over industry groups by the largest
   *    remainder method, so the parts always add up to the sale exactly;
   *  - each tax is computed per group on the group's net revenue for the
   *    period and rounded half up to 1 đ; the total tax is the sum of the
   *    rounded group amounts (not the rounded total of exact amounts);
   *  - a group whose net revenue is negative (returns exceed sales) gets 0.
   */
  // UNVERIFIED: cần kế toán xác nhận — rounding unit and per-group rounding.
  rounding: 'group-half-up-1d',
});

/*
 * Default industry group of each shop industry preset
 * (packages/industry-presets, read only), with per-category exceptions keyed
 * by the preset's own category names. The owner can override any category.
 */
// UNVERIFIED: cần kế toán xác nhận — which group an activity belongs to
// (e.g. food and drink service in group 3, karaoke in group 2, bakery
// producing its own goods in group 3) is our reading, not confirmed.
const INDUSTRY_DEFAULTS = Object.freeze({
  'tap-hoa-minimart': { group: 'phan_phoi' },
  'cafe-tra-sua': { group: 'sx_vt' },
  'nha-hang-quan-an': { group: 'sx_vt' },
  'karaoke-bida': { group: 'dich_vu' },
  'thoi-trang': { group: 'phan_phoi' },
  'nha-thuoc': { group: 'phan_phoi' },
  'dien-thoai-dien-may': { group: 'phan_phoi' },
  'spa-salon': { group: 'dich_vu', categories: { 'Sản phẩm bán lẻ': 'phan_phoi' } },
  'vat-lieu-xay-dung': { group: 'phan_phoi' },
  'me-va-be': { group: 'phan_phoi' },
  'my-pham': { group: 'phan_phoi' },
  'tiem-banh': { group: 'sx_vt', categories: { 'Nguyên liệu': 'phan_phoi' } },
  'sach-van-phong-pham': { group: 'phan_phoi' },
  'nong-san-thuc-pham': { group: 'phan_phoi' },
  khac: { group: 'phan_phoi', categories: { 'Dịch vụ': 'dich_vu', 'Khác': 'khac' } },
});
const FALLBACK_INDUSTRY = 'khac';

/*
 * Items marked as services in Posnic (items.item_kind === 'service') that no
 * category rule covers go to this group.
 */
// UNVERIFIED: cần kế toán xác nhận — a service sold together with goods may
// belong to group 3 instead.
const SERVICE_ITEM_GROUP = 'dich_vu';

/*
 * S1-HKD layout details used by the CSV/HTML exports.
 */
// UNVERIFIED: cần kế toán xác nhận — column letters, header lines and the
// signature block follow our reading of mẫu S1-HKD (Thông tư 88/2021/TT-BTC);
// recording one line per day from the day's sales list (bảng kê) instead of
// one line per invoice is to be confirmed.
const S1_HKD = Object.freeze({
  formNo: 'Mẫu số S1-HKD',
  formRef: '(Kèm theo Thông tư số 88/2021/TT-BTC của Bộ trưởng Bộ Tài chính)',
  title: 'SỔ CHI TIẾT DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
  columns: Object.freeze({ postedOn: 'A', docNo: 'B', docDate: 'C', description: 'D', note: 'E' }),
  signatures: Object.freeze(['NGƯỜI LẬP BIỂU', 'NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/CÁ NHÂN KINH DOANH']),
});

const GROUP_IDS = Object.freeze(Object.keys(TAX_TABLE.groups));

module.exports = { NOTICE, TAX_TABLE, INDUSTRY_DEFAULTS, FALLBACK_INDUSTRY, SERVICE_ITEM_GROUP, S1_HKD, GROUP_IDS };
