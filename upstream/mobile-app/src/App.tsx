import type { CatalogueResult } from "./data/catalogueQuery";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  RefreshControl,
  FlatList,
  Image,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as Localization from "expo-localization";
import QRCode from "react-native-qrcode-svg";
import { openStorage } from "./data/openStorage";
import { Repository } from "./data/repository";
import {
  formatMoney,
  normalizeDigits,
  parseMoney,
  parseQuantity,
  quickCode,
  totals,
} from "./domain/money";
import { selectedAccount, upiUri } from "./domain/payments";
import type { Item, Locale, Sale, SessionData } from "./domain/types";
import { detectLocale, translator, translationCoverage } from "./i18n";
import { languages } from "./i18n/registry";

import { PosnicApi, type ServerReceipt } from "./services/api";

import { SyncWorker } from "./services/sync";
import { isLocalServer, parseServerInput } from "./services/serverAddress";
import { discoverServers, type DiscoveredServer } from "./services/discovery";
import { wifiAddress } from "./platform/wifi";
import * as Network from "expo-network";
import { printSale, printTest } from "./platform/printing";
import {
  directPrinterAvailable,
  pairedPrinters,
  usbPrinters,
  authorizeDirectPrinter,
  printDirect,
  testDirect,
} from "./platform/directPrinter";
import type { DirectPrintJob } from "./domain/types";
import { vault } from "./platform/vault";
import { GestureScroll } from "./components/GestureScroll";
import { Connections } from "./components/Connections";
import { Inventory } from "./components/Inventory";
import { adjacentRecord } from "./domain/gestures";
import { deviceOptions, receiptJobMessage } from "./domain/devices";
import { ScanQueue } from "./domain/scanQueue";
import { printNeedsAttention } from "./domain/retention";
import {
  cacheProductImages,
  imageKey,
  productImageUrl,
} from "./services/imageCache";
import { storageUsage } from "./platform/storageUsage";
import { imageFiles, imageFetch } from "./platform/imageFiles";
import { Brand } from "./components/Brand";
import { PhotoOrders } from "./components/PhotoOrders";
import { authorizeAccount } from "./services/accountAuthorization";
import { openAccountBrowser } from "./platform/authBrowser";
import { foreground } from "./platform/foreground";

type Screen =
  | "inventory"
  | "photoOrders"
  | "sell"
  | "quick"
  | "cart"
  | "quantity"
  | "payment"
  | "card"
  | "cash"
  | "upi"
  | "done"
  | "held"
  | "receipts"
  | "more"
  | "language"
  | "printer"
  | "devices"
  | "serverReceipts"
  | "offlineData"
  | "printAttention"
  | "serverSettings"
  | "connection"
  | "customer"
  | "item"
  | "code"
  | "scanner"
  | "externalScanner"
  | "leaveTraining"
  | "pin";
type IconName = React.ComponentProps<typeof Feather>["name"];
const uuid = () => Crypto.randomUUID();

export default function App() {
  return (
    <SafeAreaProvider>
      <Till />
    </SafeAreaProvider>
  );
}

