import { Linking, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  AUTH_RETURN_URL,
  completeBrowserAuthorization,
} from "../services/browserAuthorization";

export const automaticAuthReturn = Platform.OS !== "web";
export async function openAccountBrowser(url: string, signal: AbortSignal) {
  if (!automaticAuthReturn) {
    await Linking.openURL(url);
    return;
  }
  await completeBrowserAuthorization(
    () => WebBrowser.openAuthSessionAsync(url, AUTH_RETURN_URL),
    () => {
      WebBrowser.dismissAuthSession();
    },
    signal,
  );
}
