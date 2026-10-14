import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { getRandomBytesAsync } from "expo-crypto";
import { SessionVault, VaultError } from "../services/sessionVault";
import { derivePinKey, deriveLegacyPinKey } from "./pinCrypto";

const options = {
  keychainService: "com.posnic.business.session",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const supportsRememberedSession = Platform.OS !== "web";
const available = () => {
  if (!supportsRememberedSession) throw new VaultError("storageUnavailable");
};
export const vault = new SessionVault(
  {
    async get(key) {
      available();
      return SecureStore.getItemAsync(key, options);
    },
    async set(key, value) {
      available();
      await SecureStore.setItemAsync(key, value, options);
    },
    async remove(key) {
      available();
      await SecureStore.deleteItemAsync(key, options);
    },
  },
  getRandomBytesAsync,
  Date.now,
  derivePinKey,
  deriveLegacyPinKey,
);
