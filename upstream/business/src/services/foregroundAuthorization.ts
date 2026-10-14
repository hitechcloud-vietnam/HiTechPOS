import type { Session } from "./authorization";

/** Approval may arrive while the system browser covers the app. Delivering it
 * then mounts PIN setup under the privacy lock and can immediately revoke the
 * new session. Keep it in memory until the app is actually foregrounded. */
export function foregroundAuthorization({
  active,
  deliver,
  discard,
}: {
  active: () => boolean;
  deliver: (session: Session) => void;
  discard: (session: Session) => void;
}) {
  let pending: Session | null = null;
  let disposed = false;
  function resume() {
    if (disposed || !pending || !active()) return;
    const session = pending;
    pending = null;
    deliver(session);
  }
  return {
    offer(session: Session) {
      if (disposed) {
        discard(session);
        return;
      }
      if (pending) discard(pending);
      pending = session;
      resume();
    },
    resume,
    dispose() {
      disposed = true;
      if (pending) discard(pending);
      pending = null;
    },
  };
}
