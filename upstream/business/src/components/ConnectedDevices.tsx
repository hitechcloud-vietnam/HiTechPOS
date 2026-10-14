import { useLocale } from "../i18n/useLocale";
import React, { useEffect, useRef, useState } from "react";
import { Text, View, useColorScheme } from "react-native";
import { Button, Card } from "./ui";
import { type Credential } from "../services/sessionVault";
import { ConnectionError } from "../services/businessConnection";
import {
  listBusinessSessions,
  removeBusinessSession,
  type BusinessSession,
} from "../services/sessions";
import { businessFetch } from "../platform/network";
import { t, getFormatLocale } from "../i18n";
export function ConnectedDevices({
  credential,
  onAccessLost,
  page = false,
  onClose,
}: {
  credential: Credential;
  onAccessLost: () => void;
  page?: boolean;
  onClose?: () => void;
}) {
  useLocale();
  const [open, setOpen] = useState(page),
    [rows, setRows] = useState<BusinessSession[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  const dark = useColorScheme() === "dark",
    text = {
      color: dark ? "#eef5fa" : "#172b37",
      fontSize: 15,
      lineHeight: 23,
    };
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (page) void load();
  }, []);
  async function load(removeId?: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const current = ++generation.current,
      request = new AbortController();
    controller.current = request;
    const options = { fetcher: businessFetch, signal: request.signal };
    try {
      if (removeId) {
        await removeBusinessSession(credential, removeId, options);
        if (current === generation.current) {
          setRows((previous) => previous.filter((row) => row.id !== removeId));
          setSelected(null);
        }
      }
      const result = await listBusinessSessions(credential, options);
      if (current === generation.current) setRows(result);
    } catch (error) {
      if (current !== generation.current) return;
      if (
        error instanceof ConnectionError &&
        ["signInRequired", "accessChanged"].includes(error.problem)
      ) {
        setRows([]);
        onAccessLost();
      } else setMessage(t("devicesUnavailable"));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  if (!open)
    return (
      <Button
        label={t("connectedDevices")}
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
        style={{ ...text, fontSize: 22, fontWeight: "700" }}
      >
        {t("connectedDevices")}
      </Text>
      <Text style={text}>{t("connectedDevicesHelp")}</Text>
      {rows.map((row) => (
        <View key={row.id} style={{ gap: 8, paddingVertical: 12 }}>
          <Text style={{ ...text, fontWeight: "600" }}>
            {row.name}
            {row.current ? " · " + t("thisDevice") : ""}
          </Text>
          <Text style={text}>
            {t("signedInOn", {
              date: new Date(row.issuedAt).toLocaleString(getFormatLocale()),
            })}
          </Text>
          <Text style={text}>
            {t("sessionExpires", {
              date: new Date(row.expiresAt).toLocaleDateString(
                getFormatLocale(),
              ),
            })}
          </Text>
          {!row.current &&
            (selected === row.id ? (
              <View style={{ gap: 8 }}>
                <Text style={text}>{t("removeDeviceHelp")}</Text>
                <Button
                  label={t("confirmRemoveDevice")}
                  disabled={busy}
                  onPress={() => {
                    void load(row.id);
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
              <Button
                label={t("removeDevice")}
                secondary
                disabled={busy}
                onPress={() => setSelected(row.id)}
              />
            ))}
        </View>
      ))}
      {message ? (
        <Text accessibilityRole="alert" style={text}>
          {message}
        </Text>
      ) : null}
      {!busy && !rows.length && !message ? (
        <Text style={text}>{t("noDevices")}</Text>
      ) : null}
      <Button
        label={t(busy ? "unlocking" : "refresh")}
        disabled={busy}
        secondary
        onPress={() => {
          void load();
        }}
      />
      <Button
        label={t("closeDevices")}
        secondary
        disabled={busy}
        onPress={() => {
          if (onClose) {
            onClose();
            return;
          }
          setOpen(false);
          setRows([]);
          setSelected(null);
        }}
      />
    </Card>
  );
}
