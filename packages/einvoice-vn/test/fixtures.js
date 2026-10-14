'use strict';

/* Shared helpers for the test files (node --test also loads this file; it defines no tests). */

const NOW = Date.parse('2026-10-14T05:00:00Z');

function sampleInput(overrides = {}) {
  return {
    refId: 'HTP-ORD-000123',
    invoiceType: 'GTGT',
    fromCashRegister: true,
    series: '1C26MAA',
    issueDate: '2026-10-14T04:30:00Z',
    paymentMethod: 'TM/CK',
    seller: { taxCode: '0100109106', name: 'Công ty TNHH Cà Phê Hi-Tech', address: '1 Tràng Tiền, Hoàn Kiếm, Hà Nội', phone: '0241234567' },
    buyer: {},
    lines: [
      { code: 'CF01', name: 'Cà phê sữa đá', unit: 'ly', quantity: 3, unitPrice: 33333, vatRate: 8 },
      { code: 'BN01', name: 'Bánh mì', unit: 'cái', quantity: 2, unitPrice: 25000, discount: 5000, vatRate: 10 },
      { name: 'Ly giữ nhiệt (khuyến mại)', unit: 'cái', quantity: 1, kind: 'promotion', vatRate: 10 },
      { name: 'Chiết khấu thành viên', kind: 'discount', amount: 9999, vatRate: 8 },
      { name: 'Cảm ơn quý khách', kind: 'note' },
    ],
    ...overrides,
  };
}

/*
 * Fake fetch: `handler(call)` returns { status?, json?, text? } or throws.
 * Records { url, method, headers, body (parsed JSON or raw string) }.
 */
function fakeTransport(handler) {
  const calls = [];
  const transport = async (url, init = {}) => {
    let body = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* form or text */ } }
    const call = { url: String(url), method: init.method, headers: init.headers || {}, body, rawBody: init.body, redirect: init.redirect };
    calls.push(call);
    const out = await handler(call, calls.length);
    const text = out.text !== undefined ? out.text : out.json === undefined ? '' : JSON.stringify(out.json);
    return new Response(text, { status: out.status || 200 });
  };
  return { transport, calls };
}

/* Unsigned JWT with an exp claim (adapters only read exp, never verify). */
function jwt(expSeconds) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: expSeconds })}.sig`;
}

module.exports = { NOW, sampleInput, fakeTransport, jwt };
