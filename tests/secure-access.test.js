const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { createAccess } = require("../assets/common/access");

test("a lost local reply falls back to the verified domain with the identical order, never a second sale", async () => {
  const f = fixture(),
    routeKey = "a".repeat(64),
    lan = "http://192.168.1.20:5555/api",
    cloud = "https://shop.example/api";
  const sales = new Map(),
    attempts = [];
  const access = createAccess(
    f.plugin,
    f.storage,
    async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      if (url.endsWith("/route-proof")) {
        assert.equal(options.headers.Authorization, undefined);
        return {
          ok: true,
          json: async () => ({
            proof: require("node:crypto")
              .createHmac("sha256", routeKey)
              .update(body.nonce)
              .digest("hex"),
          }),
        };
      }
      assert.equal(options.headers.Authorization, "Bearer access");
      attempts.push({ url, body });
      if (!sales.has(body.idempotencyKey))
        sales.set(body.idempotencyKey, {
          type: "success",
          data: { orderId: "one" },
        });
      if (url.startsWith(lan)) throw Error("reply lost after commit");
      return { ok: true, json: async () => sales.get(body.idempotencyKey) };
    },
    webcrypto,
  );
  await access.session.start({
    ...f.grant,
    base: lan,
    routeKey,
    routes: [cloud],
    idempotentOrders: true,
  });
  const result = await access.session.request("/sales/qrOrder", {
    method: "POST",
    body: { idempotencyKey: "stable", items: [1] },
  });
  assert.equal(result.data.orderId, "one");
  assert.equal(sales.size, 1);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(access.session.base, lan);
});

test("a different server cannot receive a bearer, renewal secret or order even if it claims the shop name", async () => {
  const f = fixture(),
    seen = [];
  const access = createAccess(
    f.plugin,
    f.storage,
    async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        json: async () => ({ proof: "wrong", shopKey: "shop" }),
      };
    },
    webcrypto,
  );
  await access.session.start({
    ...f.grant,
    routeKey: "a".repeat(64),
    routes: ["http://192.168.1.20:5555/api"],
    idempotentOrders: true,
  });
  await assert.rejects(
    access.session.request("/sales/qrOrder", {
      method: "POST",
      body: { idempotencyKey: "stable" },
    }),
    (e) => e.code === "OFFLINE",
  );
  assert.equal(seen.length, 2);
  for (const call of seen) {
    assert.ok(call.url.endsWith("/route-proof"));
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(JSON.parse(call.options.body).refreshToken, undefined);
  }
});

test("validation and permission failures do not try another address", async () => {
  for (const status of [401, 403, 422, 429]) {
    const f = fixture(),
      routeKey = "b".repeat(64),
      calls = [];
    const access = createAccess(
      f.plugin,
      f.storage,
      async (url, options) => {
        calls.push(url);
        if (url.endsWith("/route-proof"))
          return {
            ok: true,
            json: async () => ({
              proof: require("node:crypto")
                .createHmac("sha256", routeKey)
                .update(JSON.parse(options.body).nonce)
                .digest("hex"),
            }),
          };
        return {
          ok: false,
          status,
          json: async () => ({
            error: { message: "Denied", code: "CAPTAIN_PERMISSION" },
          }),
        };
      },
      webcrypto,
    );
    await access.session.start({
      ...f.grant,
      refreshToken: null,
      routeKey,
      routes: ["https://other.example/api"],
      idempotentOrders: true,
    });
    await assert.rejects(
      access.session.request("/sales/qrOrder", {
        method: "POST",
        body: { idempotencyKey: "stable" },
      }),
      (e) => e.status === status,
    );
    assert.ok(calls.every((url) => url.startsWith(f.grant.base)));
    if (status === 403) assert.equal(access.session.canTakeOrders, false);
  }
});

test("iOS uses native secure storage and locks on background just like Android", async () => {
  const f = fixture(), listeners = {};
  const window = {
    Capacitor: {isNativePlatform:()=>true,getPlatform:()=>"ios",Plugins:{SecureSession:f.plugin}},
    localStorage:f.storage,crypto:webcrypto,fetch:async()=>({}),
    location:{pathname:"/index.html"},
    document:{hidden:false,addEventListener:(name,action)=>{listeners[name]=action}},
  };
  require("node:vm").runInNewContext(
    require("node:fs").readFileSync(require.resolve("../assets/common/access"),"utf8"),
    {window,btoa,atob,TextEncoder,setTimeout,clearTimeout,AbortController},
  );
  await window.CaptainAccess.ready;
  assert.equal(typeof window.CaptainAccess.session.start,"function");
  assert.equal(typeof listeners.visibilitychange,"function");
});

