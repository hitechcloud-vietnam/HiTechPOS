import { VaultError } from "../services/sessionVault";
// Remembered credentials are deliberately unavailable in the web preview.
export async function derivePinKey(
  _pin: string,
  _saltAndSecret: string,
): Promise<Uint8Array> {
  throw new VaultError("storageUnavailable");
}
export const deriveLegacyPinKey = derivePinKey;
