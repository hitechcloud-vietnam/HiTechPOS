import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { type Credential } from "../services/sessionVault";
import {
  readPushStatus,
  setPushRegistration,
  type PushStatus,
} from "../services/pushRegistration";
import {
  supportsPush,
  pushProjectId,
  requestPushToken,
  PushPermissionError,
} from "../platform/push";
import { ConnectionError } from "../services/businessConnection";
import { businessFetch } from "../platform/network";
import { t, getLocale } from "../i18n";
import { useLocale } from "../i18n/useLocale";

export function usePushSettings(
  credential: Credential | null,
  nativePrompt: MutableRefObject<boolean>,
  onAccessLost: () => void,
) {
  const locale = useLocale();
  const previousLocale = useRef(locale),
    pendingRenew = useRef(false);
  const latestChange = useRef<(action: "renew") => Promise<void>>(
    async () => {},
  );
  const [status, setStatus] = useState<PushStatus | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null),
    running = useRef(false),
    lost = useRef(onAccessLost);
  lost.current = onAccessLost;
  async function change(action: "load" | "enable" | "disable" | "renew") {
    if (!credential || !supportsPush) return;
    if (running.current) {
      if (action === "renew") pendingRenew.current = true;
      return;
    }
    running.current = true;
    setBusy(true);
    setMessage("");
    const request = new AbortController();
    controller.current = request;
    try {
      const options = { fetcher: businessFetch, signal: request.signal };
      const current = await readPushStatus(credential, options);
      if (request.signal.aborted) return;
      setStatus(current);
      if (action === "disable")
        await setPushRegistration(credential, null, options);
      else if (
        (action === "enable" || current.enabled) &&
        current.available &&
        current.projectId === pushProjectId
      ) {
        nativePrompt.current = action === "enable";
        try {
          const registration = await requestPushToken(
            action === "enable",
            current.channelVersion === 2,
          );
          if (request.signal.aborted) return;
          const selectedLocale = getLocale();
          await setPushRegistration(
            credential,
            {
              ...registration,
              ...(current.channelVersion === 2
                ? { channelVersion: 2 as const }
                : {}),
              ...(current.supportedLanguages?.includes(selectedLocale)
                ? { locale: selectedLocale }
                : {}),
            },
            options,
          );
        } finally {
          if (controller.current === request) nativePrompt.current = false;
        }
      }
      const next = await readPushStatus(credential, options);
      if (!request.signal.aborted) setStatus(next);
    } catch (error) {
      if (request.signal.aborted) return;
      if (
        error instanceof ConnectionError &&
        ["signInRequired", "accessChanged"].includes(error.problem)
      )
        lost.current();
      else
        setMessage(
          t(
            error instanceof PushPermissionError
              ? "pushPermissionDenied"
              : "pushUnavailable",
          ),
        );
    } finally {
      if (controller.current === request) {
        running.current = false;
        if (!request.signal.aborted) setBusy(false);
        if (pendingRenew.current && !request.signal.aborted) {
          pendingRenew.current = false;
          void latestChange.current("renew");
        }
      }
    }
  }
  latestChange.current = change;
  useEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    void change("renew");
  }, [locale]);
  useEffect(() => {
    setStatus(null);
    setMessage("");
    void change("load");
    return () => {
      controller.current?.abort();
      controller.current = null;
      running.current = false;
      pendingRenew.current = false;
    };
  }, [credential]);
  return {
    status,
    busy,
    message,
    available:
      supportsPush &&
      status?.available === true &&
      status.projectId === pushProjectId,
    enable: () => void change("enable"),
    disable: () => void change("disable"),
    refresh: () => void change("load"),
    renew: () => void change("renew"),
  };
}
