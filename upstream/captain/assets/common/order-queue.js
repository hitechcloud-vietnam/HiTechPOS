/*
 * Persist orders before transmission. Every retry keeps the same key, and
 * callers must verify server duplicate protection before sending. A lost
 * response can follow a successful database write.
 *
 * Storage writes return false so checkout retains its cart. Corrupt storage
 * throws instead of silently replacing previously saved orders. Access
 * refusals pause delivery; validation rejections remain visible for review.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OrderQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const STORE = "posnic.pending-orders";
  /* A shift's worth. Beyond this something is badly wrong and the right
     answer is not to accumulate silently. */
  const LIMIT = 50;
  let flight = null;

  function read() {
    try {
      const rows = JSON.parse(localStorage.getItem(STORE) || "[]");
      if (!Array.isArray(rows)) throw new Error("Invalid saved orders");
      return rows;
    } catch (e) {
      throw new Error(
        "Saved orders could not be read. Do not clear app storage; ask your manager for help.",
      );
    }
  }

  function write(rows) {
    try {
      localStorage.setItem(STORE, JSON.stringify(rows));
      return true;
    } catch (e) {
      /* Storage full or blocked. The order is still in the cart. */
      return false;
    }
  }

  /**
   * A key that survives a retry.
   *
   * Made before the first attempt, never regenerated: a key minted per attempt
   * would make every retry look like a new order, which is the bug this whole
   * file exists to avoid.
   */
  function newKey() {
    if (
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === "function"
    ) {
      return globalThis.crypto.randomUUID();
    }
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const all = () => read();
  const count = () => read().length;

  /** Keep an order that could not be sent. */
  function add(order) {
    if (!order || !order.key) return false;
    const rows = read();
    if (rows.some((row) => row.key === order.key)) return false;
    if (rows.length >= LIMIT) return false;
    const session = globalThis.POSNIC?.session;
    const owner =
      session?.user?.id && session.shopKey
        ? {
            user: session.user.id,
            shop: session.shopKey,
            base: session.base || globalThis.POSNIC.server.baseUrl,
            branch: localStorage.getItem("branch_id") || order.body?.branch_id,
          }
        : null;
    rows.push({
      ...order,
      ...(owner ? { owner } : {}),
      at: Date.now(),
      attempts: 0,
      state: "waiting",
      nextAt: 0,
    });
    return write(rows);
  }

  function remove(key) {
    const rows = read(),
      removed = rows.find((row) => row.key === key);
    if (!write(rows.filter((row) => row.key !== key))) return false;
    // Only retire delivery ownership after the queue deletion is durable.
    // Keeping it on a failed write prevents a retry from using another till.
    if (removed?.owner)
      try {
        const name = "posnic.order-authorities";
        const entries = JSON.parse(localStorage.getItem(name) || "{}");
        delete entries[
          removed.owner.shop +
            ":" +
            removed.owner.user +
            ":" +
            (removed.body?.idempotencyKey || key)
        ];
        localStorage.setItem(name, JSON.stringify(entries));
      } catch {
        /* A leftover delivery record is safe; the order is already removed. */
      }
    return true;
  }

  function noteAttempt(key) {
    const rows = read();
    const row = rows.find((r) => r.key === key);
    if (row) row.attempts = (row.attempts || 0) + 1;
    return write(rows);
  }

  function update(key, values) {
    const rows = read(),
      row = rows.find((r) => r.key === key);
    if (!row) return false;
    Object.assign(row, values);
    return write(rows);
  }

  function classify(error) {
    const status = Number(error?.status || 0),
      code = error?.code || "";
    if (
      [401, 403].includes(status) ||
      /PIN_LOCKED|SESSION_|AUTH_|DEVICE_|OWNER|CAPTAIN_|OFFLINE_EXPIRED/.test(
        code,
      )
    )
      return "blocked";
    if (status >= 400 && status < 500 && ![408, 425, 429].includes(status))
      return "attention";
    return "waiting";
  }

  /**
   * Does this server return the existing order instead of writing a second?
   *
   * Read from what the server says about itself rather than assumed. Absent
   * means no: an older server neither advertises the flag nor honours the key,
   * and treating silence as yes is how a kitchen gets two of everything.
   *
   * @param {object} runtime the /runtime-info payload
   */
  const dedupes = (runtime) =>
    !!(runtime && runtime.features && runtime.features.idempotentOrders);

  /**
   * Try to send everything waiting.
   *
   * @param {(order: object) => Promise<any>} send  performs one order
   * @returns {Promise<{sent: number, left: number}>}
   */
  function flush(send, options = {}) {
    if (flight) return flight;
    flight = drain(send, options).finally(() => {
      flight = null;
    });
    return flight;
  }

  async function drain(send, { force = false, key, eligible = () => true, now = Date.now } = {}) {
    const rows = read();
    let sent = 0;

    for (const row of rows) {
      // Another staff member or shop must neither send nor block this queue.
      if (!eligible(row)) continue;
      if (row.held) break;
      if (key && row.key !== key) continue;
      if (row.state === "attention" && key !== row.key) continue;
      if (row.state === "blocked" && !force) break;
      if (!force && row.nextAt > now()) break;
      try {
        if (!noteAttempt(row.key)) break; // Never send if durable bookkeeping failed.
        const result = await send(row);
        /* Only a definite success clears it. Anything else leaves the order
           waiting, which is the safe direction: a queued order somebody can
           see beats an order quietly dropped. */
        if (result && result.type === "success") {
          if (!remove(row.key)) break;
          sent += 1;
        } else {
          const error = Object.assign(
            new Error(
              result?.message ||
                "The server rejected this order. Ask your manager to review it.",
            ),
            { status: 422 },
          );
          throw error;
        }
      } catch (e) {
        const state = classify(e);
        const delay = Math.min(
          60000,
          2000 * 2 ** Math.min(row.attempts || 0, 5),
        );
        if (
          !update(row.key, {
            state,
            message: e.message || "Waiting for connection.",
            code: e.code || "",
            nextAt: now() + delay,
          })
        )
          break;
        if (state !== "attention") break;
      }
    }
    return { sent, left: count() };
  }

  return {
    newKey,
    add,
    remove,
    all,
    count,
    flush,
    update,
    classify,
    dedupes,
    STORE,
    LIMIT,
  };
});
