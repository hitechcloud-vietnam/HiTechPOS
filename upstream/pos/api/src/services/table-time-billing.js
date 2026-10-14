'use strict';
/*
 * HiTechPOS: time-based billing for rooms and tables (karaoke, billiards,
 * courts, game rooms) on top of the ordinary table order.
 *
 * The table's settings (tableorder.time_billing) name the item that time is
 * sold as, the hourly rate, the block length, the minimum and optional
 * time-of-day bands. Starting the clock writes a snapshot of those settings
 * on the table's open order (sale.time_billing) - creating the order when the
 * table has none - and adds the minimum charge as order lines. "Tính giờ"
 * (stop) prices the session up to now and updates those lines; the order is
 * then paid like any other. All writes go through the existing order services
 * (createOnlineOrder / updateOrderModel), which total, tax and guard them;
 * time lines are named and priced (at the table's rate, not the item's
 * catalogue price) by this server-side option only, and never print in the
 * kitchen. The item gives the line its tax, category and report identity.
 */
const { randomUUID } = require('crypto');
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { clientIp } = require('../utils/client-ip');
const billing = require('../utils/time-billing');
const occupancy = require('../helpers/floor-eligibility');

const ACTIONS = ['start', 'stop', 'resume', 'cancel'];
const repository = () => require('../repositories/sale.repository');

function objectId(value, message) {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) fail(message);
  return new ObjectId(value);
}
function actor(req) {
  return {
    id: String(req.user._id || req.user.id || ''),
    name: String(req.user.name || req.user.username || ''),
  };
}
/** Same shape the table workspace sends for a line it keeps (P.kot.editLine). */
function editLine(line) {
  const inline = line.sale_inline_item_price;
  const out = {
    product_id: String(line.item_id || line.product_id || ''),
    quantity: Number(line.item_quantity ?? line.quantity),
    price:
      line.pricing && line.pricing.version === 1
        ? line.pricing.selling_price
        : inline != null && String(inline).trim() !== '' && Number.isFinite(Number(inline))
          ? Number(inline)
          : line.selling_price != null
            ? line.selling_price
            : line.item_price,
  };
  for (const key of [
    'line_id',
    'modifiers',
    'seat',
    'course',
    'held',
    'allergies',
    'allergy_note',
    'item_description',
  ])
    if (line[key] !== undefined) out[key] = line[key];
  return out;
}
/** Lines and server-owned names for a priced session. */
function timeLines(meta, quote, lang) {
  return {
    items: quote.lines.map((l) => ({
      product_id: meta.item_id,
      line_id: l.line_id,
      quantity: l.quantity,
      price: l.rate,
    })),
    names: Object.fromEntries(
      quote.lines.map((l) => [
        l.line_id,
        { name: billing.lineName(meta.item_name, meta.table_label, l, lang) },
      ])
    ),
  };
}
function running(meta) {
  return !!meta && meta.version === 1 && !meta.ended_at;
}
/** The table's settings, checked against the item they sell time as. */
async function tableSettings(db, c, table) {
  const config = billing.normalizeConfig(table && table.time_billing);
  if (!config) fail('This table is not set up for time billing.');
  const item = await db
    .collection('items')
    .findOne({ _id: new ObjectId(config.item_id), license: c.license });
  if (!item || [1, '1', true].includes(item.del_status))
    fail('The item for time billing was removed. Choose another one in the table settings.');
  return { config, item };
}
/** Settings-screen check: the named item exists. */
async function checkItem(items, license, input) {
  const config = billing.normalizeConfig(input);
  if (!config) return null;
  const item = await items.findOne({
    _id: new ObjectId(config.item_id),
    license: new ObjectId(String(license)),
  });
  if (!item || [1, '1', true].includes(item.del_status))
    throw new Error('Choose the item that time is billed as.');
  return config;
}
async function openOrders(db, c, extra) {
  return db
    .collection('sales')
    .find({ branch_id: c.branchId, license: c.license, ...occupancy.tableOccupancy(), ...extra })
    .sort({ created_date: -1 })
    .toArray();
}
async function loadOrder(db, c, saleId) {
  const [sale] = await openOrders(db, c, { _id: objectId(saleId, 'Choose an order.') });
  if (!sale) fail('This order is closed or was not found. Refresh and try again.', 404);
  if (sale.payment_status === 'Paid') fail('This order is already paid.', 409);
  return sale;
}
async function save(req, c, sale, items, timeBilling, editPolicy) {
  if (!items.length) fail('The order needs at least one line.');
  const result = await repository().updateOrderModel(
    String(sale._id),
    items,
    0,
    'modified',
    sale.extra_discount_type || 'amount',
    sale.extra_discount || 0,
    sale.discount_description || '',
    null,
    null,
    null,
    {
      editPolicy: editPolicy || {
        actor: actor(req),
        reason: '',
        approvedBy: [],
        expectedItems: sale.items,
        expectedChanges: sale.changes,
        branchId: c.branchId,
        license: c.license,
      },
      timeBilling,
    }
  );
  if (!result || result.status !== true)
    fail(
      result?.message === 'order_changed'
        ? 'The order changed on another screen. Refresh and try again.'
        : result?.message || 'The order could not be updated.',
      409
    );
}
/** Price the session up to `until` and write it on the order. */
async function charge(req, c, sale, meta, until, lang, nextMeta) {
  const quote = billing.quote(meta, meta.started_at, until);
  const { items, names } = timeLines(meta, quote, lang);
  const others = (sale.items || []).filter((l) => !billing.isTimeLine(l)).map(editLine);
  await save(req, c, sale, [...others, ...items], { lines: names, meta: nextMeta });
  return quote;
}

