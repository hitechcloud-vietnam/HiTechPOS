import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { BiometricVault } from "../services/biometricVault";
import { vault } from "./vault";
import { t } from "../i18n";
const protectedOptions = {
  keychainService: "com.posnic.business.biometric",
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  requireAuthentication: true,
};
const markerOptions = {
  keychainService: "com.posnic.business.biometric-preference",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export async function supportsBiometrics() {
  return (
    Platform.OS !== "web" &&
    (await LocalAuthentication.hasHardwareAsync()) &&
    (await LocalAuthentication.getEnrolledLevelAsync()) ===
      LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG
  );
}
export const biometrics = new BiometricVault(
  {
    get: (key) =>
      SecureStore.getItemAsync(key, {
        ...protectedOptions,
        authenticationPrompt: t("biometricPrompt"),
      }),
    set: (key, value) =>
      SecureStore.setItemAsync(key, value, {
        ...protectedOptions,
        authenticationPrompt: t("biometricPrompt"),
      }),
    remove: (key) => SecureStore.deleteItemAsync(key, protectedOptions),
  },
  {
    get: (key) => SecureStore.getItemAsync(key, markerOptions),
    set: (key, value) => SecureStore.setItemAsync(key, value, markerOptions),
    remove: (key) => SecureStore.deleteItemAsync(key, markerOptions),
  },
  () => vault.biometricBinding(),
);
