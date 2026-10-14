import { StockInboxDetails } from "./StockInboxDetails";
import { useLocale } from "../i18n/useLocale";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View, useColorScheme } from "react-native";
import { Card, Button } from "./ui";
import { type Credential } from "../services/sessionVault";
import { type BusinessContext } from "../domain/contracts";
import {
  readInbox,
  markInboxRead,
  type InboxEntry,
} from "../services/notifications";
import { ConnectionError } from "../services/businessConnection";
import { businessFetch } from "../platform/network";
import { type RefreshBinding } from "./LiveOverview";
import { formatMoney } from "../domain/money";
import { t, getTextAlign, getFormatLocale } from "../i18n";

export function BusinessInbox({
  credential,
  context,
  onAccessLost,
  onRefreshBinding,
  onOpenApproval,
}: {
  credential: Credential;
  context: BusinessContext;
  onAccessLost: () => void;
  onRefreshBinding: (binding: RefreshBinding) => void;
  onOpenApproval: (requestId: string) => void;
}) {
  useLocale();
  const [entries, setEntries] = useState<InboxEntry[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  // A request may expire while the Inbox is open. Remove its action locally;
  // the detail read still rechecks current status and authority on the server.
  useEffect(() => {
    const timer = setInterval(
      () =>
        setEntries((rows) => {
          const active = rows.filter(
            (row) =>
              row.kind !== "approval_requested" ||
              Date.parse(row.requestExpiresAt) > Date.now(),
          );
          return active.length === rows.length ? rows : active;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    running = useRef(false),
    lost = useRef(onAccessLost);
  lost.current = onAccessLost;
  const ink = {
    color: useColorScheme() === "dark" ? "#eef5fa" : "#172b37",
    textAlign: getTextAlign(),
  };
  const load = useCallback(
    async (before?: string) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setMessage("");
      const request = new AbortController(),
        run = ++generation.current;
      controller.current = request;
      if (!before) {
        setEntries([]);
        setNext(null);
      }
      try {
        const result = await readInbox(
          credential,
          context,
          { fetcher: businessFetch, signal: request.signal },
          before,
        );
        if (run !== generation.current || request.signal.aborted) return;
        const active = result.entries.filter(
          (entry) =>
            entry.kind !== "approval_requested" ||
            Date.parse(entry.requestExpiresAt) > Date.now(),
        );
        setEntries((previous) =>
          before
            ? [
                ...previous,
                ...active.filter(
                  (entry) => !previous.some((old) => old.id === entry.id),
                ),
              ]
            : active,
        );
        setNext(result.next);
      } catch (error) {
        if (request.signal.aborted) return;
        setEntries([]);
        setNext(null);
        if (
          error instanceof ConnectionError &&
          ["signInRequired", "accessChanged"].includes(error.problem)
        )
          lost.current();
        else setMessage(t("inboxUnavailable"));
      } finally {
        running.current = false;
        if (!request.signal.aborted) setBusy(false);
      }
    },
    [credential, context],
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    onRefreshBinding({ run: () => void load(), busy });
  }, [load, busy, onRefreshBinding]);
  useEffect(() => () => onRefreshBinding(null), [onRefreshBinding]);
  async function mark(entry: InboxEntry) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    const request = new AbortController();
    controller.current = request;
    try {
      await markInboxRead(credential, entry.id, {
        fetcher: businessFetch,
        signal: request.signal,
      });
      if (!request.signal.aborted)
        setEntries((previous) =>
          previous.map((row) =>
            row.id === entry.id ? { ...row, read: true } : row,
          ),
        );
    } catch (error) {
      if (request.signal.aborted) return;
      // A removed event or changed opt-in must not leave actionable stale data.
      setEntries([]);
      setNext(null);
      if (
        error instanceof ConnectionError &&
        ["signInRequired", "accessChanged"].includes(error.problem)
      )
        lost.current();
      else setMessage(t("inboxUnavailable"));
    } finally {
      running.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 14 }}>
      <Text
        accessibilityRole="header"
        style={[ink, { fontSize: 25, fontWeight: "700" }]}
      >
        {t("inbox")}
      </Text>
      <Text style={[ink, { lineHeight: 23 }]}>
        {t(
          entries.some((entry) => "close" in entry)
            ? "registerCloseHelp"
            : "inboxHistoryHelp",
        )}
      </Text>
      <Button
        label={t("refresh")}
        secondary
        disabled={busy}
        onPress={() => void load()}
      />
      {message ? (
        <Text accessibilityRole="alert" style={ink}>
          {message}
        </Text>
      ) : null}
      {!busy && !message && !entries.length && (
        <Card>
          <Text style={ink}>{t("inboxEmpty")}</Text>
        </Card>
      )}
      {entries.map((entry) => (
        <Card key={entry.id}>
          <Text
            accessibilityRole="header"
            style={[ink, { fontSize: 19, fontWeight: "600" }]}
          >
            {t(
              entry.kind === "approval_requested"
                ? "approvalAlerts"
                : entry.kind === "stock_low"
                  ? "stockAlerts"
                  : "close" in entry
                    ? "registerSummary"
                    : "dailySummary",
            )}
            {entry.read ? "" : " · " + t("unread")}
          </Text>
          <Text style={ink}>
            {
              context.branches.find((branch) => branch.id === entry.branchId)
                ?.name
            }{" "}
            · {entry.businessDate}
          </Text>
          {"close" in entry && (
            <>
              <Text style={[ink, { fontWeight: "600" }]}>
                {entry.close.registerName}
              </Text>
              <Text style={[ink, { lineHeight: 23 }]}>
                {[entry.close.openedAt, entry.close.closedAt]
                  .map((at) =>
                    new Intl.DateTimeFormat(getFormatLocale(), {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: entry.close.timezone,
                    }).format(new Date(at)),
                  )
                  .join(" - ")}
              </Text>
              <Text style={ink}>
                {t("branchTimezone", { timezone: entry.close.timezone })}
              </Text>
            </>
          )}
          {entry.kind === "approval_requested" ? (
            <>
              <Text style={[ink, { lineHeight: 23 }]}>
                {t("approvalListHelp")}
              </Text>
              <Button
                label={t("reviewDecision")}
                disabled={busy}
                onPress={() => {
                  if (Date.parse(entry.requestExpiresAt) > Date.now())
                    onOpenApproval(entry.requestId);
                  else void load();
                }}
              />
            </>
          ) : entry.kind === "stock_low" ? (
            <StockInboxDetails
              stock={entry.stock}
              timezone={
                context.branches.find((branch) => branch.id === entry.branchId)!
                  .timezone
              }
            />
          ) : entry.summary ? (
            <>
              <Text style={[ink, { fontSize: 26, fontWeight: "700" }]}>
                {formatMoney(
                  entry.summary.salesAfterReturnsMinor,
                  entry.summary.currency,
                  entry.summary.currencyDigits,
                )}
              </Text>
              <Text style={ink}>{t("salesAfterReturns")}</Text>
              <Text style={[ink, { lineHeight: 23 }]}>
                {t("digestPartial")}
              </Text>
            </>
          ) : (
            <Text style={[ink, { lineHeight: 23 }]}>
              {t(
                "close" in entry ? "registerUnavailable" : "digestUnavailable",
              )}
            </Text>
          )}
          {!entry.read && (
            <Button
              label={t("markRead")}
              secondary
              disabled={busy}
              onPress={() => void mark(entry)}
            />
          )}
        </Card>
      ))}
      {next && (
        <Button
          label={t("loadOlder")}
          secondary
          disabled={busy}
          onPress={() => void load(next)}
        />
      )}
    </View>
  );
}
