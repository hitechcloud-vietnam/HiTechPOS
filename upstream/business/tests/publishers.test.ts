import test from "node:test";
import assert from "node:assert/strict";
import {
  readPublishers,
  changePublisher,
  type Publishers,
} from "../src/services/publishers";

const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "a".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const branchId = "a".repeat(24);
const state: Publishers = {
  branchId,
  publisher: {
    deviceId: "old",
    name: "Old desk",
    epoch: 4,
    online: false,
    lastPublishedAt: null,
  },
  candidates: [
    {
      deviceId: "new",
      name: "New desk",
      lastSeenAt: "2026-09-28T00:00:00.000Z",
    },
  ],
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
test("publisher reads reject other branches, duplicates and unexpected fields", async () => {
  assert.deepEqual(
    await readPublishers(credential, branchId, {
      fetcher: async () => json(state),
    }),
    state,
  );
  for (const change of [
    { branchId: "other" },
    { candidates: [...state.candidates, ...state.candidates] },
    { secret: "not allowed" },
  ])
    await assert.rejects(
      readPublishers(credential, branchId, {
        fetcher: async () => json({ ...state, ...change }),
      }),
    );
});
test("publisher changes bind the user's observed generation and never submit unknown candidates", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    calls++;
    assert.equal(options?.method, "POST");
    assert.deepEqual(JSON.parse(options!.body as string), {
      deviceId: "new",
      expectedEpoch: 4,
    });
    return json({ changed: true, epoch: 5 });
  };
  await assert.rejects(
    changePublisher(credential, state, "unknown", { fetcher }),
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await changePublisher(credential, state, "new", { fetcher }),
    { changed: true, epoch: 5 },
  );
});