async function start(req, c, body, now, lang) {
  const db = req.db;
  let table, sale;
  if (body.sale_id) {
    sale = await loadOrder(db, c, body.sale_id);
    table = await db.collection('tableorder').findOne({
      branch_id: c.branchId,
      license: c.license,
      tableorder_value: String(sale.table_number || ''),
    });
  } else {
    table = await db.collection('tableorder').findOne({
      _id: objectId(body.table_id, 'Choose a table.'),
      branch_id: c.branchId,
      license: c.license,
    });
    if (!table) fail('Table not found.', 404);
  }
  const { config, item } = await tableSettings(db, c, table);
  const requestId =
    typeof body.request_id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.request_id)
      ? body.request_id
      : randomUUID();
  const open = await openOrders(db, c, { table_number: String(table.tableorder_value) });
  const already = open.find((s) => s.time_billing && s.time_billing.version === 1);
  if (already) {
    if (already.time_billing.request_id === requestId) return { sale_id: String(already._id) };
    fail('Time is already being billed on this table.', 409);
  }
  if (!sale && open.length) sale = open[0];
  const meta = {
    version: 1,
    table_id: String(table._id),
    table_label: String(table.tableorder_value || ''),
    item_id: config.item_id,
    item_name: String(item.name || item.item_name || ''),
    rate: config.rate,
    block_minutes: config.block_minutes,
    min_blocks: config.min_blocks,
    grace_minutes: config.grace_minutes,
    bands: config.bands,
    offset_minutes: billing.VIETNAM_OFFSET_MINUTES,
    started_at: now,
    started_by: actor(req),
    ended_at: null,
    request_id: requestId,
  };
  if (sale) {
    await charge(req, c, sale, meta, now, lang, meta);
    return { sale_id: String(sale._id) };
  }
  // No order yet: open one for the table with the minimum time charge.
  const quote = billing.quote(meta, now, now);
  const { names } = timeLines(meta, quote, lang);
  const guests = Number(body.guests);
  const created = await repository().createOnlineOrder(
    {
      branch: String(c.branchId),
      sale_method: 'Table-Order',
      order: 'Dine-in',
      dine_type: 'Dine-in',
      kiosk_table_no: String(table.tableorder_value),
      kiosk_table_id: String(table._id),
      person_count: Number.isInteger(guests) && guests > 0 && guests <= 1000 ? guests : 1,
      customer_id: '',
      customer_name: '',
      customerMobile: '',
      payment_status: 'cash',
      idempotencyKey: 'time-' + requestId,
      client: {
        app: 'time-billing',
        ip: clientIp(req),
        user_agent: (req.get && req.get('User-Agent')) || '',
        staff_id: actor(req).id,
        staff_name: actor(req).name,
      },
      items: quote.lines.map((l) => ({
        item_id: meta.item_id,
        line_id: l.line_id,
        item_name: names[l.line_id].name,
        item_quantity: l.quantity,
        item_price: l.rate,
        item_description: '',
      })),
    },
    { staffOrder: true, seatingProtocol: true, quietLineIds: quote.lines.map((l) => l.line_id) }
  );
  if (!created || created.status !== true)
    fail(created?.message || 'The table order could not be opened.', 409);
  const saleId = new ObjectId(String(created.data.sale_id));
  const fresh = await db
    .collection('sales')
    .findOne({ _id: saleId, branch_id: c.branchId, license: c.license });
  if (fresh && !fresh.time_billing) {
    const ids = new Set(quote.lines.map((l) => l.line_id));
    await db.collection('sales').updateOne(
      { _id: saleId, items: fresh.items, time_billing: { $exists: false } },
      {
        $set: {
          time_billing: meta,
          items: (fresh.items || []).map((l) =>
            ids.has(l.line_id)
              ? { ...l, time_billing_line: true, item_name: names[l.line_id].name }
              : l
          ),
        },
      }
    );
  }
  return { sale_id: String(saleId) };
}

