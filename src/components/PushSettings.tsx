import { useLocale } from "../i18n/useLocale";
import React from "react";
import { Text, useColorScheme } from "react-native";
import { Card, Button } from "./ui";
import { type usePushSettings } from "./usePushSettings";
import { supportsPush } from "../platform/push";
import { t } from "../i18n";
export function PushSettings({
  state,
}: {
  state: ReturnType<typeof usePushSettings>;
}) {
  useLocale();
  const ink = { color: useColorScheme() === "dark" ? "#eef5fa" : "#172b37" };
  if (!supportsPush) return null;
  return (
    <Card>
      <Text
        accessibilityRole="header"
        style={[ink, { fontSize: 20, fontWeight: "600" }]}
      >
        {t("phoneNotifications")}
      </Text>
      <Text style={[ink, { lineHeight: 23 }]}>{t("pushPrivacyHelp")}</Text>
      {state.available ? (
        <Button
          label={t(state.status?.enabled ? "disablePush" : "enablePush")}
          secondary
          disabled={state.busy}
          onPress={state.status?.enabled ? state.disable : state.enable}
        />
      ) : (
        <Text style={ink}>{t("pushServerUnavailable")}</Text>
      )}
      {state.message ? (
        <Text accessibilityRole="alert" style={ink}>
          {state.message}
        </Text>
      ) : null}
      <Button
        label={t("refreshPushSettings")}
        secondary
        disabled={state.busy}
        onPress={state.refresh}
      />
    </Card>
  );
}
