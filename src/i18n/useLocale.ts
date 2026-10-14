import { useSyncExternalStore } from "react";
import { translator } from "./index";

/** Rerender text without remounting a screen or losing an in-flight decision. */
export function useLocale() {
  return useSyncExternalStore(
    translator.subscribe,
    translator.getLocale,
    translator.getLocale,
  );
}