test("a renewal reply arriving after sign-out cannot restore access", async () => {
  const f = fixture();
  let release, started;
  const waiting = new Promise((r) => (started = r));
  const access = createAccess(
    f.plugin,
    f.storage,
    async (url) => {
      if (url.endsWith("/logout")) return { ok: true };
      started();
      await new Promise((r) => (release = r));
      return { ok: true, json: async () => f.grant };
    },
    webcrypto,
  );
  await access.session.start({ ...f.grant, expiresAt: 1 });
  const renewal = access.session.prepare();
  await waiting;
  await access.session.end();
  release();
  await assert.rejects(renewal, /cancelled/);
  assert.equal(access.session.token, null);
  assert.equal(f.vault().token, undefined);
});

function fixture(saved = {}) {
  const data = new Map(Object.entries(saved));
  const storage = {
    getItem: (k) => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
  let vault = {},
    pin,
    locked = false,
    failures = 0;
  const status = () => ({
    pinSet: !!pin,
    locked: !!pin && locked,
    attempts: 5 - failures,
    profile: vault.token
      ? { user: vault.user, shopKey: vault.shopKey, base: vault.base }
      : null,
    session: locked ? undefined : structuredClone(vault),
  });
  const plugin = {
    async status() {
      return status();
    },
    async save({ session }) {
      if (locked) throw Error("locked");
      vault = structuredClone(session);
      return status();
    },
    async setPin(value) {
      pin = value.pin;
      locked = false;
      return status();
    },
    async lock() {
      locked = !!pin;
    },
    async unlock(value) {
      if (failures === 5) throw Error("Recovery required");
      if (value.pin === pin) {
        locked = false;
        failures = 0;
      } else {
        failures++;
      }
      return status();
    },
    async clear() {
      vault = {};
      pin = null;
      locked = false;
    },
  };
  const grant = {
    token: "access",
    refreshToken: "r".repeat(43),
    sessionId: "session",
    base: "https://shop.example/api",
    shopKey: "shop",
    user: { id: "staff" },
    expiresIn: 900,
    offlineUntil: new Date(Date.now() + 86400000).toISOString(),
  };
  return { data, storage, plugin, grant, vault: () => vault };
}
test("migration writes native storage before removing plaintext and binds old queued orders", async () => {
  const legacy = {
    token: "old-access",
    user: { id: "staff" },
    shopKey: "shop",
  };
  const f = fixture({
    "posnic.session": JSON.stringify(legacy),
    "posnic.server": JSON.stringify({ active: "http://192.168.1.2:42590/api" }),
    "posnic.pending-orders": JSON.stringify([{ id: "order" }]),
  });
  const access = createAccess(f.plugin, f.storage, async () => {}, webcrypto);
  await access.ready;
  assert.equal(f.vault().token, "old-access");
  assert.equal(f.data.has("posnic.session"), false);
  assert.equal(
    JSON.parse(f.data.get("posnic.pending-orders"))[0].owner.user,
    "staff",
  );
});
test("failed secure migration retains the recoverable original", async () => {
  const f = fixture({
    "posnic.session": JSON.stringify({ token: "old-access" }),
  });
  f.plugin.save = async () => {
    throw Error("disk unavailable");
  };
  await assert.rejects(
    createAccess(f.plugin, f.storage, async () => {}, webcrypto).ready,
    /disk/,
  );
  assert.ok(f.data.has("posnic.session"));
});
test("concurrent requests renew once, persisting the successor before transmission", async () => {
  const f = fixture();
  let calls = 0;
  const access = createAccess(
    f.plugin,
    f.storage,
    async (_url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(f.vault().rotation, body.nextToken);
      await new Promise((r) => setTimeout(r, 15));
      return {
        ok: true,
        json: async () => ({
          ...f.grant,
          token: "renewed",
          refreshToken: body.nextToken,
        }),
      };
    },
    webcrypto,
  );
  await access.session.start({ ...f.grant, expiresAt: 1 });
  await Promise.all([
    access.session.prepare(),
    access.session.prepare(),
    access.session.prepare(),
  ]);
  assert.equal(calls, 1);
  assert.equal(access.session.token, "renewed");
  assert.equal(f.data.has("posnic.session"), false);
});
test("restart after a lost rotation reply retries the identical successor", async () => {
  const f = fixture();
  let sent;
  const first = createAccess(
    f.plugin,
    f.storage,
    async (_url, options) => {
      sent = JSON.parse(options.body).nextToken;
      throw Error("connection lost");
    },
    webcrypto,
  );
  await first.session.start({ ...f.grant, expiresAt: 1 });
  await assert.rejects(first.session.prepare(), /lost/);
  const restarted = createAccess(
    f.plugin,
    f.storage,
    async (_url, options) => {
      assert.equal(JSON.parse(options.body).nextToken, sent);
      return {
        ok: true,
        json: async () => ({ ...f.grant, refreshToken: sent }),
      };
    },
    webcrypto,
  );
  await restarted.ready;
  await restarted.session.prepare();
  assert.equal(f.vault().refreshToken, sent);
});
test("PIN restart hides credentials, offline unlock needs no network, wrong tries stay locked", async () => {
  const f = fixture();
  let calls = 0;
  const offline = async () => {
    calls++;
    throw Error("offline");
  };
  const first = createAccess(f.plugin, f.storage, offline, webcrypto);
  await first.session.start(f.grant);
  await first.setPin("1234");
  await first.session.suspend();
  const next = createAccess(f.plugin, f.storage, offline, webcrypto);
  await next.ready;
  assert.equal(next.session.token, null);
  assert.equal((await next.unlock("0000")).ok, false);
  assert.equal((await next.unlock("1234")).ok, true);
  assert.equal(calls, 0);
  await next.session.suspend();
  for (let i = 0; i < 5; i++)
    assert.equal((await next.unlock("0000")).ok, false);
  await assert.rejects(next.unlock("1234"), /Recovery/);
  assert.equal(next.session.token, null);
});
test("expired offline authorization cannot be extended with a PIN; sign-out preserves orders", async () => {
  const f = fixture({ "posnic.pending-orders": '[{"id":"retained"}]' });
  const access = createAccess(
    f.plugin,
    f.storage,
    async () => {
      throw Error("offline");
    },
    webcrypto,
  );
  await access.session.start({
    ...f.grant,
    offlineUntil: new Date(0).toISOString(),
  });
  await access.setPin("1234");
  await access.session.suspend();
  await assert.rejects(access.unlock("1234"), /offline/);
  assert.equal(access.session.token, null);
  await access.session.end();
  assert.equal(f.data.get("posnic.pending-orders"), '[{"id":"retained"}]');
});
test("revocation locks the phone and retains both orders and recovery identity", async () => {
  const f = fixture({ "posnic.pending-orders": '[{"id":"retained"}]' });
  const access = createAccess(
    f.plugin,
    f.storage,
    async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: { code: "DEVICE_REVOKED", message: "Ask your manager" },
      }),
    }),
    webcrypto,
  );
  await access.session.start({ ...f.grant, expiresAt: 1 });
  await access.setPin("1234");
  await assert.rejects(access.session.prepare(), /manager/);
  assert.equal(access.session.token, null);
  assert.equal(access.session.user.id, "staff");
  assert.ok(f.data.has("posnic.pending-orders"));
});

