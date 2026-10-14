import { AppState, Platform } from "react-native";
import { waitForForeground } from "../services/foreground";

export const foreground = (signal: AbortSignal) =>
  waitForForeground(
    {
      isActive: () =>
        Platform.OS === "web" || AppState.currentState === "active",
      subscribe: (listener) => {
        const subscription = AppState.addEventListener("change", listener);
        return () => subscription.remove();
      },
    },
    signal,
  );
