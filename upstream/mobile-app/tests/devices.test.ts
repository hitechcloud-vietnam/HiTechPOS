import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceOptions, receiptJobMessage } from "../src/domain/devices";
import { resolveProductScan } from "../src/domain/scanning";
import { trainingShop, trainingItems } from "../src/data/training";

test("scanner preserves leading zeroes and requires an unambiguous active barcode", () => {
  const item = { ...trainingItems[0]!, barcode: "00123" };
  assert.equal(resolveProductScan([item], "00123\r\n").id, item.id);
  for (const code of ["123", " 00123", "11"]) {
    assert.throws(() => resolveProductScan([item], code), /noMatch/);
  }
  assert.throws(
    () => resolveProductScan([{ ...item, active: false }], "00123"),
    /noMatch/,
  );
  assert.throws(
    () => resolveProductScan([item, { ...item, id: "duplicate" }], "00123"),
    /multipleMatches/,
  );
});

test("scanner rejects control frames, payment data, sign-in links and oversized input", () => {
  for (const code of [
    "",
    "x".repeat(513),
    "00\t123",
    "upi://pay?pa=test@bank",
    "https://example.test",
    "posnic://pair",
    "%B4111111111111111^TEST",
    ";4111111111111111=123",
  ]) {
    assert.throws(
      () => resolveProductScan([{ ...trainingItems[0]!, barcode: code }], code),
      /invalidScan/,
    );
  }
});

test("device workflows respect permissions, expiry and negotiated Till support", () => {
  assert.equal(
    deviceOptions(trainingShop).find((d) => d.id === "till-print")!.enabled,
    false,
  );
  const denied = {
    ...trainingShop,
    permissions: {
      ...trainingShop.permissions,
      sell: false,
      receiptPrint: false,
    },
  };
  assert.ok(deviceOptions(denied).every((d) => !d.enabled));
  assert.ok(
    deviceOptions({ ...trainingShop, offlineUntil: "bad" }).every(
      (d) => !d.enabled,
    ),
  );
  assert.equal(
    deviceOptions({
      ...trainingShop,
      mode: "live",
      capabilities: { ...trainingShop.capabilities, tillPrint: true },
    }).find((d) => d.id === "till-print")!.enabled,
    true,
  );
  assert.equal(receiptJobMessage.needs_attention, "review");
  assert.equal(receiptJobMessage.done, "printReportedDone");
});
