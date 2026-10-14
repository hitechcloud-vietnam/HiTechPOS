import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Picker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import type { Repository } from "../data/repository";
import type { Item, Shop } from "../domain/types";
import { parseQuantity } from "../domain/money";
import {
  photoLine,
  photoReady,
  type PhotoDraft,
  type PhotoMode,
} from "../domain/photoOrders";
import {
  localPhotoReading,
  readLocalPhoto,
} from "../platform/photoRecognition";
import { PosnicApi } from "../services/api";
import { credentials } from "../platform/credentials";

type Props = {
  repo: Repository;
  shop: Shop;
  t: (key: string) => string;
  back: () => void;
  imported: () => Promise<void>;
  money: (value: number) => string;
};
async function photoRequestId(draft: PhotoDraft) {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    draft.id + draft.image,
  );
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
export function PhotoOrders({ repo, shop, t, back, imported, money }: Props) {
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [mode, setMode] = useState<PhotoMode>("product");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Item[]>([]);
  const [quantity, setQuantity] = useState("");
  const mounted = useRef(true),
    lock = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    repo
      .photoDraft()
      .then((d) => {
        if (mounted.current) setDraft(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [repo]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "photoReadFailed");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save(next: PhotoDraft) {
    const value = await repo.savePhotoDraft(next, draft?.revision ?? null);
    if (mounted.current) setDraft(value);
    return value;
  }
  function eraseFile(uri: string) {
    if (Platform.OS !== "web" && uri.startsWith("file:")) {
      try {
        new File(uri).delete();
      } catch {
        /* Private cache is also cleaned by the OS. */
      }
    }
  }
  async function capture(camera: boolean) {
    if (camera && !(await Picker.requestCameraPermissionsAsync()).granted)
      throw Error("cameraPermission");
    const result = await (
      camera ? Picker.launchCameraAsync : Picker.launchImageLibraryAsync
    )({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
      exif: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0]!;
    const resize =
      asset.width > 2000 || asset.height > 2000
        ? [
            {
              resize:
                asset.width >= asset.height
                  ? { width: 2000 }
                  : { height: 2000 },
            },
          ]
        : [];
    const image = await manipulateAsync(asset.uri, resize, {
      base64: true,
      compress: 0.85,
      format: SaveFormat.JPEG,
    });
    try {
      if (!image.base64 || image.base64.length > 6900000)
        throw Error("photoInvalid");
      await save({
        id: Crypto.randomUUID(),
        scope: repo.photoScope(shop),
        revision: 0,
        mode,
        image: "data:image/jpeg;base64," + image.base64,
        lines: [],
        createdAt: new Date().toISOString(),
      });
    } finally {
      eraseFile(image.uri);
      if (asset.uri !== image.uri) eraseFile(asset.uri);
    }
  }
  async function transform(rotate: boolean) {
    if (!draft) return;
    const size = await new Promise<{ width: number; height: number }>(
      (resolve, reject) =>
        Image.getSize(
          draft.image,
          (width, height) => resolve({ width, height }),
          reject,
        ),
    );
    const action = rotate
      ? { rotate: 90 }
      : {
          crop: {
            originX: Math.floor(size.width * 0.05),
            originY: Math.floor(size.height * 0.05),
            width: Math.floor(size.width * 0.9),
            height: Math.floor(size.height * 0.9),
          },
        };
    const image = await manipulateAsync(draft.image, [action], {
      base64: true,
      format: SaveFormat.JPEG,
      compress: 0.9,
    });
    try {
      await save({ ...draft, image: "data:image/jpeg;base64," + image.base64 });
    } finally {
      eraseFile(image.uri);
    }
  }
  async function read(cloud: boolean) {
    if (!draft) return;
    const epoch = ++generation.current;
    let texts: string[],
      truncated = false;
    if (cloud) {
      if (shop.mode !== "live" || !shop.baseUrl)
        throw Error("photoCloudUnavailable");
      const api = new PosnicApi(shop.baseUrl, fetch, 90000);
      const token = await credentials.get(shop.baseUrl);
      const options = (await api.request(
        "/mobile/v1/photo-orders/options",
        undefined,
        token,
      )) as { enabled: boolean; configured: boolean };
      if (!options.enabled || !options.configured)
        throw Error("photoCloudUnavailable");
      const result = (await api.request(
        "/mobile/v1/photo-orders/recognize",
        {
          id: await photoRequestId(draft),
          original: draft.image,
        },
        token,
      )) as { lines?: { text?: string }[]; truncated?: boolean };
      if (!Array.isArray(result.lines)) throw Error("photoReadFailed");
      texts = result.lines.map((l) => String(l.text ?? "").slice(0, 300));
      truncated = !!result.truncated;
    } else texts = await readLocalPhoto(draft.image);
    if (!mounted.current || epoch !== generation.current) return;
    texts = texts.filter((v) => v.trim());
    if (!texts.length) throw Error("photoNoText");
    truncated ||= texts.length > 50;
    const lines =
      draft.mode === "product"
        ? [
            {
              ...photoLine(texts.join(" ").slice(0, 300), Crypto.randomUUID()),
              quantity: 1,
            },
          ]
        : texts
            .slice(0, 50)
            .map((text) => photoLine(text, Crypto.randomUUID()));
    await save({ ...draft, lines, truncated });
  }
  async function choose(id: string) {
    const row = draft!.lines.find((l) => l.id === id)!;
    setActive(id);
    setQuery(row.query);
    setQuantity(row.quantity === null ? "" : String(row.quantity));
    setMatches(await repo.matchPhotoProducts(row.query));
  }
  async function select(item: Item) {
    if (!draft || !active) return;
    const value = parseQuantity(quantity, item.quantityScale ?? 1);
    const row = {
      ...draft.lines.find((l) => l.id === active)!,
      item,
      quantity: value,
      reviewed: true,
      excluded: false,
    };
    if (!photoReady({ ...draft, lines: [row] })) throw Error("invalidQuantity");
    await save({
      ...draft,
      lines: draft.lines.map((l) => (l.id === active ? row : l)),
    });
    setActive(null);
  }
  const button = (
    label: string,
    action: () => void,
    primary = false,
    disabled = false,
    icon?: React.ComponentProps<typeof Feather>["name"],
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={action}
      style={[
        styles.button,
        primary && styles.primary,
        (disabled || busy) && styles.disabled,
      ]}
    >
      {icon && (
        <Feather name={icon} size={19} color={primary ? "white" : "#365643"} />
      )}
      <Text style={[styles.buttonText, primary && { color: "white" }]}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        onPress={back}
        style={styles.button}
      >
        <Feather name="arrow-left" size={19} color="#365643" />
        <Text style={styles.buttonText}>{t("photoBack")}</Text>
      </Pressable>
      <Text style={styles.title}>
        {t(
          active
            ? "photoChooseProduct"
            : draft?.lines.length
              ? "photoReview"
              : "photoTitle",
        )}
      </Text>
      {busy && (
        <View accessibilityRole="progressbar">
          <ActivityIndicator color="#365c48" />
          <Text style={styles.help}>{t("photoWorking")}</Text>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(error)}
        </Text>
      )}
      {!draft ? (
        <>
          <Text style={styles.help}>{t("photoIntro")}</Text>
          <View style={styles.row}>
            {(["product", "order"] as const).map((m) => (
              <View key={m} style={{ flex: 1 }}>
                {button(
                  t(m === "product" ? "photoFind" : "photoOrder"),
                  () => setMode(m),
                  mode === m,
                  false,
                  m === "product" ? "camera" : "file-text",
                )}
              </View>
            ))}
          </View>
          {button(
            t("photoTake"),
            () => void run(() => capture(true)),
            true,
            false,
            "camera",
          )}
          {button(
            t("photoGallery"),
            () => void run(() => capture(false)),
            false,
            false,
            "image",
          )}
          <Text style={styles.help}>{t("photoLanguageHelp")}</Text>
        </>
      ) : draft.imported ? (
        <>
          <Text style={styles.notice}>{t("photoImported")}</Text>
          {button(
            t("photoNew"),
            () =>
              void run(async () => {
                await repo.discardPhotoDraft(draft.id);
                setDraft(null);
              }),
          )}
        </>
      ) : active ? (
        <>
          <Text style={styles.source}>
            {draft.lines.find((l) => l.id === active)?.text}
          </Text>
          <Text style={styles.label}>{t("photoQuantity")}</Text>
          <TextInput
            accessibilityLabel={t("photoQuantity")}
            keyboardType="decimal-pad"
            value={quantity}
            onChangeText={setQuantity}
            style={styles.input}
          />
          <Text style={styles.label}>{t("search")}</Text>
          <TextInput
            accessibilityLabel={t("search")}
            value={query}
            onChangeText={setQuery}
            style={styles.input}
            onSubmitEditing={() =>
              void run(async () =>
                setMatches(await repo.matchPhotoProducts(query)),
              )
            }
          />
          {button(
            t("search"),
            () =>
              void run(async () =>
                setMatches(await repo.matchPhotoProducts(query)),
              ),
          )}
          <Text style={styles.help}>{t("photoChooseHelp")}</Text>
          {!matches.length && <Text style={styles.help}>{t("noMatch")}</Text>}
          {matches.map((item) => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.name}>
                {item.visual} {item.name}
              </Text>
              <Text style={styles.help}>
                {money(item.price)}
                {item.unit ? " / " + item.unit : ""}
              </Text>
              {button(
                t("photoConfirm"),
                () => void run(() => select(item)),
                true,
              )}
            </View>
          ))}
          {button(t("photoBackReview"), () => setActive(null))}
        </>
      ) : (
        <>
          {!!draft.image && (
            <Image
              accessibilityLabel={t("photoSource")}
              source={{ uri: draft.image }}
              resizeMode="contain"
              style={{
                height: draft.lines.length ? 170 : 300,
                borderRadius: 16,
                backgroundColor: "#eee9dc",
              }}
            />
          )}
          {!draft.lines.length ? (
            <>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  {button(
                    t("photoRotate"),
                    () => void run(() => transform(true)),
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  {button(
                    t("photoTrim"),
                    () => void run(() => transform(false)),
                  )}
                </View>
              </View>
              {button(
                t("photoReadLocal"),
                () => void run(() => read(false)),
                true,
                !localPhotoReading,
              )}
              <Text style={styles.help}>
                {t(
                  localPhotoReading
                    ? "photoLocalHelp"
                    : "photoLocalUnavailable",
                )}
              </Text>
              {button(
                t("photoReadCloud"),
                () => void run(() => read(true)),
                false,
                shop.mode !== "live",
              )}
              <Text style={styles.help}>{t("photoCloudHelp")}</Text>
              <Text style={styles.notice}>{t("photoSavedHelp")}</Text>
              {button(t("photoSaveLater"), back)}
            </>
          ) : (
            <>
              <Text style={styles.notice}>{t("photoReviewHelp")}</Text>
              {draft.truncated && (
                <Text style={styles.error}>{t("photoTruncated")}</Text>
              )}
              {draft.lines.map((line) => (
                <View
                  key={line.id}
                  style={[styles.card, line.excluded && { opacity: 0.55 }]}
                >
                  <Text style={styles.source}>{line.text}</Text>
                  <Text style={styles.name}>
                    {line.item?.name ?? t("photoUnmatched")}
                  </Text>
                  <Text style={styles.help}>
                    {line.excluded
                      ? t("photoExcluded")
                      : line.reviewed
                        ? `${line.quantity} × ${money(line.item!.price)}`
                        : t("photoCheck")}
                  </Text>
                  {button(
                    t("photoEdit"),
                    () => void run(() => choose(line.id)),
                  )}
                  {button(
                    t(line.excluded ? "photoRestore" : "photoExclude"),
                    () =>
                      void run(async () => {
                        await save({
                          ...draft,
                          lines: draft.lines.map((l) =>
                            l.id === line.id
                              ? { ...l, excluded: !l.excluded }
                              : l,
                          ),
                        });
                      }),
                  )}
                </View>
              ))}
              {button(
                t("photoAddLine"),
                () =>
                  void run(async () => {
                    if (draft.lines.length >= 50) throw Error("photoTruncated");
                    await save({
                      ...draft,
                      lines: [
                        ...draft.lines,
                        photoLine("", Crypto.randomUUID()),
                      ],
                    });
                  }),
              )}
              {button(
                t("photoAddOrder"),
                () =>
                  void run(async () => {
                    await repo.importPhotoDraft(draft.id, draft.revision);
                    await imported();
                  }),
                true,
                !photoReady(draft),
              )}
            </>
          )}
          {button(
            t("photoDiscard"),
            () =>
              void run(async () => {
                await repo.discardPhotoDraft(draft.id);
                setDraft(null);
                setActive(null);
              }),
          )}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 12, backgroundColor: "#fbfcf7", padding: 16, borderRadius: 20 },
  title: { fontSize: 24, fontWeight: "700", color: "#293d30" },
  row: { flexDirection: "row", gap: 10 },
  button: {
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#dce3d6",
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primary: { backgroundColor: "#365c48", borderColor: "#365c48" },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#365643",
    textAlign: "center",
  },
  disabled: { opacity: 0.45 },
  help: { fontSize: 13, lineHeight: 20, color: "#697563" },
  error: { fontSize: 14, lineHeight: 21, color: "#a4452d" },
  notice: {
    fontSize: 13,
    lineHeight: 21,
    color: "#49633e",
    backgroundColor: "#eaf0e2",
    padding: 13,
    borderRadius: 12,
  },
  source: {
    fontSize: 12,
    lineHeight: 18,
    color: "#877e66",
    fontStyle: "italic",
  },
  name: { fontSize: 16, fontWeight: "600", color: "#304635" },
  card: {
    borderWidth: 1,
    borderColor: "#dfe5d6",
    padding: 14,
    borderRadius: 15,
    gap: 8,
    backgroundColor: "white",
  },
  input: {
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cfd9c7",
    color: "#263d2e",
    backgroundColor: "white",
  },
  label: { fontSize: 12, color: "#57654f" },
});
