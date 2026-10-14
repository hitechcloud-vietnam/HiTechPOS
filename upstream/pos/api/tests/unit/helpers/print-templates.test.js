'use strict';

/**
 * HiTechPOS: which thermal template a shop starts with, and the migration
 * that moves Vietnamese shops still on the untouched stock template to the
 * Vietnamese bill (db/migrations 003-vietnamese-default-bill).
 */

const fs = require('fs');
const path = require('path');
const templates = require('../../../src/helpers/print-templates');

const JSON_DIR = path.join(__dirname, '../../../src/json');
const read = (f) => fs.readFileSync(path.join(JSON_DIR, f), 'utf8');
const STOCK = read('print_standard_html.txt');
const VI = read('print_standard_html_vi.txt');

describe('the Vietnamese template', () => {
  test('carries every hook the till fills, in Vietnamese', () => {
    for (const hook of [
      'print_store_name',
      'print_store_address',
      'print_store_telephone',
      'print_store_gst',
      'gst_hide_show',
      'print-title',
      'print_view_id',
      'print_date',
      'print-invoice-table-content',
      'print-subtotal',
      'view_sales_discount',
      'amount-print-hideshow',
      'tax_print_hide',
      'view_sales_tax',
      'print-total',
      'print-invoice-payment-mode',
      'print-payment-balance',
      'print-payment-pending',
      'footer-content',
      'print-sale-notes',
      'hide_customer_details',
      'barcodeValue',
      'canvasTarget',
      'extra_disc_standard_print',
      'roundoff_standard_print',
      // the Vietnamese finish (frontend/.../core/vn-bill-print.js)
      'data-vn-bill',
      'vn-items-head',
      'vn-vat-rows',
      'vn-amount-in-words',
      'vn-cashier',
    ]) {
      expect(VI).toContain(hook);
    }
    for (const label of [
      'HOÁ ĐƠN BÁN HÀNG',
      'MST:',
      'Tên hàng',
      'SL',
      'Tạm tính',
      'Chiết khấu',
      'Tổng cộng',
      'Bằng chữ',
      'Thu ngân',
      'Ngày:',
      'Số:',
    ]) {
      expect(VI).toContain(label);
    }
    // No Indian GST blocks and no English labels a guest would read.
    expect(VI).not.toMatch(/GSTIN|IGST|CGST|SGST|Grand Total|Sub Total|Receipt</);
  });

  test('the stock template is untouched', () => {
    expect(STOCK).toContain('GSTIN:');
    expect(STOCK).not.toContain('data-vn-bill');
  });
});

describe('thermalFileFor / thermalTemplateFor', () => {
  test('a Vietnamese shop starts on the Vietnamese bill, everyone else on the stock one', () => {
    expect(
      templates.thermalFileFor({ register_country: 'Vietnam', register_countryid: 'VN' })
    ).toBe('print_standard_html_vi.txt');
    expect(templates.thermalFileFor({ country: 'Vietnam' })).toBe('print_standard_html_vi.txt');
    expect(
      templates.thermalFileFor({ currency_value: [{ currency_text: 'VND', currency_sign: '₫' }] })
    ).toBe('print_standard_html_vi.txt');
    expect(templates.thermalFileFor({ register_country: 'India', register_countryid: 'IN' })).toBe(
      'print_standard_html.txt'
    );
    expect(templates.thermalFileFor({})).toBe('print_standard_html.txt');
    expect(templates.thermalFileFor(undefined)).toBe('print_standard_html.txt');
    expect(templates.thermalTemplateFor({ country_id: 'VN' })).toBe(VI);
    expect(templates.thermalTemplateFor({ country_id: 'GB' })).toBe(STOCK);
    expect(templates.a4Template()).toBe(read('print_a4html.txt'));
  });
});

describe('isStockThermal', () => {
  test('the stock file, however its line endings were stored', () => {
    expect(templates.isStockThermal(STOCK)).toBe(true);
    expect(templates.isStockThermal(STOCK.replace(/\n/g, '\r\n') + '\n\n')).toBe(true);
  });
  test('the stock file after HiTechPOS onboarding translated its labels', () => {
    const translated = templates.onboardingTranslation(STOCK);
    expect(translated).not.toBe(STOCK);
    expect(translated).toContain('Tạm tính');
    expect(templates.isStockThermal(translated)).toBe(true);
  });
  test('anything a shop changed is the shop’s', () => {
    expect(templates.isStockThermal(STOCK.replace('Tel:', 'Hotline:'))).toBe(false);
    expect(templates.isStockThermal(STOCK + '<p>Wifi: guest</p>')).toBe(false);
    expect(templates.isStockThermal(VI)).toBe(false);
    expect(templates.isStockThermal('')).toBe(false);
    expect(templates.isStockThermal(undefined)).toBe(false);
  });

  /* The copy of the onboarding label table must stay what onboarding does. */
  const onboarding = path.join(__dirname, '../../../../../../apps/control-plane/src/onboarding.js');
  let translate = null;
  try {
    if (fs.existsSync(onboarding)) translate = require(onboarding).translateReceiptTemplate;
  } catch (e) {
    translate = null; // control plane dependencies not installed here
  }
  (translate ? test : test.skip)('matches apps/control-plane onboarding exactly', () => {
    expect(templates.onboardingTranslation(STOCK)).toBe(translate(STOCK).html);
    expect(templates.onboardingTranslation(read('print_a4html.txt'))).toBe(
      translate(read('print_a4html.txt')).html
    );
  });
});

