import { Directory, File, Paths } from "expo-file-system";
import type { ImageFiles } from "../services/imageCache";
import { fetch as imageFetch } from "expo/fetch";
export { imageFetch };
const directory = () => {
  const dir = new Directory(Paths.document, "posnic-product-images");
  dir.create({ idempotent: true, intermediates: true });
  return dir;
};
function file(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("invalidImage");
  return new File(directory(), key);
}
let transfer = 0;
export const imageFiles: ImageFiles = {
  async prune(keep) {
    for (const entry of directory().list()) {
      if (!(entry instanceof File)) continue;
      if (/^[a-f0-9]{64}$/.test(entry.name) && !keep.has(entry.name))
        entry.delete();
      else if (
        /^[a-f0-9]{64}(?:\.\d+-\d+)?\.part$/.test(entry.name) &&
        entry.modificationTime &&
        entry.modificationTime < Date.now() - 300000
      )
        entry.delete();
    }
  },
  async get(key) {
    const target = file(key);
    return target.exists && target.size > 0 ? target.uri : null;
  },
  async put(key, bytes) {
    const target = file(key);
    if (target.exists && target.size > 0) return target.uri;
    if (Paths.availableDiskSpace < 100 * 1024 * 1024 + bytes.byteLength)
      throw Error("storageUnavailable");
    const partial = new File(
      directory(),
      key + "." + Date.now() + "-" + ++transfer + ".part",
    );
    let committed = false;
    try {
      partial.write(bytes);
      partial.move(target);
      committed = true;
      return target.uri;
    } finally {
      if (!committed && partial.exists) partial.delete();
    }
  },
};
