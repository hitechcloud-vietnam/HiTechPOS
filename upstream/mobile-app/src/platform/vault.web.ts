import { SessionVault } from "../services/sessionVault";
// Browser is a UX preview; account/password/PIN secrets never persist to web storage.
const records = new Map<string, string>();
export const vault = new SessionVault(
  {
    get: async (key) => records.get(key) ?? null,
    set: async (key, value) => {
      records.set(key, value);
    },
    remove: async (key) => {
      records.delete(key);
    },
  },
  (length) => crypto.getRandomValues(new Uint8Array(length)),
);
