'use strict';

const { removeDiacritics } = require('@hitechpos/vn-locale');
const { NOTICE, TAX_TABLE, INDUSTRY_DEFAULTS, FALLBACK_INDUSTRY, SERVICE_ITEM_GROUP, GROUP_IDS } = require('./tax-ledger-config');

/*
 * Revenue book (sổ chi tiết doanh thu, layout of mẫu S1-HKD) and period tax
 * summary for a household business, built from the completed sales of the
 * shop's Posnic database (tenant DB hitech_t_<subdomain>, collection `sales`).
 *
 * Sale documents are those mapped by einvoice-worker.js mapPosnicSale (see
 * test/fixtures/posnic-sales.json). What this module reads:
 *   sales_total            what the customer was charged for the sale, after
 *                          every discount and round-off, VAT and charges
 *                          included; it is NOT reduced by later returns;
 *   items[]                lines as they stand now (returned quantities are
 *                          removed from them): item_id, category_id,
 *                          category_name, total_amount;
 *   business_item_origin   lines as originally sold (written by Posnic just
 *                          before the first return, services/business-item-
 *                          origin.js): lines[].itemId, grossAmount;
 *   charges[]              amount (net) + tax_amount;
 *   items_return[]         one entry per return (repositories/sale.repository.js
 *                          returnSales): returnArray { returnId, returnDate,
 *                          returnValue[] (lines with category, total_amount),
 *                          itemsTotalAmount (the refund) }.
 *
 * Entries: a sale is revenue on the day it was sold (VN time) for its whole
 * sales_total; each return is a separate negative entry on its return day for
 * the amount refunded. A sale returned in a later period therefore leaves the
 * earlier book untouched.
 *
 * Every amount is integer VND; see TAX_TABLE.rounding for the rules.
 */

/* Asia/Ho_Chi_Minh is UTC+7 with no daylight saving time (none since 1975),
   so period boundaries are plain UTC instants shifted by 7 hours. */
const VN_OFFSET_MS = 7 * 3600000;
const ROMAN = ['I', 'II', 'III', 'IV'];

function httpError(code, status, message) {
  return Object.assign(new Error(message || code), { code, status });
}

function num(v) {
  if (typeof v === 'number') return v;
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'object' && typeof v.toString === 'function' && v._bsontype) return Number(v.toString()); // Decimal128 / Long
  const s = String(v).replace(/,/g, '').trim();
  return s === '' ? NaN : Number(s);
}

/* Round half away from zero to 1 đ, after trimming float noise
   (0.1 + 0.2 style artefacts in Posnic's stored totals). */
function vnd(x) {
  const r = Math.sign(x) * Math.round(Math.abs(Number(x.toPrecision(15))));
  return r === 0 ? 0 : r;
}

function idOf(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object' && typeof v.toHexString === 'function') return v.toHexString();
  if (typeof v === 'object' && typeof v.$oid === 'string') return v.$oid;
  return String(v);
}

