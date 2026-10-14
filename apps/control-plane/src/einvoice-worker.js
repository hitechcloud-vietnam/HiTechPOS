'use strict';

const { EInvoiceError } = require('@hitechpos/einvoice-vn');
const { isValidTaxCode, normalizeVNPhone, removeDiacritics, VAT_RATE_LABELS } = require('@hitechpos/vn-locale');

/*
 * Auto-issue of Vietnamese e-invoices for sales completed on a shop's Posnic
 * till.
 *
 * For every tenant with einvoiceSettings.autoIssue the worker reads the shop's
 * `sales` collection (tenant DB hitech_t_<subdomain>) in (updated_date, _id)
 * order from a per-tenant checkpoint (tenant.einvoiceCursor), decides whether
 * each sale is final, maps it to the canonical sale input of
 * createEInvoiceService().issue() and issues it.
 *
 * Why updated_date: every Posnic write path that settles a bill stamps it
 * (processSale in services/sale.service.js, the legacy settle in
 * repositories/sale.repository.js, services/captain-payments.js), while
 * `date` only moves for KOT/table settlements (helpers/restaurant-sale-time.js).
 * A table order opened before the checkpoint and paid after it is therefore
 * still seen. The flip side is that any later edit (return, print stamp) brings
 * a sale back; the idempotency guard row in store.einvoices makes that a cheap
 * no-op, and a return after issue is reported instead of silently ignored.
 *
 * Checkpoint rules:
 *   - it advances over the leading run of sales that are issued or
 *     definitively skipped; the first sale that is not stops it, so a transient
 *     provider failure is retried next run;
 *   - an einvoice_outcome_unknown / in-progress guard row stops it too but is
 *     never re-sent: the guard refuses until the owner reconciles
 *     (POST /api/shop/einvoices/:refId/reconcile), after which the row is
 *     'done' (or gone, and the sale is issued normally);
 *   - the first run starts at einvoiceSettings.updatedAt (when auto-issue was
 *     switched on) and sales whose own time is earlier are never issued, so
 *     enabling the feature does not back-issue history. Switching autoIssue off
 *     clears the checkpoint.
 *
 * Failures are kept on the tenant as einvoiceErrors (last 50, one per sale).
 */

const ZERO_ID = '000000000000000000000000';
const MAX_ERRORS = 50;
const REF_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/* Provider/guard error codes, by what the worker does next. */
const STOP_TENANT = new Set([ // provider or configuration trouble: stop this tenant, retry next run
  'einvoice_unavailable', 'einvoice_credentials_rejected', 'einvoice_configuration_invalid',
  'einvoice_not_configured', 'einvoice_response_invalid', 'einvoice_rejected', 'einvoice_outcome_unknown', 'einvoice_duplicate',
]);
const BLOCKED = new Set(['einvoice_outcome_unknown', 'einvoice_duplicate', 'einvoice_issue_in_progress']);
/* Retried a few times (the provider may refuse one invoice for its own data),
   then given up on so one sale cannot hold the shop's queue for ever. */
const CAPPED = new Set(['einvoice_rejected', 'einvoice_response_invalid']);
const MAX_CAPPED_ATTEMPTS = 5;

function unmappable(message, details) {
  return new EInvoiceError('posnic_sale_unmappable', { status: 422, message, details });
}

function num(v) {
  if (typeof v === 'number') return v;
  if (v === undefined || v === null) return NaN;
  const s = String(v).replace(/,/g, '').trim();
  return s === '' ? NaN : Number(s);
}

function vnd(x) {
  const r = Math.sign(x) * Math.round(Math.abs(Number(x.toPrecision(15))));
  return r === 0 ? 0 : r;
}

function idOf(v) {
  if (v === undefined || v === null) return '';
  return typeof v === 'object' && typeof v.toHexString === 'function' ? v.toHexString() : String(v);
}

function isoOf(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function text(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s || undefined;
}

const fold = (s) => removeDiacritics(String(s || '')).toLowerCase().trim();

/* Stable invoice reference of a Posnic sale: its Mongo _id (24 hex). The
   human number (sales_id, e.g. S-OKHF-000003) comes from a per-branch counter
   and is shown in error rows but is not guaranteed unique across branches. */
function saleRefId(sale) {
  const raw = idOf(sale && sale._id).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);
  return REF_ID_RE.test(raw) ? raw : null;
}

