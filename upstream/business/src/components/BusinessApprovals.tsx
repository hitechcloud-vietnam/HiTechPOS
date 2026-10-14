import { useLocale } from "../i18n/useLocale";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View, useColorScheme } from "react-native";
import { Button, Card } from "./ui";
import { AuthorizationPanel } from "./AuthorizationPanel";
import { type Credential } from "../services/sessionVault";
import { type BusinessContext } from "../domain/contracts";
import { type Session, revokeSession } from "../services/authorization";
import {
  readDecisions,
  readDecision,
  sendDecision,
  validateConfirmation,
  DecisionError,
  type Decision,
  type DecisionAction,
} from "../services/decisions";
import {
  rememberConfirmation,
  pendingConfirmation,
  clearConfirmation,
} from "../services/pendingConfirmation";
import { ConnectionError } from "../services/businessConnection";
import { businessFetch } from "../platform/network";
import { proofSource } from "../platform/proof";
import { formatMoney } from "../domain/money";
import { type RefreshBinding } from "./LiveOverview";
import { t, getFormatLocale, getTextAlign, type MessageKey } from "../i18n";

type Props = {
  credential: Credential;
  context: BusinessContext;
  onAccessLost: () => void;
  onRefreshBinding: (binding: RefreshBinding) => void;
};
const stateKeys: Record<Decision["state"], MessageKey> = {
  pending: "decisionPending",
  approved: "decisionApproved",
  declined: "decisionDeclined",
  cancelled: "decisionCancelled",
  expired: "decisionExpired",
  applying: "decisionApplying",
  applied: "decisionApplied",
};
function amount(row: Decision, value: number) {
  return formatMoney(value, row.summary.currency, row.summary.currencyDigits);
}
function accessLost(error: unknown) {
  return (
    error instanceof ConnectionError &&
    ["signInRequired", "accessChanged"].includes(error.problem)
  );
}
function useInk() {
  return {
    color: useColorScheme() === "dark" ? "#eef5fa" : "#172b37",
    textAlign: getTextAlign(),
    fontSize: 16,
    lineHeight: 24,
  };
}

export function BusinessApprovals({
  credential,
  context,
  onAccessLost,
  onRefreshBinding,
  onOpen,
  branchId,
}: Props & { onOpen: (id: string) => void; branchId?: string }) {
  useLocale();
  const [entries, setEntries] = useState<Decision[]>([]),
    [next, setNext] = useState<string | null>(null),
    [history, setHistory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null),
    lost = useRef(onAccessLost);
  lost.current = onAccessLost;
  const ink = useInk();
  const load = useCallback(
    async (before?: string) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      setBusy(true);
      setError(false);
      if (!before) {
        setEntries([]);
        setNext(null);
      }
      try {
        const page = await readDecisions(
          credential,
          context,
          { fetcher: businessFetch, signal: request.signal },
          { before, branchId, history },
        );
        if (request.signal.aborted) return;
        setEntries((previous) =>
          before
            ? [
                ...previous,
                ...page.entries.filter(
                  (row) => !previous.some((old) => old.id === row.id),
                ),
              ]
            : page.entries,
        );
        setNext(page.nextCursor);
      } catch (error) {
        if (request.signal.aborted) return;
        setEntries([]);
        setNext(null);
        setError(true);
        if (accessLost(error)) lost.current();
      } finally {
        if (!request.signal.aborted) setBusy(false);
      }
    },
    [credential, context, branchId, history],
  );
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  useEffect(() => {
    onRefreshBinding({ run: () => void load(), busy });
    return () => onRefreshBinding(null);
  }, [load, busy, onRefreshBinding]);
  return (
    <>
      <Text style={ink}>{t("approvalListHelp")}</Text>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <Button
          label={t("decisionOpen")}
          secondary={history}
          onPress={() => setHistory(false)}
        />
        <Button
          label={t("decisionHistory")}
          secondary={!history}
          onPress={() => setHistory(true)}
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" style={ink}>
          {t("approvalsUnavailable")}
        </Text>
      )}
      {!busy && !error && !entries.length && (
        <Card>
          <Text style={ink}>
            {t(history ? "noDecisionHistory" : "noOpenDecisions")}
          </Text>
        </Card>
      )}
      {entries.map((row) => (
        <Card key={row.id}>
          <Text style={[ink, { fontWeight: "700" }]}>
            {t("discountRequest", {
              amount: amount(row, row.summary.discountMinor),
            })}
          </Text>
          <Text style={ink}>
            {
              context.branches.find((branch) => branch.id === row.branchId)!
                .name
            }{" "}
            · {row.requester.name ?? t("teamMember")}
          </Text>
          <Text style={ink}>{t(stateKeys[row.state])}</Text>
          <Text style={ink}>{row.summary.reason}</Text>
          <Button
            label={t("reviewDecision")}
            secondary
            onPress={() => onOpen(row.id)}
          />
        </Card>
      ))}
      {next && (
        <Button
          label={t("loadMore")}
          disabled={busy}
          secondary
          onPress={() => void load(next)}
        />
      )}
      <Button
        label={t(busy ? "loading" : "refresh")}
        disabled={busy}
        secondary
        onPress={() => void load()}
      />
    </>
  );
}

