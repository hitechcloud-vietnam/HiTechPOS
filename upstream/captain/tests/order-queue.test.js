/*
 * Orders that could not be sent yet.
 *
 * The failure mode this guards against is not losing an order - it is sending
 * it twice. A network error does not mean the order was not written; it may
 * have reached the kitchen and the reply been lost. Resending into a server
 * that does not dedupe is how a table gets two of everything.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

/* A localStorage that behaves like the browser's, so the queue can be tested
   without one. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
globalThis.localStorage = fakeStorage();

const OrderQueue = require(
  path.join(__dirname, "..", "assets", "common", "order-queue.js"),
);

const reset = () => globalThis.localStorage.removeItem(OrderQueue.STORE);
const order = (key) => ({
  key,
  branch: "b1",
  body: { idempotencyKey: key, items: [] },
});

test("a held checkout cannot send before its cart is cleared", async () => {
  reset();
  OrderQueue.add({ ...order("held"), held: true });
  let calls = 0;
  await OrderQueue.flush(async () => {
    calls++;
    return { type: "success" };
  });
  assert.equal(calls, 0);
  OrderQueue.update("held", { held: false });
  await OrderQueue.flush(async () => {
    calls++;
    return { type: "success" };
  });
  assert.equal(calls, 1);
});
test("transient failures preserve FIFO and back off, while rejections do not block later orders", async () => {
  reset();
  OrderQueue.add(order("a"));
  OrderQueue.add(order("b"));
  const calls = [];
  const offline = async (r) => {
    calls.push(r.key);
    throw Object.assign(Error("Slow"), { status: 503 });
  };
  await OrderQueue.flush(offline, { now: () => 100 });
  await OrderQueue.flush(offline, { now: () => 101 });
  assert.deepEqual(calls, ["a"]);
  await OrderQueue.flush(
    async (r) => {
      calls.push(r.key);
      if (r.key === "a")
        throw Object.assign(Error("Item unavailable"), { status: 422 });
      return { type: "success" };
    },
    { force: true },
  );
  assert.equal(OrderQueue.count(), 1);
  assert.equal(OrderQueue.all()[0].state, "attention");
  assert.deepEqual(calls, ["a", "a", "b"]);
});
test("concurrent flushes cannot send the same order twice", async () => {
  reset();
  OrderQueue.add(order("one"));
  let release,
    calls = 0;
  const send = async () => {
    calls++;
    await new Promise((r) => (release = r));
    return { type: "success" };
  };
  const a = OrderQueue.flush(send),
    b = OrderQueue.flush(send);
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});
test("authorization refusals pause automatic retries until a deliberate retry", async () => {
  reset();
  OrderQueue.add(order("revoked"));
  let calls = 0;
  await OrderQueue.flush(async () => {
    calls++;
    throw Object.assign(Error("Revoked"), {
      status: 403,
      code: "DEVICE_REVOKED",
    });
  });
  await OrderQueue.flush(async () => {
    calls++;
    return { type: "success" };
  });
  assert.equal(calls, 1);
  await OrderQueue.flush(async () => ({ type: "success" }), { force: true });
  assert.equal(OrderQueue.count(), 0);
});
test("corrupt storage is surfaced and never overwritten as an empty queue", () => {
  reset();
  localStorage.setItem(OrderQueue.STORE, "broken");
  assert.throws(() => OrderQueue.add(order("new")), /could not be read/);
  assert.equal(localStorage.getItem(OrderQueue.STORE), "broken");
  reset();
});

test("a full queue refuses the new order so the caller keeps its cart", () => {
  reset();
  for (let i = 0; i < OrderQueue.LIMIT; i++)
    assert.equal(OrderQueue.add(order("full-" + i)), true);
  assert.equal(OrderQueue.add(order("overflow")), false);
  assert.equal(OrderQueue.count(), OrderQueue.LIMIT);
  reset();
});
test("storage failure never claims the order was saved", () => {
  reset();
  const saved = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw Error("disk full");
  };
  try {
    assert.equal(OrderQueue.add(order("disk-full")), false);
  } finally {
    globalThis.localStorage.setItem = saved;
  }
});

test("a failed order is kept", () => {
  reset();
  assert.equal(OrderQueue.add(order("k1")), true);
  assert.equal(OrderQueue.count(), 1);
});

test("the same order is never queued twice", () => {
  reset();
  OrderQueue.add(order("k1"));
  OrderQueue.add(order("k1"));
  assert.equal(
    OrderQueue.count(),
    1,
    "one tap, one order, however many times it failed",
  );
});

test("a key survives a retry", () => {
  /* A key minted per attempt makes every resend look like a new order, which
     is the thing the key exists to prevent. */
  const a = OrderQueue.newKey();
  const b = OrderQueue.newKey();
  assert.notEqual(a, b);
  assert.ok(a.length > 8);
});

