import { notificationIntent } from "../domain/notificationIntent";

/** A native response carries a navigation hint only; authentication stays in the account screen. */
export type InboxNotificationResponse = {
  actionIdentifier: string;
  notification: { request: { content: { data?: unknown } } };
};

export function listenForInboxNotifications(
  adapter: {
    defaultAction: string;
    subscribe: (
      receive: (response: InboxNotificationResponse | null) => void,
    ) => () => void;
    readLast: () => Promise<InboxNotificationResponse | null>;
    clearLast: () => Promise<unknown>;
  },
  openInbox: () => void,
) {
  let disposed = false;
  const receive = (response: InboxNotificationResponse | null) => {
    if (
      disposed ||
      response?.actionIdentifier !== adapter.defaultAction ||
      notificationIntent(response.notification.request.content.data) !== "inbox"
    )
      return;
    openInbox();
    // A native clear failure must not turn an accepted navigation hint into an
    // unhandled rejection. Reopening Inbox still requires a live account scope.
    void Promise.resolve()
      .then(() => adapter.clearLast())
      .catch(() => {});
  };
  const unsubscribe = adapter.subscribe(receive);
  void Promise.resolve()
    .then(() => adapter.readLast())
    .then(receive)
    .catch(() => {});
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
  };
}