async function handle(req) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  const c = await context(req);
  const body = req.body || {};
  const action = String(body.action || '');
  if (!ACTIONS.includes(action)) fail('Choose start, stop, resume or cancel.');
  const lang = typeof body.lang === 'string' ? body.lang.slice(0, 10) : 'vi';
  const now = new Date();
  if (action === 'start') return start(req, c, body, now, lang);

  const sale = await loadOrder(req.db, c, body.sale_id);
  const meta = sale.time_billing;
  if (!meta || meta.version !== 1) fail('This order has no time charge.', 409);
  if (action === 'stop') {
    if (!running(meta)) return { sale_id: String(sale._id), ended_at: meta.ended_at };
    const quote = await charge(req, c, sale, meta, now, lang, { ...meta, ended_at: now });
    return { sale_id: String(sale._id), ended_at: now, amount: quote.amount };
  }
  if (action === 'resume') {
    if (running(meta)) return { sale_id: String(sale._id) };
    const changed = await req.db
      .collection('sales')
      .updateOne(
        {
          _id: sale._id,
          'time_billing.ended_at': meta.ended_at,
          payment_status: sale.payment_status,
        },
        { $set: { 'time_billing.ended_at': null } }
      );
    if (!changed.modifiedCount)
      fail('The order changed on another screen. Refresh and try again.', 409);
    return { sale_id: String(sale._id) };
  }
  // cancel: a mistaken start. Removing charged lines is a void, so it takes
  // the same permission (or manager approval) as any other reduction.
  const others = (sale.items || []).filter((l) => !billing.isTimeLine(l)).map(editLine);
  if (!others.length) fail('Only time is on this order. Use Cancel order instead.', 409);
  const editPolicy = await require('./captain-edit-policy').authorize({
    ...req,
    body: {
      order_id: String(sale._id),
      items: others,
      status: 'modified',
      change_reason: body.reason || '',
      approval_token: body.approval_token,
    },
  });
  await save(req, c, sale, others, { lines: {}, meta: null }, editPolicy);
  return { sale_id: String(sale._id) };
}

/** POST /api/sales/tableTime { action, table_id | sale_id, request_id?, guests?, lang? } */
async function route(req, res) {
  try {
    const data = await handle(req);
    return res.json({ type: 'success', message: 'success', data });
  } catch (error) {
    const status = Number(error.status || error.statusCode) || 500;
    if (status >= 500) console.error('Error in tableTime:', error);
    return res
      .status(status)
      .json({
        type: 'error',
        message: status >= 500 ? 'Time billing failed.' : error.message,
        data: null,
      });
  }
}

module.exports = { route, handle, checkItem, editLine, timeLines };