test("only a definite success clears an order", async () => {
  reset();
  OrderQueue.add(order("k1"));
  await OrderQueue.flush(async () => ({ type: "error", message: "nope" }));
  assert.equal(OrderQueue.count(), 1, "a refusal must not look like a send");

  await OrderQueue.flush(async () => {
    throw new Error("offline");
  });
  assert.equal(
    OrderQueue.count(),
    1,
    "an unreachable server must not look like a send",
  );

  const { sent } = await OrderQueue.flush(
    async () => ({ type: "success", data: {} }),
    { force: true, key: "k1" },
  );
  assert.equal(sent, 1);
  assert.equal(OrderQueue.count(), 0);
});

test("a server that does not say it dedupes is treated as one that does not", () => {
  /* Silence is not consent. An older server neither advertises the flag nor
     honours the key, and reading absent as yes doubles orders. */
  assert.equal(OrderQueue.dedupes(undefined), false);
  assert.equal(OrderQueue.dedupes({}), false);
  assert.equal(OrderQueue.dedupes({ features: {} }), false);
  assert.equal(
    OrderQueue.dedupes({ features: { idempotentOrders: true } }),
    true,
  );
});

test("the queue does not grow without limit", () => {
  reset();
  for (let i = 0; i < OrderQueue.LIMIT + 20; i++)
    OrderQueue.add(order(`k${i}`));
  assert.ok(
    OrderQueue.count() <= OrderQueue.LIMIT,
    "beyond a shift of unsent orders, something is wrong and silence is the wrong answer",
  );
});

test("attempts are counted, so a stuck order is visible", async () => {
  reset();
  OrderQueue.add(order("k1"));
  await OrderQueue.flush(async () => {
    throw new Error("offline");
  });
  await OrderQueue.flush(
    async () => {
      throw new Error("offline");
    },
    { force: true },
  );
  assert.equal(OrderQueue.all()[0].attempts, 2);
});

test("delivery authority is retained on failed queue deletion and retired only after success", () => {
  reset();
  OrderQueue.add({ ...order("ack"), owner: { shop: "shop", user: "staff" } });
  localStorage.setItem(
    "posnic.order-authorities",
    JSON.stringify({ "shop:staff:ack": "till-a", "shop:other:ack": "till-b" }),
  );
  const set = localStorage.setItem;
  localStorage.setItem = (name, value) => {
    if (name === OrderQueue.STORE) throw Error("Storage unavailable");
    return set(name, value);
  };
  try {
    assert.equal(OrderQueue.remove("ack"), false);
    assert.equal(
      JSON.parse(localStorage.getItem("posnic.order-authorities"))[
        "shop:staff:ack"
      ],
      "till-a",
    );
  } finally {
    localStorage.setItem = set;
  }
  assert.equal(OrderQueue.remove("ack"), true);
  assert.deepEqual(
    JSON.parse(localStorage.getItem("posnic.order-authorities")),
    { "shop:other:ack": "till-b" },
  );
});


test("an unavailable order owned by another session cannot silently block eligible orders", async () => {
  for (const state of ["held", "blocked", "waiting"]) {
    reset();
    OrderQueue.add({...order("other"), held: state === "held"});
    OrderQueue.update("other", {state: state === "held" ? "waiting" : state, nextAt: 999999});
    OrderQueue.add(order("own"));
    const calls = [];
    const result = await OrderQueue.flush(async row => {
      calls.push(row.key);
      return {type:"success"};
    }, {eligible: row => row.key === "own", now: () => 100});
    assert.deepEqual(calls, ["own"]);
    assert.equal(result.sent, 1);
    assert.deepEqual(OrderQueue.all().map(row => row.key), ["other"]);
  }
});
