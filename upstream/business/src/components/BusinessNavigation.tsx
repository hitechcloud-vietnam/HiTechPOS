import { insightText } from "../i18n/insights";
import { canReadInbox } from "../services/notifications";
import { useLocale } from "../i18n/useLocale";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
  type RouteProp,
  useNavigationContainerRef,
  usePreventRemove,
  useScrollToTop,
  type NavigationAction,
  type NavigatorScreenParams,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { type Credential } from "../services/sessionVault";
import { type BusinessContext } from "../domain/contracts";
import { supportsRememberedSession } from "../platform/vault";
import { supportsPush } from "../platform/push";
import { t, isRTL } from "../i18n";
import { Card, Button } from "./ui";
import { LiveOverview, type RefreshBinding } from "./LiveOverview";
import { BusinessInsights } from "./BusinessInsights";
import { BusinessStock } from "./BusinessStock";
import { BusinessItems } from "./BusinessItems";
import { BusinessInbox } from "./BusinessInbox";
import { BusinessApprovals, BusinessApprovalDetail } from "./BusinessApprovals";
import { pendingConfirmation } from "../services/pendingConfirmation";
import { NotificationSettings } from "./NotificationSettings";
import { ReportingDesktop } from "./ReportingDesktop";
import { ConnectedDevices } from "./ConnectedDevices";
import { PushSettings } from "./PushSettings";
import { type usePushSettings } from "./usePushSettings";
import { useReducedMotion } from "./useReducedMotion";
import { LanguageSettings } from "./LanguageSettings";
import { type ReportPeriod } from "../domain/reportPeriod";

type Tabs = {
  Today: undefined;
  Insights: { period?: ReportPeriod } | undefined;
  Stock: undefined;
  Inbox: undefined;
  More: undefined;
};
type Routes = {
  Home: NavigatorScreenParams<Tabs> | undefined;
  Branches: {
    destination:
      | "scope"
      | "Notifications"
      | "ApprovalNotifications"
      | "StockNotifications"
      | "Publisher";
  };
  Notifications: { branchId: string };
  ApprovalNotifications: { branchId: string };
  StockNotifications: { branchId: string };
  Publisher: { branchId: string };
  Devices: undefined;
  Security: undefined;
  Language: undefined;
  PhoneNotifications: undefined;
  Account: undefined;
  Help: undefined;
  Approvals: undefined;
  Approval: { requestId: string };
};
type Model = {
  credential: Credential;
  context: BusinessContext;
  branch: string | null;
  setBranch: (id: string | null) => void;
  onAccessLost: () => void;
  onSignOut: () => void;
  security: React.ReactNode;
  canLock: boolean;
  push: ReturnType<typeof usePushSettings>;
  generation: number;
  publisherChanged: () => void;
};
const Context = createContext<Model | null>(null);
function useModel() {
  const value = useContext(Context);
  if (!value) throw new Error("Account missing");
  return value;
}
const Stack = createNativeStackNavigator<Routes>(),
  Tab = createBottomTabNavigator<Tabs>();
