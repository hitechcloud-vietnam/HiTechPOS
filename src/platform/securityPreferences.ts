import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
const KEY = "business.auto-lock.v1";
export type LockDelay = 0 | 60000 | 300000;
export async function readLockDelay(): Promise<LockDelay> {
  if (Platform.OS === "web") return 0;
  const n = Number(await SecureStore.getItemAsync(KEY));
  return n === 60000 || n === 300000 ? n : 0;
}
export async function writeLockDelay(delay: LockDelay) {
  if (![0, 60000, 300000].includes(delay)) throw Error("Invalid lock delay");
  if (Platform.OS !== "web") await SecureStore.setItemAsync(KEY, String(delay));
}