function toDate(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object' && !(v instanceof Date) && v.$date !== undefined) return toDate(v.$date);
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fold = (s) => removeDiacritics(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ periods */

function vnMonthStart(year, month0) {
  return new Date(Date.UTC(year, month0, 1) - VN_OFFSET_MS);
}

/** "YYYY-MM-DD" of an instant, in Vietnam time. */
function vnDayKey(date) {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** "dd/MM/yyyy" from a "YYYY-MM-DD" day key. */
function dayLabel(key) {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Parse "YYYY-MM" (month), "YYYY-Qn" (quarter) or "YYYY" (year) into the
 * period [from, to) in Vietnam time. Throws a 422 error otherwise.
 */
function parsePeriod(input) {
  const s = String(input || '').trim().toUpperCase();
  let m;
  let type;
  let year;
  let m0;
  let months;
  let quarter;
  let month;
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) {
    type = 'month'; year = Number(m[1]); month = Number(m[2]); m0 = month - 1; months = 1;
    if (month < 1 || month > 12) m = null;
  } else if ((m = /^(\d{4})-Q([1-4])$/.exec(s))) {
    type = 'quarter'; year = Number(m[1]); quarter = Number(m[2]); m0 = (quarter - 1) * 3; months = 3;
  } else if ((m = /^(\d{4})$/.exec(s))) {
    type = 'year'; year = Number(m[1]); m0 = 0; months = 12;
  }
  if (!m || year < 2000 || year > 2100) {
    throw httpError('tax_period_invalid', 422, 'Kỳ báo cáo không hợp lệ (dạng 2026-10, 2026-Q4 hoặc 2026).');
  }
  const from = vnMonthStart(year, m0);
  const to = vnMonthStart(year, m0 + months);
  const key = type === 'month' ? `${year}-${String(month).padStart(2, '0')}` : type === 'quarter' ? `${year}-Q${quarter}` : String(year);
  const label = type === 'month' ? `Tháng ${String(month).padStart(2, '0')}/${year}` : type === 'quarter' ? `Quý ${ROMAN[quarter - 1]}/${year}` : `Năm ${year}`;
  return { key, type, year, ...(month ? { month } : {}), ...(quarter ? { quarter } : {}), from, to, label,
    fromDay: vnDayKey(from), toDay: vnDayKey(new Date(to.getTime() - 1)) };
}

/* ------------------------------------------------------------------ amounts */

/**
 * Split an integer total over non-negative weights by the largest remainder
 * method (ties go to the earlier weight). Parts always add up to the total;
 * a negative total is split as the mirror of its absolute value. Returns null
 * when the weights sum to zero.
 */
function allocate(total, weights) {
  if (!Number.isInteger(total)) throw new TypeError('allocate: total must be an integer');
  if (total < 0) {
    const parts = allocate(-total, weights);
    return parts && parts.map((p) => (p === 0 ? 0 : -p));
  }
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, x) => a + x, 0);
  if (!(sum > 0)) return null;
  const exact = w.map((x) => (total * x) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, p) => a + p, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).filter(([, i]) => w[i] > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) parts[order[k][1]] += 1;
  return parts;
}

/**
 * Tax on a revenue at a rate in basis points, optionally reduced by a percent
 * of the rate, rounded half up to 1 đ with exact integer arithmetic.
 * Non-positive revenue gives 0.
 */
function taxOn(revenue, rateBp, reductionPercent = 0) {
  if (!Number.isInteger(revenue) || revenue <= 0) return 0;
  const n = BigInt(revenue) * BigInt(rateBp) * BigInt(100 - reductionPercent);
  const d = 1000000n; // 10000 (basis points) * 100 (percent of the rate)
  return Number((2n * n + d) / (2n * d));
}

/* ---------------------------------------------------- industry group mapping */

/** Key identifying a category in the owner's mapping. */
function categoryKey(id, name) {
  const cid = idOf(id).trim();
  if (cid) return cid;
  const n = fold(name);
  return n ? `name:${n}` : 'none';
}

function presetDefaults(industry) {
  return INDUSTRY_DEFAULTS[industry] || INDUSTRY_DEFAULTS[FALLBACK_INDUSTRY];
}

/**
 * Decides the industry group of a sale line. Order:
 *   1. the owner's mapping for the line's category (by id, then by name);
 *   2. the industry preset's rule for that category name;
 *   3. a Posnic service item (items.item_kind === 'service');
 *   4. the owner's default group, else the preset's default group.
 * Charges (phụ phí) use the owner's chargeGroup, else the default group.
 *
 * settings = tenant.taxLedgerSettings
 *   { defaultGroup?, chargeGroup?, categoryGroups: [{ key, name?, group }] }
 * items = docs of the shop's `items` collection ({ _id, category_id,
 *   category_name, item_kind }), used when a sale line lacks its category.
 */