/* When the sale happened, for the invoice date and the never-back-issue rule. */
function saleTime(sale) {
  return isoOf(sale.settled_at) || isoOf(sale.date) || isoOf(sale.created_date) || isoOf(sale.updated_date);
}

function isReturned(sale) {
  return (Array.isArray(sale.items_return) && sale.items_return.length > 0)
    || /return/i.test(String(sale.sale_process || ''))
    || (Array.isArray(sale.return_refund_transactions) && sale.return_refund_transactions.length > 0);
}

/*
 * Why a sale must NOT be invoiced (now), or null when it is final.
 * Field references are to upstream/pos/api/src.
 */
function saleSkipReason(sale, { since } = {}) {
  /* No lines at all - nothing to invoice. */
  if (!Array.isArray(sale.items) || sale.items.length === 0) return 'no_items';
  /* Parked bill: POST /api/sales/hold stores sale_process 'Hold' and, oddly,
     payment_status 'Paid' (salesController.holdSale -> processSale 'Hold'). */
  if (String(sale.sale_process || '') === 'Hold') return 'held';
  /* Online order still waiting for (or refused by) the shop:
     order_state 'pending' | 'rejected' (utils/order-approval.js). */
  if (sale.order_state === 'pending' || sale.order_state === 'rejected') return 'order_not_accepted';
  /* Cancelled. Till cancel deletes the sale (sale.repository deleteSales ->
     recycle_bin) so it simply vanishes; online orders called off by the
     customer keep customer_cancelled_at; status/is_deleted are defensive. */
  if (sale.customer_cancelled_at || sale.status === 'cancelled' || sale.is_deleted === true) return 'cancelled';
  /* Not settled: payment_status 'Unpaid' (open KOT/table order, unpaid toggle,
     no payment_mode) or 'Partialy Paid' (sic, credit / partial tender).
     sale.service.js processSale computes it; settlement later flips it to
     'Paid' and stamps updated_date, which brings the sale back to us. */
  if (sale.payment_status !== 'Paid') return 'not_paid';
  /* A payment correction is half done (sale.service.js refuses edits too). */
  if (sale.payment_correction_pending) return 'payment_correction_pending';
  /* Returned (POST /api/sales/returnSales rewrites the sale: sale_process
     'PartialReturn'/'Return', items_return[], return_refund_transactions[]).
     Needs a person: either an adjustment of an invoice already issued or an
     invoice for what was finally sold. */
  if (isReturned(sale)) return 'returned';
  if (!(num(sale.sales_total) > 0)) return 'zero_total';
  const at = saleTime(sale);
  if (since && (!at || at < since)) return 'before_auto_issue';
  return null;
}

/*
 * VAT rate of a Posnic tax: the shop's grouptax doc (by id from the line's
 * tax_fields, else by name). The KCT / KKKNT taxes are recognised by name
 * ("KCT-Không chịu thuế" from onboarding.js), everything else by its rate.
 */
function vatRateOf({ taxId, taxName, rate }, taxes, where) {
  const byId = taxId ? taxes.find((t) => idOf(t._id) === String(taxId)) : null;
  const byName = !byId && taxName ? taxes.find((t) => fold(t.name) === fold(taxName)) : null;
  const tax = byId || byName;
  const name = fold((tax && tax.name) || taxName);
  if (/^kct\b|khong chiu thue/.test(name)) return 'KCT';
  if (/^kkknt\b|khong (phai )?ke khai/.test(name)) return 'KKKNT';
  const fields = tax && Array.isArray(tax.tax_fields) ? tax.tax_fields : [];
  const value = tax ? num(tax.rate !== undefined ? tax.rate : fields.reduce((a, f) => a + num(f.tax_value), 0)) : num(rate);
  if ([0, 5, 8, 10].includes(value)) return value;
  throw unmappable(`Thuế suất ${Number.isFinite(value) ? `${value}%` : `"${taxName || ''}"`} của ${where} không phải 0/5/8/10%, KCT hoặc KKKNT`, { where, taxName, rate: value });
}

function unitOf(item, units) {
  const value = text(item.item_unit);
  /* Posnic's default unit "qty" is labelled "Số lượng" - not a unit an invoice can print. */
  if (!value || value === 'qty') return 'cái';
  const u = units.find((x) => x.value === value);
  return text(u && u.name) || value;
}

