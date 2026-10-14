import { insightText } from "../i18n/insights";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { type BusinessContext } from "../domain/contracts";
import { type Credential } from "../services/sessionVault";
import {
  createReportingClient,
  ConnectionError,
} from "../services/businessConnection";
import { businessFetch } from "../platform/network";
import {
  reportRange,
  type ReportPeriod,
  type ReportRange,
} from "../domain/reportPeriod";
import { type BusinessInsights as Report } from "../domain/businessInsights";
import { formatMoney } from "../domain/money";
import { branchDay } from "../domain/preparedOverview";
import { t, getTextAlign, getFormatLocale } from "../i18n";
import { useLocale } from "../i18n/useLocale";
import { Button, Card } from "./ui";
import { type RefreshBinding } from "./LiveOverview";
import { BusinessTrends } from "./BusinessTrends";
import { BusinessItems } from "./BusinessItems";

const periods: [ReportPeriod, string][] = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["thisWeek", "This week"],
  ["lastWeek", "Last week"],
  ["lastSeven", "Last 7 days"],
  ["thisMonth", "This month"],
  ["lastMonth", "Last month"],
  ["all", "All time"],
];
type Props = {
  credential: Credential;
  context: BusinessContext;
  branch: string | null;
  onAccessLost: () => void;
  onRefreshBinding: (binding: RefreshBinding) => void;
  initialPeriod?: ReportPeriod;
};
export function BusinessInsights({
  credential,
  context,
  branch,
  onAccessLost,
  onRefreshBinding,
  initialPeriod = "today",
}: Props) {
  useLocale();
  const [legacy, setLegacy] = useState(false),
    [legacyItems, setLegacyItems] = useState(false);
  const selected =
    context.branches.find((b) => b.id === branch) ??
    (context.branches.length === 1 ? context.branches[0] : undefined);
  const [period, setPeriod] = useState<ReportPeriod>(initialPeriod),
    [custom, setCustom] = useState<ReportRange | undefined>(),
    [picker, setPicker] = useState(false);
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [validation, setValidation] = useState("");
  const [data, setData] = useState<{
      key: string;
      value: Report;
      expires: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [detail, setDetail] = useState<string | null>(null),
    [ranking, setRanking] = useState<"sales" | "quantity">("sales"),
    [unit, setUnit] = useState("");
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!detail && !picker) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (picker) setPicker(false);
      else setDetail(null);
      return true;
    });
    return () => listener.remove();
  }, [detail, picker]);
  const day = selected ? branchDay(selected.timezone, new Date(clock)) : "";
  const range = selected
    ? reportRange(period, selected.timezone, custom, new Date(clock))
    : null;
  const key = JSON.stringify([
    credential.origin,
    credential.token,
    context,
    selected?.id,
    range,
    day,
  ]);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    lost = useRef(onAccessLost);
  lost.current = onAccessLost;
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const run = ++generation.current;
    setData(null);
    setLegacy(false);
    setError("");
    setDetail(null);
    if (!selected || !context.capabilities.includes("overview.read")) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const value = await createReportingClient(
        credential.origin,
        credential.token,
        { fetcher: businessFetch, signal: request.signal },
      ).insights(context, selected.id, range);
      if (run === generation.current)
        setData({
          key,
          value,
          expires: Math.min(
            Date.now() + 60000,
            Date.parse(credential.expiresAt),
          ),
        });
    } catch (e) {
      if (request.signal.aborted || run !== generation.current) return;
      if (
        e instanceof ConnectionError &&
        ["accessChanged", "signInRequired"].includes(e.problem)
      )
        lost.current();
      else if (e instanceof ConnectionError && e.problem === "unsupported")
        setLegacy(true);
      else
        setError(
          e instanceof ConnectionError && e.problem === "unsupported"
            ? t("liveReportsPending")
            : t("summaryUnavailable"),
        );
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }, [key]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      controller.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    onRefreshBinding({ busy, run: () => void load() });
    return () => onRefreshBinding(null);
  }, [busy, load, onRefreshBinding]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const value = data?.key === key && data.expires > clock ? data.value : null;
  const dark = useColorScheme() === "dark";
  const style = {
    color: dark ? "#eef5fa" : "#172b37",
    fontSize: 15,
    lineHeight: 23,
    textAlign: getTextAlign(),
  };
  const money = (n: number) =>
    formatMoney(n, selected!.currency, selected!.currencyDigits);
  const heading = (s: string) => (
    <Text
      accessibilityRole="header"
      style={[style, { fontSize: 21, fontWeight: "700" }]}
    >
      {s}
    </Text>
  );
  const line = (label: string, value: string) => (
    <View
      key={label}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <Text style={style}>{insightText(label)}</Text>
      <Text selectable style={[style, { fontWeight: "600" }]}>
        {value}
      </Text>
    </View>
  );
  const choose = (p: ReportPeriod) => {
    setPeriod(p);
    setPicker(false);
    setDetail(null);
  };
  if (legacy)
    return (
      <View style={{ gap: 14 }}>
        {context.capabilities.includes("items.read") && (
          <Button
            secondary
            label={t(legacyItems ? "previousSevenDays" : "bestItems")}
            onPress={() => setLegacyItems((v) => !v)}
          />
        )}
        {legacyItems ? (
          <BusinessItems
            credential={credential}
            context={context}
            branch={branch}
            onAccessLost={onAccessLost}
            onRefreshBinding={onRefreshBinding}
          />
        ) : (
          <BusinessTrends
            credential={credential}
            context={context}
            branch={branch}
            onAccessLost={onAccessLost}
            onRefreshBinding={onRefreshBinding}
          />
        )}
      </View>
    );
  if (!selected)
    return (
      <Card>
        <Text style={style}>{t("chooseBranch")}</Text>
      </Card>
    );
  if (!context.capabilities.includes("overview.read"))
    return (
      <Card>
        <Text style={style}>{t("noAccess")}</Text>
      </Card>
    );
  return (
    <View testID="business-insights" style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {periods.slice(0, 4).map(([p, label]) => (
          <Button
            key={p}
            secondary={period !== p}
            label={insightText(label)}
            onPress={() => choose(p)}
          />
        ))}
        <Button
          secondary
          label={insightText("More dates")}
          onPress={() => {
            setFrom(range?.from || day);
            setTo(range?.to || day);
            setPicker(!picker);
          }}
        />
      </View>
      {picker && (
        <Card>
          {periods.slice(4).map(([p, label]) => (
            <Button
              key={p}
              label={insightText(label)}
              secondary
              onPress={() => choose(p)}
            />
          ))}
          <Text style={style}>Custom range · YYYY-MM-DD</Text>
          <TextInput
            accessibilityLabel={insightText("From date")}
            value={from}
            onChangeText={setFrom}
            placeholder="YYYY-MM-DD"
            style={[
              style,
              {
                borderWidth: 1,
                borderColor: "#a5b7c2",
                padding: 12,
                minHeight: 48,
              },
            ]}
          />
          <TextInput
            accessibilityLabel={insightText("To date")}
            value={to}
            onChangeText={setTo}
            placeholder="YYYY-MM-DD"
            style={[
              style,
              {
                borderWidth: 1,
                borderColor: "#a5b7c2",
                padding: 12,
                minHeight: 48,
              },
            ]}
          />
          {validation ? (
            <Text accessibilityRole="alert" style={style}>
              {validation}
            </Text>
          ) : null}
          <Button
            label={insightText("Apply dates")}
            onPress={() => {
              try {
                reportRange("custom", selected.timezone, { from, to });
                setCustom({ from, to });
                setValidation("");
                choose("custom");
              } catch {
                setValidation(
                  "Choose valid dates, with the start before the end and no future dates.",
                );
              }
            }}
          />
        </Card>
      )}
      <Text style={style}>
        {range ? `${range.from} — ${range.to}` : "All recorded dates"} ·{" "}
        {selected.timezone}
      </Text>
      <Button
        secondary
        label={t("refresh")}
        disabled={busy}
        onPress={() => void load()}
      />
      {busy ? (
        <Text accessibilityLiveRegion="polite" style={style}>
          {t("summaryLoading")}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={style}>
          {error}
        </Text>
      ) : null}
      {!busy && !error && !value ? (
        <Text style={style}>{t("summaryUnavailable")}</Text>
      ) : null}
      {value && (
        <>
          {detail && (
            <Button
              secondary
              label={insightText("Back to overview")}
              onPress={() => setDetail(null)}
            />
          )}
          {!detail && (
            <>
              <Card>
                {heading(t("salesAfterReturns"))}
                <Text
                  selectable
                  style={[
                    style,
                    { fontSize: 34, lineHeight: 42, fontWeight: "700" },
                  ]}
                >
                  {money(value.salesAfterReturnsMinor)}
                </Text>
                {line(t("issuedBills"), String(value.bills))}
                {line(
                  "Average billed sale",
                  value.bills
                    ? money(Math.round(value.billedSalesMinor / value.bills))
                    : "—",
                )}
                <Button
                  secondary
                  label={t("salesBreakdown")}
                  onPress={() => setDetail("sales")}
                />
              </Card>
              {context.capabilities.includes("items.read") && (
                <Card>
                  {heading("Best-selling items")}
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    <Button
                      label={insightText("By sales value")}
                      secondary={ranking !== "sales"}
                      onPress={() => setRanking("sales")}
                    />
                    <Button
                      label={insightText("By quantity")}
                      secondary={ranking !== "quantity"}
                      onPress={() => setRanking("quantity")}
                    />
                  </View>
                  {ranking === "quantity" &&
                    value.items?.byQuantity.map((g) => (
                      <Button
                        key={g.unit}
                        secondary={unit !== g.unit}
                        label={g.unit}
                        onPress={() => setUnit(g.unit)}
                      />
                    ))}
                  {!value.items ? (
                    <Text style={style}>{t("summaryUnavailable")}</Text>
                  ) : (
                    (ranking === "sales"
                      ? value.items.bySales
                      : value.items.byQuantity.find((g) => g.unit === unit)
                          ?.items ||
                        value.items.byQuantity[0]?.items ||
                        []
                    )
                      .slice(0, 5)
                      .map((i) => (
                        <Button
                          secondary
                          key={i.itemId}
                          label={`${i.name} · ${
                            ranking === "sales"
                              ? money(i.salesAfterReturnsMinor)
                              : i.quantities
                                  .filter(
                                    (q) =>
                                      q.unit ===
                                      (unit ||
                                        value.items!.byQuantity[0]?.unit),
                                  )
                                  .map(
                                    (q) =>
                                      `${new Intl.NumberFormat(getFormatLocale()).format((q.soldMilli - q.returnedMilli) / 1000)} ${q.unit}`,
                                  )
                                  .join(", ")
                          }`}
                          onPress={() => setDetail("item:" + i.itemId)}
                        />
                      ))
                  )}
                  {value.items?.bySales.length === 0 ? (
                    <Text style={style}>No item sales in this period.</Text>
                  ) : null}
                </Card>
              )}
              {context.capabilities.includes("reporting.manage") && (
                <Card>
                  {heading(insightText("Staff sales"))}
                  <Text style={style}>
                    By recorded invoice author, not payment collector.
                  </Text>
                  {value.staff?.slice(0, 5).map((s) => (
                    <Button
                      secondary
                      key={s.id}
                      label={`${s.name} · ${money(s.salesAfterReturnsMinor)}`}
                      onPress={() => setDetail("staff:" + s.id)}
                    />
                  ))}
                  {value.staff?.length === 0 ? (
                    <Text style={style}>No staff sales in this period.</Text>
                  ) : null}
                </Card>
              )}
              <Card>
                {heading(insightText("More about your sales"))}
                {context.capabilities.includes("tenders.read") && (
                  <Button
                    secondary
                    label={insightText("Payments & unpaid bills")}
                    onPress={() => setDetail("payments")}
                  />
                )}
                <Button
                  secondary
                  label={insightText("Discounts & returns")}
                  onPress={() => setDetail("adjustments")}
                />
                <Button
                  secondary
                  label={insightText("Busy hours")}
                  onPress={() => setDetail("hours")}
                />
              </Card>
            </>
          )}
          {detail === "sales" && (
            <Card>
              {heading(t("salesBreakdown"))}
              {line(insightText("Billed sales"), money(value.billedSalesMinor))}
              {line(insightText("Returns"), money(value.refundsMinor))}
              {line(
                t("salesAfterReturns"),
                money(value.salesAfterReturnsMinor),
              )}
              <Text style={style}>{t("salesDefinition")}</Text>
              {value.details.map((b) => (
                <View key={b.id} style={{ gap: 4 }}>
                  {line(b.number, money(b.billedSalesMinor - b.refundsMinor))}
                  <Text style={style}>{b.date}</Text>
                </View>
              ))}
              <Text style={style}>
                Up to 50 included bill records. Amounts reflect contributions in
                the selected dates.
              </Text>
            </Card>
          )}
          {detail?.startsWith("item:") &&
            (() => {
              const i = [
                ...(value.items?.bySales || []),
                ...(value.items?.byQuantity.flatMap((g) => g.items) || []),
              ].find((i) => i.itemId === detail.slice(5));
              return i ? (
                <Card>
                  {heading(i.name)}
                  {line(
                    t("salesAfterReturns"),
                    money(i.salesAfterReturnsMinor),
                  )}
                  {i.quantities.map((q) =>
                    line(
                      q.unit,
                      new Intl.NumberFormat(getFormatLocale()).format(
                        (q.soldMilli - q.returnedMilli) / 1000,
                      ),
                    ),
                  )}
                </Card>
              ) : null;
            })()}
          {detail?.startsWith("staff:") &&
            (() => {
              const s = value.staff?.find((s) => s.id === detail.slice(6));
              return s ? (
                <Card>
                  {heading(s.name)}
                  {line(insightText("Billed sales"), money(s.billedSalesMinor))}
                  {line(insightText("Returns"), money(s.refundsMinor))}
                  {line(
                    t("salesAfterReturns"),
                    money(s.salesAfterReturnsMinor),
                  )}
                </Card>
              ) : null;
            })()}
          {detail === "payments" && (
            <Card>
              {heading("Payments on selected bills")}
              <Text style={style}>
                Current recorded payments against bills dated in this period.
                This is not money collected during these dates or a bank
                settlement report.
              </Text>
              {value.payments ? (
                <>
                  {line(
                    insightText("Recorded payments"),
                    money(value.payments.receivedMinor),
                  )}
                  {line(
                    insightText("Still unpaid"),
                    money(value.payments.outstandingMinor),
                  )}
                  {value.payments.methods.map((m) =>
                    line(m.name, money(m.amountMinor)),
                  )}
                </>
              ) : (
                <Text style={style}>
                  The recorded payment amounts could not be reconciled. No total
                  is shown.
                </Text>
              )}
            </Card>
          )}
          {detail === "adjustments" && (
            <Card>
              {heading(insightText("Discounts & returns"))}
              {value.discounts ? (
                <>
                  {line(
                    insightText("Discounts"),
                    money(value.discounts.amountMinor),
                  )}
                  {line(
                    insightText("Discounted bills"),
                    String(value.discounts.bills),
                  )}
                </>
              ) : (
                <Text style={style}>{t("summaryUnavailable")}</Text>
              )}
              {line(insightText("Returns"), money(value.returns.amountMinor))}
              {line(
                insightText("Return transactions"),
                String(value.returns.transactions),
              )}
              <Text style={style}>
                Discounts are already included in billed sales. Returns count on
                the day processed.
              </Text>
            </Card>
          )}
          {detail === "hours" && (
            <Card>
              {heading(insightText("Busy hours"))}
              <Text style={style}>
                Billed sales by invoice hour · {selected.timezone}
              </Text>
              {value.hours
                .filter((h) => h.bills > 0)
                .map((h) => (
                  <View key={h.hour} style={{ gap: 4 }}>
                    {line(
                      `${String(h.hour).padStart(2, "0")}:00`,
                      money(h.billedSalesMinor),
                    )}
                    <View
                      style={{
                        height: 6,
                        backgroundColor: dark ? "#274c38" : "#e1f2e7",
                      }}
                    >
                      <View
                        style={{
                          height: 6,
                          width: `${(100 * h.billedSalesMinor) / Math.max(1, ...value.hours.map((x) => x.billedSalesMinor))}%`,
                          backgroundColor: dark ? "#9ae4b8" : "#126443",
                        }}
                      />
                    </View>
                  </View>
                ))}
            </Card>
          )}
          <Text style={style}>
            {t("summaryPartial")} ·{" "}
            {new Intl.DateTimeFormat(getFormatLocale(), {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: selected.timezone,
            }).format(new Date(value.checkedAt))}
          </Text>
        </>
      )}
    </View>
  );
}