for (const stall of ["fetch", "body"]) {
  test(
    `a stalled ${stall} ignores abort but releases the request and retries the same order`,
    { timeout: 2000 },
    async () => {
      const f = fixture();
      let recovering = false;
      const attempts = [];
      let lateReply;
      const pending = new Promise((resolve) => {
        lateReply = resolve;
      });
      const answer = { type: "success", data: { orderId: "one" } };
      const access = createAccess(
        f.plugin,
        f.storage,
        async (_url, options) => {
          attempts.push(JSON.parse(options.body));
          if (!recovering && stall === "fetch") return pending;
          return {
            ok: true,
            json: () => (recovering ? Promise.resolve(answer) : pending),
          };
        },
        webcrypto,
      );
      await access.session.start(f.grant);
      const options = {
        method: "POST",
        body: { idempotencyKey: "stable", items: [1] },
        timeout: 20,
      };
      await assert.rejects(
        access.session.request("/sales/qrOrder", options),
        (e) => e.code === "OFFLINE",
      );
      recovering = true;
      assert.deepEqual(
        await access.session.request("/sales/qrOrder", options),
        answer,
      );
      assert.deepEqual(attempts, [options.body, options.body]);
      lateReply(
        stall === "fetch" ? { ok: true, json: async () => answer } : answer,
      );
    },
  );
}
for (const loseReply of [false, true])
  test(`independent local and cloud sessions use their own credentials and preserve write ownership (${loseReply})`, async () => {
    const f = fixture(),
      lan = "http://192.168.1.20:5555/api",
      cloud = f.grant.base,
      seen = [];
    let down = !loseReply;
    const handler = async (url, options) => {
      const here = url.startsWith(lan),
        body = options.body && JSON.parse(options.body);
      if (url.endsWith("/route-proof")) {
        if (here && down) throw Error("Wi-Fi unavailable");
        assert.equal(options.headers.Authorization, undefined);
        return {
          ok: true,
          json: async () => ({
            proof: require("node:crypto")
              .createHmac("sha256", here ? "local-key" : "cloud-key")
              .update(body.nonce)
              .digest("hex"),
          }),
        };
      }
      seen.push({ url, token: options.headers.Authorization, body });
      assert.equal(
        options.headers.Authorization,
        here ? "Bearer local-access" : "Bearer access",
      );
      if (here && loseReply) throw Error("Reply lost");
      return { ok: true, json: async () => ({ type: "success" }) };
    };
    let access = createAccess(f.plugin, f.storage, handler, webcrypto);
    await access.session.start({
      ...f.grant,
      routeKey: "cloud-key",
      idempotentOrders: true,
      connections: [
        {
          ...f.grant,
          base: lan,
          token: "local-access",
          sessionId: "local-session",
          routeKey: "local-key",
          targetDeviceId: "till-1",
          expiresAt: Date.now() + 900000,
        },
      ],
    });
    const options = { method: "POST", body: { idempotencyKey: "new-sale" } };
    if (!loseReply) {
      assert.equal(
        (await access.session.request("/sales/qrOrder", options)).type,
        "success",
      );
      assert.equal(seen[0].url, cloud + "/sales/qrOrder");
    } else {
      await assert.rejects(access.session.request("/sales/qrOrder", options));
      assert.equal(seen.length, 1);
      assert.ok(seen[0].url.startsWith(lan));
      down = true;
      access = createAccess(f.plugin, f.storage, handler, webcrypto);
      await access.ready;
      await assert.rejects(access.session.request("/sales/qrOrder", options));
      assert.equal(
        seen.length,
        1,
        "a restart must not reroute an uncertain order to a second database",
      );
    }
  });