function isCash(mode) {
  return /^(cash|tien mat|tm)$/.test(fold(mode));
}

function paymentMethodOf(sale) {
  let modes = [];
  const mp = sale.multi_payment;
  if (mp && typeof mp === 'object') {
    const entries = Array.isArray(mp) ? mp.map((p) => [p && (p.mode || p.method || p.payment_mode), p && p.amount]) : Object.entries(mp);
    modes = entries.filter(([m, a]) => text(m) && num(a) > 0).map(([m]) => m);
  }
  if (!modes.length) modes = String(sale.payment_mode || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!modes.length) return 'TM/CK';
  const cash = modes.filter(isCash).length;
  if (cash === modes.length) return 'TM';
  if (cash === 0) return 'CK';
  return 'TM/CK';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buyerOf(sale, customer) {
  const taxCode = text(sale.customer_gst_number) || text(customer && customer.gst_number);
  if (!taxCode) return {};
  if (!isValidTaxCode(taxCode)) throw unmappable(`Mã số thuế người mua "${taxCode}" không hợp lệ`, { field: 'customer_gst_number', value: taxCode });
  const email = text(sale.customer_email) || text(customer && customer.email);
  const phone = normalizeVNPhone(text(sale.customer_phone) || text(customer && customer.phone));
  const buyer = {
    name: text(sale.customer_name) || text(customer && customer.name),
    companyName: text(customer && customer.company_name),
    taxCode,
    address: text(sale.customer_address) || text(customer && customer.address),
    email: email && EMAIL_RE.test(email) ? email : undefined,
    phone: phone || undefined,
  };
  for (const k of Object.keys(buyer)) if (buyer[k] === undefined) delete buyer[k];
  return buyer;
}

/* Integer split of `total` proportional to `weights` (largest remainder, ties to the first). */
function allocate(total, weights) {
  const sum = weights.reduce((a, w) => a + w, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, p) => a + p, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) parts[order[k][1]] += 1;
  return parts;
}

/*
 * Posnic sale document -> canonical sale input of einvoices.issue().
 *
 * Every amount is taken VAT-inclusive (pricesIncludeVat: true) so the invoice
 * total equals what the customer paid (sales_total):
 *   goods  items[]: item_name, item_sku (code), item_unit, item_quantity,
 *          item_price (catalogue unit price; net of VAT when tax_type is
 *          'exclusive'), total_amount (the line as charged, VAT included,
 *          after the line discount), tax / tax_type / tax_name / tax_fields.
 *          Posnic applies a line discount to the NET price of inclusive items
 *          (services/tax-engine.js), so the discount is derived as list
 *          amount - total_amount rather than read from item_discount.
 *   charges[]: name, amount (net), tax_amount, tax_name (sale-charges.js).
 *   bill discounts: sale_extra_discount (amount or percent already
 *          resolved), coupon_discount_value, loyalty_redeem_value, round_off
 *          (sale-header.js). Their sum is cross-checked against
 *          lines - sales_total and emitted as chiết khấu thương mại lines,
 *          one per VAT rate, allocated in proportion to the goods of that rate.
 *   payment: multi_payment {mode: amount} or payment_mode "Cash, Chuyển khoản".
 *   buyer: customer_gst_number (+ the customers doc for company_name).
 *
 * options: { taxes: grouptax docs, units?: unit docs, customer?: customers doc }
 * Throws EInvoiceError 'posnic_sale_unmappable' (422) when the sale cannot be
 * represented faithfully.
 */
