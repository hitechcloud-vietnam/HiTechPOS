import { useLocale } from "../i18n/useLocale";
import React, { useEffect, useRef, useState } from "react";
import {
  Text,
  TextInput,
  View,
  Switch,
  Pressable,
  useColorScheme,
} from "react-native";
import { Card, Button } from "./ui";
import { type Credential } from "../services/sessionVault";
import {
  readPreference,
  savePreference,
  type NotificationPreference,
} from "../services/notifications";
import {
  readSummarySchedule,
  saveSummarySchedule,
  type SummarySchedule,
} from "../services/registerNotifications";
import { ConnectionError } from "../services/businessConnection";
import { businessFetch } from "../platform/network";
import { t, getFormatLocale } from "../i18n";
import {
  readStockPreference,
  saveStockPreference,
  type StockPreference,
} from "../services/stockNotifications";
import { normalizeDigits } from "../i18n/digits";
import { type BusinessContext } from "../domain/contracts";
import {
  readApprovalPreference,
  saveApprovalPreference,
  type ApprovalPreference,
} from "../services/approvalNotifications";

export function NotificationSettings({
  credential,
  branchId,
  onAccessLost,
  page = false,
  onClose,
  onDirtyChanged,
  approvalContext,
  summaryContext,
  stockContext,
}: {
  credential: Credential;
  branchId: string;
  onAccessLost: () => void;
  page?: boolean;
  onClose?: () => void;
  onDirtyChanged?: (dirty: boolean) => void;
  approvalContext?: BusinessContext;
  summaryContext?: BusinessContext;
  stockContext?: BusinessContext;
}) {
  useLocale();
  const [open, setOpen] = useState(page),
    [value, setValue] = useState<
      | NotificationPreference
      | SummarySchedule
      | ApprovalPreference
      | StockPreference
      | null
    >(null),
    [supportsClose, setSupportsClose] = useState(false),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null),
    running = useRef(false);
  const [savedValue, setSavedValue] = useState<string | null>(null);
  useEffect(() => {
    const dirty =
      value !== null &&
      savedValue !== null &&
      JSON.stringify(value) !== savedValue;
    onDirtyChanged?.(dirty);
    if (dirty) setMessage("");
  }, [value, savedValue, onDirtyChanged]);
  const ink = { color: useColorScheme() === "dark" ? "#eef5fa" : "#172b37" };
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (page) void load();
  }, []);
  async function load(save = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    const request = new AbortController();
    controller.current = request;
    try {
      const options = { fetcher: businessFetch, signal: request.signal };
      let result;
      if (stockContext) {
        result =
          save && value && "minimumIntervalMinutes" in value
            ? await saveStockPreference(
                credential,
                stockContext,
                value,
                options,
              )
            : await readStockPreference(
                credential,
                stockContext,
                branchId,
                options,
              );
      } else if (summaryContext && !approvalContext) {
        const schedule =
          save && value && "mode" in value
            ? await saveSummarySchedule(
                credential,
                summaryContext,
                { supportsClose, preference: value },
                options,
              )
            : await readSummarySchedule(
                credential,
                summaryContext,
                branchId,
                options,
              );
        result = schedule.preference;
        if (!request.signal.aborted) setSupportsClose(schedule.supportsClose);
      } else
        result = approvalContext
          ? save && value
            ? await saveApprovalPreference(
                credential,
                approvalContext,
                value,
                options,
              )
            : await readApprovalPreference(
                credential,
                approvalContext,
                branchId,
                options,
              )
          : save && value && "time" in value
            ? await savePreference(credential, value, options)
            : await readPreference(credential, branchId, options);
      if (!request.signal.aborted) {
        setConflict(false);
        setValue(result);
        setSavedValue(JSON.stringify(result));
        if (save) setMessage(t("notificationSaved"));
      }
    } catch (error) {
      if (request.signal.aborted) return;
      if (stockContext && save) {
        setConflict(
          error instanceof ConnectionError && error.problem === "conflict",
        );
      } else setValue(null);
      if (
        error instanceof ConnectionError &&
        ["signInRequired", "accessChanged"].includes(error.problem)
      )
        onAccessLost();
      else
        setMessage(
          t(
            error instanceof ConnectionError &&
              error.problem === "unsupported" &&
              stockContext
              ? "stockAlertsUnsupported"
              : approvalContext &&
                  error instanceof ConnectionError &&
                  error.problem === "unsupported"
                ? "approvalAlertsUnsupported"
                : "notificationSettingsUnavailable",
          ),
        );
    } finally {
      running.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  if (!open)
    return (
      <Button
        label={t("notificationSettings")}
        secondary
        onPress={() => {
          setOpen(true);
          void load();
        }}
      />
    );
  const controlsDisabled = busy || conflict;
  const validTime = (text: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text);
  const valid =
    value &&
    (!("time" in value) || validTime(value.time)) &&
    (!value.quiet.enabled ||
      (validTime(value.quiet.start) &&
        validTime(value.quiet.end) &&
        value.quiet.start !== value.quiet.end));
  const timeInput = (
    label: string,
    text: string,
    change: (text: string) => void,
  ) => (
    <View style={{ gap: 6 }}>
      <Text style={ink}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={text}
        onChangeText={(input) => change(normalizeDigits(input))}
        editable={!controlsDisabled}
        maxLength={5}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="23:00"
        style={[
          ink,
          {
            minHeight: 48,
            borderWidth: 1,
            borderColor: "#8296a2",
            borderRadius: 12,
            padding: 12,
            fontSize: 18,
            writingDirection: "ltr",
            textAlign: "left",
          },
        ]}
      />
    </View>
  );
  return (
    <Card>
      <Text
        accessibilityRole="header"
        style={[ink, { fontSize: 20, fontWeight: "600" }]}
      >
        {t(
          stockContext
            ? "stockAlerts"
            : approvalContext
              ? "approvalAlerts"
              : "notificationSettings",
        )}
      </Text>
      <Text style={[ink, { lineHeight: 23 }]}>
        {t(
          stockContext
            ? "stockAlertsHelp"
            : approvalContext
              ? "approvalAlertsHelp"
              : value && "mode" in value && value.mode === "register-close"
                ? "registerCloseHelp"
                : "inboxDeliveryHelp",
        )}
      </Text>
      {value && (
        <>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Text style={[ink, { flex: 1 }]}>
              {t(
                stockContext
                  ? "stockAlerts"
                  : approvalContext
                    ? "approvalAlerts"
                    : "mode" in value && value.mode === "register-close"
                      ? "registerSummary"
                      : "dailySummary",
              )}
            </Text>
            <Switch
              accessibilityLabel={t(
                stockContext
                  ? "stockAlerts"
                  : approvalContext
                    ? "approvalAlerts"
                    : "mode" in value && value.mode === "register-close"
                      ? "registerSummary"
                      : "dailySummary",
              )}
              value={value.enabled}
              disabled={controlsDisabled}
              onValueChange={(enabled) => setValue({ ...value, enabled })}
            />
          </View>
          <Text style={ink}>
            {t("branchTimezone", { timezone: value.timezone })}
          </Text>
          {"minimumIntervalMinutes" in value && (
            <View
              style={{ gap: 8 }}
              accessibilityRole="radiogroup"
              accessibilityLabel={t("stockAlertFrequency")}
            >
              <Text style={[ink, { fontWeight: "600" }]}>
                {t("stockAlertFrequency")}
              </Text>
              {([15, 30, 60, 180] as const).map((minutes) => {
                const label = t("stockAlertInterval", {
                  minutes: new Intl.NumberFormat(getFormatLocale()).format(
                    minutes,
                  ),
                });
                return (
                  <Pressable
                    key={minutes}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{
                      checked: value.minimumIntervalMinutes === minutes,
                      disabled: controlsDisabled,
                    }}
                    disabled={controlsDisabled}
                    onPress={() =>
                      setValue({ ...value, minimumIntervalMinutes: minutes })
                    }
                    style={{
                      minHeight: 48,
                      padding: 12,
                      borderWidth:
                        value.minimumIntervalMinutes === minutes ? 2 : 1,
                      borderColor: "#8296a2",
                      borderRadius: 12,
                      justifyContent: "center",
                    }}
                  >
                    <Text style={ink}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {supportsClose && "mode" in value && (
            <View style={{ gap: 8 }} accessibilityRole="radiogroup">
              {(["daily", "register-close"] as const).map((mode) => (
                <Pressable
                  key={mode}
                  accessibilityRole="radio"
                  accessibilityLabel={t(
                    mode === "daily" ? "dailySummary" : "afterRegisterClose",
                  )}
                  accessibilityState={{
                    checked: value.mode === mode,
                    disabled: busy,
                  }}
                  disabled={controlsDisabled}
                  onPress={() => setValue({ ...value, mode })}
                  style={{
                    minHeight: 48,
                    padding: 12,
                    borderWidth: value.mode === mode ? 2 : 1,
                    borderColor: "#8296a2",
                    borderRadius: 12,
                    justifyContent: "center",
                  }}
                >
                  <Text style={ink}>
                    {t(
                      mode === "daily" ? "dailySummary" : "afterRegisterClose",
                    )}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {"time" in value &&
            !("mode" in value && value.mode === "register-close") &&
            timeInput(t("summaryTime"), value.time, (time) =>
              setValue({ ...value, time }),
            )}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Text style={[ink, { flex: 1 }]}>{t("quietHours")}</Text>
            <Switch
              accessibilityLabel={t("quietHours")}
              value={value.quiet.enabled}
              disabled={controlsDisabled}
              onValueChange={(enabled) =>
                setValue({
                  ...value,
                  quiet: {
                    enabled,
                    start: validTime(value.quiet.start)
                      ? value.quiet.start
                      : "22:00",
                    end: validTime(value.quiet.end) ? value.quiet.end : "07:00",
                  },
                })
              }
            />
          </View>
          {value.quiet.enabled && (
            <>
              {timeInput(t("quietStart"), value.quiet.start, (start) =>
                setValue({ ...value, quiet: { ...value.quiet, start } }),
              )}
              {timeInput(t("quietEnd"), value.quiet.end, (end) =>
                setValue({ ...value, quiet: { ...value.quiet, end } }),
              )}
            </>
          )}
          <Text style={ink}>
            {t(
              stockContext
                ? "stockAlertsQuietHelp"
                : approvalContext
                  ? "approvalAlertsQuietHelp"
                  : "quietHoursHelp",
            )}
          </Text>
          <Button
            label={t("saveNotificationSettings")}
            disabled={controlsDisabled || !valid}
            onPress={() => void load(true)}
          />
        </>
      )}
      {message ? (
        <Text accessibilityRole="alert" style={ink}>
          {message}
        </Text>
      ) : null}
      {(!value || conflict) && (
        <Button
          label={t("refresh")}
          secondary
          disabled={busy}
          onPress={() => void load()}
        />
      )}
      <Button
        label={t("closeNotificationSettings")}
        secondary
        disabled={busy}
        onPress={() => {
          if (onClose) {
            onClose();
            return;
          }
          setOpen(false);
          setValue(null);
          setMessage("");
        }}
      />
    </Card>
  );
}
