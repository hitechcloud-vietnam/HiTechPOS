import React, { useState } from "react";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { Button, Card } from "./ui";
import { t, releaseLanguages, translator } from "../i18n";
import { useLocale } from "../i18n/useLocale";
import { writeLanguage } from "../platform/language";

export function LanguageSettings({ page = false }: { page?: boolean }) {
  const locale = useLocale();
  const [open, setOpen] = useState(page),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const dark = useColorScheme() === "dark";
  const ink = dark ? "#eef5fa" : "#172b37";
  if (!open)
    return (
      <Button label={t("language")} secondary onPress={() => setOpen(true)} />
    );
  async function choose(code: string) {
    if (busy || !translator.available(code)) return;
    setBusy(true);
    setFailed(false);
    translator.setLocale(code);
    try {
      await writeLanguage(code);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Text
        accessibilityRole="header"
        style={{ color: ink, fontSize: 22, fontWeight: "700" }}
      >
        {t("language")}
      </Text>
      <Text style={{ color: ink, fontSize: 15, lineHeight: 23 }}>
        {t("languagePlan")}
      </Text>
      <View style={{ gap: 8 }}>
        {releaseLanguages
          .filter((language) => translator.available(language.code))
          .map((language) => (
            <Pressable
              key={language.code}
              accessibilityRole="radio"
              accessibilityLabel={language.name}
              aria-checked={locale === language.code}
              aria-disabled={busy}
              accessibilityState={{
                checked: locale === language.code,
                disabled: busy,
              }}
              disabled={busy}
              onPress={() => void choose(language.code)}
              style={({ pressed }) => ({
                minHeight: 52,
                padding: 14,
                borderRadius: 12,
                borderWidth: 1,
                borderColor:
                  locale === language.code
                    ? dark
                      ? "#71d9ba"
                      : "#146b54"
                    : dark
                      ? "#36505e"
                      : "#d9e2e7",
                opacity: pressed ? 0.7 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              })}
            >
              <Text style={{ color: ink, flex: 1, fontSize: 17 }}>
                {language.name}
              </Text>
              <Text accessible={false} style={{ color: ink, fontSize: 18 }}>
                {locale === language.code ? "✓" : ""}
              </Text>
            </Pressable>
          ))}
      </View>
      {failed && (
        <Text accessibilityRole="alert" style={{ color: ink, lineHeight: 23 }}>
          {t("languageSaveFailed")}
        </Text>
      )}
      {!page && (
        <Button
          label={t("back")}
          secondary
          disabled={busy}
          onPress={() => setOpen(false)}
        />
      )}
    </Card>
  );
}
