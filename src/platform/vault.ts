import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { SessionVault } from "../services/sessionVault";
const native =
  Platform.OS === "android" || Platform.OS === "ios"
    ? requireOptionalNativeModule<{
        derivePinKey(pin: string, salt: string): Promise<string>;
      }>(Platform.OS === "ios" ? "PosnicSecurity" : "PosnicPrinter")
    : null;
export const vault = new SessionVault(
  {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: (key) => SecureStore.deleteItemAsync(key),
  },
  (length) => Crypto.getRandomBytes(length),
  native?.derivePinKey
    ? async (pin, salt) =>
        hexToBytes(await native.derivePinKey(pin, bytesToHex(salt)))
    : undefined,
);
