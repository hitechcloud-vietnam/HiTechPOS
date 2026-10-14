import { useLocale } from "../i18n/useLocale";
import React, { useEffect, useRef, useState } from "react";
import { Text, View, useColorScheme } from "react-native";
import { Card, Button } from "./ui";
import { type Credential } from "../services/sessionVault";
import {
  readPublishers,
  changePublisher,
  type Publishers,
} from "../services/publishers";
import { ConnectionError } from "../services/businessConnection";
import { businessFetch } from "../platform/network";
import { t } from "../i18n";

export function ReportingDesktop({
  credential,
  branchId,
  onAccessLost,
  onChanged,
  page = false,
  onClose,
}: {
  credential: Credential;
  branchId: string;
  onAccessLost: () => void;
  onChanged: () => void;
  page?: boolean;
  onClose?: () => void;
}) {
  useLocale();
  const [open, setOpen] = useState(page),
    [state, setState] = useState<Publishers | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null),
    running = useRef(false);
  const ink = { color: useColorScheme() === "dark" ? "#eef5fa" : "#172b37" };
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (page) void load();
  }, []);
  async function load(replace = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    const request = new AbortController();
    controller.current = request;
    try {
      const options = { fetcher: businessFetch, signal: request.signal };
      if (replace && state && selected) {
        await changePublisher(credential, state, selected, options);
        if (!request.signal.aborted) onChanged();
      }
      const next = await readPublishers(credential, branchId, options);
      if (!request.signal.aborted) {
        setState(next);
        setSelected(null);
        if (replace) setMessage(t("publisherChanged"));
      }
    } catch (error) {
      if (request.signal.aborted) return;
      setState(null);
      setSelected(null);
      if (
        error instanceof ConnectionError &&
        ["signInRequired", "accessChanged"].includes(error.problem)
      )
        onAccessLost();
      else setMessage(t("publisherUnavailable"));
    } finally {
      running.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  if (!open)
    return (
      <Button
        label={t("reportingDesktop")}
        secondary
        onPress={() => {
          setOpen(true);
          void load();
        }}
      />
    );
  return (
    <Card>
      <Text
        accessibilityRole="header"
        style={[ink, { fontSize: 20, fontWeight: "600" }]}
      >
        {t("reportingDesktop")}
      </Text>
      <Text style={[ink, { lineHeight: 23 }]}>{t("publisherHelp")}</Text>
      {state?.publisher ? (
        <View style={{ gap: 6 }}>
          <Text style={ink}>{state.publisher.name}</Text>
          <Text style={ink}>
            {t(state.publisher.online ? "publisherOnline" : "publisherOffline")}
          </Text>
        </View>
      ) : state ? (
        <Text style={ink}>{t("publisherUnassigned")}</Text>
      ) : null}
      {selected && state ? (
        <View style={{ gap: 12 }}>
          <Text style={[ink, { lineHeight: 23 }]}>
            {t("publisherConfirmHelp", {
              name: state.candidates.find(
                (candidate) => candidate.deviceId === selected,
              )!.name,
            })}
          </Text>
          <Button
            label={t("confirmPublisher")}
            disabled={busy}
            onPress={() => {
              void load(true);
            }}
          />
          <Button
            label={t("cancel")}
            secondary
            disabled={busy}
            onPress={() => setSelected(null)}
          />
        </View>
      ) : (
        state?.candidates
          .filter(
            (candidate) => candidate.deviceId !== state.publisher?.deviceId,
          )
          .map((candidate) => (
            <Button
              key={candidate.deviceId}
              label={t("usePublisher", { name: candidate.name })}
              secondary
              disabled={busy}
              onPress={() => setSelected(candidate.deviceId)}
            />
          ))
      )}
      {state && state.candidates.length === 0 && (
        <Text style={[ink, { lineHeight: 23 }]}>
          {t("publisherNoCandidates")}
        </Text>
      )}
      {message ? (
        <Text accessibilityRole="alert" style={[ink, { lineHeight: 23 }]}>
          {message}
        </Text>
      ) : null}
      <Button
        label={t("refreshDesktops")}
        secondary
        disabled={busy}
        onPress={() => {
          void load();
        }}
      />
      <Button
        label={t("closeDesktops")}
        secondary
        disabled={busy}
        onPress={() => {
          if (onClose) {
            onClose();
            return;
          }
          setOpen(false);
          setState(null);
          setSelected(null);
        }}
      />
    </Card>
  );
}