function palette(dark: boolean) {
  return {
    ink: dark ? "#eef5fa" : "#172b37",
    muted: dark ? "#afc1cb" : "#566a77",
    background: dark ? "#101e26" : "#f5f7f8",
    card: dark ? "#192d38" : "#ffffff",
    brand: dark ? "#71d9ba" : "#146b54",
    border: dark ? "#36505e" : "#d9e2e7",
  };
}
function Page({
  children,
  top = false,
  refresh,
}: {
  children: React.ReactNode;
  top?: boolean;
  refresh?: RefreshBinding;
}) {
  const insets = useSafeAreaInsets(),
    colors = palette(useColorScheme() === "dark");
  const scroll = useRef<ScrollView>(null),
    focused = useRef(false),
    binding = useRef(refresh);
  binding.current = refresh;
  useScrollToTop(scroll);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) binding.current?.run();
      focused.current = true;
    }, []),
  );
  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingHorizontal: 22,
        paddingTop: 22 + (top ? insets.top : 0),
        paddingBottom: 30,
        gap: 16,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      scrollsToTop
      refreshControl={
        <RefreshControl
          enabled={!!refresh}
          refreshing={refresh?.busy ?? false}
          onRefresh={refresh?.run}
          tintColor={colors.brand}
        />
      }
    >
      {children}
    </ScrollView>
  );
}
function Heading({ children }: { children: React.ReactNode }) {
  const colors = palette(useColorScheme() === "dark");
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: colors.ink,
        fontSize: 27,
        lineHeight: 34,
        fontWeight: "700",
      }}
    >
      {children}
    </Text>
  );
}
function MenuRow({
  title,
  detail,
  icon,
  onPress,
}: {
  title: string;
  detail?: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}) {
  const colors = palette(useColorScheme() === "dark");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 72,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={23} color={colors.brand} accessible={false} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "600" }}>
          {title}
        </Text>
        {detail ? (
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={isRTL() ? "chevron-back" : "chevron-forward"}
        size={18}
        color={colors.muted}
        accessible={false}
      />
    </Pressable>
  );
}
function Scope() {
  useLocale();
  const model = useModel(),
    navigation = useNavigation<NativeStackScreenProps<Routes>["navigation"]>(),
    colors = palette(useColorScheme() === "dark");
  const selected = model.context.branches.find(
    (branch) => branch.id === model.branch,
  );
  if (model.context.branches.length === 1)
    return (
      <Text style={{ color: colors.muted, fontSize: 15 }}>
        {t("branchLabel", { name: model.context.branches[0]!.name })}
      </Text>
    );
  if (!model.context.branches.length) return null;
  return (
    <Button
      secondary
      label={selected?.name ?? t("allBranches")}
      onPress={() => navigation.navigate("Branches", { destination: "scope" })}
    />
  );
}
function Today() {
  useLocale();
  const navigation =
    useNavigation<NativeStackScreenProps<Routes>["navigation"]>();
  const model = useModel(),
    [refresh, setRefresh] = useState<RefreshBinding>(null),
    colors = palette(useColorScheme() === "dark");
  return (
    <Page top refresh={refresh}>
      <Text
        style={{
          color: colors.brand,
          letterSpacing: 1.5,
          fontSize: 12,
          fontWeight: "700",
        }}
      >
        {t("appName").toUpperCase()}
      </Text>
      <Heading>{model.context.businessName}</Heading>
      <Scope />
      {model.context.capabilities.includes("overview.read") &&
      model.context.branches.length ? (
        <LiveOverview
          key={model.generation}
          credential={model.credential}
          context={model.context}
          branch={model.branch}
          onAccessLost={model.onAccessLost}
          onRefreshBinding={setRefresh}
        />
      ) : (
        <Card>
          <Heading>{t("noAccess")}</Heading>
          <Text style={{ color: colors.muted, lineHeight: 23 }}>
            {t("noAccessHelp")}
          </Text>
        </Card>
      )}
      {model.context.capabilities.includes("overview.read") && (
        <>
          <MenuRow
            title={insightText("Yesterday")}
            icon="calendar-outline"
            onPress={() =>
              navigation.navigate("Home", {
                screen: "Insights",
                params: { period: "yesterday" },
              })
            }
          />
          <MenuRow
            title={insightText("Last week")}
            icon="calendar-outline"
            onPress={() =>
              navigation.navigate("Home", {
                screen: "Insights",
                params: { period: "lastWeek" },
              })
            }
          />
        </>
      )}
      {model.context.capabilities.includes("approvals.read") && (
        <MenuRow
          title={t("approvals")}
          detail={t("approvalListHelp")}
          icon="checkmark-circle-outline"
          onPress={() => navigation.navigate("Approvals")}
        />
      )}
      {model.context.capabilities.includes("stock.read") && (
        <MenuRow
          title={t("stock")}
          icon="cube-outline"
          onPress={() => navigation.navigate("Home", { screen: "Stock" })}
        />
      )}
    </Page>
  );
}
function Insights() {
  useLocale();
  const route = useRoute<RouteProp<Tabs, "Insights">>();
  const focused = useIsFocused();
  const model = useModel(),
    [refresh, setRefresh] = useState<RefreshBinding>(null);
  return (
    <Page top refresh={refresh}>
      <Heading>{t("insights")}</Heading>
      <Scope />
      {focused && (
        <BusinessInsights
          key={`${model.generation}:${route.params?.period}`}
          initialPeriod={route.params?.period}
          credential={model.credential}
          context={model.context}
          branch={model.branch}
          onAccessLost={model.onAccessLost}
          onRefreshBinding={setRefresh}
        />
      )}
    </Page>
  );
}
function Stock() {
  useLocale();
  const model = useModel(),
    focused = useIsFocused(),
    navigation = useNavigation<NativeStackScreenProps<Routes>["navigation"]>();
  const [refresh, setRefresh] = useState<RefreshBinding>(null);
  return (
    <Page top refresh={refresh}>
      <Scope />
      {model.context.capabilities.includes("notifications.self.manage") &&
        model.context.branches.length > 0 && (
          <Button
            label={t("stockAlerts")}
            secondary
            onPress={() => {
              const branchId =
                model.branch ??
                (model.context.branches.length === 1
                  ? model.context.branches[0]!.id
                  : null);
              if (branchId)
                navigation.navigate("StockNotifications", { branchId });
              else
                navigation.navigate("Branches", {
                  destination: "StockNotifications",
                });
            }}
          />
        )}
      {focused && (
        <BusinessStock
          key={model.generation}
          credential={model.credential}
          context={model.context}
          branch={model.branch}
          onAccessLost={model.onAccessLost}
          onRefreshBinding={setRefresh}
        />
      )}
    </Page>
  );
}
function Inbox() {
  useLocale();
  const focused = useIsFocused();
  const model = useModel(),
    navigation = useNavigation<NativeStackScreenProps<Routes>["navigation"]>(),
    [refresh, setRefresh] = useState<RefreshBinding>(null);
  return (
    <Page top refresh={refresh}>
      {model.context.capabilities.includes("approvals.read") && (
        <MenuRow
          title={t("approvals")}
          detail={t("approvalListHelp")}
          icon="checkmark-circle-outline"
          onPress={() => navigation.navigate("Approvals")}
        />
      )}
      {focused && (
        <BusinessInbox
          credential={model.credential}
          context={model.context}
          onAccessLost={model.onAccessLost}
          onRefreshBinding={setRefresh}
          onOpenApproval={(requestId) =>
            navigation.navigate("Approval", { requestId })
          }
        />
      )}
    </Page>
  );
}
function More() {
  useLocale();
  const model = useModel(),
    navigation = useNavigation<NativeStackScreenProps<Routes>["navigation"]>();
  function openModule(
    name:
      | "Notifications"
      | "ApprovalNotifications"
      | "StockNotifications"
      | "Publisher",
  ) {
    const branchId =
      model.branch ??
      (model.context.branches.length === 1
        ? model.context.branches[0]!.id
        : null);
    if (branchId) navigation.navigate(name, { branchId });
    else navigation.navigate("Branches", { destination: name });
  }
  return (
    <Page top>
      <Heading>{t("more")}</Heading>
      <Scope />
      <MenuRow
        title={insightText("Account & server")}
        icon="person-circle-outline"
        onPress={() => navigation.navigate("Account")}
      />
      {model.context.capabilities.includes("approvals.read") &&
        model.context.branches.length > 0 && (
          <MenuRow
            title={t("approvals")}
            icon="checkmark-circle-outline"
            onPress={() => navigation.navigate("Approvals")}
          />
        )}
      {model.context.capabilities.includes("overview.read") &&
        model.context.capabilities.includes("notifications.self.manage") &&
        model.context.branches.length > 0 && (
          <MenuRow
            title={t("notificationSettings")}
            detail={t("notificationMenuHelp")}
            icon="notifications-outline"
            onPress={() => openModule("Notifications")}
          />
        )}
      {model.context.capabilities.includes("approvals.read") &&
        model.context.capabilities.includes("notifications.self.manage") &&
        model.context.branches.length > 0 && (
          <MenuRow
            title={t("approvalAlerts")}
            icon="notifications-outline"
            onPress={() => openModule("ApprovalNotifications")}
          />
        )}
      {model.context.capabilities.includes("stock.read") &&
        model.context.capabilities.includes("notifications.self.manage") &&
        model.context.branches.length > 0 && (
          <MenuRow
            title={t("stockAlerts")}
            icon="notifications-outline"
            onPress={() => openModule("StockNotifications")}
          />
        )}
      {supportsPush && (
        <MenuRow
          title={t("phoneNotifications")}
          icon="phone-portrait-outline"
          onPress={() => navigation.navigate("PhoneNotifications")}
        />
      )}
      {model.context.capabilities.includes("reporting.manage") &&
        model.context.branches.length > 0 && (
          <MenuRow
            title={t("reportingDesktop")}
            detail={t("publisherMenuHelp")}
            icon="desktop-outline"
            onPress={() => openModule("Publisher")}
          />
        )}
      <MenuRow
        title={t("connectedDevices")}
        detail={t("deviceMenuHelp")}
        icon="phone-portrait-outline"
        onPress={() => navigation.navigate("Devices")}
      />
      {supportsRememberedSession && (
        <>
          <MenuRow
            title={t("securitySettings")}
            detail={t("securityMenuHelp")}
            icon="shield-checkmark-outline"
            onPress={() => navigation.navigate("Security")}
          />
          {model.canLock && (
            <Button
              label={t("lockApp")}
              secondary
              onPress={model.onAccessLost}
            />
          )}
        </>
      )}
      <MenuRow
        title={t("language")}
        icon="language-outline"
        onPress={() => navigation.navigate("Language")}
      />
      <Button label={t("signOut")} secondary onPress={model.onSignOut} />
      <MenuRow
        title={insightText("Help & about")}
        icon="help-circle-outline"
        onPress={() => navigation.navigate("Help")}
      />
    </Page>
  );
}
function ApprovalsPage({
  navigation,
}: NativeStackScreenProps<Routes, "Approvals">) {
  const model = useModel(),
    [refresh, setRefresh] = useState<RefreshBinding>(null);
  return (
    <Page refresh={refresh}>
      <Scope />
      <BusinessApprovals
        credential={model.credential}
        context={model.context}
        branchId={model.branch ?? undefined}
        onAccessLost={model.onAccessLost}
        onRefreshBinding={setRefresh}
        onOpen={(requestId) => navigation.navigate("Approval", { requestId })}
      />
    </Page>
  );
}
function ApprovalPage({ route }: NativeStackScreenProps<Routes, "Approval">) {
  const model = useModel(),
    [refresh, setRefresh] = useState<RefreshBinding>(null);
  return (
    <Page refresh={refresh}>
      <BusinessApprovalDetail
        credential={model.credential}
        context={model.context}
        requestId={route.params.requestId}
        onAccessLost={model.onAccessLost}
        onRefreshBinding={setRefresh}
      />
    </Page>
  );
}
function Home() {
  const locale = useLocale();
  const model = useModel(),
    colors = palette(useColorScheme() === "dark");
  const insets = useSafeAreaInsets();
  const { fontScale, width } = useWindowDimensions();
  const [labelHeight, setLabelHeight] = useState(18 * fontScale);
  useEffect(() => setLabelHeight(18 * fontScale), [locale, fontScale, width]);
  return (
    <Tab.Navigator
      backBehavior="initialRoute"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: Math.max(70, 42 + labelHeight) + insets.bottom,
          paddingTop: 4,
          paddingBottom: Math.max(4, insets.bottom),
        },
        tabBarAccessibilityLabel: t(
          route.name === "Today"
            ? "today"
            : route.name === "Insights"
              ? "insights"
              : route.name === "Stock"
                ? "stock"
                : route.name === "Inbox"
                  ? "inbox"
                  : "more",
        ),
        tabBarLabelPosition: "below-icon",
        tabBarLabel: ({ color }) => (
          <Text
            onLayout={(event) => {
              const height = Math.ceil(event.nativeEvent.layout.height);
              if (Number.isFinite(height))
                setLabelHeight((previous) => Math.max(previous, height));
            }}
            style={{
              color,
              fontSize: 12,
              lineHeight: 18,
              fontWeight: "600",
              textAlign: "center",
              alignSelf: "stretch",
              maxWidth: "100%",
            }}
          >
            {t(
              route.name === "Today"
                ? "today"
                : route.name === "Insights"
                  ? "insights"
                  : route.name === "Stock"
                    ? "stock"
                    : route.name === "Inbox"
                      ? "inbox"
                      : "more",
            )}
          </Text>
        ),
        tabBarIcon: ({ color, size }) => (
          <Ionicons
            accessible={false}
            name={
              route.name === "Today"
                ? "grid-outline"
                : route.name === "Insights"
                  ? "stats-chart-outline"
                  : route.name === "Stock"
                    ? "cube-outline"
                    : route.name === "Inbox"
                      ? "mail-outline"
                      : "ellipsis-horizontal-circle-outline"
            }
            color={color}
            size={size}
          />
        ),
        tabBarHideOnKeyboard: true,
      })}
    >
      <Tab.Screen
        name="Today"
        component={Today}
        options={{ title: t("today") }}
      />
      {model.context.capabilities.includes("overview.read") &&
        model.context.branches.length > 0 && (
          <Tab.Screen
            name="Insights"
            component={Insights}
            options={{ title: t("insights") }}
          />
        )}
      {canReadInbox(model.context) && (
        <Tab.Screen
          name="Inbox"
          component={Inbox}
          options={{ title: t("inbox") }}
        />
      )}
      {model.context.capabilities.includes("stock.read") &&
        model.context.branches.length > 0 && (
          <Tab.Screen
            name="Stock"
            component={Stock}
            options={{ title: t("stock") }}
          />
        )}
      <Tab.Screen name="More" component={More} options={{ title: t("more") }} />
    </Tab.Navigator>
  );
}
function Branches({
  navigation,
  route,
}: NativeStackScreenProps<Routes, "Branches">) {
  useLocale();
  const model = useModel();
  function choose(branchId: string | null) {
    model.setBranch(branchId);
    if (route.params.destination === "scope") navigation.goBack();
    else if (branchId)
      navigation.replace(route.params.destination, { branchId });
  }
  return (
    <Page>
      {route.params.destination === "scope" && (
        <Button
          label={t("allBranches")}
          secondary={model.branch !== null}
          onPress={() => choose(null)}
        />
      )}
      {model.context.branches.map((branch) => (
        <Button
          key={branch.id}
          label={branch.name}
          secondary={model.branch !== branch.id}
          onPress={() => choose(branch.id)}
        />
      ))}
      <Button
        label={t("cancel")}
        secondary
        onPress={() => navigation.goBack()}
      />
    </Page>
  );
}
function NotificationPage({
  route,
  navigation,
}: NativeStackScreenProps<
  Routes,
  "Notifications" | "ApprovalNotifications" | "StockNotifications"
>) {
  useLocale();
  const reducedMotion = useReducedMotion();
  const model = useModel(),
    [dirty, setDirty] = useState(false),
    [action, setAction] = useState<NavigationAction | null>(null),
    colors = palette(useColorScheme() === "dark");
  usePreventRemove(dirty, ({ data }) => setAction(data.action));
  return (
    <>
      <Page>
        <Heading>
          {
            model.context.branches.find(
              (branch) => branch.id === route.params.branchId,
            )?.name
          }
        </Heading>
        <NotificationSettings
          key={route.name + route.params.branchId + model.generation}
          approvalContext={
            route.name === "ApprovalNotifications" ? model.context : undefined
          }
          stockContext={
            route.name === "StockNotifications" ? model.context : undefined
          }
          summaryContext={model.context}
          page
          credential={model.credential}
          branchId={route.params.branchId}
          onAccessLost={model.onAccessLost}
          onClose={() => navigation.goBack()}
          onDirtyChanged={setDirty}
        />
      </Page>
      <Modal
        visible={!!action}
        transparent
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={() => setAction(null)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 24,
            backgroundColor: "rgba(0,0,0,0.45)",
          }}
          accessibilityViewIsModal
        >
          <Card>
            <Heading>{t("discardChanges")}</Heading>
            <Text style={{ color: colors.ink, lineHeight: 23 }}>
              {t("discardChangesHelp")}
            </Text>
            <Button label={t("keepEditing")} onPress={() => setAction(null)} />
            <Button
              label={t("discard")}
              secondary
              onPress={() => {
                if (action) navigation.dispatch(action);
                setAction(null);
              }}
            />
          </Card>
        </View>
      </Modal>
    </>
  );
}
export function BusinessNavigation({
  credential,
  context,
  onAccessLost,
  onSignOut,
  security,
  canLock,
  push,
  inboxIntent,
  onInboxConsumed,
}: Omit<Model, "branch" | "setBranch" | "generation" | "publisherChanged"> & {
  inboxIntent: number;
  onInboxConsumed: () => void;
}) {
  useLocale();
  const [branch, setBranch] = useState<string | null>(null),
    [generation, setGeneration] = useState(0);
  const reducedMotion = useReducedMotion();
  const navigation = useNavigationContainerRef<Routes>(),
    dark = useColorScheme() === "dark",
    colors = palette(dark);
  function openPendingInbox() {
    if (inboxIntent && navigation.isReady() && canReadInbox(context)) {
      if (context.branches.length > 0)
        navigation.navigate("Home", { screen: "Inbox" });
      onInboxConsumed();
    }
  }
  useEffect(openPendingInbox, [inboxIntent]);
  const model: Model = {
    credential,
    context,
    branch,
    setBranch,
    onAccessLost,
    onSignOut,
    security,
    canLock,
    push,
    generation,
    publisherChanged: () => setGeneration((value) => value + 1),
  };
  return (
    <Context.Provider value={model}>
      <NavigationContainer
        direction={isRTL() ? "rtl" : "ltr"}
        ref={navigation}
        onReady={() => {
          const pending = pendingConfirmation(credential.origin, context);
          if (pending && context.capabilities.includes("approvals.read"))
            navigation.navigate("Approval", { requestId: pending.requestId });
          else openPendingInbox();
        }}
        theme={{
          ...(dark ? DarkTheme : DefaultTheme),
          colors: {
            ...(dark ? DarkTheme : DefaultTheme).colors,
            primary: colors.brand,
            background: colors.background,
            card: colors.card,
            text: colors.ink,
            border: colors.border,
          },
        }}
      >
        <Stack.Navigator
          screenOptions={{
            headerBackTitle: t("back"),
            animation: reducedMotion ? "none" : "default",
            headerTintColor: colors.brand,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen
            name="Home"
            component={Home}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Branches"
            component={Branches}
            options={{ title: t("chooseBranch"), presentation: "modal" }}
          />
          {context.capabilities.includes("approvals.read") && (
            <>
              <Stack.Screen
                name="Approvals"
                component={ApprovalsPage}
                options={{ title: t("approvals") }}
              />
              <Stack.Screen
                name="Approval"
                component={ApprovalPage}
                options={{ title: t("reviewDecision") }}
              />
            </>
          )}
          <Stack.Screen
            name="Notifications"
            component={NotificationPage}
            options={{ title: t("notificationSettings") }}
          />
          {context.capabilities.includes("approvals.read") &&
            context.capabilities.includes("notifications.self.manage") && (
              <Stack.Screen
                name="ApprovalNotifications"
                component={NotificationPage}
                options={{ title: t("approvalAlerts") }}
              />
            )}
          {context.capabilities.includes("stock.read") &&
            context.capabilities.includes("notifications.self.manage") && (
              <Stack.Screen
                name="StockNotifications"
                component={NotificationPage}
                options={{ title: t("stockAlerts") }}
              />
            )}
          <Stack.Screen
            name="Publisher"
            options={{ title: t("reportingDesktop") }}
          >
            {({ route, navigation: nav }) => (
              <Page>
                <ReportingDesktop
                  page
                  credential={credential}
                  branchId={route.params.branchId}
                  onAccessLost={onAccessLost}
                  onChanged={model.publisherChanged}
                  onClose={() => nav.goBack()}
                />
              </Page>
            )}
          </Stack.Screen>
          <Stack.Screen
            name="Devices"
            options={{ title: t("connectedDevices") }}
          >
            {({ navigation: nav }) => (
              <Page>
                <ConnectedDevices
                  page
                  credential={credential}
                  onAccessLost={onAccessLost}
                  onClose={() => nav.goBack()}
                />
              </Page>
            )}
          </Stack.Screen>
          <Stack.Screen
            name="Security"
            options={{ title: t("securitySettings") }}
          >
            {() => <Page>{security}</Page>}
          </Stack.Screen>
          <Stack.Screen name="Language" options={{ title: t("language") }}>
            {() => (
              <Page>
                <LanguageSettings page />
              </Page>
            )}
          </Stack.Screen>
          <Stack.Screen
            name="Account"
            options={{ title: insightText("Account & server") }}
          >
            {() => (
              <Page>
                <Card>
                  <Heading>{context.businessName}</Heading>
                  <Text style={{ color: colors.ink }}>{credential.origin}</Text>
                  <Text style={{ color: colors.ink }}>
                    {t("sessionExpires", {
                      date: new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                      }).format(new Date(credential.expiresAt)),
                    })}
                  </Text>
                </Card>
                <Scope />
                <MenuRow
                  title={t("connectedDevices")}
                  icon="phone-portrait-outline"
                  onPress={() => navigation.navigate("Devices")}
                />
                <Button secondary label={t("signOut")} onPress={onSignOut} />
              </Page>
            )}
          </Stack.Screen>
          <Stack.Screen
            name="Help"
            options={{ title: insightText("Help & about") }}
          >
            {() => (
              <Page>
                <Card>
                  <Heading>{t("appName")}</Heading>
                  <Text style={{ color: colors.ink }}>
                    {t("summaryCompleteness")}
                  </Text>
                  <Text style={{ color: colors.ink }}>
                    {t("salesDefinition")}
                  </Text>
                  <Text style={{ color: colors.ink }}>{t("noAccessHelp")}</Text>
                </Card>
              </Page>
            )}
          </Stack.Screen>
          <Stack.Screen
            name="PhoneNotifications"
            options={{ title: t("phoneNotifications") }}
          >
            {() => (
              <Page>
                <PushSettings state={push} />
              </Page>
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </Context.Provider>
  );
}
