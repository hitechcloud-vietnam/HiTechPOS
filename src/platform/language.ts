import * as SecureStore from "expo-secure-store";
const key = "preferred-language";
const options = {
  keychainService: "com.posnic.business.preferences",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export function readLanguage() {
  return SecureStore.getItemAsync(key, options);
}
export function writeLanguage(code: string) {
  return SecureStore.setItemAsync(key, code, options);
}
