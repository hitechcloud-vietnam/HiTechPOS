import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { Shop } from "../domain/types";
import type { Repository } from "../data/repository";
import { PosnicApi } from "../services/api";
import { discoverServers, type DiscoveredServer } from "../services/discovery";
import { isLocalServer, parseServerInput } from "../services/serverAddress";
import { wifiAddress } from "../platform/wifi";
import { vault } from "../platform/vault";
import { authorizeAccount } from "../services/accountAuthorization";
import { openAccountBrowser } from "../platform/authBrowser";
type Data = Awaited<ReturnType<PosnicApi["connect"]>>;
type Props = {
  shop: Shop;
  repo: Repository;
  t: (key: string) => string;
  back: () => void;
  apply: (data: Data, username: string, signal: AbortSignal) => Promise<void>;
  colors: {
    ink: string;
    muted: string;
    accent: string;
    paper: string;
    line: string;
    soft: string;
  };
};
export function Connections({ shop, repo, t, back, apply, colors: c }: Props) {
  const [saved, setSaved] = useState<string[]>([]),
    [view, setView] = useState("home"),
    [address, setAddress] = useState(""),
    [selected, setSelected] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [useCode, setUseCode] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [found, setFound] = useState<DiscoveredServer[]>([]),
    [progress, setProgress] = useState(""),
    [match, setMatch] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const operation = useRef<AbortController | null>(null),
    alive = useRef(true),
    scanLock = useRef(false);
  useEffect(() => {
    alive.current = true;
    void repo
      .connections(shop)
      .then((value) => {
        if (alive.current) setSaved(value);
      })
      .catch(() => setError("storageUnavailable"));
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, [repo, shop.baseUrl]);
  const text = { color: c.ink, fontSize: 17 };
  const button = (
    label: string,
    action: () => void,
    icon?: React.ComponentProps<typeof Feather>["name"],
    availableWhileSearching = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy && !availableWhileSearching}
      onPress={action}
      style={{
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 16,
        padding: 16,
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        opacity: busy && !availableWhileSearching ? 0.5 : 1,
        backgroundColor: c.paper,
      }}
    >
      {icon && <Feather name={icon} size={22} color={c.accent} />}
      <Text style={{ ...text, flex: 1 }}>{label}</Text>
      <Feather name="chevron-right" size={18} color={c.muted} />
    </Pressable>
  );
  const input = (
    label: string,
    value: string,
    set: (s: string) => void,
    secret = false,
  ) => (
    <View>
      <Text style={{ ...text, marginBottom: 8 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={set}
        editable={!busy}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          ...text,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 14,
          padding: 15,
          backgroundColor: c.paper,
        }}
      />
    </View>
  );
  async function run(fn: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const ctrl = new AbortController();
    operation.current = ctrl;
    setBusy(true);
    setError("");
    try {
      await Promise.race([
        fn(ctrl.signal),
        new Promise<void>((resolve) => {
          ctrl.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        }),
      ]);
    } catch (e) {
      if (alive.current && !ctrl.signal.aborted)
        setError(e instanceof Error ? e.message : "unknownError");
    } finally {
      if (alive.current) {
        setBusy(false);
        setMatch("");
      }
      operation.current = null;
    }
  }
  async function accept(
    data: Data,
    signal: AbortSignal,
    loginName = data.shop.staffName,
  ) {
    if (signal.aborted || !alive.current) return;
    if (
      data.shop.id !== shop.id ||
      data.shop.branchId !== shop.branchId ||
      data.shop.staffId !== shop.staffId
    )
      throw Error("connectionWrongShop");
    await apply(data, loginName, signal);
  }
  async function choose(raw: string, signal: AbortSignal) {
    const parsed = parseServerInput(raw);
    const api = new PosnicApi(parsed.address);
    const runtime = await api.probe();
    if (runtime.features?.mobilePosV1 !== true) throw Error("serverUpgrade");
    if (signal.aborted) return;
    setSelected(parsed.address);
    setAddress(parsed.address);
    setPassword("");
    setCode(parsed.code ?? "");
    if (parsed.code) setUseCode(true);
    const account = await vault.accountFor(parsed.address);
    if (account) {
      try {
        const data = await api.catalogue();
        await accept(
          { ...data, token: account.token },
          signal,
          account.username,
        );
        return;
      } catch (e) {
        if (
          !["signInFailed", "permissionDenied"].includes(
            e instanceof Error ? e.message : "",
          )
        )
          throw e;
      }
    }
    if (signal.aborted || !alive.current) return;
    setUsername(account?.username ?? "");
    setView("login");
  }
  async function cloud(signal: AbortSignal) {
    const grant = await authorizeAccount(
      "login",
      async (url, code) => {
        setMatch(code);
        await openAccountBrowser(url, signal);
      },
      signal,
    );
    if (signal.aborted) return;
    await accept(
      await new PosnicApi(grant.baseUrl).connect(
        "",
        "",
        grant.code,
        false,
        grant.verifier,
      ),
      signal,
    );
  }
  async function search(signal: AbortSignal) {
    setView("wifi");
    setFound([]);
    await discoverServers(
      await wifiAddress(),
      signal,
      (server) => {
        if (alive.current && !signal.aborted)
          setFound((old) =>
            old.some((s) => s.address === server.address)
              ? old
              : [...old, server],
          );
      },
      (done, total) => {
        if (alive.current && !signal.aborted) setProgress(`${done}/${total}`);
      },
    );
  }
  return (
    <View style={{ gap: 16 }}>
      {button(t("back"), back, "arrow-left")}
      <Text
        accessibilityRole="header"
        style={{ ...text, fontSize: 28, fontWeight: "700" }}
      >
        {t("connection")}
      </Text>
      {error !== "" && (
        <Text accessibilityRole="alert" style={{ ...text, color: c.accent }}>
          {t(error)}
        </Text>
      )}
      {busy && (
        <View style={{ gap: 10 }}>
          <ActivityIndicator color={c.accent} />
          <Text style={text}>
            {match ? t("authorizeInBrowser") + " " + match : t("loading")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => operation.current?.abort()}
            style={{ padding: 16 }}
          >
            <Text style={text}>{t("cancel")}</Text>
          </Pressable>
        </View>
      )}
      {view === "home" && (
        <>
          <View
            style={{
              padding: 16,
              backgroundColor: c.soft,
              borderRadius: 16,
              gap: 8,
            }}
          >
            <Text style={text}>{t("connectionCurrent")}</Text>
            <Text style={{ ...text, fontWeight: "700" }}>
              {t(
                isLocalServer(shop.baseUrl!)
                  ? "connectionWifi"
                  : "connectionInternet",
              )}
            </Text>
            <Text selectable style={{ color: c.muted }}>
              {shop.baseUrl}
            </Text>
          </View>
          <Text style={{ color: c.muted }}>{t("connectionHelp")}</Text>
          {saved
            .filter((s) => s !== shop.baseUrl)
            .map((url) => (
              <View key={url}>
                {button(
                  t(
                    isLocalServer(url)
                      ? "connectionWifi"
                      : "connectionInternet",
                  ) +
                    " · " +
                    url,
                  () => void run((s) => choose(url, s)),
                  isLocalServer(url) ? "wifi" : "globe",
                )}
              </View>
            ))}
          {button(
            t("serverSignIn"),
            () => void run((s) => choose(shop.baseUrl!, s)),
            "refresh-cw",
          )}
          {button(t("connectionInternet"), () => void run(cloud), "globe")}
          {button(t("searchWifi"), () => void run(search), "wifi")}
          {button(
            t("shopQr"),
            () => {
              scanLock.current = false;
              setView("scan");
            },
            "maximize",
          )}
          {button(
            t("pairCode"),
            () => {
              setUseCode(true);
              setView("address");
            },
            "key",
          )}
          {button(
            t("server"),
            () => {
              setUseCode(false);
              setView("address");
            },
            "edit-3",
          )}
        </>
      )}
      {view === "wifi" && (
        <>
          <Text style={{ color: c.muted }}>
            {t("chooseServer")} · {progress}
          </Text>
          {found.map((hit) => (
            <View key={hit.address}>
              {button(
                hit.address +
                  " · " +
                  hit.edition +
                  (hit.compatible ? "" : " · " + t("serverUpgrade")),
                () => {
                  operation.current?.abort();
                  // Let the cancelled scan release its operation lock first.
                  setTimeout(() => void run((s) => choose(hit.address, s)), 0);
                },
                "server",
                true,
              )}
            </View>
          ))}
          {!busy && found.length === 0 && (
            <Text style={text}>{t("wifiNotFound")}</Text>
          )}
          {button(t("searchWifi"), () => void run(search), "refresh-cw")}
          {button(t("server"), () => setView("address"), "edit-3")}
        </>
      )}
      {view === "address" && (
        <>
          {input(t("server"), address, setAddress)}
          {button(
            t("next"),
            () => void run((s) => choose(address, s)),
            "arrow-right",
          )}
        </>
      )}
      {view === "login" && (
        <>
          <Text selectable style={{ color: c.muted }}>
            {selected}
          </Text>
          {useCode ? (
            input(t("pairCode"), code, setCode)
          ) : (
            <>
              {input(t("username"), username, setUsername)}
              {input(t("password"), password, setPassword, true)}
            </>
          )}
          {button(
            t(useCode ? "pair" : "signIn"),
            () =>
              void run(async (signal) =>
                accept(
                  await new PosnicApi(selected).connect(
                    useCode ? "" : username,
                    useCode ? "" : password,
                    useCode ? code : undefined,
                    false,
                  ),
                  signal,
                  useCode ? undefined : username.trim(),
                ),
              ),
            "check",
          )}
          {button(
            t(useCode ? "signIn" : "pairCode"),
            () => setUseCode(!useCode),
            "key",
          )}
        </>
      )}
      {view === "scan" && (
        <>
          {!permission?.granted ? (
            button(
              t("cameraPermission"),
              () => void requestPermission(),
              "camera",
            )
          ) : (
            <CameraView
              style={{ height: 300, borderRadius: 16 }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (scanLock.current) return;
                scanLock.current = true;
                void run(async (signal) => {
                  try {
                    await choose(data, signal);
                  } finally {
                    scanLock.current = false;
                  }
                });
              }}
            />
          )}
          {button(t("server"), () => setView("address"), "edit-3")}
        </>
      )}
      {view !== "home" &&
        button(
          t("connection"),
          () => {
            setError("");
            setView("home");
          },
          "globe",
        )}
    </View>
  );
}
