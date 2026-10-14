import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import {
  startAuthorization,
  checkAuthorization,
} from "../src/services/authorization";
import { sampleContext } from "../src/data/sample";
import { CLOUD_ORIGIN } from "../src/services/businessConnection";
const origin = "https://shop.example.com",
  request = "r".repeat(43);
const crypto = {
  async random() {
    return randomBytes(32).toString("base64url");
  },
  async challenge(v: string) {
    return createHash("sha256").update(v).digest("base64url");
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
test("only Cloud may hand off once to a tenant, with proof and without a token", async () => {
  const attempt = {
    origin: CLOUD_ORIGIN,
    request,
    verifier: "v".repeat(43),
    authorizationUrl: "",
    expiresAt: Date.now() + 60000,
    interval: 5000,
    matchingCode: "",
  };
  const calls: string[] = [];
  const session = await checkAuthorization(attempt, {
    fetcher: async (url, options) => {
      calls.push(String(url));
      assert.equal(new Headers(options?.headers).has("authorization"), false);
      assert.equal(
        JSON.parse(String(options?.body)).codeVerifier,
        attempt.verifier,
      );
      if (calls.length === 1)
        return json({ handoff: { origin, request: "h".repeat(43) } });
      assert.equal(JSON.parse(String(options?.body)).request, "h".repeat(43));
      return json({
        token: "pb1_" + "t".repeat(43),
        expiresAt: "2099-01-01T00:00:00.000Z",
        context: sampleContext("manager"),
      });
    },
  });
  assert.equal(session?.origin, origin);
  assert.equal(session?.authorizationOrigin, CLOUD_ORIGIN);
  assert.deepEqual(calls, [
    CLOUD_ORIGIN + "/api/business/v1/token",
    origin + "/api/business/v1/token",
  ]);
  for (const handoffOrigin of [
    "http://shop.example.com",
    CLOUD_ORIGIN,
    origin + "/path",
    origin + "/",
    "https://user:password@shop.example.com",
  ]) {
    let count = 0;
    await assert.rejects(
      checkAuthorization(attempt, {
        fetcher: async () => {
          count++;
          return json({ handoff: { origin: handoffOrigin, request } });
        },
      }),
    );
    assert.equal(count, 1);
  }
  let count = 0;
  await assert.rejects(
    checkAuthorization(
      { ...attempt, origin },
      {
        fetcher: async () => {
          count++;
          return json({
            handoff: { origin: "https://other.example.com", request },
          });
        },
      },
    ),
  );
  assert.equal(count, 1);
  count = 0;
  await assert.rejects(
    checkAuthorization(attempt, {
      fetcher: async () => {
        count++;
        return json({ handoff: { origin, request } });
      },
    }),
  );
  assert.equal(count, 2);
});
test("browser authorization binds its page, verifier and grant to the chosen issuer", async () => {
  let challenge = "";
  const attempt = await startAuthorization(origin, crypto, {
    fetcher: async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      challenge = body.codeChallenge;
      assert.equal(body.deviceName, "Posnic Business");
      assert.equal(body.password, undefined);
      assert.equal(body.stepUp, undefined);
      return json({
        request,
        authorizationUrl:
          origin + "/api/business/v1/authorize?request=" + request,
        expiresIn: 600,
        interval: 5,
      });
    },
  });
  assert.equal(await crypto.challenge(attempt.verifier), challenge);
  assert.equal(attempt.matchingCode, "RRRRRR");
  assert.equal(
    await checkAuthorization(attempt, {
      fetcher: async () =>
        json({ error: { code: "authorization_pending" } }, 202),
    }),
    null,
  );
  const grant = await checkAuthorization(attempt, {
    fetcher: async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.codeVerifier, attempt.verifier);
      return json({
        token: "pb1_" + "t".repeat(43),
        expiresAt: "2099-01-01T00:00:00.000Z",
        context: sampleContext("manager"),
      });
    },
  });
  assert.equal(grant?.origin, origin);
  assert.equal(grant?.authorizationOrigin, origin);
});
test("fresh confirmation asks the original issuer to verify a password without sending one from the phone", async () => {
  await startAuthorization(CLOUD_ORIGIN, crypto, {
    stepUp: true,
    fetcher: async (url, options) => {
      assert.equal(url, CLOUD_ORIGIN + "/api/business/v1/requests");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.stepUp, true);
      assert.deepEqual(Object.keys(body).sort(), [
        "codeChallenge",
        "deviceName",
        "stepUp",
      ]);
      return json({
        request,
        authorizationUrl:
          CLOUD_ORIGIN + "/api/business/v1/authorize?request=" + request,
        expiresIn: 600,
        interval: 5,
      });
    },
  });
});
test("a substituted browser page or password-bearing grant is rejected", async () => {
  await assert.rejects(
    startAuthorization(origin, crypto, {
      fetcher: async () =>
        json({
          request,
          authorizationUrl: "https://attacker.example.com/login",
          expiresIn: 600,
          interval: 5,
        }),
    }),
  );
  const attempt = await startAuthorization(origin, crypto, {
    fetcher: async () =>
      json({
        request,
        authorizationUrl:
          origin + "/api/business/v1/authorize?request=" + request,
        expiresIn: 600,
        interval: 5,
      }),
  });
  await assert.rejects(
    checkAuthorization(attempt, {
      fetcher: async () =>
        json({
          token: "pb1_" + "t".repeat(43),
          expiresAt: "2099-01-01T00:00:00.000Z",
          context: sampleContext("manager"),
          password: "not allowed",
        }),
    }),
  );
});
