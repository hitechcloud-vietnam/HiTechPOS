import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View, useColorScheme } from "react-native";
import { type Credential } from "../services/sessionVault";
import { type BusinessContext, resolveBranchScope } from "../domain/contracts";
import { branchDay } from "../domain/preparedOverview";
import { snapshotScope, SNAPSHOT_MAX_AGE_MS } from "../domain/overviewSnapshot";
import {
  readBusinessTrend,
  type BusinessTrend,
} from "../services/businessTrends";
import { ConnectionError } from "../services/businessConnection";
import { businessFetch } from "../platform/network";
import { formatMoney } from "../domain/money";
import { t, getFormatLocale, getTextAlign, type MessageKey } from "../i18n";
import { useLocale } from "../i18n/useLocale";
import { Card, Button } from "./ui";
import { type RefreshBinding } from "./LiveOverview";

export function BusinessTrends({
  credential,
  context,
  branch,
  onAccessLost,
  onRefreshBinding,
}: {
  credential: Credential;
  context: BusinessContext;
  branch: string | null;
  onAccessLost: () => void;
  onRefreshBinding: (binding: RefreshBinding) => void;
}) {
  useLocale();
  const ids = resolveBranchScope(context, branch);
  const selected = context.branches.filter((row) => ids.includes(row.id));
  const first = selected[0];
  const compatible =
    !!first &&
    selected.every(
      (row) =>
        row.currency === first.currency &&
        row.currencyDigits === first.currencyDigits &&
        row.timezone === first.timezone,
    );
  const identity = snapshotScope(
    credential.origin,
    credential.token,
    context,
    ids,
  );
  const [data, setData] = useState<{
    value: BusinessTrend;
    identity: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<MessageKey | null>(null);
  const [details, setDetails] = useState(false);
  const [, tick] = useState(0);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    lost = useRef(onAccessLost);
  lost.current = onAccessLost;
  const allowed = context.capabilities.includes("overview.read") && compatible;
  const refresh = useCallback(async () => {
    if (controller.current && !controller.current.signal.aborted) return;
    const request = new AbortController(),
      run = ++generation.current;
    controller.current = request;
    setData((previous) =>
      allowed &&
      previous?.identity === identity &&
      previous.expiresAt > Date.now() &&
      first &&
      previous.value.anchorDay === branchDay(first.timezone)
        ? previous
        : null,
    );
    setNotice(null);
    if (!allowed) {
      controller.current = null;
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const value = await readBusinessTrend(
        credential,
        context,
        resolveBranchScope(context, branch),
        { fetcher: businessFetch, signal: request.signal },
      );
      if (run === generation.current)
        setData({
          value,
          identity,
          expiresAt: Math.min(
            Date.now() + SNAPSHOT_MAX_AGE_MS,
            Date.parse(credential.expiresAt),
          ),
        });
    } catch (error) {
      if (run !== generation.current || request.signal.aborted) return;
      const preserve = error instanceof ConnectionError && error.transient;
      if (!preserve) {
        setData(null);
      }
      if (
        error instanceof ConnectionError &&
        ["signInRequired", "accessChanged"].includes(error.problem)
      )
        lost.current();
      else
        setNotice(
          preserve
            ? "summaryConnectionLost"
            : error instanceof ConnectionError &&
                error.problem === "unsupported"
              ? "liveReportsPending"
              : "summaryUnavailable",
        );
    } finally {
      if (run === generation.current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }, [credential, context, branch, allowed, identity]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    onRefreshBinding(
      allowed
        ? {
            run: () => {
              void refresh();
            },
            busy,
          }
        : null,
    );
    return () => onRefreshBinding(null);
  }, [refresh, busy, allowed, onRefreshBinding]);
  useEffect(() => {
    if (!data) return;
    const timeout = setTimeout(
      () => setData(null),
      Math.max(0, data.expiresAt - Date.now()),
    );
    const calendar = setInterval(() => tick((value) => value + 1), 30000);
    return () => {
      clearTimeout(timeout);
      clearInterval(calendar);
    };
  }, [data]);
  const dark = useColorScheme() === "dark";
  const text = {
    color: dark ? "#eef5fa" : "#172b37",
    textAlign: getTextAlign(),
    fontSize: 15,
    lineHeight: 23,
  };
  const visible =
    allowed &&
    data &&
    data.identity === identity &&
    Date.now() < data.expiresAt &&
    first &&
    data.value.anchorDay === branchDay(first.timezone)
      ? data.value
      : null;
  return (
    <View testID="business-trends" style={{ gap: 14 }}>
      <Text
        accessibilityRole="header"
        style={[text, { fontSize: 23, fontWeight: "700" }]}
      >
        {t("previousSevenDays")}
      </Text>
      {allowed && (
        <Button
          secondary
          label={t("refresh")}
          disabled={busy}
          onPress={() => {
            void refresh();
          }}
        />
      )}
      {visible && (busy || notice) && (
        <Text accessibilityLiveRegion="polite" style={text}>
          {t(busy ? "summaryLoading" : notice!)}
        </Text>
      )}
      {!compatible ? (
        <Card>
          <Text style={text}>{t("chooseBranch")}</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={text}>{t("summaryPartial")}</Text>
            <Button
              secondary
              label={t("salesBreakdown")}
              expanded={details}
              onPress={() => setDetails((value) => !value)}
            />
            {details && (
              <>
                <Text style={text}>{t("summaryCompleteness")}</Text>
                <Text style={text}>{t("salesDefinition")}</Text>
              </>
            )}
          </Card>
          {!visible ? (
            <Card>
              <Text accessibilityLiveRegion="polite" style={text}>
                {t(busy ? "summaryLoading" : (notice ?? "summaryUnavailable"))}
              </Text>
            </Card>
          ) : (
            [...visible.days].reverse().map(({ day, summary }) => (
              <Card key={day}>
                <Text
                  accessibilityRole="header"
                  style={[text, { fontWeight: "700", fontSize: 18 }]}
                >
                  {new Intl.DateTimeFormat(getFormatLocale(), {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(day + "T12:00:00Z"))}
                </Text>
                {summary ? (
                  <>
                    <Text style={text}>{t("salesAfterReturns")}</Text>
                    <Text
                      selectable
                      style={[
                        text,
                        { fontSize: 26, lineHeight: 34, fontWeight: "700" },
                      ]}
                    >
                      {formatMoney(
                        summary.salesAfterReturnsMinor,
                        summary.currency,
                        summary.currencyDigits,
                      )}
                    </Text>
                    <Text style={text}>
                      {t("issuedBills")}:{" "}
                      {new Intl.NumberFormat(getFormatLocale()).format(
                        summary.completedSales,
                      )}
                    </Text>
                    <Text style={text}>
                      {t(
                        summary.freshness.state === "delayed"
                          ? "summaryDelayed"
                          : "summaryPartial",
                      )}
                    </Text>
                  </>
                ) : (
                  <Text style={text}>{t("summaryPreparing")}</Text>
                )}
              </Card>
            ))
          )}
        </>
      )}
    </View>
  );
}
