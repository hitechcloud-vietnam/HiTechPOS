import { pbkdf2, scrypt } from "react-native-quick-crypto";
import { hexToBytes } from "@noble/hashes/utils.js";
import { VaultError } from "../services/sessionVault";

export function derivePinKey(
  pin: string,
  saltAndSecret: string,
): Promise<Uint8Array> {
  return derive(pin, saltAndSecret, false);
}

export function deriveLegacyPinKey(
  pin: string,
  saltAndSecret: string,
): Promise<Uint8Array> {
  return derive(pin, saltAndSecret, true);
}

function derive(
  pin: string,
  saltAndSecret: string,
  legacy: boolean,
): Promise<Uint8Array> {
  if (
    !/^(?:[0-9]{4}|[0-9]{6})$/.test(pin) ||
    !/^[a-f0-9]{96}$/.test(saltAndSecret)
  )
    return Promise.reject(new VaultError("storageUnavailable"));
  // The asynchronous C++ implementation performs the unchanged KDF on a worker.
  // No global crypto polyfill or replacement of Expo's network stack is installed.
  return new Promise((resolve, reject) => {
    const salt = hexToBytes(saltAndSecret);
    const done = (error: Error | null, key?: Uint8Array) => {
      salt.fill(0);
      if (error || !key || key.length !== 32) {
        key?.fill(0);
        reject(new VaultError("storageUnavailable"));
      } else {
        const result = Uint8Array.from(key);
        key.fill(0);
        resolve(result);
      }
    };
    if (legacy)
      scrypt(pin, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 67108864 }, done);
    else pbkdf2(pin, salt, 600_000, 32, "sha256", done);
  });
}