function createGroupResolver({ industry, settings, items = [] } = {}) {
  const s = settings || {};
  const preset = presetDefaults(industry);
  const presetCats = new Map(Object.entries(preset.categories || {}).map(([name, g]) => [fold(name), g]));
  const ownerByKey = new Map();
  const ownerByName = new Map();
  for (const row of Array.isArray(s.categoryGroups) ? s.categoryGroups : []) {
    if (!row || !GROUP_IDS.includes(row.group)) continue;
    ownerByKey.set(String(row.key), row.group);
    if (row.name) ownerByName.set(fold(row.name), row.group);
  }
  const itemById = new Map(items.map((it) => [idOf(it._id), it]));
  const defaultGroup = GROUP_IDS.includes(s.defaultGroup) ? s.defaultGroup : preset.group;
  const chargeGroup = GROUP_IDS.includes(s.chargeGroup) ? s.chargeGroup : defaultGroup;

  /* Category of a line, completed from the items collection when the sale
     line carries none (Posnic leaves category_name '' on some lines). */
  function categoryOf(line) {
    let id = idOf(line.category_id).trim();
    let name = String(line.category_name || '').trim();
    const item = itemById.get(idOf(line.item_id || line.itemId));
    if (!id && !name && item) {
      id = idOf(item.category_id).trim();
      name = String(item.category_name || '').trim();
    }
    return { key: categoryKey(id, name), id, name, item };
  }

  function forCategory(key, name) {
    if (ownerByKey.has(key)) return { group: ownerByKey.get(key), source: 'owner' };
    const n = fold(name);
    if (n && ownerByName.has(n)) return { group: ownerByName.get(n), source: 'owner' };
    if (n && presetCats.has(n)) return { group: presetCats.get(n), source: 'preset' };
    return null;
  }

  function forLine(line) {
    const c = categoryOf(line);
    const hit = forCategory(c.key, c.name);
    if (hit) return hit.group;
    if (c.item && c.item.item_kind === 'service') return SERVICE_ITEM_GROUP;
    return defaultGroup;
  }

  /* Effective group of a category for the settings screen. */
  function describeCategory(key, name) {
    const hit = forCategory(key, name);
    if (hit) return hit;
    return { group: defaultGroup, source: 'default' };
  }

  return { forLine, describeCategory, categoryOf, defaultGroup, chargeGroup, presetGroup: preset.group, presetCategory: (name) => presetCats.get(fold(name)) || null };
}

/* ------------------------------------------------------------- sale entries */

function saleTime(sale) {
  return toDate(sale.settled_at) || toDate(sale.date) || toDate(sale.created_date) || toDate(sale.updated_date);
}

/*
 * Why a sale is not revenue, or null when it is. Field references are to
 * upstream/pos/api/src (same reading as einvoice-worker.js saleSkipReason).
 */
function exclusionReason(sale) {
  const hasLines = (Array.isArray(sale.items) && sale.items.length > 0)
    || (Array.isArray(sale.items_return) && sale.items_return.length > 0);
  if (!hasLines) return 'no_items';
  /* Parked bill, stored with payment_status 'Paid' (salesController.holdSale). */
  if (String(sale.sale_process || '') === 'Hold') return 'held';
  if (sale.order_state === 'pending' || sale.order_state === 'rejected') return 'order_not_accepted';
  if (sale.customer_cancelled_at || sale.status === 'cancelled' || sale.is_deleted === true) return 'cancelled';
  /* 'Partialy Paid' (sic) is a credit sale (bán chịu) or a part-tendered
     bill: the goods are delivered, so it is revenue on the day of sale; an
     open table order (sale_process 'KOT') with a deposit is not. */
  // UNVERIFIED: cần kế toán xác nhận — credit sales recognised on the day of sale.
  if (sale.payment_status === 'Partialy Paid' && String(sale.sale_process || '') !== 'KOT') return null;
  if (sale.payment_status !== 'Paid') return 'not_paid';
  return null;
}

