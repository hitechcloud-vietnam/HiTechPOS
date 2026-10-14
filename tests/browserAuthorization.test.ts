import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_RETURN_URL,
  completeBrowserAuthorization,
} from "../src/services/browserAuthorization";
const signal = () => new AbortController().signal;
test("approved browser callback completes without another sign-in action", async () => {
  await completeBrowserAuthorization(
    async () => ({
      type: "success",
      url: AUTH_RETURN_URL + "?result=approved",
    }),
    () => {},
    signal(),
  );
});
test("old server return link remains compatible", async () => {
  await completeBrowserAuthorization(
    async () => ({ type: "success", url: AUTH_RETURN_URL }),
    () => {},
    signal(),
  );
});
for (const type of ["cancel", "dismiss"])
  test(`browser ${type} does not complete login`, async () => {
    await assert.rejects(
      completeBrowserAuthorization(
        async () => ({ type }),
        () => {},
        signal(),
      ),
      /authorizationCancelled/,
    );
  });
test("denial cannot complete login", async () => {
  await assert.rejects(
    completeBrowserAuthorization(
      async () => ({
        type: "success",
        url: AUTH_RETURN_URL + "?result=denied",
      }),
      () => {},
      signal(),
    ),
    /authorizationCancelled/,
  );
});
for (const url of [
  "https://example.com/authorized",
  "com.posnic.mobile://other",
  "com.posnic.mobile://authorized/evil",
  "com.posnic.mobile://user@authorized",
])
  test(`reject unexpected callback ${url}`, async () => {
    await assert.rejects(
      completeBrowserAuthorization(
        async () => ({ type: "success", url }),
        () => {},
        signal(),
      ),
      /invalidServer/,
    );
  });
test("abort closes pending authentication and ignores a late return", async () => {
  const controller = new AbortController();
  let dismissed = 0;
  let finish!: (v: { type: string; url: string }) => void;
  const result = completeBrowserAuthorization(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => {
      dismissed++;
    },
    controller.signal,
  );
  controller.abort();
  await assert.rejects(result, /authorizationCancelled/);
  assert.equal(dismissed, 1);
  finish({ type: "success", url: AUTH_RETURN_URL });
});
test("pre-aborted request never opens browser", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    completeBrowserAuthorization(
      async () => {
        throw Error("must not open");
      },
      () => {},
      controller.signal,
    ),
    /authorizationCancelled/,
  );
});