test("local renewal persists its own successor while preserving cloud credentials", async () => {
  const f = fixture(),
    lan = "http://192.168.1.20:5555/api";
  let rotated;
  const access = createAccess(
    f.plugin,
    f.storage,
    async (url, options) => {
      const body = options.body && JSON.parse(options.body);
      if (url.endsWith("/route-proof"))
        return {
          ok: true,
          json: async () => ({
            proof: require("node:crypto")
              .createHmac(
                "sha256",
                url.startsWith(lan) ? "local-key" : "cloud-key",
              )
              .update(body.nonce)
              .digest("hex"),
          }),
        };
      if (url.endsWith("/refresh")) {
        assert.ok(url.startsWith(lan));
        rotated = body.nextToken;
        return {
          ok: true,
          json: async () => ({
            ...f.grant,
            token: "local-new",
            refreshToken: rotated,
            routeKey: "local-key",
            sessionId: "local-session",
          }),
        };
      }
      assert.equal(options.headers.Authorization, "Bearer local-new");
      return { ok: true, json: async () => ({ ok: true }) };
    },
    webcrypto,
  );
  await access.session.start({
    ...f.grant,
    routeKey: "cloud-key",
    connections: [
      {
        ...f.grant,
        base: lan,
        routeKey: "local-key",
        sessionId: "local-session",
        targetDeviceId: "till-1",
        expiresAt: 1,
      },
    ],
  });
  await access.session.request("/sales/getOrderHistory", { method: "POST" });
  assert.equal(f.vault().token, "access");
  assert.equal(f.vault().connections[0].token, "local-new");
  assert.equal(f.vault().connections[0].refreshToken, rotated);
});
test("a replacement IP is proved before it is stored as a connection", async () => {
  const f = fixture(),
    calls = [];
  const access = createAccess(
    f.plugin,
    f.storage,
    async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ proof: "wrong" }) };
    },
    webcrypto,
  );
  await access.session.start({ ...f.grant, routeKey: "key" });
  await assert.rejects(
    access.session.addAddress("http://192.168.1.99:5555/api"),
    /not the server/,
  );
  assert.equal(f.vault().routes, undefined);
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("late local approval is retried without interrupting the established cloud session", async (t) => {
  const f = fixture(),
    lan = "http://192.168.1.20:5555/api",
    code = "ABCDEF123456";
  let delivered = false,
    proofs = 0,
    time = Date.now();
  t.mock.method(Date, "now", () => time);
  const previous = globalThis.POSNIC;
  globalThis.POSNIC = {
    thisDevice: { facts: () => ({ deviceId: "phone" }) },
    server: { recordShop() {}, remember() {} },
  };
  t.after(() => {
    globalThis.POSNIC = previous;
  });
  const access = createAccess(
    f.plugin,
    f.storage,
    async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.endsWith("/enrolment-proof")) {
        proofs++;
        if (!delivered)
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: { message: "Not delivered yet" } }),
          };
        return {
          ok: true,
          json: async () => ({
            proof: require("node:crypto")
              .createHmac(
                "sha256",
                require("node:crypto")
                  .createHash("sha256")
                  .update(code)
                  .digest("hex"),
              )
              .update(body.nonce)
              .digest("hex"),
          }),
        };
      }
      assert.equal(url, lan + "/captain/v1/pair");
      assert.equal(body.code, code);
      return {
        ok: true,
        json: async () => ({
          ...f.grant,
          token: "local-token",
          routeKey: "local-key",
          sessionId: "local-session",
        }),
      };
    },
    webcrypto,
  );
  await access.session.start({
    ...f.grant,
    cloudAuthorization: { connectionToken: "receipt", verifier: "proof" },
    pendingConnections: [
      { deviceId: "till", addresses: [lan], code, enrolmentId: "approval" },
    ],
  });
  await access.session.refreshConnections();
  assert.equal(proofs, 1);
  assert.equal(f.vault().connections, undefined);
  delivered = true;
  time += 11000;
  await access.session.refreshConnections();
  assert.equal(proofs, 2);
  assert.equal(f.vault().token, "access");
  assert.equal(f.vault().connections[0].token, "local-token");
  assert.equal(f.vault().pendingConnections, undefined);
});
test("parallel local requests share one refresh rotation and refusal cannot fall through to cloud", async () => {
  for (const refused of [false, true]) {
    const f = fixture(),
      lan = "http://192.168.1.20:5555/api";
    let renewals = 0,
      cloudWrites = 0;
    const access = createAccess(
      f.plugin,
      f.storage,
      async (url, options) => {
        const body = options.body && JSON.parse(options.body);
        if (url.endsWith("/route-proof"))
          return {
            ok: true,
            json: async () => ({
              proof: require("node:crypto")
                .createHmac(
                  "sha256",
                  url.startsWith(lan) ? "local-key" : "cloud-key",
                )
                .update(body.nonce)
                .digest("hex"),
            }),
          };
        if (url.endsWith("/refresh")) {
          renewals++;
          await new Promise((r) => setTimeout(r, 10));
          return refused
            ? {
                ok: false,
                status: 403,
                json: async () => ({ error: { message: "Device revoked" } }),
              }
            : {
                ok: true,
                json: async () => ({
                  ...f.grant,
                  token: "local-new",
                  refreshToken: body.nextToken,
                  routeKey: "local-key",
                  sessionId: "local-session",
                }),
              };
        }
        if (!url.startsWith(lan)) cloudWrites++;
        return { ok: true, json: async () => ({ ok: true }) };
      },
      webcrypto,
    );
    await access.session.start({
      ...f.grant,
      routeKey: "cloud-key",
      connections: [
        {
          ...f.grant,
          base: lan,
          routeKey: "local-key",
          sessionId: "local-session",
          expiresAt: 1,
        },
      ],
    });
    const results = await Promise.allSettled([
      access.session.request("/sales/getOrderHistory", { method: "POST" }),
      access.session.request("/sales/getOrderHistory", { method: "POST" }),
    ]);
    assert.equal(renewals, 1);
    assert.equal(cloudWrites, 0);
    assert.ok(
      results.every((r) => r.status === (refused ? "rejected" : "fulfilled")),
    );
  }
});


