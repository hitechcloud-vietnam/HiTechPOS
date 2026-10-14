type Channel = { name: string | null; importance: number };

/** Serialize native writes so rapid language changes cannot finish out of order. */
export function createPushChannelUpdater(adapter: {
  read: () => Promise<Channel | null>;
  write: (name: string, importance: number, create: boolean) => Promise<void>;
  name: () => string;
  defaultImportance: number;
  initialImportance?: () => Promise<number | undefined>;
}) {
  let pending = Promise.resolve();
  return (create = false) => {
    const update = pending.then(async () => {
      const existing = await adapter.read();
      if (!existing && !create) return;
      const name = adapter.name();
      if (existing?.name === name) return;
      await adapter.write(
        name,
        existing?.importance ??
          (await adapter.initialImportance?.()) ??
          adapter.defaultImportance,
        !existing,
      );
    });
    // A native error reaches its caller but must not poison later updates.
    pending = update.catch(() => {});
    return update;
  };
}
