import { useLocale } from "./i18n/useLocale";
import { deviceFormatting, refreshFormattingTimeZone } from "./i18n/intl";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  hasCapability,
  canShowBranchSelector,
  resolveBranchScope,
} from "./domain/contracts";
import { averageBill, formatMoney } from "./domain/money";
import { recordSwipe, adjacentIndex } from "./domain/gestures";
import { communityOrigin } from "./domain/server";
import {
  CLOUD_ORIGIN,
  ConnectionError,
  discoverBusinessServer,
} from "./services/businessConnection";
import {
  sampleContext,
  sampleOverview,
  sampleItems,
  sampleStock,
  type SampleProfile,
  type SampleNetwork,
} from "./data/sample";
import { t, isRTL, translator, getTextAlign } from "./i18n";
import { readLanguage } from "./platform/language";
import { watchPushChannelLanguage } from "./platform/push";
import { LanguageSettings } from "./components/LanguageSettings";
import { Button, Card, UIContext } from "./components/ui";
import { AuthorizationPanel } from "./components/AuthorizationPanel";
import { AccountScreen } from "./components/AccountScreen";
import { type Session } from "./services/authorization";
import { supportsRememberedSession, vault } from "./platform/vault";
import { businessFetch } from "./platform/network";

type Tab = "today" | "insights" | "inbox" | "more";
function BusinessApp() {
  useLocale();
  const dark = useColorScheme() === "dark",
    { width } = useWindowDimensions();
  const colors = dark
    ? {
        bg: "#141c23",
        paper: "#202b34",
        ink: "#eef5fa",
        muted: "#b1c1cb",
        line: "#384851",
        brand: "#8bdfbf",
        onBrand: "#123427",
        soft: "#233f35",
      }
    : {
        bg: "#f5f7f8",
        paper: "#ffffff",
        ink: "#172b37",
        muted: "#566a77",
        line: "#dce5e9",
        brand: "#146b54",
        onBrand: "#ffffff",
        soft: "#e8f4ee",
      };
  const styles = useMemo(
    () =>
      StyleSheet.create({
        shell: {
          flex: 1,
          backgroundColor: colors.bg,
          direction: isRTL() ? "rtl" : "ltr",
        },
        frame: { flex: 1, width: "100%", maxWidth: 520, alignSelf: "center" },
        body: { padding: 22, paddingBottom: 32, gap: 14 },
        brand: {
          textAlign: getTextAlign(),
          color: colors.brand,
          fontSize: 12,
          fontWeight: "700",
          letterSpacing: 1.5,
        },
        heading: {
          textAlign: getTextAlign(),
          color: colors.ink,
          fontSize: 30,
          fontWeight: "700",
          letterSpacing: -0.6,
        },
        sub: {
          color: colors.muted,
          fontSize: 13,
          lineHeight: 20,
          textAlign: getTextAlign(),
        },
        text: {
          color: colors.ink,
          fontSize: 15,
          lineHeight: 23,
          textAlign: getTextAlign(),
        },
        card: {
          padding: 19,
          backgroundColor: colors.paper,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.line,
          gap: 12,
        },
        title: {
          color: colors.ink,
          fontSize: 18,
          fontWeight: "600",
          textAlign: getTextAlign(),
        },
        total: {
          textAlign: getTextAlign(),
          color: colors.ink,
          fontSize: 39,
          fontWeight: "700",
          fontVariant: ["tabular-nums"],
          letterSpacing: -1,
        },
        row: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        },
        half: { flex: 1, minWidth: 115, gap: 5 },
        button: {
          minHeight: 48,
          borderRadius: 13,
          paddingHorizontal: 16,
          paddingVertical: 12,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.brand,
        },
        buttonText: {
          color: colors.onBrand,
          fontSize: 15,
          fontWeight: "600",
          maxWidth: "100%",
          flexShrink: 1,
          textAlign: "center",
        },
        secondary: {
          backgroundColor: colors.paper,
          borderWidth: 1,
          borderColor: colors.line,
        },
        secondaryText: { color: colors.brand },
        badge: { backgroundColor: colors.soft, borderRadius: 10, padding: 10 },
        nav: {
          flexDirection: "row",
          backgroundColor: colors.paper,
          borderTopWidth: 1,
          borderColor: colors.line,
          padding: 10,
          gap: 3,
        },
        navButton: {
          flex: 1,
          minWidth: 0,
          alignItems: "center",
          justifyContent: "center",
          minHeight: 52,
          borderRadius: 12,
        },
        navLabel: {
          fontSize: 12,
          color: colors.muted,
          alignSelf: "stretch",
          flexShrink: 1,
          textAlign: "center",
        },
        selected: { backgroundColor: colors.soft },
        field: {
          minHeight: 48,
          borderColor: colors.line,
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
          fontSize: 16,
          color: colors.ink,
          backgroundColor: colors.paper,
        },
        divider: { height: 1, backgroundColor: colors.line },
        disabled: { opacity: 0.45 },
      }),
    [dark, isRTL()],
  );
  const [started, setStarted] = useState(false),
    [community, setCommunity] = useState(false),
    [server, setServer] = useState(""),
    [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [compatibleOrigin, setCompatibleOrigin] = useState<string | null>(null);
  const [connectedSession, setConnectedSession] = useState<Session | null>(
    null,
  );
  const [accountOpen, setAccountOpen] = useState(false);
  const [restoringSession, setRestoringSession] = useState(
    supportsRememberedSession,
  );
  useEffect(() => {
    let cancelled = false;
    if (supportsRememberedSession)
      void vault
        .hasCredential()
        .then((saved) => {
          if (!cancelled && saved) setAccountOpen(true);
        })
        .catch(() => {
          if (!cancelled) setMessage(t("storageUnavailable"));
        })
        .finally(() => {
          if (!cancelled) setRestoringSession(false);
        });
    return () => {
      cancelled = true;
    };
  }, []);
  const connectionRequest = useRef<AbortController | null>(null);
  const cancelConnection = () => {
    connectionRequest.current?.abort();
    connectionRequest.current = null;
    setChecking(false);
    setMessage("");
    setCompatibleOrigin(null);
  };
  useEffect(() => () => connectionRequest.current?.abort(), []);
  const checkConnection = async (address: string) => {
    if (connectionRequest.current) return;
    let origin: string;
    try {
      origin = communityOrigin(address);
    } catch {
      setMessage(t("invalidServer"));
      return;
    }
    const request = new AbortController();
    connectionRequest.current = request;
    setChecking(true);
    setMessage(t("checkingServer"));
    try {
      await discoverBusinessServer(origin, {
        signal: request.signal,
        fetcher: businessFetch,
      });
      if (connectionRequest.current === request) {
        setMessage("");
        setCompatibleOrigin(origin);
      }
    } catch (error) {
      if (connectionRequest.current === request) {
        const problem =
          error instanceof ConnectionError ? error.problem : "unreachable";
        setMessage(
          t(
            problem === "unsupported"
              ? "serverUnsupported"
              : problem === "timeout"
                ? "serverTimeout"
                : problem === "busy"
                  ? "serverBusy"
                  : problem === "invalidResponse"
                    ? "serverInvalidResponse"
                    : "serverUnreachable",
          ),
        );
      }
    } finally {
      if (connectionRequest.current === request) {
        connectionRequest.current = null;
        setChecking(false);
      }
    }
  };
  const [profile, setProfile] = useState<SampleProfile>("owner"),
    [network, setNetwork] = useState<SampleNetwork>("current"),
    [tab, setTab] = useState<Tab>("today"),
    [branch, setBranch] = useState<string | null>(null),
    [branchOpen, setBranchOpen] = useState(false),
    [itemIndex, setItemIndex] = useState<number | null>(null),
    [refreshing, setRefreshing] = useState(false);
  const context = useMemo(() => sampleContext(profile), [profile]);
  const scope = resolveBranchScope(context, branch),
    moneyAllowed = hasCapability(context, "overview.read");
  const overview =
    scope.length && moneyAllowed
      ? sampleOverview(context, branch, network)
      : null;
  const items = sampleItems(context, branch),
    stock = sampleStock(context, branch);
  const selectedItem =
    tab === "insights" && itemIndex !== null ? items[itemIndex] : undefined;
  const scroll = useRef<ScrollView>(null),
    scrollPositions = useRef<Record<string, number>>({}),
    generation = useRef(0),
    busy = useRef(false);
  const scrollKey = tab + (selectedItem ? ":" + selectedItem.id : ":list");
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setRefreshing(false);
    setMessage("");
  }, [profile, branch, network, started]);
  useEffect(() => {
    requestAnimationFrame(() =>
      scroll.current?.scrollTo({
        y: scrollPositions.current[scrollKey] ?? 0,
        animated: false,
      }),
    );
  }, [scrollKey]);
  useEffect(() => {
    if (accountOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (community) {
        cancelConnection();
        setCommunity(false);
        return true;
      }
      if (branchOpen) {
        setBranchOpen(false);
        return true;
      }
      if (selectedItem) {
        setItemIndex(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [accountOpen, community, branchOpen, !!selectedItem]);
  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const token = generation.current;
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (token !== generation.current) return;
    busy.current = false;
    setRefreshing(false);
    setMessage(t(network === "offline" ? "offlineRefresh" : "refreshed"));
  };
  const pagingRef = useRef({
    itemIndex,
    selected: !!selectedItem,
    count: items.length,
    width,
  });
  pagingRef.current = {
    itemIndex,
    selected: !!selectedItem,
    count: items.length,
    width,
  };
  const singleTouch = useRef(true),
    gestureStart = useRef(0),
    gestureStartY = useRef(0);
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (e, g) => {
          singleTouch.current = g.numberActiveTouches === 1;
          gestureStart.current = e.nativeEvent.pageX;
          gestureStartY.current = e.nativeEvent.pageY;
          return false;
        },
        onMoveShouldSetPanResponderCapture: (_e, g) => {
          if (g.numberActiveTouches !== 1) singleTouch.current = false;
          const p = pagingRef.current;
          return (
            p.selected &&
            singleTouch.current &&
            recordSwipe(
              g.moveX - gestureStart.current,
              g.moveY - gestureStartY.current,
              gestureStart.current,
              p.width,
              g.numberActiveTouches,
              isRTL(),
            ) !== null
          );
        },
        onPanResponderMove: (_e, g) => {
          if (g.numberActiveTouches !== 1) singleTouch.current = false;
        },
        onPanResponderRelease: (_e, g) => {
          const p = pagingRef.current,
            action = recordSwipe(
              // PanResponder resets dx/dy when it claims the gesture. Keep the
              // original touch origin so the threshold is counted only once.
              g.moveX - gestureStart.current,
              g.moveY - gestureStartY.current,
              gestureStart.current,
              p.width,
              1,
              isRTL(),
            );
          if (
            singleTouch.current &&
            p.selected &&
            p.itemIndex !== null &&
            action
          )
            setItemIndex(adjacentIndex(p.itemIndex, p.count, action));
        },
        onPanResponderTerminate: () => {
          singleTouch.current = false;
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );
  function chooseProfile(p: SampleProfile) {
    setProfile(p);
    setBranch(null);
    setItemIndex(null);
    setBranchOpen(false);
    setTab("today");
    scrollPositions.current = {};
  }
  const freshness = t(
    network === "offline"
      ? "offline"
      : network === "delayed"
        ? "delayed"
        : "current",
  );
  const tabs: Tab[] = [
    "today",
    ...(hasCapability(context, "items.read") ||
    hasCapability(context, "stock.read")
      ? ["insights" as Tab]
      : []),
    "inbox",
    "more",
  ];
  const currency = overview?.currency ?? context.branches[0]?.currency ?? "INR",
    digits = overview?.currencyDigits ?? 2;
  const money = (value: number) => formatMoney(value, currency, digits);
  const title = selectedItem?.name ?? t(tab);
  const noScope = context.branches.length === 0;
  return (
    <UIContext.Provider value={styles}>
      <SafeAreaView
        edges={accountOpen ? ["left", "right"] : undefined}
        style={styles.shell}
      >
        <StatusBar style={dark ? "light" : "dark"} />
        <View style={styles.frame}>
          {accountOpen && !restoringSession ? (
            <AccountScreen
              initialSession={connectedSession}
              onSessionConsumed={() => setConnectedSession(null)}
              onExit={(notice) => {
                setAccountOpen(false);
                setCommunity(false);
                setStarted(false);
                setConnectedSession(null);
                cancelConnection();
                if (notice) setMessage(notice);
              }}
            />
          ) : (
            <>
              <View style={{ flex: 1 }} {...gesture.panHandlers}>
                <ScrollView
                  ref={scroll}
                  contentContainerStyle={styles.body}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode={
                    Platform.OS === "ios" ? "interactive" : "on-drag"
                  }
                  scrollsToTop
                  onScroll={(e) => {
                    scrollPositions.current[scrollKey] =
                      e.nativeEvent.contentOffset.y;
                  }}
                  scrollEventThrottle={100}
                  refreshControl={
                    <RefreshControl
                      enabled={started && tab !== "more" && !noScope}
                      refreshing={refreshing}
                      onRefresh={refresh}
                      tintColor={colors.brand}
                    />
                  }
                >
                  <Text style={styles.brand}>{t("appName").toUpperCase()}</Text>
                  {restoringSession ? (
                    <Text style={styles.text}>{t("unlocking")}</Text>
                  ) : !started ? (
                    <>
                      <Text
                        accessibilityRole="header"
                        style={[
                          styles.heading,
                          { fontSize: 37, marginTop: 24 },
                        ]}
                      >
                        {t("welcome")}
                      </Text>
                      <Text style={styles.sub}>{t("welcomeDetail")}</Text>
                      <LanguageSettings />
                      {community ? (
                        <Card>
                          <Text accessibilityRole="header" style={styles.title}>
                            {t("community")}
                          </Text>
                          <Text style={styles.sub}>{t("serverAddress")}</Text>
                          <TextInput
                            accessibilityLabel={t("serverAddress")}
                            value={server}
                            onChangeText={(value) => {
                              cancelConnection();
                              setServer(value);
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            placeholder="https://shop.example.com"
                            placeholderTextColor={colors.muted}
                            style={[
                              styles.field,
                              { writingDirection: "ltr", textAlign: "left" },
                            ]}
                          />
                          <Button
                            label={t(
                              checking ? "checkingServer" : "secureSignIn",
                            )}
                            disabled={checking || !!compatibleOrigin}
                            onPress={() => {
                              void checkConnection(server);
                            }}
                          />
                          <Button
                            label={t("back")}
                            secondary
                            onPress={() => {
                              cancelConnection();
                              setCommunity(false);
                              setMessage("");
                            }}
                          />
                        </Card>
                      ) : (
                        <Card>
                          <Button
                            label={t("cloud")}
                            disabled={checking || !!compatibleOrigin}
                            onPress={() => {
                              void checkConnection(CLOUD_ORIGIN);
                            }}
                          />
                          <Button
                            label={t("community")}
                            secondary
                            onPress={() => {
                              cancelConnection();
                              setCommunity(true);
                              setMessage("");
                            }}
                          />
                        </Card>
                      )}
                      {compatibleOrigin && (
                        <AuthorizationPanel
                          key={compatibleOrigin}
                          origin={compatibleOrigin}
                          autoStart
                          onCancel={cancelConnection}
                          onConnected={(session) => {
                            setConnectedSession(session);
                            setAccountOpen(true);
                            cancelConnection();
                          }}
                        />
                      )}
                      <Card>
                        <Text style={styles.title}>{t("readOnly")}</Text>
                        <Text style={styles.sub}>{t("sampleHelp")}</Text>
                        <Button
                          label={t("sample")}
                          onPress={() => {
                            cancelConnection();
                            setStarted(true);
                            setCommunity(false);
                            setMessage("");
                          }}
                        />
                      </Card>
                    </>
                  ) : (
                    <>
                      <View style={styles.badge}>
                        <Text style={styles.sub}>{t("sampleNotice")}</Text>
                      </View>
                      {selectedItem && (
                        <Button
                          label={t("back")}
                          secondary
                          onPress={() => setItemIndex(null)}
                        />
                      )}
                      <Text accessibilityRole="header" style={styles.heading}>
                        {title}
                      </Text>
                      <Text style={styles.sub}>{context.businessName}</Text>
                      {(tab === "today" || tab === "insights") &&
                        !selectedItem &&
                        !noScope && (
                          <>
                            {canShowBranchSelector(context) ? (
                              <>
                                <Button
                                  label={
                                    branch === null
                                      ? t("allBranches")
                                      : context.branches.find(
                                          (b) => b.id === branch,
                                        )!.name
                                  }
                                  secondary
                                  onPress={() => setBranchOpen(!branchOpen)}
                                />
                                {branchOpen && (
                                  <Card>
                                    {[
                                      { id: null, name: t("allBranches") },
                                      ...context.branches,
                                    ].map((b) => (
                                      <Button
                                        key={b.id ?? "all"}
                                        label={b.name}
                                        secondary
                                        onPress={() => {
                                          setBranch(b.id);
                                          setBranchOpen(false);
                                          setItemIndex(null);
                                        }}
                                      />
                                    ))}
                                  </Card>
                                )}
                              </>
                            ) : (
                              <Text style={styles.sub}>
                                {t("branchLabel", {
                                  name: context.branches[0]!.name,
                                })}
                              </Text>
                            )}
                            <Text style={styles.sub}>{t("sourceDate")}</Text>
                          </>
                        )}
                      {noScope && tab !== "more" ? (
                        <Card>
                          <Text style={styles.title}>{t("noAccess")}</Text>
                          <Text style={styles.sub}>{t("noAccessHelp")}</Text>
                        </Card>
                      ) : (
                        <>
                          {tab !== "more" && (
                            <View style={styles.row}>
                              <Text style={[styles.sub, { flex: 1 }]}>
                                {freshness}
                              </Text>
                              <Button
                                label={t(refreshing ? "refreshing" : "refresh")}
                                secondary
                                disabled={refreshing}
                                onPress={refresh}
                              />
                            </View>
                          )}
                          {tab === "today" && (
                            <>
                              {overview && (
                                <Card>
                                  <Text style={styles.text}>
                                    {t("netSales")}
                                  </Text>
                                  <Text style={styles.total}>
                                    {money(overview.netSalesMinor)}
                                  </Text>
                                  <Text style={styles.sub}>{t("untaxed")}</Text>
                                  <View style={styles.divider} />
                                  <View style={styles.row}>
                                    <View style={styles.half}>
                                      <Text style={styles.sub}>
                                        {t("completedBills")}
                                      </Text>
                                      <Text style={styles.title}>
                                        {overview.completedSales}
                                      </Text>
                                    </View>
                                    <View style={styles.half}>
                                      <Text style={styles.sub}>
                                        {t("averageBill")}
                                      </Text>
                                      <Text style={styles.title}>
                                        {averageBill(
                                          overview.netSalesMinor,
                                          overview.completedSales,
                                        ) === null
                                          ? "—"
                                          : money(
                                              averageBill(
                                                overview.netSalesMinor,
                                                overview.completedSales,
                                              )!,
                                            )}
                                      </Text>
                                    </View>
                                  </View>
                                </Card>
                              )}
                              {hasCapability(context, "stock.read") && (
                                <Card>
                                  <Text style={styles.title}>{t("stock")}</Text>
                                  {stock.length ? (
                                    stock.map((s) => (
                                      <View key={s.id}>
                                        <Text style={styles.text}>
                                          {s.name} · {s.available} {s.unit}
                                        </Text>
                                        <Text style={styles.sub}>
                                          {t(
                                            s.available === 0
                                              ? "outOfStock"
                                              : "lowStock",
                                          )}{" "}
                                          · Central
                                        </Text>
                                      </View>
                                    ))
                                  ) : (
                                    <Text style={styles.sub}>
                                      {t("stockEmpty")}
                                    </Text>
                                  )}
                                </Card>
                              )}
                              <Text style={styles.sub}>{t("desktop")}</Text>
                            </>
                          )}
                          {tab === "insights" && (
                            <>
                              {selectedItem ? (
                                <>
                                  <View style={styles.row}>
                                    <Button
                                      label={t("previous")}
                                      secondary
                                      disabled={itemIndex === 0}
                                      onPress={() =>
                                        setItemIndex(
                                          adjacentIndex(
                                            itemIndex!,
                                            items.length,
                                            "previous",
                                          ),
                                        )
                                      }
                                    />
                                    <Text style={styles.sub}>
                                      {t("itemPosition", {
                                        position: itemIndex! + 1,
                                        total: items.length,
                                      })}
                                    </Text>
                                    <Button
                                      label={t("next")}
                                      secondary
                                      disabled={itemIndex === items.length - 1}
                                      onPress={() =>
                                        setItemIndex(
                                          adjacentIndex(
                                            itemIndex!,
                                            items.length,
                                            "next",
                                          ),
                                        )
                                      }
                                    />
                                  </View>
                                  <Card>
                                    <Text style={styles.text}>
                                      {t("itemSales")}
                                    </Text>
                                    <Text style={styles.total}>
                                      {money(selectedItem.netSalesMinor)}
                                    </Text>
                                    <Text style={styles.sub}>
                                      {t("quantity")}: {selectedItem.quantity}
                                    </Text>
                                    <Text style={styles.sub}>
                                      {t("itemRanking")}
                                    </Text>
                                  </Card>
                                  <Text style={styles.sub}>
                                    {t("swipeHint")}
                                  </Text>
                                </>
                              ) : (
                                <>
                                  {hasCapability(context, "items.read") && (
                                    <Card>
                                      <Text style={styles.title}>
                                        {t("bestItems")}
                                      </Text>
                                      <Text style={styles.sub}>
                                        {t("itemRanking")}
                                      </Text>
                                      {items.map((item, i) => (
                                        <Pressable
                                          key={item.id}
                                          accessibilityRole="button"
                                          accessibilityLabel={item.name}
                                          onPress={() => setItemIndex(i)}
                                          style={[
                                            styles.row,
                                            {
                                              paddingVertical: 13,
                                              minHeight: 48,
                                            },
                                          ]}
                                        >
                                          <Text
                                            style={[styles.text, { flex: 1 }]}
                                          >
                                            {item.name}
                                          </Text>
                                          <Text style={styles.title}>
                                            {money(item.netSalesMinor)} ›
                                          </Text>
                                        </Pressable>
                                      ))}
                                    </Card>
                                  )}
                                  {hasCapability(context, "stock.read") && (
                                    <Card>
                                      <Text style={styles.title}>
                                        {t("stock")}
                                      </Text>
                                      {stock.length ? (
                                        stock.map((s) => (
                                          <View key={s.id} style={{ gap: 6 }}>
                                            <Text style={styles.title}>
                                              {s.name}
                                            </Text>
                                            <Text style={styles.sub}>
                                              {t("available")}: {s.available}{" "}
                                              {s.unit} · {t("threshold")}:{" "}
                                              {s.threshold}
                                            </Text>
                                          </View>
                                        ))
                                      ) : (
                                        <Text style={styles.sub}>
                                          {t("stockEmpty")}
                                        </Text>
                                      )}
                                    </Card>
                                  )}
                                </>
                              )}
                            </>
                          )}
                          {tab === "inbox" && (
                            <Card>
                              <Text style={styles.title}>{t("noUpdates")}</Text>
                              <Text style={styles.sub}>
                                {t("notificationPlan")}
                              </Text>
                              {hasCapability(context, "approvals.read") && (
                                <Text style={styles.sub}>
                                  {t("approvalPlan")}
                                </Text>
                              )}
                            </Card>
                          )}
                        </>
                      )}
                      {tab === "more" && (
                        <>
                          <LanguageSettings page />
                          {hasCapability(
                            context,
                            "notifications.self.manage",
                          ) && (
                            <Card>
                              <Text style={styles.title}>
                                {t("notifications")}
                              </Text>
                              <Text style={styles.sub}>
                                {t("notificationPlan")}
                              </Text>
                            </Card>
                          )}
                          <Card>
                            <Text style={styles.title}>{t("profile")}</Text>
                            {(
                              [
                                "owner",
                                "manager",
                                "stock",
                                "no-access",
                              ] as const
                            ).map((p) => (
                              <Button
                                key={p}
                                label={t(
                                  p === "stock"
                                    ? "stockProfile"
                                    : p === "no-access"
                                      ? "noAccessProfile"
                                      : p,
                                )}
                                secondary
                                disabled={profile === p}
                                onPress={() => chooseProfile(p)}
                              />
                            ))}
                          </Card>
                          <Card>
                            <Text style={styles.title}>{t("network")}</Text>
                            {(["current", "delayed", "offline"] as const).map(
                              (n) => (
                                <Button
                                  key={n}
                                  label={t(
                                    n === "current"
                                      ? "networkCurrent"
                                      : n === "delayed"
                                        ? "networkDelayed"
                                        : "networkOffline",
                                  )}
                                  secondary
                                  disabled={network === n}
                                  onPress={() => setNetwork(n)}
                                />
                              ),
                            )}
                          </Card>
                          <Button
                            label={t("leaveSample")}
                            secondary
                            onPress={() => {
                              setStarted(false);
                              setItemIndex(null);
                              setTab("today");
                            }}
                          />
                        </>
                      )}
                    </>
                  )}
                  {!!message && (
                    <Text accessibilityLiveRegion="polite" style={styles.sub}>
                      {message}
                    </Text>
                  )}
                </ScrollView>
              </View>
              {started && (
                <View style={styles.nav}>
                  {tabs.map((name) => (
                    <Pressable
                      key={name}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: tab === name }}
                      aria-selected={tab === name}
                      onPress={() => {
                        setMessage("");
                        if (tab === name) {
                          if (selectedItem) setItemIndex(null);
                          else
                            scroll.current?.scrollTo({ y: 0, animated: true });
                        } else setTab(name);
                        setBranchOpen(false);
                      }}
                      style={[
                        styles.navButton,
                        tab === name && styles.selected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.navLabel,
                          tab === name && {
                            color: colors.brand,
                            fontWeight: "700",
                          },
                        ]}
                      >
                        {t(name)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </SafeAreaView>
    </UIContext.Provider>
  );
}
export default function App() {
  const locale = useLocale();
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshFormattingTimeZone();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (Platform.OS === "web") {
      document.documentElement.lang = locale;
      document.documentElement.dir = isRTL() ? "rtl" : "ltr";
    }
  }, [locale]);
  const [languageReady, setLanguageReady] = useState(false);
  useEffect(
    () => (languageReady ? watchPushChannelLanguage() : undefined),
    [languageReady],
  );
  useEffect(() => {
    let mounted = true;
    const fallback = translator.resolveLocale([deviceFormatting.locale]);
    const timer = setTimeout(() => {
      if (mounted) {
        translator.setLocale(fallback);
        setLanguageReady(true);
        mounted = false;
      }
    }, 2000);
    void readLanguage()
      .catch(() => null)
      .then((saved) => {
        if (!mounted) return;
        translator.setLocale(
          saved && translator.available(saved) ? saved : fallback,
        );
        setLanguageReady(true);
        clearTimeout(timer);
      });
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);
  return (
    <SafeAreaProvider>
      {languageReady ? (
        <BusinessApp />
      ) : (
        <View>
          <Text>Posnic Business</Text>
        </View>
      )}
    </SafeAreaProvider>
  );
}