/* Lines as originally sold, each with an amount used only as a weight. */
function originalLines(sale) {
  const now = Array.isArray(sale.items) ? sale.items.filter((l) => l && typeof l === 'object') : [];
  const returned = [];
  for (const entry of Array.isArray(sale.items_return) ? sale.items_return : []) {
    const ra = entry && (entry.returnArray || entry);
    for (const l of Array.isArray(ra && ra.returnValue) ? ra.returnValue : []) if (l && typeof l === 'object') returned.push(l);
  }
  const origin = sale.business_item_origin;
  if (origin && Array.isArray(origin.lines) && origin.lines.length) {
    /* Origin lines carry no category: take it from the sale's own lines. */
    const known = new Map();
    for (const l of [...now, ...returned]) {
      const id = idOf(l.item_id);
      if (id && !known.has(id)) known.set(id, l);
    }
    return origin.lines.map((l) => {
      const ref = known.get(idOf(l.itemId)) || {};
      return { item_id: l.itemId, category_id: ref.category_id, category_name: ref.category_name, amount: num(l.grossAmount) };
    });
  }
  return [...now, ...returned].map((l) => ({ item_id: l.item_id, category_id: l.category_id, category_name: l.category_name, amount: num(l.total_amount) }));
}

function groupWeights(lines, resolver) {
  const w = Object.fromEntries(GROUP_IDS.map((g) => [g, 0]));
  for (const l of lines) {
    const a = num(l.amount);
    if (!(a > 0)) continue;
    w[resolver.forLine(l)] += a;
  }
  return w;
}

function splitByGroup(total, weights, fallbackGroup) {
  const amounts = Object.fromEntries(GROUP_IDS.map((g) => [g, 0]));
  const parts = allocate(total, GROUP_IDS.map((g) => weights[g]));
  if (parts) GROUP_IDS.forEach((g, i) => { amounts[g] = parts[i]; });
  else amounts[fallbackGroup] = total;
  return amounts;
}

/**
 * Ledger entries of one Posnic sale document: { entries, excluded, at }.
 * entries: [{ kind: 'sale'|'return', at: Date, day, docNo, saleNo, refId,
 *             amounts: { <group>: int }, total: int, credit? }]
 * excluded: the reason the sale is not revenue (then entries is empty).
 */
function saleEntries(sale, resolver) {
  const at = saleTime(sale);
  const refId = idOf(sale._id);
  const saleNo = String(sale.sales_id || refId || '').trim();
  const reason = exclusionReason(sale);
  if (reason) return { entries: [], excluded: reason, at };
  const total = vnd(num(sale.sales_total));
  if (!at) return { entries: [], excluded: 'no_date', at };
  if (!Number.isFinite(total) || total < 0) return { entries: [], excluded: 'invalid_total', at };

  const entries = [];
  const weights = groupWeights(originalLines(sale), resolver);
  for (const c of Array.isArray(sale.charges) ? sale.charges : []) {
    const a = (num(c && c.amount) || 0) + (num(c && c.tax_amount) || 0);
    if (a > 0) weights[resolver.chargeGroup] += a;
  }
  entries.push({
    kind: 'sale', at, day: vnDayKey(at), docNo: saleNo, saleNo, refId,
    amounts: splitByGroup(total, weights, resolver.defaultGroup), total,
    ...(sale.payment_status === 'Partialy Paid' ? { credit: true } : {}),
  });

  (Array.isArray(sale.items_return) ? sale.items_return : []).forEach((entry, i) => {
    const ra = entry && (entry.returnArray || entry);
    if (!ra || typeof ra !== 'object') return;
    const lines = (Array.isArray(ra.returnValue) ? ra.returnValue : []).filter((l) => l && typeof l === 'object');
    const when = toDate(ra.returnDate) || toDate(lines[0] && lines[0].return_date);
    if (!when) return;
    let refund = num(ra.itemsTotalAmount);
    if (!Number.isFinite(refund)) refund = lines.reduce((a, l) => a + (num(l.total_amount) || 0), 0) - (num(ra.extraDiscount) || 0);
    refund = vnd(refund);
    if (!(refund > 0)) return;
    const w = groupWeights(lines.map((l) => ({ ...l, amount: num(l.total_amount) })), resolver);
    const amounts = splitByGroup(-refund, w, resolver.defaultGroup);
    entries.push({
      kind: 'return', at: when, day: vnDayKey(when), docNo: String(ra.returnId || idOf(ra.returnObjId) || `${saleNo}-TL${i + 1}`), saleNo, refId,
      amounts, total: -refund,
    });
  });
  return { entries, excluded: null, at };
}

