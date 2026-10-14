import test from "node:test";
import assert from "node:assert/strict";
import { formatQuantity, formatStockQuantity } from "../src/domain/quantity";
test("quantity formatting preserves exact thousandths and localized decimal digits", () => {
  assert.equal(formatQuantity(1, "en"), "0.001");
  assert.equal(formatQuantity(1010, "en"), "1.01");
  assert.equal(formatQuantity(1000, "en"), "1");
  assert.equal(
    formatQuantity(Number.MAX_SAFE_INTEGER, "en"),
    "9,007,199,254,740.991",
  );
  assert.equal(formatQuantity(1250, "fr"), "1,25");
  assert.equal(formatQuantity(1001, "ar-u-nu-arab"), "١٫٠٠١");
  for (const value of [-1, 1.1, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => formatQuantity(value));
});

test("stock quantities preserve negative thousandths and Arabic sign direction marks", () => {
  assert.equal(formatStockQuantity(-125, "en"), "-0.125");
  assert.equal(
    formatStockQuantity(-Number.MAX_SAFE_INTEGER, "en"),
    "-9,007,199,254,740.991",
  );
  const expected = new Intl.NumberFormat("ar-u-nu-arab").format(-0.125);
  assert.equal(formatStockQuantity(-125, "ar-u-nu-arab"), expected);
  assert.equal(formatStockQuantity(0, "en"), "0");
  assert.throws(() => formatStockQuantity(1.5));
});
