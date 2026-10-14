import { test } from "node:test";
import assert from "node:assert/strict";
import { requirePermission } from "../src/domain/permissions";
import { trainingShop } from "../src/data/training";

test("direct printing permission fails closed for old, denied or expired grants", () => {
  for (const receiptPrint of [undefined, false]) {
    assert.throws(
      () =>
        requirePermission(
          {
            ...trainingShop,
            permissions: { ...trainingShop.permissions, receiptPrint },
          },
          "receiptPrint",
          1000,
        ),
      /permissionDenied/,
    );
  }
  for (const offlineUntil of ["invalid", new Date(999).toISOString()]) {
    assert.throws(
      () =>
        requirePermission(
          { ...trainingShop, offlineUntil },
          "receiptPrint",
          1000,
        ),
      /grantExpired/,
    );
  }
  requirePermission(trainingShop, "receiptPrint", 1000);
});
