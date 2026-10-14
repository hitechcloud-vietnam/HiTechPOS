import React, { useMemo, useRef } from "react";
import {
  Modal,
  PanResponder,
  ScrollView,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type PreparedItems } from "../domain/preparedItems";
import { recordSwipe, adjacentIndex } from "../domain/gestures";
import { formatMoney } from "../domain/money";
import { formatQuantity } from "../domain/quantity";
import { t, isRTL, getTextAlign } from "../i18n";
import { useLocale } from "../i18n/useLocale";
import { Card, Button } from "./ui";

export function BusinessItemDetail({
  summary,
  index,
  onIndex,
  onClose,
}: {
  summary: PreparedItems;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  useLocale();
  const { width } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const items = summary.itemInsights.items,
    item = items[index];
  const current = useRef({ index, count: items.length, width, onIndex });
  current.current = { index, count: items.length, width, onIndex };
  const start = useRef({ x: 0, y: 0, single: true });
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (event, state) => {
          start.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
            single: state.numberActiveTouches === 1,
          };
          return false;
        },
        onMoveShouldSetPanResponderCapture: (_event, state) => {
          if (state.numberActiveTouches !== 1) start.current.single = false;
          return (
            start.current.single &&
            recordSwipe(
              state.moveX - start.current.x,
              state.moveY - start.current.y,
              start.current.x,
              current.current.width,
              state.numberActiveTouches,
              isRTL(),
            ) !== null
          );
        },
        onPanResponderMove: (_event, state) => {
          if (state.numberActiveTouches !== 1) start.current.single = false;
        },
        onPanResponderRelease: (_event, state) => {
          const action = recordSwipe(
            state.moveX - start.current.x,
            state.moveY - start.current.y,
            start.current.x,
            current.current.width,
            1,
            isRTL(),
          );
          const value = current.current;
          if (start.current.single && action)
            value.onIndex(adjacentIndex(value.index, value.count, action));
        },
        onPanResponderTerminate: () => {
          start.current.single = false;
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );
  if (!item) return null;
  const text = {
    color: dark ? "#eef5fa" : "#172b37",
    fontSize: 16,
    lineHeight: 24,
    textAlign: getTextAlign(),
  };
  const money = (value: number) =>
    formatMoney(value, summary.currency, summary.currencyDigits);
  return (
    <Modal visible animationType="none" onRequestClose={onClose}>
      <View
        testID="business-item-detail"
        accessibilityViewIsModal
        style={{
          flex: 1,
          backgroundColor: dark ? "#101e26" : "#f5f7f8",
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
        {...gesture.panHandlers}
      >
        <View style={{ padding: 18, gap: 12 }}>
          <Button secondary label={t("back")} onPress={onClose} />
          <Text accessibilityLiveRegion="polite" style={text}>
            {t("itemPosition", { position: index + 1, total: items.length })}
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                secondary
                label={t("previous")}
                disabled={index === 0}
                onPress={() =>
                  onIndex(adjacentIndex(index, items.length, "previous"))
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                secondary
                label={t("next")}
                disabled={index === items.length - 1}
                onPress={() =>
                  onIndex(adjacentIndex(index, items.length, "next"))
                }
              />
            </View>
          </View>
        </View>
        <ScrollView
          key={item.itemId}
          contentContainerStyle={{ padding: 18, gap: 16 }}
        >
          <Text
            accessibilityRole="header"
            style={[text, { fontSize: 26, lineHeight: 34, fontWeight: "700" }]}
          >
            {item.name}
          </Text>
          <Text style={text}>{t("swipeHint")}</Text>
          <Card>
            <Text style={text}>{t("salesAfterReturns")}</Text>
            <Text
              selectable
              style={[
                text,
                { fontSize: 28, lineHeight: 36, fontWeight: "700" },
              ]}
            >
              {money(item.salesAfterReturnsMinor)}
            </Text>
            <Text style={text}>
              {t("billedSales")}: {money(item.billedSalesMinor)}
            </Text>
            <Text style={text}>
              {t("returnsOnDay")}: {money(item.refundsMinor)}
            </Text>
          </Card>
          {item.quantities.map((quantity) => (
            <Card key={quantity.unit}>
              <Text style={text}>
                {t("quantity")}: {formatQuantity(quantity.soldMilli)}{" "}
                {quantity.unit}
              </Text>
              <Text style={text}>
                {t("returnsOnDay")}: {formatQuantity(quantity.returnedMilli)}{" "}
                {quantity.unit}
              </Text>
            </Card>
          ))}
          <Text style={text}>{t("itemRankingDefinition")}</Text>
          <Text style={text}>
            {t(
              summary.freshness.state === "delayed"
                ? "summaryDelayed"
                : "summaryPartial",
            )}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}