export function BusinessApprovalDetail({
  credential,
  context,
  requestId,
  onAccessLost,
  onRefreshBinding,
}: Props & { requestId: string }) {
  useLocale();
  const [row, setRow] = useState<Decision | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<MessageKey | null>(null),
    [choice, setChoice] = useState<"approved" | "declined" | null>(null),
    [reason, setReason] = useState(""),
    [confirming, setConfirming] = useState(false),
    [verified, setVerified] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [, tick] = useState(0);
  const request = useRef<AbortController | null>(null),
    confirmation = useRef<Session | null>(null),
    command = useRef<DecisionAction | null>(null),
    sending = useRef(false),
    mounted = useRef(true),
    lost = useRef(onAccessLost);
  lost.current = onAccessLost;
  const ink = useInk();
  const resumed = pendingConfirmation(credential.origin, context);
  function forgetProof() {
    const proof = confirmation.current;
    confirmation.current = null;
    if (proof)
      void revokeSession(proof, { fetcher: businessFetch }).catch(() => {});
    clearConfirmation();
    setVerified(false);
    setConfirming(false);
  }
  const load = useCallback(async () => {
    if (sending.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage(null);
    try {
      const value = await readDecision(credential, context, requestId, {
        fetcher: businessFetch,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRow(value);
      // A status read resolves an uncertain response; never infer acceptance
      // from the old screen, an optimistic state or a request timeout.
      setUncertain(false);
      if (value.state !== "pending") {
        command.current = null;
        setChoice(null);
        forgetProof();
      }
      if (
        value.requiresStepUp &&
        pendingConfirmation(credential.origin, context)?.requestId === requestId
      )
        setConfirming(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRow(null);
      setMessage("approvalsUnavailable");
      if (accessLost(error)) lost.current();
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [credential, context, requestId]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => {
      mounted.current = false;
      request.current?.abort();
      clearInterval(timer);
      const proof = confirmation.current;
      confirmation.current = null;
      if (proof)
        void revokeSession(proof, { fetcher: businessFetch }).catch(() => {});
    };
  }, [load]);
  useEffect(() => {
    onRefreshBinding({ run: () => void load(), busy });
    return () => onRefreshBinding(null);
  }, [load, busy, onRefreshBinding]);
  async function submit() {
    if (
      !row ||
      !choice ||
      sending.current ||
      (choice === "declined" && !reason.trim())
    )
      return;
    sending.current = true;
    setBusy(true);
    setMessage(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!command.current)
        command.current = {
          decisionId: await proofSource.random(),
          expectedRevision: row.revision,
          outcome: choice,
          reason: reason.trim(),
        };
      if (controller.signal.aborted) return;
      const value = await sendDecision(
        credential,
        context,
        requestId,
        command.current,
        { fetcher: businessFetch, signal: controller.signal },
        confirmation.current ?? undefined,
      );
      if (controller.signal.aborted) return;
      setRow(value);
      setChoice(null);
      setUncertain(false);
      command.current = null;
      forgetProof();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (accessLost(error)) lost.current();
      else if (error instanceof DecisionError) {
        if (error.code === "step_up_required") {
          forgetProof();
          setConfirming(true);
          setMessage("confirmIdentityHelp");
        } else {
          setMessage(
            error.code === "confirmation_account_mismatch"
              ? "confirmationAccountMismatch"
              : "decisionChangedHelp",
          );
          setRow(null);
          setChoice(null);
          command.current = null;
          forgetProof();
        }
      } else {
        setUncertain(true);
        setMessage("decisionUncertain");
      }
    } finally {
      sending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const expired =
    !!row &&
    ["pending", "approved"].includes(row.state) &&
    Date.parse(row.expiresAt) <= Date.now();
  const canDecide = !!row?.canDecide && !expired;
  return (
    <>
      {message && (
        <Text accessibilityRole="alert" style={ink}>
          {t(message)}
        </Text>
      )}
      {row && (
        <>
          <Card>
            <Text
              accessibilityRole="header"
              style={[ink, { fontSize: 23, lineHeight: 30, fontWeight: "700" }]}
            >
              {t("discountRequest", {
                amount: amount(row, row.summary.discountMinor),
              })}
            </Text>
            <Text style={ink}>
              {
                context.branches.find((branch) => branch.id === row.branchId)!
                  .name
              }
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[ink, { fontWeight: "700" }]}
            >
              {t(stateKeys[expired ? "expired" : row.state])}
            </Text>
            <Text style={ink}>
              {t("decisionRequester", {
                name: row.requester.name ?? t("teamMember"),
              })}
            </Text>
            <Text style={ink}>{row.summary.reason}</Text>
            <Text style={ink}>
              {t("decisionItems", { count: row.summary.itemCount })}
            </Text>
            <Text style={ink}>
              {t("decisionBefore", {
                amount: amount(row, row.summary.beforeDiscountMinor),
              })}
            </Text>
            <Text style={ink}>
              {t("decisionDiscount", {
                amount: amount(row, row.summary.discountMinor),
              })}
            </Text>
            {row.summary.roundingMinor !== 0 && (
              <Text style={ink}>
                {t("decisionRounding", {
                  amount: amount(row, row.summary.roundingMinor),
                })}
              </Text>
            )}
            <Text style={[ink, { fontWeight: "700" }]}>
              {t("decisionPayable", {
                amount: amount(row, row.summary.payableMinor),
              })}
            </Text>
            <Text style={ink}>
              {t("decisionExpires", {
                time: new Date(row.expiresAt).toLocaleString(getFormatLocale()),
              })}
            </Text>
            {row.state === "approved" && !expired && (
              <Text style={ink}>{t("approvedNotApplied")}</Text>
            )}
            {row.state === "applying" && (
              <Text style={ink}>{t("applyingHelp")}</Text>
            )}
            {row.unavailableReason === "self_approval" && (
              <Text style={ink}>{t("decisionSelfDenied")}</Text>
            )}
            {row.unavailableReason === "discount_limit" && (
              <Text style={ink}>{t("decisionLimitDenied")}</Text>
            )}
          </Card>
          {canDecide && !uncertain && !choice && (
            <>
              <Button
                label={t("approve")}
                disabled={busy}
                onPress={() => {
                  setChoice("approved");
                  setReason("");
                }}
              />
              <Button
                label={t("decline")}
                disabled={busy}
                secondary
                onPress={() => {
                  setChoice("declined");
                  setReason("");
                }}
              />
            </>
          )}
          {canDecide && choice && !uncertain && (
            <Card>
              <Text style={[ink, { fontWeight: "700" }]}>
                {t(choice === "approved" ? "confirmApprove" : "confirmDecline")}
              </Text>
              <Text style={ink}>{t("decisionConfirmationHelp")}</Text>
              <Text style={ink}>
                {t(
                  choice === "declined"
                    ? "decisionReasonRequired"
                    : "decisionReasonOptional",
                )}
              </Text>
              <TextInput
                accessibilityLabel={t("decisionReason")}
                multiline
                maxLength={500}
                value={reason}
                editable={!busy && !command.current}
                onChangeText={setReason}
                style={[
                  ink,
                  {
                    borderWidth: 1,
                    borderColor: "#859ba7",
                    borderRadius: 12,
                    padding: 12,
                    minHeight: 90,
                    textAlignVertical: "top",
                  },
                ]}
              />
              {row.requiresStepUp && !verified && (
                <Button
                  label={t("confirmIdentity")}
                  disabled={busy}
                  onPress={() => setConfirming(true)}
                />
              )}
              <Button
                label={t(
                  choice === "approved" ? "sendApproval" : "sendDecline",
                )}
                disabled={
                  busy ||
                  (row.requiresStepUp && !verified) ||
                  (choice === "declined" && !reason.trim())
                }
                onPress={() => void submit()}
              />
              <Button
                label={t("cancel")}
                secondary
                disabled={busy}
                onPress={() => {
                  setChoice(null);
                  command.current = null;
                  forgetProof();
                }}
              />
            </Card>
          )}
          {canDecide && confirming && !verified && (
            <AuthorizationPanel
              origin={credential.authorizationOrigin ?? credential.origin}
              stepUp
              initialAttempt={
                resumed?.requestId === requestId ? resumed.attempt : null
              }
              onAttempt={(attempt) =>
                attempt
                  ? rememberConfirmation(
                      credential.origin,
                      context,
                      requestId,
                      attempt,
                    )
                  : clearConfirmation()
              }
              onConnected={(proof) => {
                if (!mounted.current) {
                  void revokeSession(proof, { fetcher: businessFetch }).catch(
                    () => {},
                  );
                  return;
                }
                try {
                  validateConfirmation(credential, context, proof);
                  confirmation.current = proof;
                  clearConfirmation();
                  setVerified(true);
                  setConfirming(false);
                  setMessage("identityConfirmed");
                } catch {
                  void revokeSession(proof, { fetcher: businessFetch }).catch(
                    () => {},
                  );
                  clearConfirmation();
                  setConfirming(false);
                  setMessage("confirmationAccountMismatch");
                }
              }}
            />
          )}
          <Card>
            <Text
              accessibilityRole="header"
              style={[ink, { fontWeight: "700" }]}
            >
              {t("decisionHistory")}
            </Text>
            {row.timeline.map((event, index) => (
              <Text key={index} style={ink}>
                {t(stateKeys[event.state])} ·{" "}
                {new Date(event.at).toLocaleString(getFormatLocale())}
              </Text>
            ))}
            {row.decision && (
              <Text style={ink}>
                {t("decidedBy", {
                  name: row.decision.approver.name ?? t("teamMember"),
                })}
                {row.decision.reason ? " · " + row.decision.reason : ""}
              </Text>
            )}
          </Card>
        </>
      )}
      {uncertain && command.current && (
        <Button
          label={t("retrySameDecision")}
          disabled={busy}
          onPress={() => void submit()}
        />
      )}
      <Button
        label={t(busy ? "loading" : "refresh")}
        secondary
        disabled={busy}
        onPress={() => void load()}
      />
    </>
  );
}
