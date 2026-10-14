import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View, useColorScheme } from "react-native";
import { type Credential } from "../services/sessionVault";
import { type BusinessContext, resolveBranchScope } from "../domain/contracts";
import { type PreparedStock } from "../domain/preparedStock";
import { snapshotScope, SNAPSHOT_MAX_AGE_MS } from "../domain/overviewSnapshot";
import { formatStockQuantity } from "../domain/quantity";
import { readBusinessStock } from "../services/businessStock";
import { ConnectionError } from "../services/businessConnection";
import { businessFetch } from "../platform/network";
import { t, getTextAlign, getFormatLocale, type MessageKey } from "../i18n";
import { useLocale } from "../i18n/useLocale";
import { Card, Button } from "./ui";
import { type RefreshBinding } from "./LiveOverview";
export function BusinessStock({
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
  const selected = context.branches.find((row) => row.id === ids[0]);
  const allowed =
    context.capabilities.includes("stock.read") &&
    ids.length === 1 &&
    !!selected;
  const identity = snapshotScope(
    credential.origin,
    credential.token,
    context,
    ids,
  );
  const [data, setData] = useState<{
    value: PreparedStock;
    identity: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<MessageKey | null>(null);
  const [limit, setLimit] = useState(20);
  const [, tick] = useState(0);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    lost = useRef(onAccessLost);
  lost.current = onAccessLost;
  const refresh = useCallback(async () => {
    if (controller.current && !controller.current.signal.aborted) return;
    const request = new AbortController(),
      run = ++generation.current;
    controller.current = request;
    setData((previous) =>
      allowed &&
      previous?.identity === identity &&
      previous.expiresAt > Date.now()
        ? previous
        : null,
    );
    setNotice(null);
    if (!allowed) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const value = await readBusinessStock(
        credential,
        context,
        resolveBranchScope(context, branch)[0]!,
        { fetcher: businessFetch, signal: request.signal },
      );
      if (run === generation.current) {
        setLimit(20);
        setData({
          value,
          identity,
          expiresAt: Math.min(
            Date.now() + SNAPSHOT_MAX_AGE_MS,
            Date.parse(credential.expiresAt),
            Date.parse(value.preparedAt) + 86400000,
          ),
        });
      }
    } catch (error) {
      if (run !== generation.current || request.signal.aborted) return;
      const preserve = error instanceof ConnectionError && error.transient;
      if (!preserve) setData(null);
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
    const timer = setTimeout(
      () => setData(null),
      Math.max(0, data.expiresAt - Date.now()),
    );
    const clock = setInterval(() => tick((v) => v + 1), 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(clock);
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
    allowed && data?.identity === identity && Date.now() < data.expiresAt
      ? data.value
      : null;
  const number = (value: number) =>
    new Intl.NumberFormat(getFormatLocale()).format(value);
  return (
    <View testID="business-stock" style={{ gap: 14 }}>
      <Text
        accessibilityRole="header"
        style={[text, { fontSize: 23, fontWeight: "700" }]}
      >
        {t("stock")}
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
      {!allowed ? (
        <Card>
          <Text style={text}>
            {t(
              context.capabilities.includes("stock.read")
                ? "chooseBranch"
                : "noAccess",
            )}
          </Text>
        </Card>
      ) : !visible ? (
        <Card>
          <Text accessibilityLiveRegion="polite" style={text}>
            {t(busy ? "summaryLoading" : (notice ?? "summaryUnavailable"))}
          </Text>
        </Card>
      ) : (
        <>
          {(busy || notice) && (
            <Text accessibilityLiveRegion="polite" style={text}>
              {t(busy ? "summaryLoading" : notice!)}
            </Text>
          )}
          <Card>
            {Date.now() - Date.parse(visible.preparedAt) > 900000 && (
              <Text style={text}>{t("stockDelayed")}</Text>
            )}
            <Text style={text}>{t("stockObservationHelp")}</Text>
            <Text style={text}>
              {t("stockCoverage", {
                known: number(visible.coverage.verifiedItems),
                unknown: number(visible.coverage.unavailableItems),
                excluded: number(visible.coverage.excludedItems),
              })}
            </Text>
            <Text style={text}>
              {t("stockObserved", {
                time: new Intl.DateTimeFormat(getFormatLocale(), {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: selected!.timezone,
                }).format(new Date(visible.preparedAt)),
              })}
            </Text>
          </Card>
          {!visible.lowItems.length ? (
            <Card>
              <Text style={text}>{t("stockNoKnownLow")}</Text>
            </Card>
          ) : (
            <>
              <Text style={text}>
                {t("stockListLimit", {
                  shown: number(Math.min(limit, visible.lowItems.length)),
                  total: number(visible.lowItemCount),
                })}
              </Text>
              {visible.lowItems.slice(0, limit).map((item) => (
                <Card key={item.itemId}>
                  <Text
                    accessibilityRole="header"
                    style={[text, { fontSize: 19, fontWeight: "700" }]}
                  >
                    {item.name}
                  </Text>
                  <Text style={text}>{t("stockOnHand")}</Text>
                  <Text
                    selectable
                    style={[
                      text,
                      { fontSize: 28, lineHeight: 36, fontWeight: "700" },
                    ]}
                  >
                    {formatStockQuantity(item.availableMilli)} {item.unit}
                  </Text>
                  <Text style={text}>
                    {t(
                      item.thresholdSource === "item"
                        ? "stockItemThreshold"
                        : "stockBranchThreshold",
                    )}
                    : {formatStockQuantity(item.thresholdMilli)} {item.unit}
                  </Text>
                  {item.availableMilli < 0 && (
                    <Text style={text}>{t("stockNegative")}</Text>
                  )}
                </Card>
              ))}
              {limit < visible.lowItems.length && (
                <Button
                  secondary
                  label={t("loadMore")}
                  onPress={() => setLimit((value) => value + 20)}
                />
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}