describe('upgradeVietnameseThermalTemplates (migration 003)', () => {
  function fakeDb(rows) {
    const writes = [];
    const collection = {
      find: () => ({
        [Symbol.asyncIterator]: async function* () {
          for (const r of rows) yield r;
        },
      }),
      updateOne: jest.fn(async (filter, update) => {
        writes.push({ filter, update });
        const row = rows.find(
          (r) => r._id === filter._id && r.thermal_body_print === filter.thermal_body_print
        );
        if (row) Object.assign(row, update.$set);
        return { modifiedCount: row ? 1 : 0 };
      }),
    };
    return {
      db: { collection: (name) => (name === 'branches' ? collection : null) },
      writes,
      rows,
    };
  }
  const now = new Date('2026-10-14T00:00:00Z');

  test('only Vietnamese branches on the untouched stock template move', async () => {
    const custom = STOCK.replace('Tel:', 'Hotline:');
    const { db, rows, writes } = fakeDb([
      { _id: 'vn-stock', country: 'Vietnam', country_id: 'VN', thermal_body_print: STOCK },
      {
        _id: 'vn-onboarded',
        country: 'Vietnam',
        thermal_body_print: templates.onboardingTranslation(STOCK),
      },
      { _id: 'vn-custom', country: 'Vietnam', thermal_body_print: custom },
      { _id: 'vn-vnd-only', currency_value: [{ currency_text: 'VND' }], thermal_body_print: STOCK },
      { _id: 'in-stock', country: 'India', country_id: 'IN', thermal_body_print: STOCK },
      { _id: 'vn-empty', country: 'Vietnam', thermal_body_print: '' },
    ]);
    const result = await templates.upgradeVietnameseThermalTemplates(db, { now });
    expect(result.checked).toBe(6);
    expect(result.upgraded).toEqual(['vn-stock', 'vn-onboarded', 'vn-vnd-only']);
    const byId = Object.fromEntries(rows.map((r) => [r._id, r]));
    expect(byId['vn-stock'].thermal_body_print).toBe(VI);
    expect(byId['vn-stock'].updated_date).toBe(now);
    expect(byId['vn-onboarded'].thermal_body_print).toBe(VI);
    expect(byId['vn-custom'].thermal_body_print).toBe(custom);
    expect(byId['in-stock'].thermal_body_print).toBe(STOCK);
    expect(byId['vn-empty'].thermal_body_print).toBe('');
    // Guarded on the value it read, so a concurrent edit is never overwritten.
    expect(writes[0].filter).toEqual({ _id: 'vn-stock', thermal_body_print: STOCK });
  });

  test('running it again changes nothing', async () => {
    const { db } = fakeDb([{ _id: 'a', country: 'Vietnam', thermal_body_print: STOCK }]);
    await templates.upgradeVietnameseThermalTemplates(db, { now });
    const again = await templates.upgradeVietnameseThermalTemplates(db, { now });
    expect(again.upgraded).toEqual([]);
  });

  test('a dry run reports without writing', async () => {
    const { db, writes } = fakeDb([{ _id: 'a', country: 'Vietnam', thermal_body_print: STOCK }]);
    const result = await templates.upgradeVietnameseThermalTemplates(db, { dryRun: true });
    expect(result.upgraded).toEqual(['a']);
    expect(writes).toEqual([]);
  });

  test('is registered as a ledgered migration', () => {
    const registry = require('../../../src/db/migrations/index');
    const entry = registry.find((m) => m.id === '003-vietnamese-default-bill');
    expect(entry).toBeTruthy();
    expect(registry[registry.length - 1]).toBe(entry);
    expect(typeof entry.up).toBe('function');
    const { API_SCHEMA_VERSION } = require('../../../src/constants/runtime.constants');
    expect(API_SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
  });
});
