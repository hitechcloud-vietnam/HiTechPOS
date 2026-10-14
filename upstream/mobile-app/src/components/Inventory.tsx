import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import type { Repository } from "../data/repository";
import type { Shop } from "../domain/types";
import type {
  InventoryDraft,
  InventoryItem,
  InventoryMode,
  InventoryOperation,
  InventoryReference,
} from "../domain/inventory";
import { inventoryPayload } from "../domain/inventory";
import { normalizeDigits } from "../domain/money";
import { InventoryApi } from "../services/inventory";
import { ApiError } from "../services/api";
type Props = {
  repo: Repository;
  shop: Shop;
  t: (key: string) => string;
  back: () => void;
  colors: {
    ink: string;
    muted: string;
    surface: string;
    line: string;
    accent: string;
    tint: string;
  };
};
export function Inventory({ repo, shop, t, back, colors }: Props) {
  const store = useMemo(
    () => repo.inventory(shop),
    [repo, shop.id, shop.branchId, shop.staffId, shop.baseUrl],
  );
  const api = useMemo(
    () => new InventoryApi(shop),
    [shop.id, shop.branchId, shop.staffId, shop.baseUrl],
  );
  const [view, setView] = useState("home"),
    [kind, setKind] = useState("items"),
    [query, setQuery] = useState("");
  const [rows, setRows] = useState<(InventoryItem | InventoryReference)[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<InventoryDraft[]>([]),
    [draft, setDraft] = useState<InventoryDraft | null>(null);
  const [operations, setOperations] = useState<InventoryOperation[]>([]),
    [selectedOperation, setSelectedOperation] =
      useState<InventoryOperation | null>(null);
  const [movements, setMovements] = useState<
    Awaited<ReturnType<InventoryApi["history"]>>["rows"]
  >([]);
  const [selected, setSelected] = useState<InventoryItem | null>(null),
    [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [offline, setOffline] = useState(false),
    [asOf, setAsOf] = useState("");
  const [canWrite, setCanWrite] = useState(
      shop.permissions.inventoryWrite === true,
    ),
    [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  useEffect(
    () => setCanWrite(shop.permissions.inventoryWrite === true),
    [shop.permissions.inventoryWrite],
  );
  const alive = useRef(true);
  const lock = useRef(false),
    sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    void store.drafts().then(setDrafts);
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, [store]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(t(e instanceof Error ? e.message : "unknownError"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function load(search = query, after = "", catalogue = kind) {
    const request = ++sequence.current;
    const cachedPage = async (offset: number) => {
      const found = await store.cached(catalogue, search, offset, 201);
      if (request !== sequence.current) return;
      setRows((old) =>
        offset ? [...old, ...found.slice(0, 200)] : found.slice(0, 200),
      );
      setNext(found.length > 200 ? "offline:" + (offset + 200) : null);
      setOffline(true);
      setMessage(t("inventoryOffline"));
    };
    if (after.startsWith("offline:")) return cachedPage(Number(after.slice(8)));
    try {
      const page = await api.catalogue(catalogue, search, after);
      if (request !== sequence.current) return;
      await store.cache(catalogue, search + ":" + after, page.rows, page.asOf);
      setRows((old) => (after ? [...old, ...page.rows] : page.rows));
      setNext(page.next);
      setCanWrite(page.permissions.write);
      setOffline(false);
      setAsOf(page.asOf);
    } catch (e) {
      if (request !== sequence.current) return;
      if (!(e instanceof ApiError) || (e.status !== 0 && e.status < 500)) {
        setCanWrite(false);
        setRows([]);
        throw e;
      }
      await cachedPage(0);
    }
  }
  async function browse(catalogue = "items") {
    setKind(catalogue);
    setQuery("");
    setRows([]);
    setNext(null);
    setView("find");
    await load("", "", catalogue);
  }
  async function download() {
    const generation = Crypto.randomUUID(),
      started = new Date().toISOString();
    for (const catalogue of [
      "items",
      "categories",
      ...(shop.permissions.supplierRead ? ["suppliers"] : []),
    ]) {
      let after = "",
        pageNumber = 0;
      do {
        if (!alive.current) return;
        const page = await api.catalogue(catalogue, "", after);
        if (!alive.current) return;
        await store.stage(catalogue, generation, pageNumber++, page.rows);
        after = page.next || "";
        setMessage(
          t("offlineData") + " · " + catalogue + " · " + pageNumber * 200,
        );
      } while (after);
      await store.activate(catalogue, generation, pageNumber, started);
    }
    setMessage(t("inventorycomplete"));
  }
  async function save(value: InventoryDraft) {
    await store.save(value);
    setDraft(value);
    setDrafts(await store.drafts());
  }
  async function start(mode: InventoryMode) {
    const value: InventoryDraft = {
      id: Crypto.randomUUID(),
      mode,
      reason: "",
      state: "draft",
      createdAt: new Date().toISOString(),
      lines: [],
    };
    await save(value);
    await browse();
  }
  async function openItem(item: InventoryItem) {
    setSelected(item);
    setQuantity(
      draft?.lines.find((l) => l.item.id === item.id)?.quantity !== undefined
        ? String(
            draft.lines.find((l) => l.item.id === item.id)!.quantity / 1000,
          )
        : draft?.mode === "count"
          ? ""
          : "1",
    );
    setView("item");
  }
  async function add() {
    if (!draft || !selected) return;
    const text = normalizeDigits(quantity.trim()).replace(/[,\u066b]/g, ".");
    if (!/^\d+(\.\d{1,3})?$/.test(text)) throw Error("invalidQuantity");
    const value = Math.round(Number(text) * 1000);
    if (
      (!selected.quantityScale && value % 1000) ||
      !Number.isSafeInteger(value) ||
      value > 999999999 ||
      (draft.mode !== "count" && value === 0)
    )
      throw Error("invalidQuantity");
    if (
      draft.lines.length >= 200 &&
      !draft.lines.some((l) => l.item.id === selected.id)
    )
      throw Error("inventoryLineLimit");
    await save({
      ...draft,
      lines: [
        ...draft.lines.filter((l) => l.item.id !== selected.id),
        { item: selected, quantity: value },
      ],
    });
    setView("find");
  }
  async function submit() {
    if (!draft) return;
    if (draft.mode === "count" && (await repo.load()).outbox.length)
      throw Error("signOutPending");
    inventoryPayload(draft);
    let value = { ...draft, state: "sending" as const };
    // Freeze before networking. A timeout retries the same identity and contents.
    await save(value);
    const operation = draft.operation
      ? await api.status(draft.operation.operationId)
      : await api.prepare(draft);
    const saved = { ...value, state: "submitted" as const, operation };
    await save(saved);
    setView("review");
  }
  async function confirm() {
    if (!draft?.operation) return;
    if (draft.mode === "count" && (await repo.load()).outbox.length)
      throw Error("signOutPending");
    const operation = await api.confirm(draft.operation.operationId);
    await save({ ...draft, operation });
    setMessage(
      t(
        operation.state === "complete"
          ? "inventoryComplete"
          : "inventoryConflict",
      ),
    );
  }
  const s = StyleSheet.create({
    root: { gap: 16 },
    heading: { color: colors.ink, fontSize: 27, fontWeight: "700" },
    text: { color: colors.ink, fontSize: 17 },
    muted: { color: colors.muted, fontSize: 14 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap",
    },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 18,
      padding: 18,
      gap: 8,
    },
    button: {
      borderRadius: 14,
      padding: 15,
      minHeight: 48,
      backgroundColor: colors.tint,
      borderColor: colors.line,
      borderWidth: 1,
    },
    input: {
      color: colors.ink,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      padding: 14,
      fontSize: 18,
      minHeight: 52,
    },
    notice: { padding: 16, borderRadius: 14, backgroundColor: colors.tint },
    image: { width: 72, height: 72, borderRadius: 12 },
  });
  const button = (
    label: string,
    action: () => Promise<void> | void,
    enabled = true,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || !enabled}
      accessibilityState={{ disabled: busy || !enabled }}
      style={[s.button, (!enabled || busy) && { opacity: 0.45 }]}
      onPress={() =>
        void run(async () => {
          await action();
        })
      }
    >
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
  const title = (key: string) => <Text style={s.heading}>{t(key)}</Text>;
  const lineText = (o: InventoryOperation) => (
    <View style={s.card}>
      <Text style={s.text}>{t("inventory" + o.state)}</Text>
      <Text style={s.muted}>{o.reason}</Text>
      {o.lines.map((l) => (
        <Text key={l.itemId} style={s.text}>
          {l.name} · {(l.actualOpening ?? l.expected) / 1000} →{" "}
          {l.actualClosing !== undefined
            ? l.actualClosing / 1000
            : o.mode === "count"
              ? l.quantity / 1000
              : (l.expected + (o.mode === "receive" ? 1 : -1) * l.quantity) /
                1000}
          {o.applied.includes(l.itemId) ? " ✓" : ""}
        </Text>
      ))}
    </View>
  );
  return (
    <View style={s.root}>
      <View style={s.row}>
        {button(t("back"), () => {
          setScanning(false);
          setSelected(null);
          if (view === "home") back();
          else setView("home");
        })}
        {title("inventory")}
      </View>
      <Text style={s.muted}>
        {shop.branchName} · {shop.staffName}
      </Text>
      {busy && <ActivityIndicator color={colors.accent} />}
      {!!message && (
        <View accessibilityLiveRegion="polite" style={s.notice}>
          <Text style={s.text}>{message}</Text>
        </View>
      )}
      {view === "home" && (
        <>
          {button(t("inventoryFind"), () => {
            setDraft(null);
            return browse();
          })}
          <View style={s.row}>
            {(["count", "receive", "damage", "loss"] as InventoryMode[]).map(
              (mode) => (
                <View key={mode}>
                  {button(t("inventory" + mode), () => start(mode), canWrite)}
                </View>
              ),
            )}
          </View>
          <Text style={s.muted}>{t("inventoryDraftHelp")}</Text>
          <View style={s.row}>
            {button(t("categories"), () => {
              setDraft(null);
              return browse("categories");
            })}
            {shop.permissions.supplierRead &&
              button(t("inventorySuppliers"), () => {
                setDraft(null);
                return browse("suppliers");
              })}
          </View>
          {button(t("offlineData") + " · " + t("refresh"), download)}
          {title("inventoryDrafts")}
          {!drafts.length && (
            <Text style={s.muted}>{t("inventoryNoDrafts")}</Text>
          )}
          {drafts.map((d) => (
            <View key={d.id}>
              {button(
                t("inventory" + d.mode) +
                  " · " +
                  d.lines.length +
                  " · " +
                  new Date(d.createdAt).toLocaleDateString(),
                () => {
                  setDraft(d);
                  setView("review");
                },
              )}
            </View>
          ))}
          {button(t("inventoryHistory"), async () => {
            const page = await api.operations();
            setOperations(page.rows);
            setNext(page.next);
            setSelectedOperation(null);
            setView("history");
          })}
        </>
      )}
      {view === "find" && (
        <>
          <TextInput
            accessibilityLabel={t("search")}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void run(() => load())}
            placeholder={t("search")}
            placeholderTextColor={colors.muted}
            style={s.input}
          />
          <View style={s.row}>
            {button(t("search"), () => load())}
            {button(t("refresh"), () => load())}
            {kind === "items" &&
              button(t("scan"), async () => {
                const p = permission?.granted
                  ? permission
                  : await requestPermission();
                if (p.granted) setScanning(true);
                else setMessage(t("cameraPermission"));
              })}
          </View>
          {scanning && (
            <CameraView
              style={{ height: 240 }}
              barcodeScannerSettings={{
                barcodeTypes: [
                  "ean13",
                  "ean8",
                  "code128",
                  "code39",
                  "qr",
                  "upc_a",
                  "upc_e",
                  "itf14",
                ],
              }}
              onBarcodeScanned={({ data }) => {
                setScanning(false);
                setQuery(data);
                void run(() => load(data));
              }}
            />
          )}
          <Text style={s.muted}>
            {offline
              ? t("inventoryOffline")
              : asOf
                ? new Date(asOf).toLocaleString()
                : ""}
          </Text>
          {draft &&
            button(t("inventoryReview") + " · " + draft.lines.length, () =>
              setView("review"),
            )}
          {rows.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              style={s.card}
              onPress={() => {
                if ("tracked" in r) void run(() => openItem(r));
              }}
            >
              <Text style={s.text}>{r.name}</Text>
              {"tracked" in r && (
                <Text style={s.muted}>
                  {r.barcode || r.sku} ·{" "}
                  {r.quantity === null ? "—" : r.quantity / 1000} {r.unit} ·{" "}
                  {r.supplierName}
                  {!r.active ? " · " + t("inventoryInactive") : ""}
                </Text>
              )}
            </Pressable>
          ))}
          {!rows.length && <Text style={s.muted}>{t("noItems")}</Text>}
          {next && button(t("loadMore"), () => load(query, next))}
        </>
      )}
      {view === "item" && selected && (
        <>
          <View style={s.card}>
            {selected.image && (
              <Image source={{ uri: selected.image }} style={s.image} />
            )}
            <Text style={s.heading}>{selected.name}</Text>
            <Text style={s.text}>
              {t("inventoryOnHand")}:{" "}
              {selected.quantity === null ? "—" : selected.quantity / 1000}{" "}
              {selected.unit}
            </Text>
            <Text style={s.muted}>
              {selected.barcode} · {selected.category} · {selected.supplierName}
            </Text>
          </View>
          {!selected.tracked && (
            <Text style={s.muted}>{t("inventoryNotTracked")}</Text>
          )}
          {button(t("inventoryHistory"), async () => {
            const page = await api.history(selected.id);
            setMovements(page.rows);
            setNext(page.next);
            setView("itemHistory");
          })}
          {draft?.state === "draft" && selected.tracked && (
            <>
              <Text style={s.text}>
                {t(draft.mode === "count" ? "inventoryCounted" : "quantity")}
              </Text>
              <TextInput
                accessibilityLabel={t("quantity")}
                style={s.input}
                keyboardType="decimal-pad"
                value={quantity}
                onChangeText={setQuantity}
              />
              {button(t("save"), add)}
            </>
          )}
        </>
      )}
      {view === "review" && draft && (
        <>
          {title("inventory" + draft.mode)}
          {draft.operation
            ? lineText(draft.operation)
            : draft.lines.map((l) => (
                <View key={l.item.id} style={s.card}>
                  <Text style={s.text}>
                    {l.item.name} · {l.quantity / 1000} {l.item.unit}
                  </Text>
                  {draft.state === "draft" && (
                    <View style={s.row}>
                      {button(t("edit"), () => openItem(l.item))}
                      {button(t("inventoryRemoveLine"), () =>
                        save({
                          ...draft,
                          lines: draft.lines.filter(
                            (v) => v.item.id !== l.item.id,
                          ),
                        }),
                      )}
                    </View>
                  )}
                </View>
              ))}
          {draft.state === "draft" ? (
            <>
              {button(t("inventoryAddItems"), () => browse())}
              <TextInput
                accessibilityLabel={t("inventoryReason")}
                placeholder={t("inventoryReason")}
                placeholderTextColor={colors.muted}
                multiline
                maxLength={500}
                style={s.input}
                value={draft.reason}
                onChangeText={(reason) => {
                  const value = { ...draft, reason };
                  setDraft(value);
                  void store
                    .save(value)
                    .catch(() => setMessage(t("inventoryUncertain")));
                }}
              />
              {button(
                t("inventorySubmit"),
                submit,
                !!draft.lines.length && !!draft.reason.trim(),
              )}
              {button(t("inventoryDiscard"), async () => {
                await store.discard(draft);
                setDraft(null);
                setDrafts(await store.drafts());
                setView("home");
              })}
            </>
          ) : (
            <>
              {!["complete", "cancelled"].includes(
                draft.operation?.state || "",
              ) && <Text style={s.muted}>{t("inventoryUncertain")}</Text>}
              {button(t("refresh"), submit)}
              {draft.state === "sending" &&
                !draft.operation &&
                button(t("edit"), async () => {
                  const operation = await api.abandonRequest(draft.id);
                  if (operation.state !== "cancelled")
                    await save({ ...draft, state: "submitted", operation });
                  else {
                    const reopened = await store.reopenUnsubmitted(
                      draft,
                      Crypto.randomUUID(),
                    );
                    setDraft(reopened);
                    setDrafts(await store.drafts());
                  }
                })}
              {draft.operation?.state === "prepared" &&
                button(
                  t(
                    draft.operation.approvalRequired
                      ? "inventoryApprove"
                      : "inventoryConfirm",
                  ),
                  confirm,
                )}
              {draft.operation?.state === "applying" &&
                button(t("retry"), confirm)}
              {draft.operation?.state === "prepared" &&
                button(t("cancel"), async () => {
                  const operation = await api.cancel(
                    draft.operation!.operationId,
                  );
                  await save({ ...draft, operation });
                })}
              {draft.operation?.state === "conflict" && (
                <>
                  <Text style={s.muted}>{t("inventoryConflict")}</Text>
                  {button(t("inventorycount"), () => start("count"))}
                </>
              )}
            </>
          )}
          {!["complete", "cancelled"].includes(
            draft.operation?.state || "",
          ) && <Text style={s.muted}>{t("inventoryOnlineConfirm")}</Text>}
        </>
      )}
      {view === "history" && (
        <>
          {selectedOperation ? (
            <>
              {lineText(selectedOperation)}
              {selectedOperation.state === "prepared" &&
                button(t("inventoryApprove"), async () =>
                  setSelectedOperation(
                    await api.confirm(selectedOperation.operationId),
                  ),
                )}
              {button(t("refresh"), async () =>
                setSelectedOperation(
                  await api.status(selectedOperation.operationId),
                ),
              )}
            </>
          ) : (
            operations.map((o) => (
              <View key={o.operationId}>
                {button(
                  t("inventory" + o.mode) + " · " + t("inventory" + o.state),
                  () => setSelectedOperation(o),
                )}
              </View>
            ))
          )}
          {!selectedOperation &&
            next &&
            button(t("loadMore"), async () => {
              const page = await api.operations(next);
              setOperations([...operations, ...page.rows]);
              setNext(page.next);
            })}
        </>
      )}
      {view === "itemHistory" && selected && (
        <>
          <Text style={s.heading}>{selected.name}</Text>
          {movements.map((m) => (
            <View key={m.id} style={s.card}>
              <Text style={s.text}>
                {m.reason} · {m.opening} → {m.closing}
              </Text>
              <Text style={s.muted}>
                {m.at ? new Date(m.at).toLocaleString() : ""} · {m.actor}
              </Text>
              <Text style={s.muted}>{m.note}</Text>
            </View>
          ))}
          {next &&
            button(t("loadMore"), async () => {
              const page = await api.history(selected.id, next);
              setMovements([...movements, ...page.rows]);
              setNext(page.next);
            })}
        </>
      )}
    </View>
  );
}