function mapPosnicSale(sale, { taxes = [], units = [], customer = null } = {}) {
  if (!sale || typeof sale !== 'object') throw unmappable('Thiếu dữ liệu đơn hàng');
  const refId = saleRefId(sale);
  if (!refId) throw unmappable('Đơn hàng không có mã hợp lệ', { field: '_id' });
  const issueDate = saleTime(sale);
  if (!issueDate) throw unmappable('Đơn hàng không có thời điểm bán', { field: 'date' });

  const lines = [];
  (Array.isArray(sale.items) ? sale.items : []).forEach((item, i) => {
    if (!item || typeof item !== 'object') throw unmappable(`Dòng ${i + 1} hỏng`, { line: i });
    const quantity = num(item.item_quantity);
    if (!(quantity > 0)) return; // fully returned / zeroed line
    const name = text(item.item_name) || text(item.name) || (text(item.item_sku) ? `Mặt hàng ${text(item.item_sku)}` : undefined);
    if (!name) throw unmappable(`Dòng ${i + 1} không có tên hàng`, { line: i });
    const field0 = Array.isArray(item.tax_fields) && item.tax_fields[0] ? item.tax_fields[0] : {};
    const vatRate = vatRateOf({ taxId: field0.tax_id, taxName: item.tax_name || field0.tax_name, rate: item.tax }, taxes, `"${name}"`);
    const rateNum = typeof vatRate === 'number' ? vatRate : 0;
    const price = [item.item_price, item.sale_inline_item_price, item.pricing && item.pricing.selling_price].map(num).find((x) => Number.isFinite(x) && x >= 0);
    const charged = vnd(num(item.total_amount));
    if (price === undefined || !Number.isFinite(charged) || charged < 0) throw unmappable(`Dòng "${name}" thiếu đơn giá/thành tiền`, { line: i });
    const exclusive = String(item.tax_type || '').toLowerCase() === 'exclusive';
    let unitPrice = exclusive ? (price * (100 + rateNum)) / 100 : price;
    let listAmount = vnd(quantity * unitPrice);
    if (charged > listAmount) { // modifiers or a price override raised the line
      unitPrice = charged / quantity;
      listAmount = vnd(quantity * unitPrice);
    }
    const discount = Math.max(0, listAmount - charged);
    const line = { code: text(item.item_sku) || text(item.barcode_id), name, unit: unitOf(item, units), quantity, unitPrice, vatRate };
    if (discount) line.discount = discount;
    if (!line.code) delete line.code;
    lines.push(line);
  });
  const goods = lines.slice();
  if (!goods.length) throw unmappable('Đơn hàng không có dòng hàng hoá', { field: 'items' });

  for (const c of Array.isArray(sale.charges) ? sale.charges : []) {
    const net = num(c && c.amount);
    const tax = num(c && c.tax_amount) || 0;
    if (!(net > 0)) continue;
    const name = text(c.name) || 'Phụ phí';
    /* An untaxed charge carries no VAT: KCT is the closest invoice category. */
    const vatRate = c.taxed === true || tax > 0
      ? vatRateOf({ taxName: c.tax_name, rate: Math.round((tax / net) * 100) }, taxes, `phụ phí "${name}"`)
      : 'KCT';
    lines.push({ name, unit: 'lần', quantity: 1, unitPrice: vnd(net + tax), vatRate });
  }

  const linesGross = lines.reduce((a, l) => a + vnd(l.quantity * l.unitPrice) - (l.discount || 0), 0);
  const paid = vnd(num(sale.sales_total));
  const billDiscount = linesGross - paid;
  const declared = (num(sale.sale_extra_discount) || 0) + (num(sale.coupon_discount_value) || 0)
    + (num(sale.loyalty_redeem_value) || 0) - (num(sale.round_off !== undefined ? sale.round_off : sale.sales_round_off) || 0);
  if (Math.abs(billDiscount - declared) > 1) {
    throw unmappable(`Tổng tiền đơn (${paid}) không khớp tiền hàng (${linesGross}) trừ chiết khấu (${vnd(declared)})`, { linesGross, salesTotal: paid, declaredDiscount: declared });
  }
  if (billDiscount < 0) throw unmappable('Đơn hàng làm tròn lên - không biểu diễn được trên hoá đơn', { roundOff: -billDiscount });
  if (billDiscount > 0) {
    const groups = [];
    for (const l of goods) {
      const g = groups.find((x) => x.vatRate === l.vatRate) || (groups.push({ vatRate: l.vatRate, gross: 0 }), groups[groups.length - 1]);
      g.gross += vnd(l.quantity * l.unitPrice) - (l.discount || 0);
    }
    const goodsGross = groups.reduce((a, g) => a + g.gross, 0);
    if (billDiscount > goodsGross) throw unmappable('Chiết khấu vượt quá tiền hàng', { billDiscount, goodsGross });
    const parts = allocate(billDiscount, groups.map((g) => g.gross));
    groups.forEach((g, i) => {
      if (!parts[i]) return;
      const label = VAT_RATE_LABELS[g.vatRate] || String(g.vatRate);
      lines.push({ kind: 'discount', name: groups.length > 1 ? `Chiết khấu thương mại (thuế suất ${label})` : 'Chiết khấu thương mại', amount: parts[i], vatRate: g.vatRate });
    });
  }

  return {
    refId,
    issueDate,
    paymentMethod: paymentMethodOf(sale),
    pricesIncludeVat: true,
    buyer: buyerOf(sale, customer),
    lines,
  };
}

