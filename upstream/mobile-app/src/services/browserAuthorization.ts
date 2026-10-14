export const AUTH_RETURN_URL = "com.posnic.mobile://authorized";

export async function completeBrowserAuthorization(
  open: () => Promise<{ type: string; url?: string }>,
  dismiss: () => void,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new Error("authorizationCancelled");
  let rejectAbort: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    rejectAbort(new Error("authorizationCancelled"));
    try {
      dismiss();
    } catch {
      /* Browser may already be closing. */
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await Promise.race([open(), cancelled]);
    if (signal.aborted || result.type !== "success" || !result.url)
      throw new Error("authorizationCancelled");
    const url = new URL(result.url);
    if (
      url.protocol !== "com.posnic.mobile:" ||
      url.host !== "authorized" ||
      url.pathname !== "" ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("invalidServer");
    if (url.searchParams.get("result") === "denied")
      throw new Error("authorizationCancelled");
    // Older servers return the same fixed URL without a result. The callback
    // merely wakes the app; only the PKCE-bound token exchange signs it in.
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
