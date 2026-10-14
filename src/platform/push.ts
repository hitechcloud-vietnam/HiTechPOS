import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { listenForInboxNotifications } from "../services/pushResponses";
import { t, translator } from "../i18n";
import { createPushChannelUpdater } from "../services/pushChannel";
const channelDefinitions = [
  ["business-updates", "phoneNotifications"],
  ["business-decisions", "approvals"],
  ["business-summaries", "summaryNotifications"],
  ["business-stock", "stockAlerts"],
] as const;
const channelUpdaters = channelDefinitions.map(([id, label]) =>
  createPushChannelUpdater({
    read: () => Notifications.getNotificationChannelAsync(id),
    name: () => t(label),
    defaultImportance: Notifications.AndroidImportance.DEFAULT,
    // A muted legacy channel must not become audible after an app upgrade.
    initialImportance:
      id === "business-updates"
        ? undefined
        : async () =>
            (
              await Notifications.getNotificationChannelAsync(
                "business-updates",
              )
            )?.importance,
    async write(name, importance, create) {
      await Notifications.setNotificationChannelAsync(id, {
        name,
        importance,
        ...(create
          ? {
              lockscreenVisibility:
                Notifications.AndroidNotificationVisibility.PRIVATE,
            }
          : {}),
      });
    },
  }),
);
async function updateChannels(create = false, separate = false) {
  // Finish every required native channel before advertising support to the server.
  for (const [index, update] of channelUpdaters.entries()) {
    if (create && !separate && index > 0) continue;
    await update(create);
  }
}
export function watchPushChannelLanguage() {
  if (Platform.OS !== "android") return () => {};
  const refresh = () => {
    void updateChannels().catch(() => {});
  };
  refresh();
  const unsubscribe = translator.subscribe(refresh);
  const foreground = AppState.addEventListener("change", (state) => {
    if (state === "active") refresh();
  });
  return () => {
    unsubscribe();
    foreground.remove();
  };
}
const configuredProject =
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
export const pushProjectId: string | null =
  typeof configuredProject === "string" ? configuredProject : null;
export const supportsPush =
  Device.isDevice &&
  ["ios", "android"].includes(Platform.OS) &&
  !!pushProjectId;
export class PushPermissionError extends Error {}
export async function pushAllowed() {
  if (!supportsPush) return false;
  const permission = await Notifications.getPermissionsAsync();
  return (
    permission.granted ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}
export async function requestPushToken(
  prompt: boolean,
  separateChannels = false,
) {
  if (!supportsPush) throw new Error("push_unavailable");
  if (Platform.OS === "android") await updateChannels(true, separateChannels);
  if (!(await pushAllowed()) && prompt)
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    });
  if (!(await pushAllowed()))
    throw new PushPermissionError("permission_denied");
  const token = (
    await Notifications.getExpoPushTokenAsync({ projectId: pushProjectId! })
  ).data;
  return {
    token,
    projectId: pushProjectId!,
    platform: Platform.OS as "ios" | "android",
  };
}
export function listenPush(openInbox: () => void, tokenChanged: () => void) {
  if (!supportsPush) return () => {};
  let disposed = false;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  const stopResponses = listenForInboxNotifications(
    {
      defaultAction: Notifications.DEFAULT_ACTION_IDENTIFIER,
      subscribe(receive) {
        const subscription =
          Notifications.addNotificationResponseReceivedListener(receive);
        return () => subscription.remove();
      },
      readLast: () => Notifications.getLastNotificationResponseAsync(),
      clearLast: () => Notifications.clearLastNotificationResponseAsync(),
    },
    openInbox,
  );
  const tokens = Notifications.addPushTokenListener(() => {
    if (!disposed) tokenChanged();
  });
  return () => {
    disposed = true;
    stopResponses();
    tokens.remove();
  };
}
