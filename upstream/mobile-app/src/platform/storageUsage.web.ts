export async function storageUsage() {
  if (!navigator.storage?.estimate) return null;
  const info = await navigator.storage.estimate();
  if (info.usage === undefined || info.quota === undefined) return null;
  return { used: info.usage, available: Math.max(0, info.quota - info.usage) };
}
