// Only used by pin-qa.yml's isolated application; never the shipping entry point.
import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountScreen } from "../../src/components/AccountScreen";
import { UIContext } from "../../src/components/ui";
import { vault } from "../../src/platform/vault";
import { derivePinKey, deriveLegacyPinKey } from "../../src/platform/pinCrypto";
import { bytesToHex } from "@noble/hashes/utils.js";
import { account } from "./network";

const session = {
  origin: "https://pin-qa.example.test",
  token: "pb1_" + "q".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
  context: account,
};
// Instrument duration without replacing any vault or storage implementation.
for (const method of ["enroll", "unlock"] as const) {
  const original = vault[method].bind(vault) as (
    ...args: any[]
  ) => Promise<any>;
  (vault as any)[method] = async (...args: any[]) => {
    const start = performance.now();
    try {
      return await original(...args);
    } finally {
      console.info(
        "PIN_QA_" +
          method.toUpperCase() +
          "_MS=" +
          Math.round(performance.now() - start),
      );
    }
  };
}
export default function PinQa() {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [exited, setExited] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    void (async () => {
      const started = performance.now();
      const key = await derivePinKey("8264", "01".repeat(48));
      if (
        bytesToHex(key) !==
        "574203076fdb98a4826d51ff3d53c6119c8d96fdc692ad1f1eec0fbdb643cf9e"
      )
        throw new Error("Native KDF known-answer mismatch");
      key.fill(0);
      console.info(
        "PIN_QA_NATIVE_KDF_MS=" + Math.round(performance.now() - started),
      );
      const legacyKey = await deriveLegacyPinKey("826493", "01".repeat(48));
      if (
        bytesToHex(legacyKey) !==
        "74b172e78ce73424e204813461cd39bb2890598536653672348770184577fa29"
      )
        throw new Error("Legacy native KDF known-answer mismatch");
      legacyKey.fill(0);
      setSaved(await vault.hasCredential());
    })().catch((error) => setFailure(String(error)));
  }, []);
  return (
    <SafeAreaProvider>
      <UIContext.Provider
        value={{
          button: { padding: 16, borderRadius: 12, backgroundColor: "#146b54" },
          buttonText: { color: "white", fontSize: 16 },
          secondary: { backgroundColor: "#dde8e4" },
          secondaryText: { color: "#146b54" },
          disabled: { opacity: 0.5 },
          card: {
            padding: 16,
            gap: 14,
            borderRadius: 12,
            backgroundColor: "white",
          },
        }}
      >
        {failure ? (
          <Text>{failure}</Text>
        ) : saved === null ? (
          <Text>Loading PIN test</Text>
        ) : exited ? (
          <Text>Cloud sign-in required</Text>
        ) : (
          <AccountScreen
            initialSession={saved ? null : session}
            onSessionConsumed={() => {}}
            onExit={() => setExited(true)}
          />
        )}
      </UIContext.Provider>
    </SafeAreaProvider>
  );
}
