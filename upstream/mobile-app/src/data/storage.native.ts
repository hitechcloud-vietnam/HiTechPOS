import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type { Storage } from "./storage";
import { sqliteStorage } from "./sqliteStorage";

let opening: Promise<Storage> | null = null;
export function openStorage(): Promise<Storage> {
  if (!opening)
    opening = initialize().catch((error) => {
      opening = null;
      throw error;
    });
  return opening;
}
async function initialize(): Promise<Storage> {
  let key = await SecureStore.getItemAsync("posnic.database.key");
  if (!key) {
    key = Array.from(await Crypto.getRandomBytesAsync(32), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    await SecureStore.setItemAsync("posnic.database.key", key);
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("storageUnavailable");
  const db = await SQLite.openDatabaseAsync("posnic.db", {
    useNewConnection: true,
  });
  try {
    await db.execAsync(`PRAGMA key = '${key}';`);
    const cipher = await db.getFirstAsync<Record<string, string>>(
      "PRAGMA cipher_version",
    );
    if (!cipher) throw new Error("nativeBuildRequired");
    await db.execAsync(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); PRAGMA user_version=1;",
    );
    return sqliteStorage(db);
  } catch (error) {
    await db.closeAsync().catch(() => {});
    throw error;
  }
}