function Till() {
  const [imageReadyCount, setImageReadyCount] = useState(0);
  const visibleImageIds = useRef(new Set<string>());
  const [cachedImages, setCachedImages] = useState<Record<string, string>>({});
  const [diskUsage, setDiskUsage] = useState<{
    used: number;
    available: number;
  } | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [directJobs, setDirectJobs] = useState<DirectPrintJob[]>([]);
  const [printers, setPrinters] = useState<{ address: string; name: string }[]>(
    [],
  );
  const [confirmReprint, setConfirmReprint] = useState(false);
  const scannerInput = useRef<TextInput>(null);
  const scannerValue = useRef("");
  const scanWriting = useRef(0);
  const [scanResult, setScanResult] = useState("");
  const [scannerFocused, setScannerFocused] = useState(false);
  const [receiptJob, setReceiptJob] = useState<{
    saleId: string;
    state: keyof typeof receiptJobMessage;
  } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [receiptDetails, setReceiptDetails] = useState(false);
  const receiptOrder = useRef<string[]>([]);
  const [localSetup, setLocalSetup] = useState(false);
  const [localMethod, setLocalMethod] = useState<
    "menu" | "address" | "wifi" | "pair" | "signin"
  >("menu");

  const [serverReceipts, setServerReceipts] = useState<ServerReceipt[]>([]);
  const [serverCursor, setServerCursor] = useState<string | null>(null);
  const [serverQuery, setServerQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [serverSearched, setServerSearched] = useState(false);
  const [serverReceipt, setServerReceipt] = useState<ServerReceipt | null>(
    null,
  );
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [receiptQuery, setReceiptQuery] = useState("");
  const [authorizationCode, setAuthorizationCode] = useState("");
  const accountRequest = useRef<AbortController | null>(null);
  const itemQueue = useRef<Item[]>([]);
  const addingItems = useRef(false);
  useEffect(() => () => accountRequest.current?.abort(), []);
  const dark = useColorScheme() === "dark",
    dimensions = useWindowDimensions();
  const palette = useMemo(
    () => ({
      paper: dark ? "#182D28" : "#ffffff",
      ink: dark ? "#EDF5EF" : "#193C39",
      muted: dark ? "#A7BEB2" : "#596F64",
      line: dark ? "#344C41" : "#E1E8E0",
      wash: dark ? "#10231D" : "#FFFEFA",
      accent: dark ? "#9CD8BC" : "#176C5C",
      onAccent: dark ? "#102D23" : "#ffffff",
      soft: dark ? "#29483B" : "#EAF3EE",
      danger: dark ? "#FFB5B5" : "#B32F3D",
    }),
    [dark],
  );
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [state, setState] = useState<SessionData | null>(null),
    [repo, setRepo] = useState<Repository | null>(null),
    [worker, setWorker] = useState<SyncWorker | null>(null);
  const scans = useMemo(
    () =>
      repo
        ? new ScanQueue(async (value) => (await acceptProductScan(value)).name)
        : null,
    [repo],
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (value) => {
      if (value !== "active") {
        scans?.cancel();
        scannerInput.current?.blur();
        scannerValue.current = "";
        scannerInput.current?.clear();
      }
    });
    return () => {
      subscription.remove();
      scans?.cancel();
    };
  }, [scans]);
  const [screen, setScreen] = useState<Screen>("sell"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [quantityItem, setQuantityItem] = useState<Item | null>(null);
  const [quantityLine, setQuantityLine] = useState<string | null>(null);
  const [quantityValue, setQuantityValue] = useState("");
  const [itemPage, setItemPage] = useState(0);
  const [catalogueView, setCatalogueView] = useState<CatalogueResult | null>(
    null,
  );
  const [codeMatches, setCodeMatches] = useState<Item[]>([]);

  const [locked, setLocked] = useState(false),
    [pinEnabled, setPinEnabled] = useState(false),
    [pin, setPin] = useState(""),
    [pinConfirm, setPinConfirm] = useState(""),
    [recovering, setRecovering] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootFailure, setBootFailure] = useState("");
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [cash, setCash] = useState(""),
    [code, setCode] = useState("");
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [itemPrice, setItemPrice] = useState(""),
    [itemCode, setItemCode] = useState(""),
    [itemVisual, setItemVisual] = useState("📦");
  const [server, setServer] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [focusedField, setFocusedField] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundServers, setFoundServers] = useState<DiscoveredServer[]>([]);
  const [searchProgress, setSearchProgress] = useState(0);
  const discovery = useRef<AbortController | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshingList, setRefreshingList] = useState(false);
  const syncLock = useRef(false);
  const [connectionError, setConnectionError] = useState("");
  const [changingServer, setChangingServer] = useState(false);
  const [cloudReconnect, setCloudReconnect] = useState(false);
  const [showServerLogin, setShowServerLogin] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const unlockAttempt = useRef(0);
  const [accountId, setAccountId] = useState<string | undefined>(),
    [checked, setChecked] = useState(false),
    [reference, setReference] = useState(""),
    [selectedSale, setLastSale] = useState<Sale | null>(null);
  const lastSale =
    state?.sales.find((sale) => sale.id === selectedSale?.id) ?? selectedSale;
  useEffect(() => setConfirmReprint(false), [selectedSale?.id]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannerHandled = useRef(false),
    actionLock = useRef(false);
  const locale = state?.settings.locale ?? "en",
    t = useMemo(() => translator(locale), [locale]);
  const rtl = languages.find((l) => l.code === locale)?.rtl ?? false;
  const shop = state?.shop;
  const currency = shop?.currency ?? "INR";
  useEffect(() => {
    if (screen !== "offlineData" || locked) return;
    let active = true;
    const measure = () =>
      void storageUsage()
        .then((usage) => {
          if (active) setDiskUsage(usage);
        })
        .catch(() => {
          if (active) setDiskUsage(null);
        });
    measure();
    const timer = setInterval(measure, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [screen, locked, state?.catalogueUpdatedAt]);
  const money = (value: number) => formatMoney(value, currency, locale);
  const sum = totals(state?.cart.lines ?? []);
  const account = shop ? selectedAccount(shop, accountId) : null;
  useEffect(() => {
    const controller = new AbortController();
    let pending: Record<string, string> = {};
    let ready = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const batch = Object.fromEntries(
        Object.entries(pending).filter(([id]) =>
          visibleImageIds.current.has(id),
        ),
      );
      pending = {};
      timer = undefined;
      if (!controller.signal.aborted) {
        setImageReadyCount(ready);
        if (Object.keys(batch).length)
          setCachedImages((previous) => ({ ...previous, ...batch }));
      }
    };
    setCachedImages({});
    setFailedImages({});
    setImageReadyCount(0);
    if (shop && state && repo && !locked) {
      void cacheProductImages(
        repo.imageItems(),
        shop,
        imageFiles,
        controller.signal,
        (id, uri) => {
          ready++;
          if (visibleImageIds.current.has(id)) pending[id] = uri;
          if (!timer) timer = setTimeout(flush, 50);
        },
        imageFetch,
      ).catch(() => {});
    }
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [state?.items, repo, shop?.id, shop?.branchId, shop?.baseUrl, locked]);
  useEffect(() => {
    let active = true;
    const items = catalogueView?.items ?? [];
    visibleImageIds.current = new Set(items.map((item) => item.id));
    setCachedImages({});
    setFailedImages({});
    if (!shop?.baseUrl || locked) return;
    const scope = JSON.stringify([shop.baseUrl, shop.id, shop.branchId]);
    void Promise.all(
      items.map(async (item) => {
        const url = item.image && productImageUrl(item.image, shop.baseUrl!);
        if (!url) return;
        const uri = await imageFiles
          .get(imageKey(scope, url, item.imageRevision))
          .catch(() => null);
        if (uri && active)
          setCachedImages((previous) => ({ ...previous, [item.id]: uri }));
      }),
    );
    return () => {
      active = false;
    };
  }, [catalogueView, shop?.baseUrl, shop?.id, shop?.branchId, locked]);
  const refresh = useCallback(async () => {
    if (repo) {
      setState(await repo.load());
      setDirectJobs(await repo.directPrintJobs());
    }
  }, [repo]);
  useEffect(() => setItemPage(0), [query, category, favouritesOnly]);
  // Loading the basket returns a fresh favourites array. Only its contents,
  // while filtering favourites, can change the catalogue query. Depending on
  // the array identity clears the grid on every item tap and collapses scroll.
  const catalogueFavouriteIds = JSON.stringify(
    favouritesOnly ? (state?.favourites ?? []) : [],
  );
  useEffect(() => {
    let active = true;
    setCatalogueView(null);
    if (!repo || !shop || locked) return;
    const timer = setTimeout(
      () => {
        void repo
          .catalogue({
            ids: favouritesOnly ? JSON.parse(catalogueFavouriteIds) : undefined,
            search: query,
            category,
            offset: itemPage * 48,
            limit: 48,
          })
          .then((result) => {
            if (active) {
              setCatalogueView(result);
              if (itemPage && itemPage * 48 >= result.total) setItemPage(0);
            }
          })
          .catch(() => {
            if (active) setError("storageUnavailable");
          });
      },
      query ? 120 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    repo,
    shop?.snapshotVersion,
    catalogueFavouriteIds,
    favouritesOnly,
    state?.items,
    query,
    category,
    itemPage,
    locked,
  ]);
  useEffect(() => {
    let active = true;
    setCodeMatches([]);
    if (!repo || locked || !code || screen !== "code") return;
    void repo
      .catalogue({ code: normalizeDigits(code), limit: 48 })
      .then((result) => {
        if (active) setCodeMatches(result.items);
      })
      .catch(() => {
        if (active) setError("storageUnavailable");
      });
    return () => {
      active = false;
    };
  }, [repo, code, screen, locked, state?.items]);
  const go = (next: Screen) => {
    setConfirmReprint(false);
    if (scanWriting.current) return;
    setShowServerLogin(false);
    setError("");
    setNotice("");
    scannerValue.current = "";
    scannerInput.current?.clear();
    setScanResult("");
    if (next === "scanner") scannerHandled.current = false;
    if (next === "cash") setCash("");
    if (next === "upi" || next === "card") {
      setAccountId(undefined);
      setChecked(false);
      setReference("");
    }
    if (next === screen) scrollRef.current?.scrollTo({ y: 0, animated: true });
    setScreen(next);
  };

  useEffect(() => {
    let active = true;
    let stage = "STARTUP-CREDENTIALS";
    (async () => {
      setBootFailure("");
      setError("");
      const enabled = await vault.hasPin();
      setPinEnabled(enabled);
      const profile = await vault.profile();
      if (profile) {
        setServer(profile.server);
        setUsername(profile.username);
      }
      const account = await vault.account();
      if (enabled && !account) {
        setLocked(true);
        return;
      }
      if (account) {
        setPassword(account.password);
      }
      setLocked(false);
      stage = "STARTUP-DB";
      const storage = await openStorage();
      const repository = new Repository(storage, uuid);
      await repository.recoverDirectPrints();
      await repository.pruneReceipts();
      setDirectJobs(await repository.directPrintJobs());
      stage = "STARTUP-SETTINGS";
      if (!(await storage.get("settings")))
        await repository.settings({
          locale: detectLocale(
            Localization.getLocales()[0]?.languageTag ?? "en",
          ),
          printer: "system",
          autoPrint: false,
        });
      stage = "STARTUP-RECORDS";
      const data = await repository.load();
      if (active) {
        setRepo(repository);
        setWorker(new SyncWorker(repository));
        setState(data);
      }
    })().catch((e) => {
      if (active) {
        setBootFailure(stage);
        setError(
          e instanceof Error && e.message === "nativeBuildRequired"
            ? e.message
            : "storageUnavailable",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [bootAttempt]);
  const choosingConnection = screen === "serverSettings";
  const syncNow = useCallback(
    async (force = false) => {
      if (
        !worker ||
        !repo ||
        locked ||
        confirmSignOut ||
        choosingConnection ||
        syncLock.current
      )
        return;
      syncLock.current = true;
      setSyncing(true);
      try {
        await worker.run(force);
        setConnectionError(worker.lastError || "");
      } catch (e) {
        setConnectionError(e instanceof Error ? e.message : "networkError");
      } finally {
        // A failed catalogue refresh must not hide orders already acknowledged.
        try {
          setState(await repo.load());
        } finally {
          syncLock.current = false;
          setSyncing(false);
        }
      }
    },
    [worker, repo, locked, confirmSignOut, choosingConnection],
  );
  const refreshList = useCallback(async () => {
    if (actionLock.current || locked || syncLock.current) return;
    setRefreshingList(true);
    try {
      await syncNow(true);
    } catch {
      setError("storageUnavailable");
    } finally {
      setRefreshingList(false);
    }
  }, [syncNow, locked]);
  const refreshable =
    !!shop &&
    !locked &&
    [
      "sell",
      "held",
      "receipts",
      "connection",
      "offlineData",
      "printAttention",
    ].includes(screen);

  const backTarget: Screen =
    screen === "serverSettings"
      ? "connection"
      : screen === "externalScanner"
        ? "devices"
        : screen === "done" && receiptDetails
          ? "receipts"
          : ["cash", "card", "upi"].includes(screen)
            ? "payment"
            : ["payment", "customer", "quantity"].includes(screen)
              ? "cart"
              : [
                    "language",
                    "printer",
                    "devices",
                    "connection",

                    "offlineData",
                    "serverReceipts",

                    "printAttention",

                    "item",
                    "leaveTraining",
                    "pin",
                  ].includes(screen) && shop
                ? "more"
                : "sell";
  const navigateBack = () => {
    if (busy || actionLock.current) return true;
    if (!shop && localSetup && screen !== "scanner" && screen !== "language") {
      if (localMethod !== "menu") {
        discovery.current?.abort();
        setPassword("");
        setError("");
        setLocalMethod(
          localMethod === "signin" && foundServers.length ? "wifi" : "menu",
        );
      } else setLocalSetup(false);
      return true;
    }
    if (locked || screen === "sell") return false;
    go(backTarget);
    return true;
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      navigateBack,
    );
    return () => subscription.remove();
  });
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [screen, selectedSale?.id]);
  const browseReceipt = (direction: "next" | "previous") => {
    if (busy || locked || !receiptDetails || screen !== "done" || !lastSale)
      return;
    const id = adjacentRecord(
      receiptOrder.current.filter((id) =>
        state?.sales.some((s) => s.id === id),
      ),
      lastSale.id,
      direction,
    );
    const sale = state?.sales.find((s) => s.id === id);
    if (sale) {
      setLastSale(sale);
      setNotice("");
      setError("");
    }
  };
  useEffect(() => {
    if (!worker || !repo || locked || confirmSignOut) return;
    void syncNow();
    const timer = setInterval(() => void syncNow(), 30000);
    const listener = AppState.addEventListener("change", (value) => {
      if (value === "active") void syncNow(true);
    });
    const network = Network.addNetworkStateListener((value) => {
      if (value.isConnected) void syncNow(true);
    });
    return () => {
      clearInterval(timer);
      listener.remove();
      network.remove();
    };
  }, [worker, repo, locked, confirmSignOut, syncNow]);
  useEffect(() => () => discovery.current?.abort(), []);

  function acceptServer(value: string) {
    const details = parseServerInput(value);
    setServer(details.address);
    setLocalSetup(true);
    setLocalMethod("signin");
    setError("");
    setPassword("");
    setUsername("");
    setPairCode(details.code || "");
    setPairing(Boolean(details.code) || localMethod === "pair");
    discovery.current?.abort();
  }
  async function searchWifi() {
    if (discovery.current) {
      discovery.current.abort();
      return;
    }
    const controller = new AbortController();
    discovery.current = controller;
    setSearching(true);
    setFoundServers([]);
    setSearchProgress(0);
    setError("");
    let found = false;
    try {
      const ip = await wifiAddress();
      await discoverServers(
        ip,
        controller.signal,
        (hit) => {
          found = true;
          setFoundServers((rows) =>
            rows.some((row) => row.address === hit.address)
              ? rows
              : [...rows, hit],
          );
        },
        (done, total) => setSearchProgress(Math.round((done / total) * 100)),
      );
      if (!controller.signal.aborted && !found) setError("wifiNotFound");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "networkError");
    } finally {
      if (discovery.current === controller) {
        discovery.current = null;
        setSearching(false);
      }
    }
  }

  const lock = () => {
    scans?.cancel();
    scannerValue.current = "";
    scannerInput.current?.clear();
    accountRequest.current?.abort();
    discovery.current?.abort();
    unlockAttempt.current++;
    setUnlocking(false);
    vault.lock();
    setLocked(true);
    setPin("");
    setPassword("");
    setRecovering(false);
    setError("");
  };
  async function unlockSession() {
    const attempt = ++unlockAttempt.current;
    setUnlocking(true);
    setError("");
    const timeout = setTimeout(() => {
      if (attempt !== unlockAttempt.current) return;
      unlockAttempt.current++;
      vault.lock();
      setUnlocking(false);
      setError("pinTimeout");
    }, 21000);
    try {
      await vault.unlock(pin);
      if (attempt !== unlockAttempt.current) return;
      setPin("");
      setLocked(false);
      // A warm resume already owns an open database and worker. Do not rebuild
      // those or wait for a network sync to unlock the checkout.
      if (!repo) setBootAttempt((n) => n + 1);
    } catch (e) {
      if (attempt === unlockAttempt.current)
        setError(e instanceof Error ? e.message : "pinWrong");
    } finally {
      clearTimeout(timeout);
      if (attempt === unlockAttempt.current) setUnlocking(false);
    }
  }
  async function signOut() {
    if (syncLock.current) {
      setError("signOutSyncing");
      return;
    }
    syncLock.current = true;
    unlockAttempt.current++;
    if (locked) vault.lock();
    setUnlocking(false);
    setBusy(true);
    try {
      const repository = repo ?? new Repository(await openStorage(), uuid);
      await repository.signOut();
      await vault.clear();
      setWorker(null);
      setRepo(null);
      setState(null);
      setPassword("");
      setUsername("");
      setServer("");
      setPin("");
      setPinEnabled(false);
      setLocked(false);
      setRecovering(false);
      setConfirmSignOut(false);
      setLocalSetup(changingServer);
      setLocalMethod("menu");
      setChangingServer(false);
      setCloudReconnect(false);
      setShowServerLogin(false);
      setConnectionError("");
      setBootAttempt((n) => n + 1);
      go("sell");
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknownError");
      setConfirmSignOut(false);
    } finally {
      syncLock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!pinEnabled) return;
    if (AppState.currentState === "background") lock();
    const listener = AppState.addEventListener("change", (value) => {
      if (value === "background") lock();
    });
    return () => listener.remove();
  }, [pinEnabled]);
  async function run(fn: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknownError");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  function enterQuantity(item: Item, lineId: string | null = null, value = "") {
    scans?.cancel();
    scannerInput.current?.blur();
    setQuantityItem(item);
    setQuantityLine(lineId);
    setQuantityValue(value);
    setError("");
    setScreen("quantity");
  }
  async function acceptProductScan(value: string) {
    const item = await repo!.scanItem(value);
    if (item.quantityScale === 1000 && !item.requiresConfiguration) {
      enterQuantity(item);
      return { name: item.name, prompt: true };
    }
    await repo!.addItem(item);
    return { name: item.name, prompt: false };
  }
  async function addItem(item: Item) {
    if (item.quantityScale === 1000 && !item.requiresConfiguration) {
      enterQuantity(item);
      return;
    }
    if (actionLock.current && !addingItems.current) return;
    itemQueue.current.push(item);
    if (addingItems.current) return;
    addingItems.current = true;
    try {
      while (itemQueue.current.length) {
        const next = itemQueue.current.shift()!;
        await run(async () => {
          await repo!.addItem(next);
        });
      }
    } finally {
      addingItems.current = false;
    }
  }
  async function finish(method: "cash" | "card" | "upi") {
    await run(async () => {
      if (!state || !repo || !shop) return;
      const payment =
        method === "cash"
          ? {
              method: "cash" as const,
              received: cash ? parseMoney(cash) : sum.total,
              change: 0,
            }
          : method === "card"
            ? {
                method: "card" as const,
                status: "staff-confirmed" as const,
                reference,
              }
            : {
                method: "upi" as const,
                account: account!,
                status: "staff-confirmed" as const,
                reference,
              };
      if (method === "card" && !checked) throw new Error("unavailable");
      if (method === "upi" && (!checked || !account))
        throw new Error("upiUnavailable");
      const sale = await repo.checkout(state.cart.id, payment);
      setLastSale(sale);
      setReceiptDetails(false);
      setScreen("done");
      setAmount("");
      setNote("");
      if (state.settings.autoPrint && state.settings.printer === "system") {
        try {
          await printSale(sale, shop, state.settings, t);
        } catch {
          setNotice("printUnknown");
        }
      }
      if (state.settings.autoPrint && state.settings.printer === "bluetooth") {
        try {
          await printDirect(repo, sale, shop.name, state.settings.locale, t);
        } catch {
          setNotice("printUnknown");
        } finally {
          setDirectJobs(await repo.directPrintJobs());
        }
      }
      void syncNow(true);
    });
  }
  const icon = (glyph: IconName, size = 20) => (
    <Feather name={glyph} size={size} color={palette.ink} />
  );
  const button = (
    label: string,
    onPress: () => void,
    primary = false,
    disabled = false,
    testID?: string,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={(busy && !locked) || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primary,
        ((busy && !locked) || disabled) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.onAccent]}>
        {label}
      </Text>
    </Pressable>
  );
  const iconButton = (
    glyph: IconName,
    label: string,
    onPress: () => void,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [
        styles.iconButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {icon(glyph)}
    </Pressable>
  );
  const field = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    options: {
      numeric?: boolean;
      secret?: boolean;
      phone?: boolean;
      testID?: string;
      placeholder?: string;
    } = {},
  ) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={options.testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={options.secret}
        keyboardType={
          options.numeric
            ? "decimal-pad"
            : options.phone
              ? "phone-pad"
              : "default"
        }
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={options.placeholder}
        placeholderTextColor={palette.muted}
        onFocus={() => setFocusedField(label)}
        onBlur={() => setFocusedField("")}
        style={[styles.input, focusedField === label && styles.inputFocused]}
      />
    </View>
  );
  const heading = (text: string) => (
    <Text accessibilityRole="header" style={styles.heading}>
      {text}
    </Text>
  );
  const help = (text: string) => <Text style={styles.help}>{text}</Text>;
  const message = (text: string) => (
    <View style={styles.message}>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
  const row = (label: string, value: string) => (
    <View style={styles.row}>
      <Text style={styles.body}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
  const back = (target: Screen = "sell") => (
    <View style={styles.back}>
      {iconButton("arrow-left", t("back"), () => go(target))}
    </View>
  );
  const actionRow = (
    glyph: IconName,
    label: string,
    detail: string,
    onPress: () => void,
    disabled = false,
    testID?: string,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menu,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.menuIcon}>{icon(glyph)}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.menuTitle}>{label}</Text>
        {!!detail && <Text style={styles.small}>{detail}</Text>}
      </View>
      {icon("chevron-right", 17)}
    </Pressable>
  );
  const menu = (
    glyph: IconName,
    label: string,
    target: Screen,
    detail?: string,
  ) => (
    <Pressable
      key={target}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      onPress={() => go(target)}
      style={styles.menu}
    >
      <View style={styles.menuIcon}>{icon(glyph)}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.body}>{label}</Text>
        {detail && <Text style={styles.small}>{detail}</Text>}
      </View>
      {icon("chevron-right", 17)}
    </Pressable>
  );
  const keypad = (
    value: string,
    onChange: (s: string) => void,
    moneyPad: boolean,
  ) => (
    <View style={styles.keypad}>
      {[
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        moneyPad ? "." : "clear",
        "0",
        "delete",
      ].map((key) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={
            key === "delete" ? t("remove") : key === "clear" ? t("clear") : key
          }
          style={({ pressed }) => [styles.key, pressed && styles.pressed]}
          onPress={() => {
            if (key === "delete") onChange(value.slice(0, -1));
            else if (key === "clear") onChange("");
            else if (key === "." && !value.includes("."))
              onChange((value || "0") + ".");
            else if (
              key !== "." &&
              value.length < (moneyPad ? 12 : 6) &&
              (!moneyPad ||
                !value.includes(".") ||
                (value.split(".")[1]?.length ?? 0) < 2)
            )
              onChange(value + key);
          }}
        >
          {key === "delete" ? (
            icon("delete", 24)
          ) : (
            <Text style={styles.keyText}>
              {key === "clear" ? t("clear") : key}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
  const cartView = () => (
    <>
      {state!.cart.lines.map((line) => (
        <View key={line.id} style={styles.cartLine}>
          <View style={{ flex: 1 }}>
            <Text style={styles.body}>{line.name}</Text>
            <Text style={styles.small}>{money(line.price)}</Text>
          </View>
          <View style={styles.quantity}>
            {iconButton(
              "minus",
              t("remove") + " " + line.name,
              () => void run(() => repo!.quantity(line.id, -1)),
              state!.shop?.permissions.voidLine !== true,
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("quantity") + " " + line.name}
              onPress={() => {
                setQuantityItem(null);
                setQuantityLine(line.id);
                setQuantityValue(String(line.quantity));
                setScreen("quantity");
              }}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={styles.value}>
                {line.quantity}
                {line.unit ? " " + line.unit : ""}
              </Text>
            </Pressable>
            {iconButton(
              "plus",
              t("addOne") + " " + line.name,
              () => void run(() => repo!.quantity(line.id, 1)),
            )}
          </View>
        </View>
      ))}
      {row(t("total"), money(sum.total))}
      {sum.tax > 0 && row(t("tax"), money(sum.tax))}
    </>
  );

  function content() {
    if (confirmSignOut)
      return (
        <>
          {heading(
            t(
              cloudReconnect
                ? "reconnectCloud"
                : changingServer
                  ? "changeServer"
                  : "switchUser",
            ),
          )}
          {cloudReconnect && help(t("reconnectCloudHelp"))}
          {help(t("signOutHelp"))}
          {error && help(t(error))}
          {syncing && help(t("signOutSyncing"))}
          {button(t("signOut"), () => void signOut(), true, busy || syncing)}
          {button(
            t("cancel"),
            () => {
              setConfirmSignOut(false);
              setChangingServer(false);
              setCloudReconnect(false);
            },
            false,
            busy,
          )}
        </>
      );
    if (locked)
      return (
        <>
          <View style={styles.center}>
            {heading(t(recovering ? "passwordRecovery" : "unlock"))}
          </View>
          <View
            style={{
              alignSelf: "center",
              backgroundColor: palette.soft,
              borderRadius: 16,
              padding: 14,
              marginBottom: 12,
            }}
          >
            {icon("lock", 24)}
          </View>
          {help(username || t("pinHelp"))}
          {error && (
            <Text accessibilityRole="alert" style={styles.body}>
              {t(error)}
            </Text>
          )}
          {recovering ? (
            <>
              {field(t("username"), username, setUsername)}
              {field(t("password"), password, setPassword, { secret: true })}
              {button(
                t("signIn"),
                () =>
                  void run(async () => {
                    const attempt = ++unlockAttempt.current;
                    const storage = await openStorage();
                    const saved = await new Repository(storage, uuid).load();
                    if (
                      !saved.shop ||
                      saved.shop.mode === "training" ||
                      !saved.shop.baseUrl
                    )
                      throw new Error("pinTrainingRecovery");
                    const data = await new PosnicApi(
                      saved.shop.baseUrl,
                    ).connect(username, password, undefined, false);
                    if (attempt !== unlockAttempt.current) return;
                    if (
                      data.shop.id !== saved.shop.id ||
                      data.shop.branchId !== saved.shop.branchId ||
                      data.shop.staffId !== saved.shop.staffId
                    )
                      throw new Error("permissionDenied");
                    await vault.recover({
                      token: data.token,
                      username,
                      password,
                      server: saved.shop.baseUrl,
                    });
                    setPinEnabled(false);
                    setLocked(false);
                    setRecovering(false);
                    setBootAttempt((n) => n + 1);
                    go("pin");
                  }),
                true,
                busy || !username || !password,
              )}
              {button(t("back"), () => {
                unlockAttempt.current++;
                setRecovering(false);
                setError("");
              })}
            </>
          ) : (
            <>
              {field(
                t("pin"),
                pin,
                (value) =>
                  setPin(normalizeDigits(value).replace(/\D/g, "").slice(0, 6)),
                { numeric: true, secret: true },
              )}
              {keypad(pin, setPin, false)}
              {button(
                t("unlock"),
                () => void unlockSession(),
                true,
                pin.length < 4 || unlocking,
              )}
              {unlocking && (
                <>
                  {help(t("unlocking"))}
                  {button(t("cancel"), lock)}
                </>
              )}
              {button(t("passwordRecovery"), () => {
                unlockAttempt.current++;
                vault.lock();
                setUnlocking(false);
                setRecovering(true);
                setError("");
              })}
            </>
          )}
          {button(t("switchUser"), () => setConfirmSignOut(true))}
        </>
      );

    if (!state || !repo)
      return (
        <View style={styles.loading}>
          {bootFailure ? (
            <>
              <Text accessibilityRole="alert" style={styles.body}>
                {t(error || "storageUnavailable")}
              </Text>
              {help(bootFailure)}
              {button(
                t("retry"),
                () => setBootAttempt((attempt) => attempt + 1),
                true,
              )}
            </>
          ) : (
            <>
              <ActivityIndicator color={palette.accent} />
              {help(t("loading"))}
            </>
          )}
        </View>
      );
    if (!shop && screen !== "scanner" && screen !== "language")
      return (
        <>
          {!localSetup && (
            <View style={styles.intro}>
              {
                <View
                  style={styles.welcomeArt}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <View style={styles.welcomeReceipt}>
                    <Feather
                      name="shopping-bag"
                      size={32}
                      color={palette.accent}
                    />
                    <View style={styles.receiptRule} />
                    <View style={[styles.receiptRule, { width: 58 }]} />
                    <View style={styles.welcomeCheck}>
                      <Feather
                        name="check"
                        size={22}
                        color={palette.onAccent}
                      />
                    </View>
                  </View>
                </View>
              }
              {heading(t("welcome"))}
              {help(t("connectHelp"))}
            </View>
          )}
          {!localSetup ? (
            <View style={styles.setupCard}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                {icon("cloud", 18)}
                <Text style={styles.fieldLabel}>{t("cloudAccount")}</Text>
              </View>
              {help(t("accountConnectHelp"))}
              {(["login", "signup"] as const).map((intent) => (
                <React.Fragment key={intent}>
                  {button(
                    t(intent === "login" ? "signIn" : "createAccount"),
                    () =>
                      void run(async () => {
                        const controller = new AbortController();
                        accountRequest.current = controller;
                        try {
                          const grant = await authorizeAccount(
                            intent,
                            async (url, code) => {
                              setAuthorizationCode(code);
                              await openAccountBrowser(url, controller.signal);
                            },
                            controller.signal,
                          );
                          await foreground(controller.signal);
                          const data = await new PosnicApi(
                            grant.baseUrl,
                          ).connect("", "", grant.code, true, grant.verifier);
                          await repo.pair(data.shop, data.items);
                          await vault.remember({
                            token: data.token,
                            username: data.shop.staffName,
                            password: "",
                            server: grant.baseUrl,
                          });
                          setPin("");
                          setPinConfirm("");
                          go("sell");
                        } finally {
                          setAuthorizationCode("");
                          accountRequest.current = null;
                        }
                      }),
                    intent === "login",
                  )}
                </React.Fragment>
              ))}
              {!!authorizationCode && (
                <>
                  {help(t("authorizeInBrowser") + " " + authorizationCode)}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => accountRequest.current?.abort()}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>{t("cancel")}</Text>
                  </Pressable>
                </>
              )}
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: palette.line,
                  paddingTop: 18,
                  marginTop: 12,
                }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  {icon("server", 18)}
                  <Text style={styles.fieldLabel}>{t("selfHosted")}</Text>
                </View>
                {help(t("selfHostedHelp"))}
                {button(t("connectLocalShop"), () => {
                  setLocalMethod("menu");
                  setLocalSetup(true);
                })}
              </View>
            </View>
          ) : (
            <View style={styles.setupCard}>
              {localMethod === "menu" &&
                button(t("backToAccount"), () => {
                  discovery.current?.abort();
                  setError("");
                  setLocalSetup(false);
                })}
              {localMethod === "menu" ? (
                <>
                  {help(t("wifiHelp"))}
                  {actionRow("wifi", t("searchWifi"), t("wifiRequired"), () => {
                    setPairing(false);
                    setPairCode("");
                    setLocalMethod("wifi");
                    void searchWifi();
                  })}
                  {actionRow("maximize", t("shopQr"), t("pairHelp"), () =>
                    go("scanner"),
                  )}
                  {actionRow("key", t("pairCode"), t("pairHelp"), () => {
                    setPairing(true);
                    setLocalMethod("pair");
                  })}
                  {actionRow(
                    "globe",
                    t("server"),
                    t("addressHelp"),
                    () => {
                      setPairing(false);
                      setLocalMethod("address");
                    },
                    false,
                    "manual-server",
                  )}
                </>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(
                      localMethod === "signin" ? "changeServer" : "back",
                    )}
                    disabled={busy}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 44,
                    }}
                    onPress={() => {
                      discovery.current?.abort();
                      setPassword("");
                      setPairCode("");
                      setError("");
                      setLocalMethod(
                        localMethod === "signin" && foundServers.length
                          ? "wifi"
                          : "menu",
                      );
                    }}
                  >
                    {icon("arrow-left", 18)}
                    <Text style={styles.buttonText}>
                      {t(localMethod === "signin" ? "changeServer" : "back")}
                    </Text>
                  </Pressable>
                  {localMethod === "signin" ? (
                    <>
                      {heading(t("signInToServer"))}
                      <View
                        style={[styles.menu, { backgroundColor: palette.soft }]}
                        testID="selected-server"
                      >
                        <View style={styles.menuIcon}>{icon("server")}</View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.menuTitle}>Posnic POS</Text>
                          <Text style={styles.small}>{server}</Text>
                        </View>
                        {icon("check-circle")}
                      </View>
                    </>
                  ) : localMethod === "wifi" ? (
                    <>
                      {heading(t("chooseServer"))}
                      {help(t("chooseServerHelp"))}
                      {searching && (
                        <ActivityIndicator color={palette.accent} />
                      )}
                      <Text
                        accessibilityLiveRegion="polite"
                        style={styles.small}
                      >
                        {searching
                          ? t("searchingWifi") + " " + searchProgress + "%"
                          : t("searchWifi")}
                      </Text>
                      {foundServers.map((hit) => (
                        <View key={hit.address}>
                          {actionRow(
                            "server",
                            t("useServer") + " · " + new URL(hit.address).host,
                            "Posnic POS · " +
                              (hit.compatible
                                ? hit.version
                                : t("serverUpgrade")),
                            () => acceptServer(hit.address),
                            !hit.compatible,
                            "found-server",
                          )}
                        </View>
                      ))}
                      {button(
                        t(searching ? "stopSearch" : "searchWifi"),
                        () => void searchWifi(),
                      )}
                      {actionRow(
                        "globe",
                        t("server"),
                        t("addressHelp"),
                        () => {
                          discovery.current?.abort();
                          setLocalMethod("address");
                          setError("");
                        },
                        false,
                        "manual-server",
                      )}
                    </>
                  ) : (
                    <>
                      {heading(t("chooseServer"))}
                      {help(t("addressHelp"))}
                      <Text style={styles.fieldLabel}>{t("server")}</Text>
                      <TextInput
                        accessibilityLabel={t("server")}
                        testID="server-input"
                        value={server}
                        onChangeText={setServer}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder={t("serverPlaceholder")}
                        placeholderTextColor={palette.muted}
                        style={styles.input}
                      />
                      {button(
                        t("next"),
                        () =>
                          void run(async () => {
                            const details = parseServerInput(server);
                            const runtime = await new PosnicApi(
                              details.address,
                            ).probe();
                            if (runtime.features?.mobilePosV1 !== true)
                              throw new Error("serverUpgrade");
                            acceptServer(server);
                          }),
                        true,
                        !server.trim(),
                        "choose-server-next",
                      )}
                      {actionRow("maximize", t("shopQr"), t("pairHelp"), () =>
                        go("scanner"),
                      )}
                    </>
                  )}
                  {localMethod === "signin" && (
                    <>
                      {button(t(pairing ? "signIn" : "pairCode"), () => {
                        setPairing(!pairing);
                        setPassword("");
                        setPairCode("");
                        setError("");
                      })}
                      {pairing ? (
                        <>
                          {field(t("pairCode"), pairCode, setPairCode)}
                          {help(t("pairHelp"))}
                        </>
                      ) : (
                        <>
                          {field(t("username"), username, setUsername)}
                          {field(t("password"), password, setPassword, {
                            secret: true,
                          })}
                          {help(t("rememberHelp"))}
                        </>
                      )}
                      {button(
                        t(pairing ? "pair" : "signIn"),
                        () =>
                          void run(async () => {
                            const details = parseServerInput(server);
                            const data = await new PosnicApi(
                              details.address,
                            ).connect(
                              username,
                              password,
                              details.code ||
                                (pairing ? pairCode.trim() : undefined),
                            );
                            await repo.pair(data.shop, data.items);
                            await vault.remember({
                              token: data.token,
                              username: pairing
                                ? data.shop.staffName
                                : username,
                              password: pairing ? "" : password,
                              server: details.address,
                            });
                            setPairCode("");
                            setPin("");
                            setPinConfirm("");
                            go("sell");
                          }),
                        true,
                        !server ||
                          (pairing ? !pairCode.trim() : !username || !password),
                      )}
                    </>
                  )}
                </>
              )}
            </View>
          )}
          {!localSetup && (
            <>
              {button(
                t("trainingStart"),
                () =>
                  void run(async () => {
                    await repo.startTraining();
                    go("sell");
                  }),
                false,
                false,
                "start-training",
              )}
              {help(t("trainingHelp"))}
            </>
          )}
        </>
      );
    if (screen === "language")
      return (
        <>
          {back(shop ? "more" : "sell")}
          {heading(t("language"))}
          {help(t("fontReview"))}
          {languages.map((language) => (
            <Pressable
              accessibilityRole="radio"
              aria-checked={locale === language.code}
              accessibilityState={{ checked: locale === language.code }}
              key={language.code}
              style={styles.menu}
              onPress={() =>
                void run(() =>
                  repo.settings({ ...state.settings, locale: language.code }),
                )
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>
                  {language.name}
                  {language.beta ? " · " + t("beta") : ""}
                </Text>
                {language.code !== "en" && (
                  <Text style={styles.small}>
                    {t("languageCoverage")}:{" "}
                    {translationCoverage(language.code).translated}/
                    {translationCoverage(language.code).total}
                  </Text>
                )}
              </View>
              {locale === language.code ? icon("check") : null}
            </Pressable>
          ))}
        </>
      );
    if (screen === "scanner")
      return (
        <>
          {back(shop ? "sell" : "sell")}
          {heading(t(shop ? "scan" : "shopQr"))}
          {!cameraPermission?.granted ? (
            <>
              {help(t("cameraPermission"))}
              {button(
                t("allowCamera"),
                () => void requestCameraPermission(),
                true,
              )}
            </>
          ) : (
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: [
                  "qr",
                  "ean13",
                  "ean8",
                  "code128",
                  "code39",
                  "upc_a",
                  "upc_e",
                ],
              }}
              onBarcodeScanned={({ data }) => {
                if (scannerHandled.current) return;
                scannerHandled.current = true;
                if (!shop) {
                  try {
                    acceptServer(data);
                    go("sell");
                  } catch (e) {
                    setError("invalidServer");
                    scannerHandled.current = false;
                  }
                } else {
                  go("sell");
                  void run(async () => {
                    await acceptProductScan(data);
                  });
                }
              }}
            />
          )}
        </>
      );
    if (!shop) return null;
    if (screen === "inventory" && !shop.capabilities.inventory)
      return (
        <>
          {heading(t("inventory"))}
          {help(t("permissionDenied"))}
          {button(t("back"), () => go("sell"))}
        </>
      );
    if (
      screen === "inventory" ||
      (!shop.permissions.sell &&
        shop.capabilities.inventory &&
        (screen === "sell" || screen === "quick"))
    )
      return (
        <Inventory
          repo={repo}
          shop={shop}
          t={t}
          back={() => go("sell")}
          colors={{ ...palette, surface: palette.paper, tint: palette.soft }}
        />
      );
    if (screen === "photoOrders")
      return (
        <PhotoOrders
          repo={repo}
          shop={shop}
          t={t}
          back={() => go("sell")}
          money={(value) => formatMoney(value, shop.currency, locale)}
          imported={async () => {
            await refresh();
            go("cart");
          }}
        />
      );
    switch (screen) {
      case "sell":
      case "quick": {
        const shown = catalogueView?.items ?? [];
        const shownCount = catalogueView?.total ?? 0;
        const columns =
          dimensions.width > 700 ? 4 : dimensions.width > 520 ? 3 : 2;
        return (
          <>
            <View style={styles.segments}>
              {shop.mode === "live" &&
                shop.capabilities.inventory &&
                iconButton("package", t("inventory"), () => go("inventory"))}
              {(["sell", "quick"] as const).map((tab) => (
                <Pressable
                  key={tab}
                  accessibilityRole="tab"
                  aria-selected={screen === tab}
                  accessibilityState={{ selected: screen === tab }}
                  onPress={() => go(tab)}
                  style={[
                    styles.segment,
                    screen === tab && styles.segmentActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      screen === tab && { color: palette.accent },
                    ]}
                  >
                    {t(tab === "sell" ? "items" : "quick")}
                  </Text>
                </Pressable>
              ))}
            </View>
            {screen === "sell" ? (
              <>
                <View style={styles.searchRow}>
                  <TextInput
                    accessibilityLabel={t("search")}
                    placeholder={t("search")}
                    placeholderTextColor={palette.muted}
                    value={query}
                    onChangeText={setQuery}
                    style={[styles.input, { flex: 1, margin: 0 }]}
                    returnKeyType="search"
                    onSubmitEditing={() => {
                      if (query)
                        void run(async () => {
                          const exact = await repo.catalogue({
                            code: normalizeDigits(query),
                            limit: 2,
                          });
                          if (exact.total === 1) {
                            if (exact.items[0]!.quantityScale === 1000)
                              enterQuantity(exact.items[0]!);
                            else await repo.addItem(exact.items[0]!);
                            setQuery("");
                          } else if (exact.total > 1)
                            throw Error("multipleMatches");
                        });
                    }}
                  />
                  {iconButton("grid", t("code"), () => go("code"))}
                  {iconButton("maximize", t("scan"), () => go("scanner"))}
                  {iconButton("camera", t("photoTitle"), () =>
                    go("photoOrders"),
                  )}
                </View>
                <View style={styles.searchRow}>
                  <ScrollView
                    style={{ flex: 1 }}
                    scrollsToTop={false}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.categories}
                  >
                    <Pressable
                      testID="favourites-filter"
                      accessibilityRole="button"
                      accessibilityState={{ selected: favouritesOnly }}
                      onPress={() => setFavouritesOnly(!favouritesOnly)}
                      style={[styles.chip, favouritesOnly && styles.chipActive]}
                    >
                      <Text style={styles.small}>{"☆ " + t("favourites")}</Text>
                    </Pressable>
                    {["", ...state.catalogue.categories].map((cat) => (
                      <Pressable
                        key={cat}
                        onPress={() => setCategory(cat)}
                        accessibilityRole="button"
                        aria-selected={category === cat}
                        accessibilityState={{ selected: category === cat }}
                        style={[
                          styles.chip,
                          category === cat && styles.chipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.small,
                            category === cat && { color: palette.accent },
                          ]}
                        >
                          {cat || t("all")}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  {iconButton("refresh-cw", t("refresh"), () => {
                    if (!busy) void refreshList();
                  })}
                </View>
                <FlatList
                  scrollsToTop={false}
                  scrollEnabled={false}
                  key={columns}
                  numColumns={columns}
                  data={shown}
                  keyExtractor={(item) => item.id}
                  columnWrapperStyle={{ gap: 8 }}
                  contentContainerStyle={{ gap: 8 }}
                  ListEmptyComponent={
                    catalogueView ? (
                      help(t(favouritesOnly ? "favouritesHelp" : "noMatch"))
                    ) : (
                      <ActivityIndicator color={palette.accent} />
                    )
                  }
                  renderItem={({ item }) => (
                    <View
                      style={[
                        styles.tile,
                        { maxWidth: `${100 / columns - 1.5}%` },
                      ]}
                    >
                      <Pressable
                        testID={"item-" + item.id}
                        accessibilityRole="button"
                        accessibilityLabel={item.name + " " + money(item.price)}
                        onPress={() => void addItem(item)}
                        style={({ pressed }) => [
                          { width: "100%" },
                          pressed && styles.pressed,
                        ]}
                      >
                        <View
                          style={[
                            styles.art,
                            item.shape === "circle" && { borderRadius: 40 },
                            item.shape === "diamond" && { borderRadius: 12 },
                          ]}
                        >
                          {cachedImages[item.id] && !failedImages[item.id] ? (
                            <Image
                              source={{ uri: cachedImages[item.id] }}
                              onError={() =>
                                setFailedImages((previous) => ({
                                  ...previous,
                                  [item.id]: true,
                                }))
                              }
                              style={{ width: "100%", height: "100%" }}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={{ fontSize: 25 }}>
                              {item.visual || "📦"}
                            </Text>
                          )}
                        </View>
                        {state.cart.lines.some(
                          (line) => line.itemId === item.id,
                        ) && (
                          <View style={styles.itemCount}>
                            <Text style={styles.itemCountText}>
                              {state.cart.lines
                                .filter((line) => line.itemId === item.id)
                                .reduce(
                                  (count, line) => count + line.quantity,
                                  0,
                                )}
                            </Text>
                          </View>
                        )}
                        <View style={styles.tileLabel}>
                          <Text style={styles.itemName} numberOfLines={2}>
                            {item.name}
                          </Text>
                          <Text style={styles.itemPrice}>
                            {money(item.price)}
                          </Text>
                        </View>
                      </Pressable>
                      <Pressable
                        testID={"favourite-" + item.id}
                        accessibilityRole="button"
                        accessibilityLabel={
                          t(
                            state.favourites?.includes(item.id)
                              ? "removeFavourite"
                              : "addFavourite",
                          ) +
                          " · " +
                          item.name
                        }
                        accessibilityState={{
                          selected: !!state.favourites?.includes(item.id),
                        }}
                        onPress={() =>
                          void run(() => repo.toggleFavourite(item.id))
                        }
                        style={{
                          position: "absolute",
                          end: 0,
                          top: 0,
                          width: 44,
                          height: 44,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Feather
                          name="star"
                          size={18}
                          color={
                            state.favourites?.includes(item.id)
                              ? palette.accent
                              : palette.muted
                          }
                        />
                      </Pressable>
                    </View>
                  )}
                />
                {shownCount > 48 && (
                  <View style={styles.row}>
                    {iconButton("chevron-left", t("back"), () =>
                      setItemPage(Math.max(0, itemPage - 1)),
                    )}
                    <Text style={styles.small}>
                      {itemPage + 1} / {Math.ceil(shownCount / 48)}
                    </Text>
                    {iconButton("chevron-right", t("more"), () =>
                      setItemPage(
                        Math.min(Math.ceil(shownCount / 48) - 1, itemPage + 1),
                      ),
                    )}
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.amount}>
                  {amount ? money(safeAmount(amount)) : money(0)}
                </Text>
                {field(t("description") + " · " + t("optional"), note, setNote)}
                {keypad(amount, setAmount, true)}
                {button(
                  t("add"),
                  () =>
                    void run(async () => {
                      await repo.addQuick(
                        parseMoney(amount),
                        note || t("quickSale"),
                      );
                      setAmount("");
                      setNote("");
                      go("cart");
                    }),
                  true,
                  !amount ||
                    safeAmount(amount) <= 0 ||
                    !shop.permissions.quickSale,
                )}
              </>
            )}
          </>
        );
      }
      case "code": {
        const matches = codeMatches;
        return (
          <>
            {back()}
            {field(
              t("quickCode"),
              code,
              (s) => setCode(normalizeDigits(s).slice(0, 6)),
              { numeric: true },
            )}
            {help(t("codeHelp"))}
            {matches.length === 1
              ? message(matches[0]!.name + " · " + money(matches[0]!.price))
              : code
                ? message(t(matches.length ? "multipleMatches" : "noMatch"))
                : null}
            {keypad(code, setCode, false)}
            {matches.length > 1
              ? matches.map((i) => button(i.name, () => void addItem(i)))
              : button(
                  t("add"),
                  () =>
                    void run(async () => {
                      if (matches[0]!.quantityScale === 1000)
                        enterQuantity(matches[0]!);
                      else {
                        await repo.addItem(matches[0]!);
                        go("sell");
                      }
                      setCode("");
                    }),
                  true,
                  matches.length !== 1,
                )}
          </>
        );
      }
      case "quantity": {
        const line = state.cart.lines.find((row) => row.id === quantityLine);
        const target = quantityItem ?? line;
        if (!target)
          return (
            <>
              {back("cart")}
              {help(t("notFound"))}
            </>
          );
        const scale = target.quantityScale ?? 1;
        return (
          <>
            {back(quantityLine ? "cart" : "sell")}
            {heading(t("quantity"))}
            {help(target.name + (target.unit ? " · " + target.unit : ""))}
            {field(t("quantity"), quantityValue, setQuantityValue, {
              numeric: true,
            })}
            {scale === 1000 && help(t("quantityHelp"))}
            {button(
              t("save"),
              () =>
                void run(async () => {
                  const value = parseQuantity(quantityValue, scale);
                  if (quantityLine) await repo.setQuantity(quantityLine, value);
                  else if (quantityItem)
                    await repo.addItem(quantityItem, value);
                  go("cart");
                }),
              true,
              busy || !quantityValue,
            )}
          </>
        );
      }
      case "cart":
        return (
          <>
            {back()}
            {shop.permissions.customerWrite &&
              button(
                state.cart.customer?.name ||
                  state.cart.customer?.phone ||
                  "+ " + t("addCustomer"),
                () => {
                  setName("");
                  setPhone("");
                  go("customer");
                },
              )}
            {cartView()}
            {button(
              t("charge") + " · " + money(sum.total),
              () => go("payment"),
              true,
              !state.cart.lines.length || sum.total <= 0,
              "take-payment",
            )}
            {button(
              t("hold"),
              () =>
                void run(async () => {
                  await repo.hold();
                  go("held");
                }),
              false,
              !state.cart.lines.length,
            )}
          </>
        );
      case "payment":
        return (
          <>
            {back("cart")}
            <View style={styles.center}>
              {heading(t("charge"))}
              <Text style={styles.amount}>{money(sum.total)}</Text>
              <Text style={styles.small}>
                {state.cart.lines.length} {t("items")}
              </Text>
            </View>
            {(shop.paymentMethods ?? ["cash", "upi"]).includes("cash") &&
              actionRow(
                "dollar-sign",
                t("cash") + " · " + money(sum.total),
                t("cashReceived"),
                () => go("cash"),
                !state.cart.lines.length || sum.total <= 0,
              )}
            {shop.paymentMethods?.includes("card") &&
              actionRow(
                "credit-card",
                t("card"),
                t("manualPayment"),
                () => go("card"),
                !state.cart.lines.length || sum.total <= 0,
              )}
            {(shop.paymentMethods ?? ["cash", "upi"]).includes("upi") &&
              actionRow(
                "maximize",
                t("upi"),
                t("manualPayment"),
                () => go("upi"),
                !state.cart.lines.length ||
                  !shop.permissions.manualUpi ||
                  !shop.upiAccounts.some((a) => a.active),
              )}
            <View style={styles.message}>
              <Text style={styles.fieldLabel}>{t("paymentDevices")}</Text>
              <Text style={styles.small}>{t("unavailable")}</Text>
            </View>
          </>
        );
      case "card":
        return (
          <>
            {back("payment")}
            {heading(t("card"))}
            <Text style={styles.amount}>{money(sum.total)}</Text>
            {help(t("manualPayment"))}
            {field(
              t("reference") + " · " + t("optional"),
              reference,
              setReference,
            )}
            <View style={styles.row}>
              <Text style={[styles.body, { flex: 1 }]}>
                {t("confirmPayment")}
              </Text>
              <Switch
                accessibilityLabel={t("confirmPayment")}
                value={checked}
                onValueChange={setChecked}
              />
            </View>
            {button(
              t("recordPayment"),
              () => void finish("card"),
              true,
              !checked || !shop.paymentMethods?.includes("card"),
            )}
          </>
        );
      case "cash":
        return (
          <>
            {back("payment")}
            <Text style={styles.amount}>{money(sum.total)}</Text>
            {field(t("cashReceived"), cash, setCash, {
              numeric: true,
              placeholder: (sum.total / 100).toFixed(2),
              testID: "cash-received",
            })}
            <View style={styles.categories}>
              {[
                sum.total,
                ...[10000, 20000, 50000, 100000]
                  .filter((n) => n > sum.total)
                  .slice(0, 2),
              ].map((value) => (
                <Pressable
                  key={value}
                  style={styles.chip}
                  onPress={() => setCash((value / 100).toFixed(2))}
                >
                  <Text style={styles.body}>
                    {value === sum.total ? t("exact") : money(value)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {row(
              t("change"),
              money(
                Math.max(0, (cash ? safeAmount(cash) : sum.total) - sum.total),
              ),
            )}
            {help(t("savedLocally"))}
            {button(
              t("done") + " · " + t("cashReceived"),
              () => void finish("cash"),
              true,
              (cash ? safeAmount(cash) : sum.total) < sum.total,
              "finish-cash",
            )}
          </>
        );
      case "upi": {
        let uri = "";
        if (account) {
          try {
            uri = upiUri(account, sum.total, currency, state.cart.id);
          } catch {}
        }
        return (
          <>
            {back("payment")}
            <Text style={styles.amount}>{money(sum.total)}</Text>
            {!account ? (
              message(t("noUpi"))
            ) : (
              <>
                {heading(t("account"))}
                {shop.upiAccounts
                  .filter((a) => a.active)
                  .map((a) => (
                    <Pressable
                      key={a.id}
                      accessibilityRole="radio"
                      aria-checked={account.id === a.id}
                      accessibilityState={{ checked: account.id === a.id }}
                      style={styles.menu}
                      onPress={() => {
                        setAccountId(a.id);
                        setChecked(false);
                        setReference("");
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.body}>
                          {a.name}
                          {a.id === shop.defaultUpiAccountId
                            ? " · " + t("default")
                            : ""}
                        </Text>
                        <Text
                          style={[styles.small, { writingDirection: "ltr" }]}
                        >
                          {a.vpa}
                        </Text>
                      </View>
                      {account.id === a.id ? icon("check") : null}
                    </Pressable>
                  ))}
                {account.verification === "provider" ? (
                  message(t("providerRequired"))
                ) : uri ? (
                  <>
                    <View style={styles.qr}>
                      <QRCode value={uri} size={210} />
                    </View>
                    {help(t("manualPayment"))}
                    {field(
                      t("reference") + " · " + t("optional"),
                      reference,
                      setReference,
                    )}
                    <View style={styles.row}>
                      <Text style={[styles.body, { flex: 1 }]}>
                        {t("confirmPayment")}
                      </Text>
                      <Switch
                        accessibilityLabel={t("confirmPayment")}
                        value={checked}
                        onValueChange={setChecked}
                      />
                    </View>
                    {button(
                      t("recordPayment"),
                      () => void finish("upi"),
                      true,
                      !checked || !shop.permissions.manualUpi,
                    )}
                  </>
                ) : (
                  message(t("upiUnavailable"))
                )}
              </>
            )}
          </>
        );
      }
      case "done":
        return (
          <>
            {receiptDetails && back("receipts")}
            {lastSale ? (
              <>
                <View style={styles.success}>{icon("check", 36)}</View>
                <View style={styles.center}>{heading(t("saved"))}</View>
                <Text style={styles.amount}>{money(lastSale.total)}</Text>
                {message(
                  t(
                    lastSale.training
                      ? "training"
                      : lastSale.sync === "synced"
                        ? "synced"
                        : "savedLocally",
                  ),
                )}
                <Text selectable style={styles.body} testID="receipt-number">
                  {lastSale.receipt}
                </Text>
                {lastSale.cloudReceivedAt &&
                  help(
                    t("cloudReceived") +
                      " · " +
                      new Date(lastSale.cloudReceivedAt).toLocaleString(locale),
                  )}
                {!lastSale.training &&
                  lastSale.sync === "synced" &&
                  shop.capabilities.cloudDelivery &&
                  !lastSale.cloudReceivedAt &&
                  help(t("cloudWaiting"))}
                {directJobs.some((j) => j.saleId === lastSale.id) && (
                  <>
                    {help(
                      t(
                        directJobs.find((j) => j.saleId === lastSale.id)
                          ?.state === "confirmed"
                          ? "confirmPrinted"
                          : "printCheckPaper",
                      ),
                    )}
                    {button(
                      t("confirmPrinted"),
                      () =>
                        void run(async () => {
                          await repo.completeDirectPrint(
                            lastSale.id,
                            "confirmed",
                          );
                          setDirectJobs(await repo.directPrintJobs());
                        }),
                      false,
                      shop.permissions.receiptPrint !== true,
                    )}
                    <View style={styles.row}>
                      <Text style={[styles.body, { flex: 1 }]}>
                        {t("reprintConfirm")}
                      </Text>
                      <Switch
                        accessibilityLabel={t("reprintConfirm")}
                        value={confirmReprint}
                        onValueChange={setConfirmReprint}
                      />
                    </View>
                  </>
                )}
                {receiptJob?.saleId === lastSale.id && (
                  <Text style={styles.small}>
                    {t(receiptJobMessage[receiptJob.state])}
                  </Text>
                )}
                {lastSale.tillPrint &&
                  shop.capabilities.printStatus &&
                  button(
                    t("refresh"),
                    () =>
                      void run(async () => {
                        const status = await new PosnicApi(
                          shop.baseUrl!,
                        ).printReceiptStatus(lastSale.id);
                        setReceiptJob({ saleId: lastSale.id, state: status });
                      }),
                    false,
                    shop.permissions.receiptPrint !== true,
                    "refresh-print-status",
                  )}
                {receiptDetails && (
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      {button(
                        t("previous"),
                        () => browseReceipt("previous"),
                        false,
                        busy ||
                          !adjacentRecord(
                            receiptOrder.current,
                            lastSale.id,
                            "previous",
                          ),
                        "previous-receipt",
                      )}
                    </View>
                    <Text style={styles.small}>
                      {receiptOrder.current.indexOf(lastSale.id) + 1} /{" "}
                      {receiptOrder.current.length}
                    </Text>
                    <View style={{ flex: 1 }}>
                      {button(
                        t("next"),
                        () => browseReceipt("next"),
                        false,
                        busy ||
                          !adjacentRecord(
                            receiptOrder.current,
                            lastSale.id,
                            "next",
                          ),
                        "next-receipt",
                      )}
                    </View>
                  </View>
                )}
                {button(
                  t("newSale"),
                  () => {
                    setLastSale(null);
                    go("sell");
                  },
                  true,
                  false,
                  "new-sale",
                )}
                {button(
                  t("print"),
                  () =>
                    void run(async () => {
                      if (state.settings.printer === "till") {
                        await repo.queueTillPrint(lastSale.id);
                        setNotice("printQueued");
                        void syncNow(true);
                      } else if (state.settings.printer === "bluetooth") {
                        try {
                          await printDirect(
                            repo,
                            lastSale,
                            shop.name,
                            state.settings.locale,
                            t,
                            confirmReprint,
                          );
                          setNotice("printCheckPaper");
                        } finally {
                          setConfirmReprint(false);
                          setDirectJobs(await repo.directPrintJobs());
                        }
                      } else {
                        await printSale(lastSale, shop, state.settings, t);
                        setNotice("printed");
                      }
                    }),
                  false,
                  shop.permissions.receiptPrint !== true,
                )}
              </>
            ) : (
              button(t("newSale"), () => go("sell"), true)
            )}
          </>
        );
      case "held":
        return (
          <>
            {heading(t("held"))}
            {button(
              t("refresh"),
              () => void refreshList(),
              false,
              syncing || busy,
            )}
            {!state.held.length && help(t("noHeld"))}
            {state.held.map((cart) => (
              <Pressable
                key={cart.id}
                style={styles.menu}
                onPress={() =>
                  void run(async () => {
                    await repo.resume(cart.id);
                    go("cart");
                  })
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.body}>
                    {cart.customer?.name || t("heldAt")}
                  </Text>
                  <Text style={styles.small}>
                    {new Date(cart.createdAt).toLocaleTimeString(locale)} ·{" "}
                    {cart.lines.length} {t("items")}
                  </Text>
                </View>
                <Text style={styles.value}>
                  {money(totals(cart.lines).total)}
                </Text>
                {icon("chevron-right")}
              </Pressable>
            ))}
          </>
        );
      case "receipts":
        return (
          <>
            <View style={styles.sectionHeader}>
              {heading(t("receipts"))}
              {iconButton(
                "refresh-cw",
                t("refresh"),
                () => void refreshList(),
                syncing || busy,
              )}
            </View>
            {field(
              t("receipts") + " · " + t("customer"),
              receiptQuery,
              setReceiptQuery,
              {
                testID: "receipt-search",
              },
            )}

            {shop.mode === "live" &&
              menu("search", t("olderReceipts"), "serverReceipts")}
            {!state.sales.length && help(t("noReceipts"))}
            {state.sales
              .filter(
                (sale) =>
                  !receiptQuery ||
                  (sale.receipt + " " + (sale.cart.customer?.name || ""))
                    .toLocaleLowerCase(locale)
                    .includes(receiptQuery.toLocaleLowerCase(locale)),
              )
              .map((sale) => (
                <Pressable
                  key={sale.id}
                  accessibilityRole="button"
                  accessibilityLabel={sale.receipt}
                  style={[
                    styles.menu,
                    sale.sync === "pending" && {
                      backgroundColor: palette.wash,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                    },
                  ]}
                  onPress={() => {
                    receiptOrder.current = state.sales.map((s) => s.id);
                    setReceiptDetails(true);
                    setLastSale(sale);
                    go("done");
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.body}>{sale.receipt}</Text>
                    <Text style={styles.small}>
                      {new Date(sale.createdAt).toLocaleString(locale, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {t(sale.training ? "training" : sale.sync)} ·{" "}
                      {t(sale.payment.method)}
                    </Text>
                  </View>
                  <Text style={styles.value}>{money(sale.total)}</Text>
                  {icon("chevron-right")}
                </Pressable>
              ))}
          </>
        );
      case "customer":
        return (
          <>
            {back("cart")}
            {heading(t("addCustomer"))}
            {field(t("name"), name, setName)}
            {field(t("phone") + " · " + t("optional"), phone, setPhone, {
              phone: true,
            })}
            {button(
              t("save"),
              () =>
                void run(async () => {
                  await repo.customer(name, phone);
                  go("cart");
                }),
              true,
              !name.trim() && !phone.trim(),
            )}
          </>
        );
      case "item":
        return (
          <>
            {back("more")}
            {heading(t("newItem"))}
            {shop.mode !== "training" ? (
              message(t("serverRequired"))
            ) : (
              <>
                {field(t("name"), name, setName)}
                {field(t("price"), itemPrice, setItemPrice, { numeric: true })}
                {field(
                  t("quickCode") + " · " + t("optional"),
                  itemCode,
                  setItemCode,
                  { numeric: true },
                )}
                {field(t("visual"), itemVisual, setItemVisual)}
                {button(
                  t("save"),
                  () =>
                    void run(async () => {
                      await repo.createItem({
                        id: uuid(),
                        name,
                        price: parseMoney(itemPrice),
                        code: quickCode(itemCode),
                        category: t("items"),
                        visual: itemVisual || "📦",
                        taxBps: shop.quickTaxBps,
                        taxInclusive: shop.quickTaxInclusive,
                        active: true,
                      });
                      setName("");
                      setItemPrice("");
                      setItemCode("");
                      go("sell");
                    }),
                  true,
                  !name.trim() || !itemPrice,
                )}
              </>
            )}
          </>
        );

      case "serverReceipts":
        return (
          <>
            {back("receipts")}
            {heading(t("olderReceipts"))}
            {help(t("ownReceipts"))}
            {field(
              t("receipts") + " · " + t("customer"),
              serverQuery,
              setServerQuery,
            )}
            {button(
              t("olderReceipts"),
              () =>
                void run(async () => {
                  setServerReceipt(null);
                  setServerReceipts([]);
                  setServerCursor(null);
                  setServerSearched(false);
                  const page = await new PosnicApi(shop.baseUrl!).receipts(
                    shop,
                    serverQuery,
                  );
                  setServerReceipts(page.receipts);
                  setServerCursor(page.next);
                  setSearchedQuery(serverQuery);
                  setServerSearched(true);
                }),
              true,
              busy || shop.mode === "training" || !shop.baseUrl,
            )}
            {serverSearched && !serverReceipts.length && help(t("noReceipts"))}
            {serverReceipt ? (
              <>
                {heading(serverReceipt.receipt)}
                {help(new Date(serverReceipt.createdAt).toLocaleString(locale))}
                {serverReceipt.lines.map((line, index) => (
                  <View key={index}>
                    {row(
                      line.name +
                        " × " +
                        line.quantity +
                        (line.unit ? " " + line.unit : ""),
                      formatMoney(
                        line.price * line.quantity,
                        serverReceipt.currency,
                        locale,
                      ),
                    )}
                  </View>
                ))}
                {row(
                  t("total"),
                  formatMoney(
                    serverReceipt.total,
                    serverReceipt.currency,
                    locale,
                  ),
                )}
                {help(t(serverReceipt.method))}
                {button(t("back"), () => setServerReceipt(null))}
              </>
            ) : (
              <>
                {serverReceipts.map((receipt) => (
                  <Pressable
                    key={receipt.id}
                    style={styles.menu}
                    accessibilityRole="button"
                    accessibilityLabel={receipt.receipt}
                    onPress={() => setServerReceipt(receipt)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.body}>{receipt.receipt}</Text>
                      <Text style={styles.small}>
                        {new Date(receipt.createdAt).toLocaleString(locale)} ·{" "}
                        {receipt.customer}
                      </Text>
                    </View>
                    <Text style={styles.value}>
                      {formatMoney(receipt.total, receipt.currency, locale)}
                    </Text>
                  </Pressable>
                ))}
                {serverCursor &&
                  button(
                    t("next"),
                    () =>
                      void run(async () => {
                        const page = await new PosnicApi(
                          shop.baseUrl!,
                        ).receipts(shop, searchedQuery, serverCursor);
                        setServerReceipts(page.receipts);
                        setServerCursor(page.next);
                        scrollRef.current?.scrollTo({ y: 0, animated: true });
                      }),
                    false,
                    busy,
                  )}
              </>
            )}
          </>
        );
      case "offlineData":
        return (
          <>
            {back("connection")}
            {heading(t("offlineData"))}
            <View style={styles.profileCard}>
              <View style={{ flex: 1 }}>
                {row(t("catalogue"), String(state.catalogue.count))}
                {row(t("receipts"), String(state.sales.length))}
                {row(
                  t("productImages"),
                  imageReadyCount + " / " + state.catalogue.imageCount,
                )}
                {row(t("pending"), String(state.outbox.length))}
                {diskUsage &&
                  row(
                    t("appStorage"),
                    new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(diskUsage.used / 1048576) + " MB",
                  )}
                {diskUsage &&
                  row(
                    t("freeStorage"),
                    new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(diskUsage.available / 1048576) + " MB",
                  )}
              </View>
            </View>
            {state.catalogueUpdatedAt &&
              help(
                t("catalogue") +
                  " · " +
                  new Date(state.catalogueUpdatedAt).toLocaleString(locale),
              )}
            {help(t("protectedData"))}
            {diskUsage &&
              diskUsage.available < 100 * 1048576 &&
              message(t("storageLow"))}
            {message(
              t("offlineUntil") +
                ": " +
                new Date(shop.offlineUntil).toLocaleString(locale),
            )}
            {Date.parse(shop.offlineUntil) <= Date.now() &&
              message(t("grantExpired"))}
            {help(
              t("historyPolicy") +
                ": " +
                (shop.historyPolicy?.days ?? 90) +
                " / " +
                (shop.historyPolicy?.maxReceipts ?? 10000),
            )}
            {menu("refresh-cw", t("connection"), "connection")}
            {menu("printer", t("printer"), "printer")}
          </>
        );
      case "printAttention":
        return (
          <>
            {back("connection")}
            {heading(t("printCheckPaper"))}
            {help(t("printUnknown"))}
            {directJobs.filter(printNeedsAttention).map((job) => {
              const sale = state.sales.find((s) => s.id === job.saleId);
              if (!sale) return null;
              return (
                <Pressable
                  key={job.id}
                  accessibilityRole="button"
                  accessibilityLabel={sale.receipt}
                  style={styles.menu}
                  onPress={() => {
                    receiptOrder.current = state.sales.map((s) => s.id);
                    setLastSale(sale);
                    setReceiptDetails(true);
                    go("done");
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.body}>{sale.receipt}</Text>
                    <Text style={styles.small}>
                      {job.printer.name} ·{" "}
                      {new Date(job.updatedAt).toLocaleString(locale)}
                    </Text>
                  </View>
                  {icon("chevron-right")}
                </Pressable>
              );
            })}
            {menu("printer", t("printer"), "printer")}
          </>
        );
      case "serverSettings":
        return (
          <Connections
            shop={shop}
            repo={repo}
            t={t}
            colors={palette}
            back={() => go("connection")}
            apply={async (data, loginName, signal) => {
              if (actionLock.current) throw Error("signOutSyncing");
              actionLock.current = true;
              let ownsSync = false;
              try {
                const deadline = Date.now() + 30000;
                while (
                  syncLock.current &&
                  Date.now() < deadline &&
                  !signal.aborted
                )
                  await new Promise((resolve) => setTimeout(resolve, 100));
                if (signal.aborted) throw Error("authorizationCancelled");
                if (syncLock.current) throw Error("signOutSyncing");
                syncLock.current = true;
                ownsSync = true;
                const previous = await vault.account();
                await vault.rememberConnection({
                  token: data.token,
                  username: loginName,
                  password: "",
                  server: data.shop.baseUrl!,
                });
                try {
                  await repo.switchConnection(data.shop, data.items);
                } catch (error) {
                  if (previous) await vault.remember(previous);
                  else await vault.clear();
                  throw error;
                }
                setServer(data.shop.baseUrl!);
                setUsername(loginName);
                setPassword("");
                setConnectionError("");
                setQuery("");
                setCategory("");
                await refresh();
                go("sell");
              } finally {
                if (ownsSync) syncLock.current = false;
                actionLock.current = false;
              }
            }}
          />
        );
      case "connection":
        return (
          <>
            {back("more")}
            {heading(t("connection"))}
            {shop.mode === "live" &&
              menu("server", t("serverSettings"), "serverSettings")}
            {message(
              shop.mode === "training"
                ? t("trainingHelp")
                : (shop.baseUrl ?? ""),
            )}
            {row(
              t("synced"),
              String(
                state.sales.filter((s) => !s.training && s.sync === "synced")
                  .length,
              ),
            )}
            {shop.capabilities.cloudDelivery ? (
              <>
                {row(
                  t("cloudReceived"),
                  String(
                    state.sales.filter((sale) => sale.cloudReceivedAt).length,
                  ),
                )}
                {help(t("cloudReceiptHelp"))}
              </>
            ) : (
              help(t("serverAcceptance"))
            )}
            {menu(
              "database",
              t("offlineData"),
              "offlineData",
              String(state.catalogue.count) + " · " + t("items"),
            )}
            {directJobs.some(printNeedsAttention) &&
              menu(
                "alert-circle",
                t("printCheckPaper"),
                "printAttention",
                String(directJobs.filter(printNeedsAttention).length),
              )}
            {row(
              t("pending"),
              String(state.outbox.filter((e) => e.state === "pending").length),
            )}
            {row(
              t("review"),
              String(state.outbox.filter((e) => e.state === "review").length),
            )}
            {help(t("offlineReady"))}
            {help(t("wifiFirst"))}
            {connectionError && message(t(connectionError))}
            {button(
              t(syncing ? "reconnecting" : "syncNow"),
              () => void syncNow(true),
              true,
              shop.mode === "training" || syncing,
            )}
            {help(t("keepSelling"))}
            {state.outbox.map((entry) => {
              const sale = state.sales.find((s) => s.id === entry.saleId);
              return (
                <Pressable
                  key={entry.id}
                  style={styles.menu}
                  accessibilityRole="button"
                  disabled={!sale}
                  onPress={() => {
                    if (sale) {
                      receiptOrder.current = state.sales.map((s) => s.id);
                      setLastSale(sale);
                      setReceiptDetails(true);
                      go("done");
                    }
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.body}>
                      {sale?.receipt ?? entry.saleId}
                    </Text>
                    <Text style={styles.small}>
                      {t(entry.state)}
                      {entry.error ? " · " + t(entry.error) : ""}
                    </Text>
                  </View>
                  {sale && (
                    <Text style={styles.value}>{money(sale.total)}</Text>
                  )}
                </Pressable>
              );
            })}
          </>
        );
      case "printer":
        return (
          <>
            {back("more")}
            {heading(t("printer"))}
            {(
              [
                "system",
                "till",
                ...(directPrinterAvailable ? ["bluetooth" as const] : []),
              ] as const
            ).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                aria-checked={state.settings.printer === value}
                accessibilityState={{
                  checked: state.settings.printer === value,
                  disabled: value === "till" && !shop.capabilities.tillPrint,
                }}
                disabled={value === "till" && !shop.capabilities.tillPrint}
                style={[
                  styles.menu,
                  value === "till" &&
                    !shop.capabilities.tillPrint &&
                    styles.disabled,
                ]}
                onPress={() =>
                  void run(() =>
                    repo.settings({ ...state.settings, printer: value }),
                  )
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.body}>
                    {t(
                      value === "bluetooth"
                        ? "directReceiptPrinter"
                        : value === "system"
                          ? "systemPrinter"
                          : "tillPrinter",
                    )}
                  </Text>
                  {value === "till" && !shop.capabilities.tillPrint && (
                    <Text style={styles.small}>{t("unavailable")}</Text>
                  )}
                </View>
                {state.settings.printer === value ? icon("check") : null}
              </Pressable>
            ))}
            {state.settings.printer === "bluetooth" && (
              <>
                {help(t("directPrinterHelp"))}
                {state.settings.directPrinter &&
                  message(state.settings.directPrinter.name)}
                {button(
                  t("pairedPrinters"),
                  () =>
                    void run(async () => setPrinters(await pairedPrinters())),
                )}
                {button(
                  t("usbPrinters"),
                  () => void run(async () => setPrinters(await usbPrinters())),
                )}
                {printers.map((printer) => (
                  <View key={printer.address}>
                    {button(
                      printer.name,
                      () =>
                        void run(async () =>
                          repo.settings({
                            ...state.settings,
                            directPrinter: {
                              ...(await authorizeDirectPrinter(printer)),
                              width: state.settings.directPrinter?.width ?? 384,
                            },
                          }),
                        ),
                    )}
                  </View>
                ))}
                <View style={styles.row}>
                  {[384, 576].map((width) => (
                    <View key={width} style={{ flex: 1 }}>
                      {button(
                        width === 384 ? "58 mm" : "80 mm",
                        () =>
                          void run(async () => {
                            if (!state.settings.directPrinter)
                              throw new Error("deviceUnavailable");
                            await repo.settings({
                              ...state.settings,
                              directPrinter: {
                                ...state.settings.directPrinter,
                                width: width as 384 | 576,
                              },
                            });
                          }),
                        state.settings.directPrinter?.width === width,
                      )}
                    </View>
                  ))}
                </View>
                {state.settings.directPrinter && (
                  <>
                    <View style={styles.row}>
                      <Text style={[styles.body, { flex: 1 }]}>
                        {t("cashDrawer")}
                      </Text>
                      <Switch
                        accessibilityLabel={t("cashDrawer")}
                        value={
                          state.settings.directPrinter.cashDrawer !== undefined
                        }
                        disabled={shop.permissions.receiptPrint !== true}
                        onValueChange={(enabled) =>
                          void run(() =>
                            repo.settings({
                              ...state.settings,
                              directPrinter: {
                                ...state.settings.directPrinter!,
                                cashDrawer: enabled ? 0 : undefined,
                              },
                            }),
                          )
                        }
                      />
                    </View>
                    {help(t("cashDrawerHelp"))}
                    {state.settings.directPrinter.cashDrawer !== undefined && (
                      <View style={styles.row}>
                        {([0, 1] as const).map((pin) => (
                          <View key={pin} style={{ flex: 1 }}>
                            {button(
                              t("drawerPin") + " " + (pin === 0 ? "2" : "5"),
                              () =>
                                void run(() =>
                                  repo.settings({
                                    ...state.settings,
                                    directPrinter: {
                                      ...state.settings.directPrinter!,
                                      cashDrawer: pin,
                                    },
                                  }),
                                ),
                              state.settings.directPrinter?.cashDrawer === pin,
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </>
            )}
            {help(t("printSystemHelp"))}
            <View style={styles.row}>
              <Text style={[styles.body, { flex: 1 }]}>{t("autoPrint")}</Text>
              <Switch
                value={state.settings.autoPrint}
                disabled={shop.permissions.receiptPrint !== true}
                onValueChange={(value) =>
                  void run(() =>
                    repo.settings({ ...state.settings, autoPrint: value }),
                  )
                }
              />
            </View>
            {button(
              t("testPrint"),
              () =>
                void run(async () => {
                  if (state.settings.printer === "bluetooth") {
                    await testDirect(
                      state.settings,
                      shop.name + "\n" + t("testPrint"),
                    );
                    setNotice("printCheckPaper");
                  } else await printTest(shop, state.settings, t);
                }),
              false,
              shop.permissions.receiptPrint !== true,
            )}
          </>
        );
      case "pin":
        return (
          <>
            {back("more")}
            {heading(t("setPin"))}
            {busy && (
              <View accessibilityRole="progressbar">
                <ActivityIndicator color={palette.accent} />
                {help(t("pinSetupWorking"))}
              </View>
            )}
            {help(t("pinHelp"))}
            {field(
              t("pin"),
              pin,
              (value) =>
                setPin(normalizeDigits(value).replace(/\D/g, "").slice(0, 6)),
              { numeric: true, secret: true },
            )}
            {field(
              t("confirmPin"),
              pinConfirm,
              (value) =>
                setPinConfirm(
                  normalizeDigits(value).replace(/\D/g, "").slice(0, 6),
                ),
              { numeric: true, secret: true },
            )}
            {button(
              t("save"),
              () =>
                void run(async () => {
                  if (pin !== pinConfirm) throw new Error("pinMismatch");
                  try {
                    await vault.enroll(pin);
                  } catch (error) {
                    if (
                      error instanceof Error &&
                      error.message === "pinTimeout"
                    )
                      throw Error("pinSetupTimeout");
                    throw error;
                  }
                  setPinEnabled(true);
                  setPin("");
                  setPinConfirm("");
                  go("sell");
                }),
              true,
              pin.length < 4 || pinConfirm.length < 4,
            )}
          </>
        );
      case "devices":
        return (
          <>
            {back("more")}
            {heading(t("devices"))}
            {help(t("deviceSetupHelp"))}
            {deviceOptions(shop).map((device) => (
              <React.Fragment key={device.id}>
                {actionRow(
                  device.id === "camera" || device.id === "hid"
                    ? "maximize"
                    : device.id === "till-print"
                      ? "printer"
                      : "smartphone",
                  t(device.label),
                  t(
                    device.id === "hid"
                      ? "externalScannerHelp"
                      : device.id === "camera"
                        ? "scan"
                        : "printSystemHelp",
                  ),
                  () => {
                    if (device.id === "camera") go("scanner");
                    else if (device.id === "hid") go("externalScanner");
                    else
                      void run(async () => {
                        await repo.settings({
                          ...state.settings,
                          printer:
                            device.id === "till-print" ? "till" : "system",
                        });
                        go("printer");
                      });
                  },
                  !device.enabled,
                  "device-" + device.id,
                )}
              </React.Fragment>
            ))}
            {help(t("printSystemHelp"))}
            {heading(t("paymentDevices"))}
            {help(t("unavailable"))}
          </>
        );
      case "externalScanner":
        return (
          <>
            {back("devices")}
            {heading(t("externalScanner"))}
            {help(t("externalScannerHelp"))}
            {help(t(scannerFocused ? "scannerReady" : "scannerPaused"))}
            <TextInput
              ref={scannerInput}
              testID="scanner-input"
              accessibilityLabel={t("externalScanner")}
              style={styles.input}
              defaultValue=""
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              showSoftInputOnFocus={false}
              blurOnSubmit={false}
              submitBehavior="submit"
              maxLength={513}
              onFocus={() => setScannerFocused(true)}
              onBlur={() => {
                setScannerFocused(false);
                scannerValue.current = "";
                scannerInput.current?.clear();
              }}
              onChangeText={(value) => {
                scannerValue.current = value;
              }}
              onSubmitEditing={(event) => {
                const scanned = event.nativeEvent.text || scannerValue.current;
                if (
                  !scans ||
                  (actionLock.current && !scanWriting.current) ||
                  locked ||
                  !scanned ||
                  AppState.currentState === "background"
                )
                  return;
                const value = scanned;
                scannerValue.current = "";
                scannerInput.current?.clear();
                setScanResult("");
                setBusy(true);
                scanWriting.current++;
                actionLock.current = true;
                setError("");
                void scans
                  .submit(value)
                  .then(async (name) => {
                    setScanResult(name);
                    await refresh();
                  })
                  .catch((error) =>
                    setError(
                      error instanceof Error ? error.message : "unknownError",
                    ),
                  )
                  .finally(() => {
                    scanWriting.current--;
                    if (!scanWriting.current) {
                      actionLock.current = false;
                      setBusy(false);
                    }
                  });
              }}
            />
            {button(t("resumeScanner"), () => scannerInput.current?.focus())}
            {!!scanResult && (
              <Text
                accessibilityLiveRegion="polite"
                style={styles.body}
                testID="scan-result"
              >
                {scanResult}
              </Text>
            )}
            {row(t("total"), money(sum.total))}
            {button(
              t("cart"),
              () => go("cart"),
              true,
              !state.cart.lines.length,
            )}
          </>
        );
      case "leaveTraining":
        return (
          <>
            {back("more")}
            {heading(t("leaveTraining"))}
            {help(t("clearPracticeHelp"))}
            {button(
              t("clearPractice"),
              () =>
                void run(async () => {
                  await repo.leaveTraining();
                  await vault.clear();
                  setPinEnabled(false);
                  setLastSale(null);
                  setQuery("");
                  setCategory("");
                  setAmount("");
                  setNote("");
                  go("sell");
                }),
              true,
            )}
            {button(t("cancel"), () => go("more"))}
          </>
        );
      default:
        return (
          <>
            <View style={styles.profileCard}>
              <View style={styles.menuIcon}>{icon("user")}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuTitle}>{shop.staffName}</Text>
                <Text style={styles.small}>
                  {shop.name} · {shop.branchName}
                </Text>
              </View>
            </View>
            {menu("pause-circle", t("held"), "held")}
            {menu("lock", t("setPin"), "pin")}
            {pinEnabled && button(t("lockNow"), lock)}
            {button(t("switchUser"), () => setConfirmSignOut(true))}
            {shop.permissions.itemWrite &&
              menu("package", t("newItem"), "item")}
            {menu(
              "globe",
              t("language"),
              "language",
              languages.find((l) => l.code === locale)?.name,
            )}
            {menu("printer", t("printer"), "printer")}
            {menu("cpu", t("devices"), "devices")}
            {menu("refresh-cw", t("connection"), "connection")}

            {menu("database", t("offlineData"), "offlineData")}

            {button(
              t("privacyPolicy"),
              () =>
                void run(() =>
                  Linking.openURL(
                    "https://github.com/Posnic/Mobile-App/blob/main/docs/PRIVACY.md",
                  ),
                ),
            )}
            {button(
              t("deleteAccountRequest"),
              () =>
                void run(() =>
                  Linking.openURL(
                    "https://github.com/Posnic/Mobile-App/blob/main/docs/PRIVACY.md#access-deletion-and-account-requests",
                  ),
                ),
            )}

            {help(shop.mode === "training" ? t("trainingHelp") : shop.name)}
            {shop.mode === "training" &&
              menu("log-out", t("leaveTraining"), "leaveTraining")}
          </>
        );
    }
  }
  const navs: { target: Screen; label: string; glyph: IconName }[] = [
    {
      target: "sell",
      label:
        shop && !shop.permissions.sell && shop.capabilities.inventory
          ? "inventory"
          : "sell",
      glyph:
        shop && !shop.permissions.sell && shop.capabilities.inventory
          ? "package"
          : "shopping-bag",
    },
    { target: "receipts", label: "receipts", glyph: "file-text" },
    { target: "more", label: "more", glyph: "menu" },
  ];
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.shell, rtl && { direction: "rtl" }]}>
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Brand dark={dark} />
              <Text style={styles.small} numberOfLines={1}>
                {shop ? shop.name + " · " + shop.branchName : t("connect")}
              </Text>
            </View>
            {!shop && iconButton("globe", t("language"), () => go("language"))}
            {shop?.mode === "live" &&
              !locked &&
              iconButton(
                shop.baseUrl && isLocalServer(shop.baseUrl) ? "wifi" : "globe",
                t("connection"),
                () => go("serverSettings"),
              )}
            {shop && !locked && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("connection")}
                onPress={() => go("connection")}
                style={styles.status}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        connectionError || state?.outbox.length
                          ? palette.muted
                          : palette.accent,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    !!state?.outbox.length && { color: palette.muted },
                  ]}
                >
                  {t(
                    shop.mode === "training"
                      ? "training"
                      : connectionError
                        ? connectionError === "networkError"
                          ? "offlineWorking"
                          : "review"
                        : state?.outbox.length
                          ? "pending"
                          : "ready",
                  )}
                </Text>
              </Pressable>
            )}
          </View>
          {shop?.mode === "live" &&
            (connectionError || !!state?.outbox.length) && (
              <View style={styles.message} accessibilityLiveRegion="polite">
                <Text style={styles.small}>
                  {connectionError ? t(connectionError) + " · " : ""}
                  {connectionError === "networkError" &&
                  shop.baseUrl &&
                  isLocalServer(shop.baseUrl) &&
                  !shop.connection?.remote
                    ? t("wifiRequired") + " · "
                    : ""}
                  {state?.outbox.filter((e) => e.state === "pending").length}{" "}
                  {t("waitingToSend")} · {t("keepSelling")}
                </Text>
              </View>
            )}
          {error && state && !locked && (
            <View accessibilityRole="alert" style={styles.error}>
              <Text style={[styles.body, { color: palette.danger, flex: 1 }]}>
                {t(error)}
              </Text>
              {iconButton("x", t("dismiss"), () => setError(""))}
            </View>
          )}
          {notice && (
            <View accessibilityLiveRegion="polite" style={styles.message}>
              <Text style={styles.body}>{t(notice)}</Text>
            </View>
          )}
          <GestureScroll
            testID="screen-scroll"
            keyboardDismissMode={
              screen === "externalScanner" ? "none" : undefined
            }
            scrollRef={scrollRef}
            width={dimensions.width}
            rtl={rtl}
            canGoBack={screen !== "sell" && !locked}
            details={screen === "done" && receiptDetails && !locked}
            blocked={busy || locked}
            onNavigate={(action) =>
              action === "back" ? void navigateBack() : browseReceipt(action)
            }
            refreshControl={
              refreshable ? (
                <RefreshControl
                  refreshing={refreshingList}
                  enabled={!busy}
                  onRefresh={() => void refreshList()}
                  tintColor={palette.accent}
                  colors={[palette.accent]}
                />
              ) : undefined
            }
            contentContainerStyle={styles.content}
          >
            {content()}
          </GestureScroll>
          {shop &&
            state &&
            !locked &&
            (screen === "sell" || screen === "quick") && (
              <View style={styles.checkoutDock}>
                <Pressable
                  testID="view-cart"
                  accessibilityRole="button"
                  accessibilityLabel={
                    state.cart.lines.length
                      ? `${t("cart")} · ${money(sum.total)}`
                      : t("emptyCart")
                  }
                  disabled={busy || !state.cart.lines.length}
                  onPress={() => go("cart")}
                  style={({ pressed }) => [
                    styles.checkoutButton,
                    !state.cart.lines.length && styles.checkoutEmpty,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather
                    name="shopping-bag"
                    size={21}
                    color={
                      state.cart.lines.length ? palette.onAccent : palette.muted
                    }
                  />
                  <Text
                    style={[
                      styles.checkoutLabel,
                      !state.cart.lines.length && { color: palette.muted },
                    ]}
                  >
                    {state.cart.lines.length ? t("cart") : t("emptyCart")}
                  </Text>
                  {!!state.cart.lines.length && (
                    <>
                      <Text style={styles.checkoutTotal}>
                        {money(sum.total)}
                      </Text>
                      <Feather
                        name="arrow-right"
                        size={20}
                        color={palette.onAccent}
                      />
                    </>
                  )}
                </Pressable>
              </View>
            )}
          {busy && (
            <View style={styles.busy}>
              <ActivityIndicator color={palette.accent} />
            </View>
          )}
          {shop && !locked && (
            <View style={styles.nav}>
              {navs.map((nav) => {
                const selected =
                  screen === nav.target ||
                  (nav.target === "receipts" &&
                    screen === "done" &&
                    receiptDetails) ||
                  (nav.target === "sell" &&
                    !(screen === "done" && receiptDetails) &&
                    [
                      "cart",
                      "payment",
                      "cash",
                      "card",
                      "upi",
                      "quick",
                      "code",
                      "done",
                      "scanner",
                      "customer",
                    ].includes(screen));
                return (
                  <Pressable
                    key={nav.target}
                    accessibilityRole="tab"
                    aria-selected={selected}
                    accessibilityState={{ selected }}
                    accessibilityLabel={t(nav.label)}
                    onPress={() => go(nav.target)}
                    style={[styles.navItem, selected && styles.chipActive]}
                  >
                    <Feather
                      name={nav.glyph}
                      size={20}
                      color={selected ? palette.accent : palette.muted}
                    />
                    <Text
                      style={[
                        styles.navLabel,
                        selected && { color: palette.accent },
                      ]}
                    >
                      {t(nav.label)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function safeAmount(value: string) {
  try {
    return parseMoney(value);
  } catch {
    return 0;
  }
}
function makeStyles(p: {
  paper: string;
  ink: string;
  muted: string;
  line: string;
  wash: string;
  accent: string;
  onAccent: string;
  soft: string;
  danger: string;
}) {
  return StyleSheet.create({
    center: { alignItems: "center" },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
    },
    menuIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: p.soft,
      alignItems: "center",
      justifyContent: "center",
    },
    menuTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: p.ink,
      lineHeight: 22,
    },
    profileCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 18,
      borderRadius: 18,
      borderColor: p.line,
      borderWidth: 1,
      backgroundColor: p.paper,
    },
    welcomeArt: {
      height: 150,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: p.soft,
      borderRadius: 32,
      marginBottom: 20,
    },
    welcomeReceipt: {
      padding: 22,
      width: 140,
      height: 130,
      backgroundColor: p.paper,
      borderRadius: 16,
      transform: [{ rotate: "-7deg" }],
    },
    receiptRule: {
      height: 5,
      width: 90,
      borderRadius: 3,
      backgroundColor: p.line,
      marginTop: 13,
    },
    welcomeCheck: {
      position: "absolute",
      end: -20,
      bottom: 6,
      width: 44,
      height: 44,
      borderRadius: 15,
      backgroundColor: p.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    intro: { paddingTop: 10, paddingBottom: 4 },
    introIcon: {
      width: 52,
      height: 52,
      borderRadius: 17,
      backgroundColor: p.soft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6,
    },
    setupCard: {
      padding: 0,
      gap: 12,
      backgroundColor: p.wash,
    },
    connectionTools: { flexDirection: "row", gap: 10 },
    inputFocused: { borderColor: p.accent, backgroundColor: p.paper },
    checkoutDock: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 12,
      backgroundColor: p.wash,
      borderTopWidth: 1,
      borderTopColor: p.line,
    },
    checkoutButton: {
      minHeight: 58,
      borderRadius: 17,
      paddingHorizontal: 18,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: p.accent,
    },
    checkoutEmpty: { backgroundColor: p.line },
    checkoutLabel: {
      flex: 1,
      color: p.onAccent,
      fontSize: 14,
      fontWeight: "600",
    },
    checkoutTotal: {
      color: p.onAccent,
      fontSize: 20,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    connectOptions: { flexDirection: "row", gap: 6 },
    connectOption: {
      flex: 1,
      minHeight: 70,
      padding: 8,
      borderRadius: 12,
      backgroundColor: p.wash,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    safe: { flex: 1, backgroundColor: p.wash },
    shell: {
      flex: 1,
      width: "100%",
      maxWidth: 900,
      alignSelf: "center",
      backgroundColor: p.wash,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: p.paper,
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    brand: { fontSize: 24, fontWeight: "700", color: p.ink, letterSpacing: -1 },
    small: { fontSize: 12, color: p.muted, lineHeight: 18 },
    status: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      padding: 9,
      borderRadius: 12,
      backgroundColor: p.soft,
      maxWidth: 125,
    },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: {
      fontSize: 11,
      fontWeight: "600",
      color: p.accent,
      flexShrink: 1,
    },
    content: { padding: 22, gap: 14, paddingBottom: 28 },
    heading: {
      fontSize: 25,
      fontWeight: "700",
      color: p.ink,
      letterSpacing: -0.6,
      marginVertical: 8,
    },
    help: { fontSize: 14, lineHeight: 21, color: p.muted, marginVertical: 4 },
    body: { fontSize: 16, lineHeight: 23, color: p.ink },
    value: { fontSize: 17, fontWeight: "600", color: p.ink },
    button: {
      minHeight: 50,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: p.line,
      backgroundColor: p.paper,
      justifyContent: "center",
      alignItems: "center",
      marginVertical: 3,
    },
    buttonText: {
      fontSize: 15,
      fontWeight: "600",
      color: p.ink,
      textAlign: "center",
    },
    primary: { backgroundColor: p.accent, borderColor: p.accent },
    onAccent: { color: p.onAccent },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
    iconButton: {
      width: 46,
      height: 46,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: p.paper,
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: 14,
    },
    field: { gap: 7, marginVertical: 3 },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: p.muted },
    input: {
      minHeight: 48,
      borderRadius: 12,
      padding: 12,
      backgroundColor: p.paper,
      color: p.ink,
      fontSize: 16,
      borderWidth: 1,
      borderColor: p.line,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    menu: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: 16,
      backgroundColor: p.paper,
      minHeight: 66,
    },
    message: {
      backgroundColor: p.soft,
      padding: 14,
      borderRadius: 12,
      marginVertical: 4,
    },
    error: {
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    segments: {
      flexDirection: "row",
      backgroundColor: p.soft,
      padding: 4,
      borderRadius: 16,
      gap: 4,
    },
    segment: {
      flex: 1,
      minHeight: 46,
      justifyContent: "center",
      padding: 8,
      borderRadius: 11,
    },
    segmentActive: { backgroundColor: p.paper },
    searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    categories: {
      flexDirection: "row",
      gap: 8,
      paddingVertical: 4,
      flexWrap: "wrap",
    },
    chip: {
      minHeight: 44,
      paddingHorizontal: 13,
      paddingVertical: 10,
      justifyContent: "center",
      borderRadius: 22,
      backgroundColor: p.paper,
    },
    chipActive: { backgroundColor: p.soft },
    tile: {
      flex: 1,
      backgroundColor: p.paper,
      borderRadius: 16,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: p.line,
    },
    art: {
      width: 44,
      height: 44,
      marginTop: 14,
      marginStart: 14,
      borderRadius: 13,
      backgroundColor: p.wash,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    tileLabel: { padding: 14, gap: 5 },
    itemName: {
      fontSize: 13,
      fontWeight: "600",
      color: p.ink,
      minHeight: 34,
      lineHeight: 17,
    },
    itemPrice: { fontSize: 13, fontWeight: "500", color: p.muted },
    itemCount: {
      position: "absolute",
      top: 42,
      end: 0,
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 5,
      backgroundColor: p.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    itemCountText: { color: p.onAccent, fontWeight: "700", fontSize: 11 },
    amount: {
      fontSize: 44,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      textAlign: "center",
      color: p.ink,
      marginVertical: 18,
      letterSpacing: -1,
    },
    keypad: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    key: {
      width: "31.5%",
      flexGrow: 1,
      minHeight: 62,
      borderRadius: 16,
      backgroundColor: p.paper,
      borderWidth: 1,
      borderColor: p.line,
      justifyContent: "center",
      alignItems: "center",
    },
    keyText: { fontSize: 24, color: p.ink },
    cartLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    quantity: { flexDirection: "row", alignItems: "center", gap: 8 },
    back: { alignSelf: "flex-start" },
    nav: {
      backgroundColor: p.paper,
      flexDirection: "row",
      padding: 8,
      borderTopWidth: 1,
      borderTopColor: p.line,
      gap: 4,
    },
    navItem: {
      flex: 1,
      minWidth: 0,
      minHeight: 58,
      justifyContent: "center",
      alignItems: "center",
      gap: 5,
      borderRadius: 12,
      padding: 4,
    },
    navLabel: {
      width: "100%",
      fontSize: 11,
      color: p.muted,
      textAlign: "center",
    },
    loading: { padding: 30, alignItems: "center", gap: 20 },
    busy: { position: "absolute", top: 16, right: 16 },
    qr: {
      padding: 18,
      backgroundColor: "#fff",
      alignSelf: "center",
      borderRadius: 12,
      marginVertical: 12,
    },
    success: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: p.soft,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      marginTop: 16,
    },
    camera: { height: 340, borderRadius: 18, overflow: "hidden" },
  });
}
