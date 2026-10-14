import {
  contextSchema,
  resolveBranchScope,
  validateOverview,
  hasCapability,
  type BusinessContext,
  type ItemSummary,
  type StockItem,
} from "../domain/contracts";
export type SampleProfile = "owner" | "manager" | "stock" | "no-access";
export type SampleNetwork = "current" | "delayed" | "offline";
const branches = [
  {
    id: "central",
    name: "Central",
    currency: "INR",
    currencyDigits: 2,
    timezone: "Asia/Kolkata",
  },
  {
    id: "marina",
    name: "Marina",
    currency: "INR",
    currencyDigits: 2,
    timezone: "Asia/Kolkata",
  },
];
export function sampleContext(profile: SampleProfile): BusinessContext {
  return contextSchema.parse({
    accountId: `sample-${profile}`,
    businessId: "sample-cafe",
    businessName: "Anbu Café",
    branches:
      profile === "no-access"
        ? []
        : profile === "owner"
          ? branches
          : [branches[0]],
    capabilities:
      profile === "no-access"
        ? []
        : profile === "owner"
          ? [
              "overview.read",
              "tenders.read",
              "items.read",
              "stock.read",
              "approvals.read",
              "discounts.approve",
              "notifications.self.manage",
            ]
          : profile === "manager"
            ? ["overview.read", "items.read", "notifications.self.manage"]
            : ["stock.read", "notifications.self.manage"],
  });
}
/** Local synthetic adapter. No production HTTP, credentials or customer data. */
export function sampleOverview(
  context: BusinessContext,
  selection: string | null,
  network: SampleNetwork,
) {
  const scope = resolveBranchScope(context, selection);
  return validateOverview(
    {
      schemaVersion: 1,
      metricDefinitionVersion: 1,
      businessId: context.businessId,
      branchIds: scope,
      businessDate: "2026-09-28",
      currency: "INR",
      currencyDigits: 2,
      netSalesMinor: scope.reduce(
        (v, id) => v + (id === "central" ? 2650000 : 1635000),
        0,
      ),
      completedSales: scope.reduce(
        (v, id) => v + (id === "central" ? 80 : 46),
        0,
      ),
      freshness: {
        state: network === "current" ? "current" : "delayed",
        complete: network === "current",
        sourceUpdatedAt: "2026-09-28T13:10:00Z",
        checkedAt: "2026-09-28T13:12:00Z",
      },
    },
    context,
    scope,
  );
}
export function sampleItems(
  context: BusinessContext,
  selection: string | null,
): ItemSummary[] {
  if (!hasCapability(context, "items.read")) return [];
  const count = resolveBranchScope(context, selection).length;
  if (!count) return [];
  return [
    {
      id: "dosa",
      name: "Masala dosa",
      netSalesMinor: 324000 * count,
      quantity: 27 * count,
    },
    {
      id: "wrap",
      name: "Paneer wrap",
      netSalesMinor: 264000 * count,
      quantity: 16 * count,
    },
    {
      id: "coffee",
      name: "Filter coffee",
      netSalesMinor: 216000 * count,
      quantity: 36 * count,
    },
  ];
}
export function sampleStock(
  context: BusinessContext,
  selection: string | null,
): StockItem[] {
  if (
    !hasCapability(context, "stock.read") ||
    !resolveBranchScope(context, selection).includes("central")
  )
    return [];
  return [
    {
      id: "milk",
      name: "Oat milk",
      available: 3,
      threshold: 5,
      unit: "cartons",
    },
    {
      id: "cups",
      name: "Takeaway cups",
      available: 0,
      threshold: 2,
      unit: "packs",
    },
  ];
}
