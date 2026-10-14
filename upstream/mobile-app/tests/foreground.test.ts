import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForForeground } from "../src/services/foreground";

function lifecycle(active: boolean) {
  const listeners = new Set<() => void>();
  return {
    listeners,
    isActive: () => active,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resume() {
      active = true;
      for (const listener of listeners) listener();
    },
  };
}
test("browser grant waits for return from Safari before it can be consumed", async () => {
  const state = lifecycle(false);
  let consumed = false;
  const ready = waitForForeground(state, new AbortController().signal).then(
    () => {
      consumed = true;
    },
  );
  await Promise.resolve();
  assert.equal(consumed, false);
  state.resume();
  await ready;
  assert.equal(consumed, true);
  assert.equal(state.listeners.size, 0);
});
test("cancelled background authorization cannot resume or leak listeners", async () => {
  const state = lifecycle(false);
  const controller = new AbortController();
  const ready = waitForForeground(state, controller.signal);
  controller.abort();
  await assert.rejects(ready, /authorizationCancelled/);
  state.resume();
  assert.equal(state.listeners.size, 0);
  await assert.rejects(
    waitForForeground(state, controller.signal),
    /authorizationCancelled/,
  );
});
test("foreground authorization proceeds immediately without retaining listeners", async () => {
  const state = lifecycle(true);
  await waitForForeground(state, new AbortController().signal);
  assert.equal(state.listeners.size, 0);
});