/* ------------------------------------------------------------------- ledger */

const zeroGroups = () => Object.fromEntries(GROUP_IDS.map((g) => [g, 0]));
const addInto = (acc, amounts) => { for (const g of GROUP_IDS) acc[g] += amounts[g] || 0; return acc; };
const sumOf = (amounts) => GROUP_IDS.reduce((a, g) => a + (amounts[g] || 0), 0);
const inRange = (at, from, to) => at.getTime() >= from.getTime() && at.getTime() < to.getTime();

function listDocNos(nos, max = 3) {
  const uniq = [...new Set(nos.filter(Boolean))];
  if (uniq.length <= max) return uniq.join(', ');
  return `${uniq[0]} … ${uniq[uniq.length - 1]}`;
}

/* Book rows: one per day for sales and one per day for returns ('day'), or
   one per sale / return ('sale'). */
function bookRows(entries, detail) {
  const sorted = entries.slice().sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'sale' ? -1 : 1) || String(a.docNo).localeCompare(String(b.docNo)));
  if (detail === 'sale') {
    return sorted.map((e) => ({
      postedOn: e.day, docNo: e.docNo, docDate: e.day,
      description: e.kind === 'sale' ? `Bán hàng – đơn ${e.saleNo}` : `Hàng bán bị trả lại – đơn ${e.saleNo}`,
      amounts: { ...e.amounts }, total: e.total,
      note: e.kind === 'sale' && e.credit ? 'Bán chịu / thu chưa đủ' : '',
      kind: e.kind,
    }));
  }
  const days = new Map();
  for (const e of sorted) {
    const k = `${e.day}|${e.kind}`;
    if (!days.has(k)) days.set(k, { day: e.day, kind: e.kind, list: [] });
    days.get(k).list.push(e);
  }
  return [...days.values()].map(({ day, kind, list }) => {
    const amounts = list.reduce((acc, e) => addInto(acc, e.amounts), zeroGroups());
    const credit = list.filter((e) => e.credit).length;
    return {
      postedOn: day,
      docNo: listDocNos(list.map((e) => e.docNo)),
      docDate: day,
      description: kind === 'sale'
        ? `Doanh thu bán hàng ngày ${dayLabel(day)} (${list.length} đơn)`
        : `Hàng bán bị trả lại ngày ${dayLabel(day)} (${list.length} lượt, đơn ${listDocNos(list.map((e) => e.saleNo))})`,
      amounts, total: sumOf(amounts),
      note: credit ? `Gồm ${credit} đơn bán chịu / thu chưa đủ` : '',
      kind,
      count: list.length,
    };
  });
}

const THRESHOLD_TEXT = {
  exceeded: (y, rev, t) => `Doanh thu năm ${y} đã ghi nhận ${fmt(rev)} đ, vượt ngưỡng không chịu thuế ${fmt(t)} đ: thuế tính trên toàn bộ doanh thu.`,
  not_exceeded_yet: (y, rev, t) => `Doanh thu năm ${y} đến nay ${fmt(rev)} đ, chưa vượt ngưỡng ${fmt(t)} đ. Nếu cả năm vượt ngưỡng, thuế tính trên toàn bộ doanh thu năm (kể cả kỳ này); số thuế dưới đây là số tạm tính nếu vượt ngưỡng.`,
  not_exceeded: (y, rev, t) => `Doanh thu cả năm ${y} là ${fmt(rev)} đ, không vượt ngưỡng ${fmt(t)} đ: không phải nộp thuế GTGT, TNCN theo tỷ lệ trên doanh thu.`,
};
function fmt(n) {
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `-${s}` : s;
}

