import * as Crypto from "expo-crypto";
import type { ProofSource } from "../services/authorization";

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64url(bytes: Uint8Array) {
  let out = "",
    value = 0,
    bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += alphabet[(value >>> bits) & 63];
    }
  }
  if (bits) out += alphabet[(value << (6 - bits)) & 63];
  return out;
}
export const proofSource: ProofSource = {
  async random() {
    return base64url(await Crypto.getRandomBytesAsync(32));
  },
  async challenge(verifier) {
    const value = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    );
    return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
};