test("foreground restore waits for an unfinished native lock before authenticated reads", async () => {
  const f = fixture();
  let finishLock, lockStarted;
  const started = new Promise(resolve => { lockStarted = resolve; });
  const originalLock = f.plugin.lock;
  f.plugin.lock = async () => {
    lockStarted();
    await new Promise(resolve => { finishLock = resolve; });
    await originalLock();
  };
  const calls = [];
  const access = createAccess(f.plugin, f.storage, async (url, options) => {
    calls.push({url, authorization:options.headers.Authorization});
    return {ok:true,json:async()=>({status:true})};
  }, webcrypto);
  await access.session.start(f.grant);
  const hiding = access.session.suspend();
  await started;
  const showing = access.resume();
  const reading = access.session.request('/captain/v1/session', {method:'GET'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0);
  finishLock();
  await Promise.all([hiding, showing, reading]);
  assert.equal(access.session.active, true);
  assert.equal(access.session.managed, true);
  assert.equal(calls[0].authorization, 'Bearer access');
  assert.equal(f.vault().token, 'access');
});

test("requests while suspended do not mistake an empty session for an offline server", async () => {
  const f=fixture(); let calls=0;
  const access=createAccess(f.plugin,f.storage,async()=>{calls++;throw Error('unexpected network');},webcrypto);
  await access.session.start(f.grant);
  await access.session.suspend();
  await assert.rejects(access.session.request('/captain/v1/session',{method:'GET'}),error=>error.code==='PIN_LOCKED');
  assert.equal(calls,0);
  await access.resume();
  assert.equal(access.session.token,'access');
});


test("rapid background-foreground-background changes remain suspended until the final resume", async()=>{
  const f=fixture();const access=createAccess(f.plugin,f.storage,async()=>({ok:true,json:async()=>({})}),webcrypto);
  await access.session.start(f.grant);
  await Promise.all([access.session.suspend(),access.resume(),access.session.suspend()]);
  await assert.rejects(access.session.whenReady(),error=>error.code==='PIN_LOCKED');
  await access.resume();
  await access.session.whenReady();
  assert.equal(access.session.token,'access');
});


test("a request interrupted by backgrounding cannot report a new foreground session offline", async()=>{
  const f=fixture();let failRequest,started;
  const sent=new Promise(resolve=>{started=resolve;});
  const access=createAccess(f.plugin,f.storage,async()=>{
    started();return new Promise((resolve,reject)=>{failRequest=reject;});
  },webcrypto);
  await access.session.start(f.grant);
  const old=access.session.request('/captain/v1/session',{method:'GET'});
  const rejected=assert.rejects(old,error=>error.code==='PIN_LOCKED');
  await sent;
  await access.session.suspend();
  await access.resume();
  failRequest(Error('socket closed while asleep'));
  await rejected;
  assert.equal(access.session.token,'access');
  assert.equal(access.session.needsReconnect,false);
});


test("a discovery proof finishing after a shop change cannot authorize an address for the new shop", async()=>{
  const f=fixture(), key='a'.repeat(64), candidate='http://192.168.1.44:42590/api';
  let release, notify;
  const started=new Promise(resolve=>{notify=resolve;});
  const access=createAccess(f.plugin,f.storage,async (url,options)=>{
    const nonce=JSON.parse(options.body).nonce;
    notify();await new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>({proof:require('node:crypto').createHmac('sha256',key).update(nonce).digest('hex')})};
  },webcrypto);
  await access.session.start({...f.grant,routeKey:key});
  const pending=access.session.addAddress(candidate);
  const rejected=assert.rejects(pending);
  await started;
  await access.session.start({...f.grant,shopKey:'another-shop',routeKey:'b'.repeat(64)});
  release();await rejected;
  assert.equal(access.session.allowsBase(candidate),false);
  assert.equal(f.vault().shopKey,'another-shop');
  assert.equal(f.vault().routes,undefined);
});

