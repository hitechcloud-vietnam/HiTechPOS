import { openStorage } from "../data/storage.web";
import type { ImageFiles } from "../services/imageCache";
export const imageFetch: typeof fetch = (...args) => fetch(...args);
export const imageFiles: ImageFiles = {
  async prune(keep) {
    const store = await openStorage();
    const keys = await store.keys!("image:");
    await store.batch(
      keys
        .filter((key) => !keep.has(key.slice(6)))
        .map((key) => ({ key, value: null })),
    );
  },
  async get(key) {
    return (await openStorage()).get<string>("image:" + key);
  },
  async put(key, bytes, mime) {
    const capacity = await navigator.storage?.estimate?.();
    if (
      capacity?.quota !== undefined &&
      capacity.usage !== undefined &&
      capacity.quota - capacity.usage < 100 * 1048576 + bytes.byteLength * 2
    )
      throw Error("storageUnavailable");
    const uri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: mime }));
    });
    await (await openStorage()).batch([{ key: "image:" + key, value: uri }]);
    return uri;
  },
};
