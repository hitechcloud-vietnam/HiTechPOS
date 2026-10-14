import { useLocale } from "../i18n/useLocale";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Text, View, StyleSheet, useColorScheme } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Button, Card } from "./ui";
import { businessFetch } from "../platform/network";
import { proofSource } from "../platform/proof";
import {
  startAuthorization,
  checkAuthorization,
  revokeSession,
  type AuthorizationAttempt,
  type Session,
} from "../services/authorization";
import { foregroundAuthorization } from "../services/foregroundAuthorization";
import { t } from "../i18n";

export function AuthorizationPanel({
  origin,
  onConnected,
  stepUp = false,
  initialAttempt = null,
  onAttempt,
  autoStart = false,
  onCancel,
}: {
  autoStart?: boolean;
  onCancel?: () => void;
  origin: string;
  onConnected: (session: Session) => void;
  stepUp?: boolean;
  initialAttempt?: AuthorizationAttempt | null;
  onAttempt?: (attempt: AuthorizationAttempt | null) => void;
}) {
  useLocale();
  const dark = useColorScheme() === "dark";
  const textStyle = [styles.text, { color: dark ? "#b1c1cb" : "#566a77" }];
  const titleStyle = [styles.title, { color: dark ? "#8bdfbf" : "#146b54" }];
  const codeStyle = [styles.code, { color: dark ? "#8bdfbf" : "#146b54" }];
  const [attempt, setAttempt] = useState<AuthorizationAttempt | null>(
    initialAttempt,
  );
  const [waiting, setWaiting] = useState(!!initialAttempt),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const connected = useRef(onConnected);
  connected.current = onConnected;
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!attempt || !waiting) return;
    const request = new AbortController();
    controller.current = request;
    const delivery = foregroundAuthorization({
      active: () => AppState.currentState === "active",
      deliver: (session) => connected.current(session),
      discard: (session) => {
        void revokeSession(session, { fetcher: businessFetch }).catch(() => {});
      },
    });
    let timer: ReturnType<typeof setTimeout>;
    let checking = false;
    let received = false;
    const check = async () => {
      if (request.signal.aborted || checking || received) return;
      clearTimeout(timer);
      checking = true;
      try {
        const session = await checkAuthorization(attempt, {
          signal: request.signal,
          fetcher: businessFetch,
        });
        if (request.signal.aborted) return;
        if (session) {
          received = true;
          delivery.offer(session);
          try {
            WebBrowser.dismissBrowser();
          } catch {
            /* Android browser closes through system navigation. */
          }
          return;
        }
        timer = setTimeout(check, attempt.interval);
      } catch {
        if (!request.signal.aborted) {
          setError(true);
          setWaiting(false);
          setAttempt(null);
        }
      } finally {
        checking = false;
      }
    };
    const foreground = AppState.addEventListener("change", (state) => {
      delivery.resume();
      // Pick up approval immediately when the browser returns, without
      // overlapping a pending exchange or consuming a one-use grant twice.
      if (state === "active") void check();
    });
    timer = setTimeout(check, attempt.interval);
    return () => {
      request.abort();
      clearTimeout(timer);
      foreground.remove();
      delivery.dispose();
    };
  }, [attempt, waiting]);
  useEffect(() => {
    if (!autoStart) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void begin(true);
    });
    return () => {
      cancelled = true;
    };
  }, [autoStart, origin]);
  async function openApproval(value: AuthorizationAttempt) {
    setWaiting(true);
    try {
      await WebBrowser.openBrowserAsync(value.authorizationUrl);
    } catch {
      setWaiting(false);
      setError(true);
    }
  }
  async function begin(openImmediately = false) {
    if (controller.current && busy) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError(false);
    try {
      const value = await startAuthorization(origin, proofSource, {
        signal: request.signal,
        fetcher: businessFetch,
        stepUp,
      });
      if (!request.signal.aborted) {
        setAttempt(value);
        onAttempt?.(value);
        if (openImmediately) void openApproval(value);
      }
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return (
    <Card>
      <Text style={titleStyle}>
        {t(stepUp ? "confirmIdentity" : "secureSignIn")}
      </Text>
      {!autoStart && (
        <Text style={[textStyle, { writingDirection: "ltr" }]}>{origin}</Text>
      )}
      <Text style={textStyle}>
        {t(stepUp ? "confirmIdentityHelp" : "browserSignInHelp")}
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={textStyle}>
          {t("authorizationFailed")}
        </Text>
      )}
      {attempt ? (
        <View style={{ gap: 12 }}>
          {!autoStart && (
            <>
              <Text style={textStyle}>{t("matchingCode")}</Text>
              <Text selectable style={codeStyle}>
                {attempt.matchingCode}
              </Text>
            </>
          )}
          <Button
            label={t(waiting ? "reopenBrowser" : "openBrowser")}
            onPress={() => {
              setWaiting(true);
              void WebBrowser.openBrowserAsync(attempt.authorizationUrl).catch(
                () => {
                  setWaiting(false);
                  setError(true);
                },
              );
            }}
          />
          {waiting && (
            <Text accessibilityLiveRegion="polite" style={textStyle}>
              {t("waitingApproval")}
            </Text>
          )}
          <Button
            label={t("cancel")}
            secondary
            onPress={() => {
              controller.current?.abort();
              setWaiting(false);
              setAttempt(null);
              onAttempt?.(null);
              setError(false);
              onCancel?.();
            }}
          />
        </View>
      ) : (
        <Button
          label={t(
            busy
              ? "preparingSignIn"
              : stepUp
                ? "confirmIdentity"
                : "secureSignIn",
          )}
          disabled={busy}
          onPress={() => {
            void begin(autoStart);
          }}
        />
      )}
    </Card>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "600", color: "#146b54" },
  text: { fontSize: 14, lineHeight: 21, color: "#667b88" },
  code: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 5,
    color: "#146b54",
    writingDirection: "ltr",
  },
});