test("profile refresh only changes the current user's display name and persists it", async () => {
 const f=fixture();const access=createAccess(f.plugin,f.storage,async()=>{},webcrypto);
 await access.session.start(f.grant);
 const user=access.session.user;
 assert.equal(await access.session.updateProfile({id:'another-user',name:'Wrong person'}),false);
 assert.deepEqual(access.session.user,user);
 assert.equal(await access.session.updateProfile({id:user.id||user._id,name:'Updated name',role:'admin'}),true);
 assert.deepEqual(access.session.user,{...user,name:'Updated name'});
 const restored=createAccess(f.plugin,f.storage,async()=>{},webcrypto);await restored.ready;
 assert.equal(restored.session.user.name,'Updated name');
});


test("cancelled address verification cannot persist a late proof or try another credential", async()=>{
  const f=fixture(), key='a'.repeat(64), candidate='http://192.168.1.44:42590/api';
  let release, notify, calls=0, requestSignal;
  const started=new Promise(resolve=>{notify=resolve;});
  const access=createAccess(f.plugin,f.storage,async (url,options)=>{
    calls++;requestSignal=options.signal;
    const nonce=JSON.parse(options.body).nonce;
    notify();await new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>({proof:require('node:crypto').createHmac('sha256',key).update(nonce).digest('hex')})};
  },webcrypto);
  await access.session.start({...f.grant,routeKey:key,connections:[{...f.grant,routeKey:key}]});
  const abort=new AbortController();
  const pending=access.session.addAddress(candidate,abort.signal);
  const rejected=assert.rejects(pending,/cancelled/);
  await started;abort.abort();
  assert.equal(requestSignal.aborted,true);
  release();await rejected;
  assert.equal(calls,1);
  assert.equal(access.session.allowsBase(candidate),false);
  assert.equal(f.vault().routes,undefined);
  assert.equal(f.vault().connections[0].routes,undefined);
});


