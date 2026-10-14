import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDecision,
  readDecisions,
  sendDecision,
  DecisionError,
  type Decision,
} from "../src/services/decisions";
import { ConnectionError } from "../src/services/businessConnection";
import { type BusinessContext } from "../src/domain/contracts";
import {
  rememberConfirmation,
  pendingConfirmation,
  clearConfirmation,
} from "../src/services/pendingConfirmation";
const context: BusinessContext = {
  accountId: "1".repeat(24),
  businessId: "2".repeat(24),
  businessName: "Test business",
  capabilities: ["approvals.read", "discounts.approve"],
  branches: [
    {
      id: "3".repeat(24),
      name: "Central",
      currency: "INR",
      currencyDigits: 2,
      timezone: "Asia/Kolkata",
    },
  ],
};
const row: Decision = {
  id: "4".repeat(24),
  branchId: context.branches[0]!.id,
  action: "discount_apply",
  state: "pending",
  revision: 0,
  requester: { id: "5".repeat(24), name: "Cashier" },
  createdAt: "2026-09-28T12:00:00.000Z",
  expiresAt: "2026-09-28T12:05:00.000Z",
  summary: {
    beforeDiscountMinor: 10000,
    discountMinor: 2000,
    payableMinor: 8000,
    roundingMinor: 0,
    currency: "INR",
    currencyDigits: 2,
    itemCount: 2,
    reason: "Regular customer",
  },
  canDecide: true,
  unavailableReason: null,
  requiresStepUp: true,
  decision: null,
  timeline: [{ state: "pending", at: "2026-09-28T12:00:00.000Z" }],
};
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "t".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
test("review rejects changed money, foreign scope, concealed fields and contradictory decision states", () => {
  assert.equal(validateDecision(row, context).state, "pending");
  for (const changed of [
    { ...row, branchId: "6".repeat(24) },
    { ...row, token: "hidden" },
    { ...row, summary: { ...row.summary, payableMinor: 9000 } },
    { ...row, summary: { ...row.summary, currencyDigits: 3 } },
    {
      ...row,
      summary: { ...row.summary, discountMinor: 0, payableMinor: 10000 },
    },
    { ...row, requester: { id: context.accountId, name: "Me" } },
    { ...row, state: "applied" },
    { ...row, unavailableReason: "closed" },
  ])
    assert.throws(() => validateDecision(changed, context));
  assert.throws(() => validateDecision(row, { ...context, capabilities: [] }));
});
test("approval pages reject duplicates and cursors that would repeat or escape the requested page", async () => {
  const page = { schemaVersion: 1, entries: [row], nextCursor: null };
  assert.equal(
    (
      await readDecisions(credential, context, {
        fetcher: async () => json(page),
      })
    ).entries.length,
    1,
  );
  for (const changed of [
    { ...page, entries: [row, row] },
    { ...page, nextCursor: row.id },
  ])
    await assert.rejects(
      readDecisions(credential, context, {
        fetcher: async () => json(changed),
      }),
    );
  await assert.rejects(
    readDecisions(
      credential,
      context,
      { fetcher: async () => json(page) },
      { before: row.id },
    ),
  );
});
test("decision retries preserve the command and require a matching server decision; fresh confirmation stays in the body", async () => {
  const action = {
    decisionId: "d".repeat(43),
    expectedRevision: 0,
    outcome: "approved" as const,
    reason: "Approved for loyalty",
  };
  const confirmation = {
    ...credential,
    token: "pb1_" + "c".repeat(43),
    context,
  };
  const accepted: Decision = {
    ...row,
    state: "approved",
    revision: 1,
    canDecide: false,
    unavailableReason: "closed",
    requiresStepUp: false,
    decision: {
      id: action.decisionId,
      outcome: action.outcome,
      reason: action.reason,
      approver: { id: context.accountId, name: "Owner" },
    },
    timeline: [
      ...row.timeline,
      { state: "approved", at: "2026-09-28T12:01:00.000Z" },
    ],
  };
  const bodies: unknown[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(
      url,
      credential.origin + "/api/business/v1/decisions/" + row.id,
    );
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer " + credential.token,
    );
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1
      ? json({ error: { code: "step_up_required" } }, 428)
      : json(accepted);
  };
  await assert.rejects(
    sendDecision(credential, context, row.id, action, { fetcher }),
    (error) =>
      error instanceof DecisionError && error.code === "step_up_required",
  );
  const result = await sendDecision(
    credential,
    context,
    row.id,
    action,
    { fetcher },
    confirmation,
  );
  assert.equal(result.state, "approved");
  assert.deepEqual(bodies, [
    action,
    { ...action, confirmationToken: confirmation.token },
  ]);
  await assert.rejects(
    sendDecision(credential, context, row.id, action, {
      fetcher: async () => json(row),
    }),
  );
  let sent = false;
  await assert.rejects(
    sendDecision(
      credential,
      context,
      row.id,
      action,
      {
        fetcher: async () => {
          sent = true;
          return json(accepted);
        },
      },
      { ...confirmation, origin: "https://other.example.com" },
    ),
  );
  assert.equal(sent, false);
  for (const status of [401, 403])
    await assert.rejects(
      sendDecision(credential, context, row.id, action, {
        fetcher: async () =>
          json({ error: { code: "step_up_required" } }, status),
      }),
      (error) => error instanceof ConnectionError,
    );
});
test("browser round-trip memory is scoped to the account and tenant and expires without retaining a command or token", () => {
  const attempt = {
    origin: credential.origin,
    request: "r".repeat(43),
    verifier: "v".repeat(43),
    authorizationUrl: "",
    expiresAt: Date.now() + 60_000,
    interval: 5000,
    matchingCode: "RRRRRR",
  };
  rememberConfirmation(credential.origin, context, row.id, attempt);
  assert.equal(
    pendingConfirmation(credential.origin, context)?.requestId,
    row.id,
  );
  assert.equal(
    pendingConfirmation(credential.origin, {
      ...context,
      accountId: "6".repeat(24),
    }),
    null,
  );
  assert.equal(pendingConfirmation("https://other.example.com", context), null);
  assert.equal(
    JSON.stringify(pendingConfirmation(credential.origin, context)).includes(
      credential.token,
    ),
    false,
  );
  rememberConfirmation(credential.origin, context, row.id, {
    ...attempt,
    expiresAt: Date.now() - 1,
  });
  assert.equal(pendingConfirmation(credential.origin, context), null);
  clearConfirmation();
});
