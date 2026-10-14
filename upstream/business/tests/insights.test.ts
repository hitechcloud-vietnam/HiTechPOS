import test from "node:test";
import assert from "node:assert/strict";
import { validateInsightTranslations, insightText } from "../src/i18n/insights";
import { translator } from "../src/i18n";
import { validateInsights } from "../src/domain/businessInsights";
import { type BusinessContext } from "../src/domain/contracts";
test("new reporting and security labels exist for all bundled languages", () => {
  assert.equal(validateInsightTranslations().length, 17);
  for (const locale of ["ta", "ar", "fr"]) {
    translator.setLocale(locale);
    assert.notEqual(insightText("Last week"), "Last week");
    assert.notEqual(insightText("Disable PIN"), "Disable PIN");
  }
  translator.setLocale("en");
});
test("report contract binds the requested scope and reconciles hourly and tender totals", () => {
  const context: BusinessContext = {
    accountId: "a",
    businessId: "b",
    businessName: "Shop",
    capabilities: ["overview.read", "tenders.read"],
    branches: [
      {
        id: "c",
        name: "Main",
        currency: "INR",
        currencyDigits: 2,
        timezone: "UTC",
      },
    ],
  };
  const range = { from: "2026-10-01", to: "2026-10-02" };
  const value = {
    schemaVersion: 1,
    businessId: "b",
    branchId: "c",
    ...range,
    currency: "INR",
    currencyDigits: 2,
    timezone: "UTC",
    billedSalesMinor: 100,
    refundsMinor: 0,
    salesAfterReturnsMinor: 100,
    bills: 1,
    checkedAt: new Date().toISOString(),
    complete: false,
    items: null,
    staff: null,
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      billedSalesMinor: hour === 12 ? 100 : 0,
      bills: hour === 12 ? 1 : 0,
    })),
    discounts: { amountMinor: 0, bills: 0 },
    returns: { amountMinor: 0, transactions: 0 },
    payments: {
      basis: "invoice-date",
      receivedMinor: 80,
      outstandingMinor: 20,
      methods: [{ name: "Cash", amountMinor: 80 }],
    },
    details: [],
  };
  assert.equal(validateInsights(value, context, "c", range).bills, 1);
  assert.throws(() =>
    validateInsights({ ...value, branchId: "other" }, context, "c", range),
  );
  assert.throws(() =>
    validateInsights({ ...value, to: "2026-10-03" }, context, "c", range),
  );
  assert.throws(() =>
    validateInsights(
      { ...value, payments: { ...value.payments, receivedMinor: 70 } },
      context,
      "c",
      range,
    ),
  );
  assert.throws(() =>
    validateInsights({ ...value, staff: [] }, context, "c", range),
  );
});