function createEInvoiceWorker({ store, einvoices, tenantDb, now = () => new Date(), logger = console, batchSize = 20, scanLimit = 200, toObjectId } = {}) {
  if (!store || !einvoices || typeof tenantDb !== 'function') throw new TypeError('createEInvoiceWorker needs store, einvoices and tenantDb');
  const oid = toObjectId || ((hex) => {
    const { ObjectId } = require('mongodb');
    return ObjectId.isValid(hex) ? new ObjectId(hex) : hex;
  });
  let running = null;

  function recordError(errors, entry) {
    const prev = errors.find((e) => e.refId === entry.refId);
    const attempts = (prev && prev.code === entry.code ? prev.attempts || 1 : 0) + 1;
    const next = errors.filter((e) => e.refId !== entry.refId);
    next.push({ ...entry, attempts, at: now().toISOString() });
    return { list: next.slice(-MAX_ERRORS), attempts };
  }

  async function runTenant(tenant) {
    const s = tenant.einvoiceSettings;
    const tid = String(tenant._id);
    const since = isoOf(s.updatedAt) || now().toISOString();
    const saved = tenant.einvoiceCursor && tenant.einvoiceCursor.since ? tenant.einvoiceCursor : null;
    const cursor = saved ? { since: saved.since, lastDate: saved.lastDate, lastId: saved.lastId } : { since, lastDate: since, lastId: ZERO_ID };
    let errors = Array.isArray(tenant.einvoiceErrors) ? tenant.einvoiceErrors.slice() : [];
    const summary = { tenantId: tid, subdomain: tenant.subdomain, scanned: 0, issued: 0, alreadyIssued: 0, skipped: {}, failed: 0, blocked: 0, stopped: null };
    const skip = (reason) => { summary.skipped[reason] = (summary.skipped[reason] || 0) + 1; };

    const db = await tenantDb(tenant);
    const [taxes, units] = await Promise.all([
      db.collection('grouptax').find({}).toArray(),
      db.collection('unit').find({}).toArray(),
    ]);
    const sales = db.collection('sales');
    const query = {
      $or: [
        { updated_date: { $gt: new Date(cursor.lastDate) } },
        { updated_date: new Date(cursor.lastDate), _id: { $gt: oid(cursor.lastId) } },
      ],
    };
    const docs = await sales.find(query).sort({ updated_date: 1, _id: 1 }).limit(scanLimit).toArray();

    let contiguous = true;
    let attempts = 0;
    const advance = (doc) => {
      if (!contiguous) return;
      cursor.lastDate = isoOf(doc.updated_date) || cursor.lastDate;
      cursor.lastId = idOf(doc._id);
    };
    const fail = (doc, refId, err, final) => {
      const r = recordError(errors, { refId: refId || idOf(doc._id), saleNo: doc.sales_id || null, code: err.code || 'error', message: String(err.message || err).slice(0, 300), final });
      errors = r.list;
      return r.attempts;
    };

    for (const doc of docs) {
      summary.scanned += 1;
      const refId = saleRefId(doc);
      const reason = saleSkipReason(doc, { since: cursor.since });
      if (reason === 'returned') {
        const row = refId ? await store.einvoices.get(`${tid}:${refId}`) : null;
        const issued = row && row.state === 'done';
        const already = errors.find((e) => e.refId === refId && e.code === (issued ? 'einvoice_adjustment_needed' : 'sale_returned_before_issue'));
        if (!already && (issued || saleTime(doc) >= cursor.since)) {
          fail(doc, refId, {
            code: issued ? 'einvoice_adjustment_needed' : 'sale_returned_before_issue',
            message: issued ? 'Đơn đã xuất hoá đơn rồi bị trả hàng - cần lập hoá đơn điều chỉnh' : 'Đơn bị trả hàng trước khi xuất hoá đơn - cần xuất hoá đơn thủ công cho phần đã bán',
          }, true);
        }
        skip(reason);
        advance(doc);
        continue;
      }
      if (reason) { skip(reason); advance(doc); continue; }
      if (!refId) { fail(doc, null, { code: 'sale_ref_invalid', message: 'Mã đơn hàng không hợp lệ' }, true); summary.failed += 1; advance(doc); continue; }

      const row = await store.einvoices.get(`${tid}:${refId}`);
      if (row && row.state === 'done') { summary.alreadyIssued += 1; advance(doc); continue; }
      if (row && (row.state === 'unknown' || row.state === 'pending')) {
        /* Never re-sent: the owner reconciles first. */
        const code = row.state === 'unknown' ? 'einvoice_outcome_unknown' : 'einvoice_issue_in_progress';
        if (!errors.some((e) => e.refId === refId && e.code === code)) fail(doc, refId, { code, message: 'Chưa rõ kết quả phát hành - cần đối soát' }, false);
        summary.blocked += 1;
        contiguous = false;
        continue;
      }
      if (attempts >= batchSize) { summary.stopped = 'batch_limit'; break; }

      let input;
      try {
        const customerId = doc.customer_id;
        const customer = customerId && (text(doc.customer_gst_number) || doc.customer_gst_type === 'business')
          ? await db.collection('customers').findOne({ _id: customerId })
          : null;
        input = mapPosnicSale(doc, { taxes, units, customer });
      } catch (err) {
        fail(doc, refId, err, true);
        summary.failed += 1;
        advance(doc);
        continue;
      }

      attempts += 1;
      try {
        await einvoices.issue(tenant, input);
        errors = errors.filter((e) => e.refId !== refId);
        summary.issued += 1;
        advance(doc);
      } catch (err) {
        const code = err && err.code;
        if (code === 'einvoice_invalid' || code === 'sale_ref_invalid') {
          fail(doc, refId, err, true);
          summary.failed += 1;
          advance(doc);
          continue;
        }
        const n = fail(doc, refId, err, false);
        if (CAPPED.has(code) && n >= MAX_CAPPED_ATTEMPTS) {
          errors = errors.map((e) => (e.refId === refId ? { ...e, final: true } : e));
          summary.failed += 1;
          advance(doc);
          continue;
        }
        summary.failed += 1;
        contiguous = false;
        if (BLOCKED.has(code)) summary.blocked += 1;
        if (STOP_TENANT.has(code) || !code) {
          logger.warn && logger.warn(`[einvoice-worker] ${tenant.subdomain}: ${code || 'error'} ${err && err.message}`);
          summary.stopped = code || 'error';
          break;
        }
      }
    }

    const patch = {};
    const prevCursor = tenant.einvoiceCursor || {};
    if (prevCursor.since !== cursor.since || prevCursor.lastDate !== cursor.lastDate || prevCursor.lastId !== cursor.lastId) {
      patch.einvoiceCursor = { since: cursor.since, lastDate: cursor.lastDate, lastId: cursor.lastId, updatedAt: now().toISOString() };
    }
    if (JSON.stringify(errors) !== JSON.stringify(tenant.einvoiceErrors || [])) patch.einvoiceErrors = errors;
    if (Object.keys(patch).length) await store.tenants.update(tenant._id, patch);
    summary.cursor = { ...cursor };
    return summary;
  }

  async function runAll() {
    const results = [];
    for (const tenant of await store.tenants.list()) {
      const s = tenant.einvoiceSettings;
      if (!s || !s.autoIssue) {
        /* Switching auto-issue off forgets the position, so switching it on
           again starts from that moment instead of back-issuing the gap. */
        if (tenant.einvoiceCursor) await store.tenants.update(tenant._id, { einvoiceCursor: null });
        continue;
      }
      if (tenant.suspended || tenant.provisioned === false || !tenant.tenantDb) continue;
      try {
        results.push(await runTenant(tenant));
      } catch (err) {
        logger.error && logger.error(`[einvoice-worker] ${tenant.subdomain}: ${err && err.stack ? err.stack : err}`);
        results.push({ tenantId: String(tenant._id), subdomain: tenant.subdomain, error: String((err && err.message) || err) });
      }
    }
    return results;
  }

  /* One pass over every tenant; overlapping calls share the running pass. */
  function runOnce() {
    if (!running) running = runAll().finally(() => { running = null; });
    return running;
  }

  return { runOnce };
}

module.exports = { createEInvoiceWorker, mapPosnicSale, saleSkipReason, saleRefId, paymentMethodOf };
