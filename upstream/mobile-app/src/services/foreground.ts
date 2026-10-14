export interface ForegroundState {
  isActive(): boolean;
  subscribe(listener: () => void): () => void;
}

/** Never consume a one-use browser grant while the OS has suspended the app. */
export function waitForForeground(state: ForegroundState, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const cleanup = () => {
      unsubscribe();
      signal.removeEventListener("abort", check);
    };
    const check = () => {
      if (signal.aborted) {
        cleanup();
        reject(new Error("authorizationCancelled"));
      } else if (state.isActive()) {
        cleanup();
        resolve();
      }
    };
    unsubscribe = state.subscribe(check);
    signal.addEventListener("abort", check, { once: true });
    check();
  });
}
