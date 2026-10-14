'use strict';
/*
 * HiTechPOS: "Đã nhận tiền" (confirm a direct VietQR transfer) records money
 * as received. It was a GET, and the CSRF middleware lets GETs through while
 * the login cookie is SameSite=None - so a link opened on the till's browser
 * could confirm a payment nobody made. It is a POST now: without the
 * reflected X-XSRF-TOKEN it is refused, and a GET reaches no handler.
 */
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'hitech-qr-csrf-test-secret';
delete process.env.CSRF_SECRET;

const passthrough = () => (req, res, next) => next();
const anything = (make) =>
  new Proxy(
    {},
    {
      get(target, key) {
        if (key === '__esModule' || typeof key === 'symbol') return undefined;
        if (!(key in target)) target[key] = make();
        return target[key];
      },
    }
  );
// Any other sales handler answers "not this route" (e.g. GET /:id).
jest.mock('../../../src/controllers/sales.controller', () =>
  anything(() => jest.fn((req, res) => res.status(404).json({ type: 'error' })))
);
jest.mock('../../../src/middleware/auth', () => ({
  protect: (req, res, next) => next(),
  optionalProtect: (req, res, next) => next(),
}));
jest.mock('../../../src/middleware/sales.validation', () => anything(passthrough));
jest.mock('../../../src/middleware/validation', () => ({ handleValidationErrors: passthrough() }));
jest.mock('../../../src/services/hitech-pay', () => ({
  isHitechId: (id) => /^htp_\d+$/.test(id),
  confirm: jest.fn(async (id) => ({ message: 'Đã xác nhận', data: { id, paid: true } })),
}));

const csrf = require('../../../src/middleware/csrf');
const hitechPay = require('../../../src/services/hitech-pay');
const router = require('../../../src/routes/sales.routes');

const LOGIN = jwt.sign({ id: 'cashier' }, process.env.JWT_SECRET, { expiresIn: '1h' });
let server, base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.cookies = { jwt: LOGIN };
    next();
  });
  app.use(csrf.protect);
  app.use((req, res, next) => {
    req.user = { _id: 'cashier', access: { sales: { write: true } } };
    next();
  });
  app.use('/api/sales', router);
  app.use((req, res) => res.status(404).json({ type: 'error', message: 'Not found' }));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/sales/hitechQrConfirm`;
});
afterAll(
  () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    })
);
beforeEach(() => hitechPay.confirm.mockClear());

const post = (body, headers = {}) =>
  fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('the route is registered as POST only', () => {
  const methods = router.stack
    .filter((l) => l.route && l.route.path === '/hitechQrConfirm')
    .map((l) => Object.keys(l.route.methods));
  expect(methods).toEqual([['post']]);
});

test('a GET link confirms nothing', async () => {
  const res = await fetch(`${base}?id=htp_123`);
  // No GET handler: it falls through to the sale-detail route, which refuses it.
  expect([400, 404, 405]).toContain(res.status);
  expect(hitechPay.confirm).not.toHaveBeenCalled();
});

test('a POST without the CSRF token is refused', async () => {
  const res = await post({ id: 'htp_123' });
  expect(res.status).toBe(403);
  expect(hitechPay.confirm).not.toHaveBeenCalled();
});

test('a POST with the reflected token confirms, reading the id from the body', async () => {
  const token = csrf.tokenFor(`jwt:${LOGIN}`);
  const res = await post({ id: 'htp_123' }, { [csrf.HEADER]: token });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    type: 'success',
    message: 'Đã xác nhận',
    data: { id: 'htp_123', paid: true },
  });
  expect(hitechPay.confirm).toHaveBeenCalledWith('htp_123', { by: 'cashier' });
  // The same validation as before: only HiTechPOS QR ids.
  const bad = await post({ id: 'rzp_1' }, { [csrf.HEADER]: token });
  expect(bad.status).toBe(400);
});
