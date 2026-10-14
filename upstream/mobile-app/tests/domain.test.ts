import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMoney,
  parseQuantity,
  quickCode,
  totals,
} from "../src/domain/money";
import { upiUri } from "../src/domain/payments";
import { parseShopQr, serverAddress } from "../src/services/api";
import { receiptHtml } from "../src/services/receipt";

test("money parsing preserves paise and rejects exponent, NaN, signs and excess precision", () => {
  assert.equal(parseMoney("123.45"), 12345);
  assert.equal(parseMoney("٠١.٥٠"), 150);
  assert.equal(parseMoney("١٢٫٥٠"), 1250);
  assert.equal(parseMoney("12,50"), 1250);
  assert.equal(parseMoney("१२.५०"), 1250);
  for (const grouped of ["1,234", "1.234,50", "1,234.50", "١٬٢٣٤", "1,2,3"])
    assert.throws(() => parseMoney(grouped));
  for (const value of ["1e3", "NaN", "-1", "1.234", "Infinity", ""])
    assert.throws(() => parseMoney(value));
});
test("quick codes preserve leading zeroes and normalize supported localized digits", () => {
  assert.equal(quickCode("0022"), "0022");
  assert.equal(quickCode("௦௦௨௨"), "0022");
  assert.equal(quickCode("٢٢"), "22");
  assert.throws(() => quickCode("1234567"));
  assert.throws(() => quickCode("2.2"));
});
test("inclusive and exclusive tax totals use integer minor units", () => {
  const line = {
    id: "1",
    name: "Item",
    quantity: 2,
    price: 11800,
    taxBps: 1800,
    taxInclusive: true,
  };
  assert.deepEqual(totals([line]), { total: 23600, tax: 3600 });
  assert.deepEqual(totals([{ ...line, price: 10000, taxInclusive: false }]), {
    total: 23600,
    tax: 3600,
  });
  assert.throws(() => totals([{ ...line, quantity: 1.5 }]));
});
test("UPI binds the selected recipient, amount and merchant without treating it as verified", () => {
  const uri = upiUri(
    {
      id: "2",
      vpa: "shop@bank",
      name: "Shop & Co",
      active: true,
      verification: "manual",
    },
    12345,
    "INR",
    "receipt-1",
  );
  assert.match(uri, /pa=shop%40bank/);
  assert.match(uri, /am=123.45/);
  assert.match(uri, /pn=Shop%20%26%20Co/);
  assert.throws(() =>
    upiUri(
      { id: "1", vpa: "x", name: "Shop", active: true, verification: "manual" },
      100,
      "INR",
      "1",
    ),
  );
});
test("server locator upgrades public HTTP, rejects URL credentials, keeps explicit LAN origin", () => {
  assert.equal(serverAddress("demo"), "https://demo.posnic.io/api");
  assert.equal(
    serverAddress("http://192.168.1.5:5555"),
    "http://192.168.1.5:5555/api",
  );
  assert.equal(
    parseShopQr(
      "https://example.com/pair?server=https%3A%2F%2Fshop.example.com",
    ),
    "https://shop.example.com/api",
  );
  assert.equal(
    serverAddress("http://public.example"),
    "https://public.example/api",
  );
  assert.throws(() => serverAddress("https://user:pass@example.com"));
});

test("weighed quantities use thousandths and exact minor-unit half-up totals", () => {
  assert.equal(parseQuantity("٠٫١٢٥", 1000), 0.125);
  assert.equal(parseQuantity("0,125", 1000), 0.125);
  for (const value of ["0", "-1", "1000", "1e-3", "0.0001"])
    assert.throws(() => parseQuantity(value, 1000));
  assert.throws(() => parseQuantity("1.5", 1));
  const line = {
    id: "weight",
    name: "Rice",
    quantity: 0.125,
    quantityScale: 1000 as const,
    price: 1235,
    taxBps: 500,
    taxInclusive: false,
  };
  assert.deepEqual(totals([line]), { total: 162, tax: 8 });
  assert.deepEqual(totals([{ ...line, taxInclusive: true }]), {
    total: 154,
    tax: 7,
  });
  assert.deepEqual(totals([{ ...line, price: 3500, taxBps: 0 }]), {
    total: 438,
    tax: 0,
  });
  assert.throws(() => totals([{ ...line, quantity: 0.0001 }]));
  assert.throws(() => totals([{ ...line, quantityScale: undefined }]));
});
