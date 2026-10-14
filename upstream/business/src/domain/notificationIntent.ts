/** Push is a navigation hint, never a credential, URL or approval command. */
export function notificationIntent(value: unknown): "inbox" | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  return Object.keys(data).sort().join(",") === "eventId,kind" &&
    data.kind === "business-inbox" &&
    typeof data.eventId === "string" &&
    /^[a-f\d]{24}$/.test(data.eventId)
    ? "inbox"
    : null;
}