/**
 * Period summary for self-declaration. `revenue` is the period's net revenue
 * per group; `yearRevenue` the year's net revenue recorded up to `now`.
 */
function summarize({ revenue, yearRevenue, period, now, table = TAX_TABLE }) {
  const reduction = Number(table.gtgtReductionPercent) || 0;
  const groups = GROUP_IDS.map((id) => {
    const g = table.groups[id];
    const rev = revenue[id] || 0;
    return {
      id, column: g.column, label: g.label, revenue: rev,
      gtgtRateBp: g.gtgtBp, tncnRateBp: g.tncnBp,
      gtgt: taxOn(rev, g.gtgtBp, reduction), tncn: taxOn(rev, g.tncnBp),
    };
  });
  const totals = groups.reduce((t, g) => ({ revenue: t.revenue + g.revenue, gtgt: t.gtgt + g.gtgt, tncn: t.tncn + g.tncn }), { revenue: 0, gtgt: 0, tncn: 0 });
  totals.tax = totals.gtgt + totals.tncn;
  const yearEnd = vnMonthStart(period.year + 1, 0);
  const status = yearRevenue > table.annualThreshold ? 'exceeded' : now.getTime() >= yearEnd.getTime() ? 'not_exceeded' : 'not_exceeded_yet';
  const payable = status === 'exceeded'
    ? { gtgt: totals.gtgt, tncn: totals.tncn, total: totals.tax }
    : { gtgt: 0, tncn: 0, total: 0 };
  const warnings = [];
  for (const g of groups) if (g.revenue < 0) warnings.push(`Nhóm "${g.label}" có doanh thu âm trong kỳ (hàng trả lại nhiều hơn hàng bán): thuế của nhóm tính bằng 0.`);
  return {
    notice: NOTICE,
    tableVersion: table.version,
    gtgtReductionPercent: reduction,
    rounding: table.rounding,
    groups, totals, payable,
    threshold: { annual: table.annualThreshold, mode: table.thresholdMode, year: period.year, yearRevenue, status, text: THRESHOLD_TEXT[status](period.year, yearRevenue, table.annualThreshold) },
    warnings,
  };
}

/**
 * The whole report of a period from ledger entries (see saleEntries) that
 * cover at least the period's calendar year.
 *
 * options: { entries, excluded?: [{ reason, at }], period, now, shop?,
 *            detail?: 'day'|'sale', table? }
 */
function buildLedger({ entries, excluded = [], period, now = new Date(), shop = {}, detail = 'day', table = TAX_TABLE }) {
  const inPeriod = entries.filter((e) => inRange(e.at, period.from, period.to));
  const yearFrom = vnMonthStart(period.year, 0);
  const yearTo = vnMonthStart(period.year + 1, 0);
  const yearRevenue = entries.filter((e) => inRange(e.at, yearFrom, yearTo) && e.at.getTime() <= now.getTime()).reduce((a, e) => a + e.total, 0);
  const rows = bookRows(inPeriod, detail === 'sale' ? 'sale' : 'day');
  const revenue = inPeriod.reduce((acc, e) => addInto(acc, e.amounts), zeroGroups());
  const sales = inPeriod.filter((e) => e.kind === 'sale');
  const returns = inPeriod.filter((e) => e.kind === 'return');
  const skipped = {};
  for (const x of excluded) if (x.at && inRange(x.at, period.from, period.to)) skipped[x.reason] = (skipped[x.reason] || 0) + 1;
  const summary = summarize({ revenue, yearRevenue, period, now, table });
  const credit = sales.filter((e) => e.credit).length;
  if (credit) summary.warnings.push(`Có ${credit} đơn bán chịu / thu chưa đủ được ghi doanh thu tại ngày bán.`);
  return {
    notice: NOTICE,
    generatedAt: now.toISOString(),
    shop: { name: shop.name || '', taxCode: shop.taxCode || '', address: shop.address || '', subdomain: shop.subdomain || '' },
    period: { key: period.key, type: period.type, label: period.label, year: period.year, from: period.from.toISOString(), to: period.to.toISOString(), fromDay: period.fromDay, toDay: period.toDay },
    detail: detail === 'sale' ? 'sale' : 'day',
    groups: GROUP_IDS.map((id) => ({ id, column: table.groups[id].column, label: table.groups[id].label })),
    book: {
      rows,
      totals: { amounts: revenue, total: sumOf(revenue) },
      counts: { sales: sales.length, returns: returns.length, skipped },
    },
    summary,
  };
}

