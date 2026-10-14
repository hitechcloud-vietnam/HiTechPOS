import { Directory, File, Paths } from "expo-file-system";
import { defaultDatabaseDirectory } from "expo-sqlite";

export async function storageUsage() {
  let used = 0;
  for (const name of ["posnic.db", "posnic.db-wal", "posnic.db-shm"]) {
    const file = new File(defaultDatabaseDirectory, name);
    if (file.exists) used += file.size;
  }
  const images = new Directory(Paths.document, "posnic-product-images");
  if (images.exists) used += images.size ?? 0;
  return { used, available: Paths.availableDiskSpace };
}
