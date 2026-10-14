import test from "node:test";
import assert from "node:assert/strict";
import { sampleContext } from "../src/data/sample";
import { type BusinessContext } from "../src/domain/contracts";
import {
  readApprovalPreference,
  saveApprovalPreference,
  type ApprovalPreference,
} from "../src/services/approvalNotifications";
import { readInbox, validateInbox } from "../src/services/notifications";
import { discoverBusinessServer } from "../src/services/businessConnection";

const branchId = "a".repeat(24),
  origin = "https://shop.example.com";
const credential = {
  origin,
  token: "pb1_" + "t".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const context: BusinessContext = {
  ...sampleContext("manager"),
  capabilities: [
    "overview.read",
    "approvals.read",
    "notifications.self.manage",
  ],
  branches: [
    {
      ...sampleContext("manager").branches[0]!,
      id: branchId,
      timezone: "Asia/Kolkata",
    },
  ],
};
const preference: ApprovalPreference = {
  branchId,
  timezone: "Asia/Kolkata",
  revision: 0,
  enabled: false,
  quiet: { enabled: false, start: "22:00", end: "07:00" },
};
const discovery = {
  product: "posnic-business",
  apiVersion: 1,
  issuer: origin,
  audience: "posnic-business",
  authorization: "business-pkce-v1",
  reporting: "bounded-summary-v2",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const entry = {
  id: "b".repeat(24),
  branchId,
  kind: "approval_requested",
  businessDate: "2026-09-29",
  createdAt: "2026-09-29T10:00:00.000Z",
  read: false,
  summary: null,
  requestId: "c".repeat(24),
  requestExpiresAt: "2026-09-29T10:05:00.000Z",
};

test("approval settings negotiate support before the scoped authenticated read", async () => {
  const paths: string[] = [];
  const result = await readApprovalPreference(credential, context, branchId, {
    fetcher: async (url, options) => {
      const path = String(url).slice(origin.length);
      paths.push(path);
      if (path.includes("discovery")) {
        assert.equal(
          (options!.headers as Record<string, string>).Authorization,
          undefined,
        );
        return json({ ...discovery, approvalAlerts: "inbox-approval-v1" });
      }
      assert.equal(
        (options!.headers as Record<string, string>).Authorization,
        "Bearer " + credential.token,
      );
      return json(preference);
    },
  });
  assert.deepEqual(result, preference);
  assert.deepEqual(paths, [
    "/api/business/v1/discovery?approvals=1",
    "/api/business/v1/notifications/approvals/" + branchId,
  ]);
  let calls = 0;
  await assert.rejects(
    readApprovalPreference(credential, context, branchId, {
      fetcher: async () => {
        calls++;
        return json(discovery);
      },
    }),
    { problem: "unsupported" },
  );
  assert.equal(calls, 1);
  await discoverBusinessServer(origin, {
    items: true,
    approvals: true,
    fetcher: async (url) => {
      assert.equal(
        String(url),
        origin + "/api/business/v1/discovery?items=1&approvals=1",
      );
      return json({
        ...discovery,
        itemReporting: "bounded-items-v1",
        approvalAlerts: "inbox-approval-v1",
      });
    },
  });
});

test("approval settings reject scope loss before networking and malformed server preferences", async () => {
  const fetcher = async () => {
    throw new Error("must not fetch");
  };
  for (const changed of [
    { ...context, branches: [] },
    { ...context, capabilities: ["approvals.read"] },
    { ...context, capabilities: ["notifications.self.manage"] },
  ] satisfies BusinessContext[]) {
    await assert.rejects(
      readApprovalPreference(credential, changed, branchId, { fetcher }),
      { problem: "accessChanged" },
    );
    await assert.rejects(
      saveApprovalPreference(credential, changed, preference, { fetcher }),
      { problem: "accessChanged" },
    );
  }
  for (const changed of [
    { ...preference, branchId: "d".repeat(24) },
    { ...preference, timezone: "UTC" },
    { ...preference, recipient: "other" },
    { ...preference, quiet: { enabled: true, start: "22:00", end: "22:00" } },
  ])
    await assert.rejects(
      readApprovalPreference(credential, context, branchId, {
        fetcher: async (url) =>
          json(
            String(url).includes("discovery")
              ? { ...discovery, approvalAlerts: "inbox-approval-v1" }
              : changed,
          ),
      }),
      { problem: "invalidResponse" },
    );
});

test("approval writes send only revision and preferences and never claim an unconfirmed save", async () => {
  const input = { ...preference, enabled: true, revision: 3 };
  const result = await saveApprovalPreference(credential, context, input, {
    fetcher: async (url, options) => {
      assert.equal(
        String(url),
        origin + "/api/business/v1/notifications/approvals/" + branchId,
      );
      assert.deepEqual(JSON.parse(options!.body as string), {
        expectedRevision: 3,
        enabled: true,
        quiet: input.quiet,
      });
      return json({ ...input, revision: 4 });
    },
  });
  assert.equal(result.revision, 4);
  for (const changed of [
    input,
    { ...input, revision: 4, enabled: false },
    { ...input, revision: 4, quiet: { ...input.quiet, start: "21:00" } },
  ])
    await assert.rejects(
      saveApprovalPreference(credential, context, input, {
        fetcher: async () => json(changed),
      }),
      { problem: "invalidResponse" },
    );
  await assert.rejects(
    saveApprovalPreference(credential, context, input, {
      fetcher: async () => json({ error: "preference_changed" }, 409),
    }),
  );
});

test("Inbox approval entries are strictly scoped and carry no embedded decision authority", async () => {
  assert.equal(
    validateInbox({ entries: [entry], next: null }, context).entries[0]!.kind,
    "approval_requested",
  );
  for (const changed of [
    { ...entry, requestId: "https://other.example/approve" },
    { ...entry, requestExpiresAt: entry.createdAt },
    { ...entry, branchId: "f".repeat(24) },
    { ...entry, action: "approve" },
    { ...entry, summary: {} },
  ])
    assert.throws(() =>
      validateInbox({ entries: [changed], next: null }, context),
    );
  assert.throws(() =>
    validateInbox(
      { entries: [entry], next: null },
      { ...context, capabilities: ["overview.read"] },
    ),
  );
  const cursor = "d".repeat(24);
  const result = await readInbox(
    credential,
    context,
    {
      fetcher: async (url) => {
        assert.equal(
          String(url),
          origin +
            "/api/business/v1/inbox?registerSessions=1&before=" +
            cursor +
            "&approvals=1",
        );
        return json({ entries: [], next: cursor });
      },
    },
    cursor,
  );
  assert.equal(result.next, cursor);
  await readInbox(
    credential,
    { ...context, capabilities: ["overview.read"] },
    {
      fetcher: async (url) => {
        assert.equal(String(url), origin + "/api/business/v1/inbox");
        return json({ entries: [], next: null });
      },
    },
  );
});