/* --------------------------------------------------------------- loading */

/* Superset query of the sales that can produce an entry in [from, to): sold
   in the range, or returned in it. Exact filtering is done in JS. Dates are
   matched both as BSON dates and as ISO strings (older documents). */
function salesQuery(from, to) {
  const range = { $gte: from, $lt: to };
  const srange = { $gte: from.toISOString(), $lt: to.toISOString() };
  const or = [];
  for (const f of ['settled_at', 'date', 'created_date', 'items_return.returnArray.returnDate']) {
    or.push({ [f]: range }, { [f]: srange });
  }
  return { $or: or };
}

const SALE_PROJECTION = {
  _id: 1, sales_id: 1, sale_process: 1, payment_status: 1, order_state: 1, customer_cancelled_at: 1, status: 1, is_deleted: 1,
  settled_at: 1, date: 1, created_date: 1, updated_date: 1, sales_total: 1, charges: 1, items_return: 1,
  'items.item_id': 1, 'items.category_id': 1, 'items.category_name': 1, 'items.total_amount': 1,
  'business_item_origin.lines': 1,
};

async function* iterate(cursor) {
  if (cursor && typeof cursor[Symbol.asyncIterator] === 'function') {
    for await (const doc of cursor) yield doc;
    return;
  }
  for (const doc of await cursor.toArray()) yield doc;
}

/**
 * Read one shop's data for a period and build its ledger.
 * db: the shop's Mongo database (or anything with collection(name).find()).
 */
async function ledgerFromShopDb({ db, tenant, period, now = new Date(), detail = 'day', table = TAX_TABLE }) {
  const items = await db.collection('items').find({}, { projection: { _id: 1, category_id: 1, category_name: 1, item_kind: 1 } }).toArray();
  const resolver = createGroupResolver({ industry: tenant.industry, settings: tenant.taxLedgerSettings, items });
  const yearFrom = vnMonthStart(period.year, 0);
  const yearTo = vnMonthStart(period.year + 1, 0);
  const entries = [];
  const excluded = [];
  const cursor = db.collection('sales').find(salesQuery(yearFrom, yearTo), { projection: SALE_PROJECTION });
  for await (const sale of iterate(cursor)) {
    const r = saleEntries(sale, resolver);
    if (r.excluded) excluded.push({ reason: r.excluded, at: r.at });
    for (const e of r.entries) entries.push(e);
  }
  return buildLedger({ entries, excluded, period, now, shop: shopOf(tenant), detail, table });
}

function shopOf(tenant) {
  const seller = (tenant.einvoiceSettings && tenant.einvoiceSettings.seller) || {};
  return {
    name: tenant.businessName || seller.name || '',
    taxCode: tenant.taxCode || seller.taxCode || '',
    address: tenant.address || seller.address || '',
    subdomain: tenant.subdomain || '',
  };
}

module.exports = {
  NOTICE,
  VN_OFFSET_MS,
  parsePeriod,
  vnDayKey,
  dayLabel,
  allocate,
  taxOn,
  categoryKey,
  createGroupResolver,
  exclusionReason,
  saleEntries,
  summarize,
  buildLedger,
  salesQuery,
  ledgerFromShopDb,
  shopOf,
  fold,
  httpError,
  formatAmount: fmt,
};
