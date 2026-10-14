import { insightText } from "../i18n/insights";
import { useLocale } from "../i18n/useLocale";
import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
  useColorScheme,
} from "react-native";
import { Button, Card } from "./ui";
import { BusinessNavigation } from "./BusinessNavigation";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePushSettings } from "./usePushSettings";
import { listenPush } from "../platform/push";
import { type Session, revokeSession } from "../services/authorization";
import { createReportingClient } from "../services/businessConnection";
import {
  type Credential,
  VaultError,
  validPin,
} from "../services/sessionVault";
import { vault, supportsRememberedSession } from "../platform/vault";
import { biometrics, supportsBiometrics } from "../platform/biometrics";
import { businessFetch } from "../platform/network";
import { type BusinessContext } from "../domain/contracts";
import { t, getTextAlign } from "../i18n";
import { clearConfirmation } from "../services/pendingConfirmation";
import { pinInput } from "../i18n/digits";
import {
  readLockDelay,
  writeLockDelay,
  type LockDelay,
} from "../platform/securityPreferences";

export function AccountScreen({
  initialSession,
  onExit,
  onSessionConsumed,
}: {
  initialSession: Session | null;
  onExit: (message?: string) => void;
  onSessionConsumed: () => void;
}) {
  useLocale();
  const [credential, setCredential] = useState<Credential | null>(
    initialSession
      ? {
          origin: initialSession.origin,
          token: initialSession.token,
          expiresAt: initialSession.expiresAt,
          authorizationOrigin:
            initialSession.authorizationOrigin ?? initialSession.origin,
        }
      : null,
  );
  const [context, setContext] = useState<BusinessContext | null>(
    initialSession?.context ?? null,
  );
  const [stage, setStage] = useState<"setup" | "locked" | "active">(
    initialSession
      ? supportsRememberedSession
        ? "setup"
        : "active"
      : "locked",
  );
  const [pin, setPin] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [inboxIntent, setInboxIntent] = useState(0);
  const [pinEnabled, setPinEnabled] = useState(true);
  const [pinAction, setPinAction] = useState<
    "change" | "disable" | "enable" | null
  >(null);
  const [currentPin, setCurrentPin] = useState("");
  const [securityLoaded, setSecurityLoaded] = useState(false);
  const [lockDelay, setLockDelay] = useState<LockDelay>(0);
  const lockDelayRef = useRef<LockDelay>(0),
    backgroundAt = useRef<number | null>(null),
    lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [biometricReady, setBiometricReady] = useState(false),
    [biometricEnabled, setBiometricEnabled] = useState(false),
    [foreground, setForeground] = useState(AppState.currentState === "active");
  const nativePrompt = useRef(false);
  const push = usePushSettings(credential, nativePrompt, lock);
  const renewPush = useRef(push.renew);
  renewPush.current = push.renew;
  useEffect(
    () =>
      listenPush(
        () => setInboxIntent((value) => value + 1),
        () => renewPush.current(),
      ),
    [],
  );
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  const live = useRef({ stage, credential });
  live.current = { stage, credential };
  const exit = useRef(onExit);
  exit.current = onExit;
  const dark = useColorScheme() === "dark",
    ink = dark ? "#eef5fa" : "#172b37";
  const text = [styles.text, { color: ink, textAlign: getTextAlign() }],
    title = [styles.title, { color: ink, textAlign: getTextAlign() }];
  function lock(reason: "background" | "accessLoss" = "accessLoss") {
    nativePrompt.current = false;
    // Keep only the generic destination across privacy locking. The unlocked
    // screen must still load fresh account/branch permissions before navigation.
    if (reason !== "background") setInboxIntent(0);
    generation.current++;
    controller.current?.abort();
    vault.lock();
    biometrics.lock();
    setCredential(null);
    setContext(null);
    setPin("");
    setConfirm("");
    setCurrentPin("");
    setPinAction(null);
    setSecurityLoaded(false);
    setMessage("");
    setBusy(false);
    setStage("locked");
  }
  useEffect(() => {
    onSessionConsumed();
    void readLockDelay()
      .then((value) => {
        lockDelayRef.current = value;
        setLockDelay(value);
      })
      .catch(() => {});
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
      if (state === "active") {
        if (lockTimer.current) clearTimeout(lockTimer.current);
        if (
          backgroundAt.current !== null &&
          Date.now() - backgroundAt.current >= lockDelayRef.current
        )
          lock("background");
        backgroundAt.current = null;
        return;
      }
      // iOS marks the app inactive while its biometric prompt is visible.
      // The privacy cover remains visible; a true background event still locks.
      if (state === "inactive" && nativePrompt.current) return;
      const current = live.current;
      if (
        current.stage === "active" &&
        supportsRememberedSession &&
        lockDelayRef.current > 0
      ) {
        if (backgroundAt.current === null) backgroundAt.current = Date.now();
        if (lockTimer.current) clearTimeout(lockTimer.current);
        lockTimer.current = setTimeout(
          () => lock("background"),
          Math.max(
            0,
            lockDelayRef.current - (Date.now() - backgroundAt.current),
          ),
        );
      } else lock("background");
      if (!supportsRememberedSession || current.stage === "setup") {
        if (current.credential)
          void revokeSession(current.credential, {
            fetcher: businessFetch,
          }).catch(() => {});
        exit.current();
      }
    });
    return () => {
      generation.current++;
      controller.current?.abort();
      vault.lock();
      biometrics.lock();
      subscription.remove();
      if (lockTimer.current) clearTimeout(lockTimer.current);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const available = await supportsBiometrics();
        // A lost biometric enrollment must not silently fall back to an
        // unprotected session when PIN has been explicitly disabled.
        const enabled = await biometrics.isEnabled();
        const hasPin = supportsRememberedSession
          ? await vault.pinEnabled()
          : false;
        if (!cancelled) {
          setPinEnabled(hasPin);
          setBiometricReady(available);
          setBiometricEnabled(enabled);
          setSecurityLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setBiometricReady(false);
          setBiometricEnabled(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage]);
  useEffect(() => {
    if (
      stage === "locked" &&
      foreground &&
      securityLoaded &&
      !pinEnabled &&
      !biometricEnabled
    ) {
      setSecurityLoaded(false);
      void unlockOrEnroll();
    }
  }, [stage, foreground, securityLoaded, pinEnabled, biometricEnabled]);
  async function unlockOrEnroll(useBiometrics = false) {
    if (busy) return;
    if (stage === "setup" && (!validPin(pin) || pin !== confirm)) {
      setMessage(t(pin !== confirm ? "pinMismatch" : "pinWeak"));
      return;
    }
    setBusy(true);
    setMessage("");
    const current = generation.current,
      request = new AbortController();
    controller.current = request;
    nativePrompt.current = useBiometrics;
    try {
      if (stage === "setup" && credential) {
        await vault.enroll(credential, pin);
        if (current === generation.current) {
          setStage("active");
          setPin("");
          setConfirm("");
        }
      } else {
        const saved = useBiometrics
          ? await biometrics.unlock()
          : pinEnabled
            ? await vault.unlock(pin)
            : await vault.unlockWithoutPin();
        if (current !== generation.current) return;
        const fresh = await createReportingClient(saved.origin, saved.token, {
          fetcher: businessFetch,
          signal: request.signal,
        }).context();
        if (current === generation.current) {
          setCredential(saved);
          setContext(fresh);
          setStage("active");
          setPin("");
        }
      }
    } catch (error) {
      if (current === generation.current) {
        setPin("");
        setConfirm("");
        setMessage(
          t(
            error instanceof VaultError
              ? error.code
              : useBiometrics
                ? "biometricUnavailable"
                : "accountUnavailable",
          ),
        );
      }
    } finally {
      nativePrompt.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  async function changeBiometrics() {
    if (busy || !credential) return;
    setBusy(true);
    setMessage("");
    nativePrompt.current = true;
    const current = generation.current;
    try {
      if (biometricEnabled) await biometrics.disable();
      else await biometrics.enable(credential);
      if (current === generation.current)
        setBiometricEnabled(await biometrics.isEnabled());
    } catch {
      if (current === generation.current) setMessage(t("biometricUnavailable"));
    } finally {
      nativePrompt.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  async function savePinSettings() {
    if (busy || !credential || !pinAction) return;
    if (pinAction !== "disable" && (!validPin(pin) || pin !== confirm)) {
      setMessage(t(pin !== confirm ? "pinMismatch" : "pinWeak"));
      return;
    }
    setBusy(true);
    setMessage("");
    const run = generation.current;
    try {
      if (pinAction === "disable") await vault.disablePin(currentPin);
      else {
        if (pinEnabled) await vault.unlock(currentPin);
        if (run !== generation.current) return;
        await vault.enroll(credential, pin);
        // Enrollment rotates the biometric binding; explicit opt-in is required again.
        await biometrics.disable();
      }
      if (run !== generation.current) return;
      setPinEnabled(await vault.pinEnabled());
      setBiometricEnabled(await biometrics.isEnabled());
      setPinAction(null);
      setCurrentPin("");
      setPin("");
      setConfirm("");
    } catch (error) {
      if (run === generation.current)
        setMessage(
          t(error instanceof VaultError ? error.code : "storageUnavailable"),
        );
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  async function signOut() {
    if (busy) return;
    setBusy(true);
    clearConfirmation();
    const saved = credential;
    lock();
    let remoteFailed = false;
    try {
      if (saved) await revokeSession(saved, { fetcher: businessFetch });
    } catch {
      remoteFailed = true;
    }
    try {
      if (supportsRememberedSession) {
        await vault.forget();
        await biometrics.disable();
      }
      exit.current(remoteFailed ? t("localSignOutOnly") : undefined);
    } catch {
      setMessage(t("storageUnavailable"));
    }
  }
  if (!foreground && stage !== "active")
    return (
      <AuthFrame>
        <Card>
          <Text style={title}>{t("appName")}</Text>
          <Text style={text}>{t("privacyCover")}</Text>
        </Card>
      </AuthFrame>
    );
  if (stage !== "active")
    return (
      <AuthFrame>
        <Card>
          <Text accessibilityRole="header" style={title}>
            {t(stage === "setup" ? "createPin" : "unlockBusiness")}
          </Text>
          <Text style={text}>
            {t(
              stage === "setup"
                ? "createPinHelp"
                : pinEnabled
                  ? "unlockHelp"
                  : "unlockBusiness",
            )}
          </Text>
          {(stage === "setup" || pinEnabled) && (
            <TextInput
              accessibilityLabel={t("sixDigitPin")}
              placeholder={t("sixDigitPin")}
              placeholderTextColor={dark ? "#b1c1cb" : "#566a77"}
              value={pin}
              onChangeText={(value) => setPin(pinInput(value))}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="off"
              style={[styles.input, { color: ink }]}
            />
          )}
          {stage === "setup" && (
            <TextInput
              accessibilityLabel={t("confirmPin")}
              placeholder={t("confirmPin")}
              placeholderTextColor={dark ? "#b1c1cb" : "#566a77"}
              value={confirm}
              onChangeText={(value) => setConfirm(pinInput(value))}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="off"
              style={[styles.input, { color: ink }]}
            />
          )}
          {message ? (
            <Text accessibilityRole="alert" style={text}>
              {message}
            </Text>
          ) : null}
          {busy && (
            <ActivityIndicator
              accessibilityLabel={t(
                stage === "setup" ? "savingPin" : "unlocking",
              )}
            />
          )}
          {(stage === "setup" || pinEnabled || !biometricEnabled) && (
            <Button
              label={t(
                busy
                  ? stage === "setup"
                    ? "savingPin"
                    : "unlocking"
                  : stage === "setup"
                    ? "savePin"
                    : "unlock",
              )}
              disabled={
                busy ||
                ((stage === "setup" || pinEnabled) &&
                  ![4, 6].includes(pin.length)) ||
                (stage === "setup" && confirm.length !== pin.length)
              }
              onPress={() => {
                void unlockOrEnroll();
              }}
            />
          )}
          {stage === "locked" && biometricEnabled && (
            <Button
              label={t("unlockBiometrics")}
              secondary
              disabled={busy}
              onPress={() => {
                void unlockOrEnroll(true);
              }}
            />
          )}
          <Button
            label={t("signInAgain")}
            secondary
            disabled={busy}
            onPress={() => {
              void (async () => {
                try {
                  await vault.forget();
                  await biometrics.disable();
                  exit.current();
                } catch {
                  setMessage(t("storageUnavailable"));
                }
              })();
            }}
          />
        </Card>
      </AuthFrame>
    );
  if (!credential || !context)
    return (
      <AuthFrame>
        <Text style={text}>{t("unlockBusiness")}</Text>
      </AuthFrame>
    );
  const security = (
    <>
      <Card>
        <Text style={title}>{insightText("PIN lock")}</Text>
        <Text style={text}>
          {pinEnabled ? insightText("Enabled") : insightText("Disabled")}
        </Text>
        {!pinAction ? (
          <>
            <Button
              label={
                pinEnabled
                  ? insightText("Disable PIN")
                  : insightText("Enable PIN")
              }
              secondary
              disabled={busy}
              onPress={() => {
                setPinAction(pinEnabled ? "disable" : "enable");
                setMessage("");
              }}
            />
            {pinEnabled && (
              <Button
                label={insightText("Change PIN")}
                secondary
                onPress={() => {
                  setPinAction("change");
                  setMessage("");
                }}
              />
            )}
          </>
        ) : (
          <>
            {pinAction === "disable" && (
              <Text style={text}>
                {biometricEnabled
                  ? "Biometric unlock will remain enabled. Your account stays signed in."
                  : "Your account stays signed in. Anyone using this unlocked phone can open the app without a PIN."}
              </Text>
            )}
            {pinEnabled && (
              <TextInput
                accessibilityLabel={insightText("Current PIN")}
                placeholder={insightText("Current PIN")}
                secureTextEntry
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="off"
                value={currentPin}
                onChangeText={(v) => setCurrentPin(pinInput(v))}
                style={[styles.input, { color: ink }]}
              />
            )}
            {pinAction !== "disable" && (
              <>
                <TextInput
                  accessibilityLabel={insightText("New PIN")}
                  placeholder={insightText("New PIN")}
                  secureTextEntry
                  keyboardType="number-pad"
                  maxLength={6}
                  autoComplete="off"
                  value={pin}
                  onChangeText={(v) => setPin(pinInput(v))}
                  style={[styles.input, { color: ink }]}
                />
                <TextInput
                  accessibilityLabel={t("confirmPin")}
                  placeholder={t("confirmPin")}
                  secureTextEntry
                  keyboardType="number-pad"
                  maxLength={6}
                  autoComplete="off"
                  value={confirm}
                  onChangeText={(v) => setConfirm(pinInput(v))}
                  style={[styles.input, { color: ink }]}
                />
              </>
            )}
            <Button
              label={
                pinAction === "disable"
                  ? insightText("Confirm disable PIN")
                  : t("savePin")
              }
              disabled={busy}
              onPress={() => void savePinSettings()}
            />
            <Button
              label={t("cancel")}
              secondary
              disabled={busy}
              onPress={() => {
                setPinAction(null);
                setPin("");
                setConfirm("");
                setCurrentPin("");
                setMessage("");
              }}
            />
          </>
        )}
      </Card>
      <Card>
        <Text style={title}>{t("quickUnlock")}</Text>
        <Text style={text}>{t("biometricHelp")}</Text>
        {biometricReady ? (
          <Button
            label={t(
              biometricEnabled ? "disableBiometrics" : "enableBiometrics",
            )}
            secondary
            disabled={busy}
            onPress={() => void changeBiometrics()}
          />
        ) : (
          <Text style={text}>{t("biometricUnavailable")}</Text>
        )}
      </Card>
      <Card>
        <Text style={title}>{insightText("Auto-lock")}</Text>
        <Text style={text}>
          When the app moves to the background. Reports stay hidden in the app
          switcher.
        </Text>
        {(
          [
            [0, insightText("Immediately")],
            [60000, insightText("After 1 minute")],
            [300000, insightText("After 5 minutes")],
          ] as const
        ).map(([delay, label]) => (
          <Button
            key={delay}
            label={label}
            secondary={lockDelay !== delay}
            disabled={busy}
            onPress={() => {
              void writeLockDelay(delay)
                .then(() => {
                  setLockDelay(delay);
                  lockDelayRef.current = delay;
                })
                .catch(() => setMessage(t("storageUnavailable")));
            }}
          />
        ))}
      </Card>
      {message ? (
        <Text accessibilityRole="alert" style={text}>
          {message}
        </Text>
      ) : null}
    </>
  );
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={!foreground}
        importantForAccessibility={foreground ? "auto" : "no-hide-descendants"}
      >
        <BusinessNavigation
          credential={credential}
          context={context}
          onAccessLost={lock}
          onSignOut={() => void signOut()}
          security={security}
          canLock={pinEnabled || biometricEnabled}
          push={push}
          inboxIntent={inboxIntent}
          onInboxConsumed={() => setInboxIntent(0)}
        />
      </View>
      {!foreground && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: dark ? "#101e26" : "#f5f7f8",
              justifyContent: "center",
              padding: 24,
            },
          ]}
          accessibilityViewIsModal
        >
          <Text style={title}>{t("appName")}</Text>
          <Text style={text}>{t("privacyCover")}</Text>
        </View>
      )}
    </View>
  );
}
function AuthFrame({ children }: { children: React.ReactNode }) {
  const dark = useColorScheme() === "dark";
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ flex: 1, backgroundColor: dark ? "#101e26" : "#f5f7f8" }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 22, gap: 16 }}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 25, lineHeight: 31, fontWeight: "700" },
  text: { fontSize: 15, lineHeight: 23 },
  input: {
    writingDirection: "ltr",
    textAlign: "left",
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#a5b7c2",
    borderRadius: 12,
    padding: 14,
    fontSize: 22,
    letterSpacing: 5,
  },
});