for (const existing of [undefined, ['https://previous.example/api']])
  test(`failed route storage preserves previous addresses and can retry (${!!existing})`, async()=>{
    const f=fixture(), key='c'.repeat(64), candidate='http://192.168.1.55:42590/api';
    let proofs=0;
    const access=createAccess(f.plugin,f.storage,async (url,options)=>{
      proofs++;
      return {ok:true,json:async()=>({proof:require('node:crypto').createHmac('sha256',key)
        .update(JSON.parse(options.body).nonce).digest('hex')})};
    },webcrypto);
    await access.session.start({...f.grant,routeKey:key,routes:existing,connections:[{...f.grant,routeKey:key}]});
    const save=f.plugin.save;
    f.plugin.save=async()=>{throw Error('Secure storage unavailable');};
    await assert.rejects(access.session.addAddress(candidate),/Secure storage unavailable/);
    assert.equal(proofs,1);
    assert.equal(access.session.allowsBase(candidate),false);
    assert.deepEqual(f.vault().routes,existing);
    f.plugin.save=save;
    // An unrelated save must not accidentally persist the failed candidate.
    await access.session.updateProfile({id:'staff',name:'Updated'});
    assert.deepEqual(f.vault().routes,existing);
    await access.session.addAddress(candidate);
    assert.equal(access.session.allowsBase(candidate),true);
    assert.deepEqual(f.vault().routes,[...(existing||[]),candidate]);
    assert.equal(access.session.user.id,'staff');
  });


test('cloud order fallback requires consent before transmitting the order', async () => {
 const f=fixture(), lan='http://192.168.1.20:5555/api',cloud='https://shop.example/api',routeKey='a'.repeat(64);
 let agree=false;const writes=[];const previous=globalThis.POSNIC;
 globalThis.POSNIC={server:{adopt(){},remember(){},recordShop(){}},net:{setOnline(){},setOffline(){}},internetChoice:{ask:async base=>base===lan||agree}};
 try {
  const access=createAccess(f.plugin,f.storage,async(url,options)=>{
   const body=JSON.parse(options.body||'{}');
   if(url.endsWith('/route-proof'))return {ok:true,json:async()=>({proof:require('node:crypto').createHmac('sha256',routeKey).update(body.nonce).digest('hex')})};
   writes.push({url,body});if(url.startsWith(lan))throw Error('Wi-Fi unavailable');
   return {ok:true,json:async()=>({type:'success'})};
  },webcrypto);
  await access.session.start({...f.grant,base:lan,routeKey,routes:[cloud],idempotentOrders:true});
  const options={method:'POST',body:{idempotencyKey:'saved-order',items:[1]}};
  await assert.rejects(access.session.request('/sales/qrOrder',options));
  assert.equal(writes.filter(w=>w.url.startsWith(cloud)).length,0);
  agree=true;
  await access.session.request('/sales/qrOrder',options);
  assert.equal(writes.filter(w=>w.url.startsWith(cloud)).length,1);
  assert.deepEqual(writes[0].body,writes.at(-1).body);
 }finally {if(previous===undefined)delete globalThis.POSNIC;else globalThis.POSNIC=previous;}
});
