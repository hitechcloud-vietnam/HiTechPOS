// Browser is an evaluation surface. Never persist bearer credentials in web storage.
import { vault } from "./vault";
export const credentials = {
  deviceId: async () => vault.deviceId(),
  get: async (server?: string) =>
    server ? ((await vault.accountFor(server))?.token ?? null) : vault.token(),
  set: async (value: string) => {
    await vault.setToken(value);
  },
};
