import test from "node:test";
import assert from "node:assert/strict";
import {
  listBusinessSessions,
  removeBusinessSession,
} from "../src/services/sessions";
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "s".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const row = {
  id: "r".repeat(43),
  name: "Business phone",
  issuedAt: "2026-09-28T01:00:00.000Z",
  expiresAt: credential.expiresAt,
  current: true,
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
test("device list rejects duplicate IDs and credential-bearing records", async () => {
  assert.deepEqual(
    await listBusinessSessions(credential, {
      fetcher: async () => json([row]),
    }),
    [row],
  );
  for (const payload of [
    [row, row],
    [{ ...row, token: credential.token }],
    [{ ...row, id: "../session" }],
  ])
    await assert.rejects(
      listBusinessSessions(credential, { fetcher: async () => json(payload) }),
    );
});
test("removal uses only a validated session ID and requires confirmed server revocation", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(
      String(url),
      credential.origin + "/api/business/v1/sessions/" + row.id,
    );
    assert.equal(options?.method, "DELETE");
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer " + credential.token,
    );
    return json({ revoked: true });
  };
  await assert.rejects(
    removeBusinessSession(credential, "../session", { fetcher }),
  );
  assert.equal(calls, 0);
  await removeBusinessSession(credential, row.id, { fetcher });
  assert.equal(calls, 1);
  await assert.rejects(
    removeBusinessSession(credential, row.id, {
      fetcher: async () => json({ revoked: false }),
    }),
  );
});
