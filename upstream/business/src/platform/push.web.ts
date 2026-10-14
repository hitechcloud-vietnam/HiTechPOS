export const pushProjectId: string | null = null;
export const supportsPush = false;
export function watchPushChannelLanguage() {
  return () => {};
}
export class PushPermissionError extends Error {}
export async function pushAllowed() {
  return false;
}
export async function requestPushToken(
  _prompt: boolean,
  _separateChannels = false,
): Promise<{ token: string; projectId: string; platform: "ios" | "android" }> {
  throw new Error("push_unavailable");
}
export function listenPush(_openInbox: () => void, _tokenChanged: () => void) {
  return () => {};
}
