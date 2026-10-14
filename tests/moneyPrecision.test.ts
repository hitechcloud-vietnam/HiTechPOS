import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney } from "../src/domain/money";
test("currency display preserves every safe minor unit without losing locale placement or negative subunits", () => {
  assert.equal(
    formatMoney(Number.MAX_SAFE_INTEGER, "USD", 2, "en-US"),
    "$90,071,992,547,409.91",
  );
  assert.equal(
    formatMoney(Number.MAX_SAFE_INTEGER, "KWD", 3, "en-US"),
    "KWD 9,007,199,254,740.991",
  );
  assert.equal(formatMoney(-1, "USD", 2, "en-US"), "-$0.01");
  assert.equal(formatMoney(-100, "USD", 2, "en-US"), "-$1.00");
  assert.equal(formatMoney(0, "USD", 2, "en-US"), "$0.00");
  assert.equal(formatMoney(123, "JPY", 0, "en-US"), "¥123");
  for (const locale of ["en-US", "fr", "hi", "ar-u-nu-arab", "ne"]) {
    for (const amount of [-12345, -1, 0, 1, 12345]) {
      assert.equal(
        formatMoney(amount, "USD", 2, locale),
        new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount / 100),
      );
    }
  }
});
