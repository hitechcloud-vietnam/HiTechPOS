export const credentials = {
  deviceId: async () => (await import("./vault")).vault.deviceId(),
  get: async (server?: string) => {
    const { vault } = await import("./vault");
    return server
      ? ((await vault.accountFor(server))?.token ?? null)
      : vault.token();
  },
  set: async (token: string) => (await import("./vault")).vault.setToken(token),
};
