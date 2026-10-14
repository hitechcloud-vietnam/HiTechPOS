import React, { useState } from "react";
import { Text, View, useColorScheme } from "react-native";
import { type StockAlert } from "../domain/stockAlert";
import { formatStockQuantity } from "../domain/quantity";
import { getFormatLocale, getTextAlign, t } from "../i18n";
import { Button } from "./ui";

export function StockInboxDetails({
  stock,
  timezone,
}: {
  stock: StockAlert;
  timezone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = {
    color: useColorScheme() === "dark" ? "#eef5fa" : "#172b37",
    textAlign: getTextAlign(),
    lineHeight: 23,
  };
  const number = (value: number) =>
    new Intl.NumberFormat(getFormatLocale()).format(value);
  return (
    <View style={{ gap: 12 }}>
      <Text style={[text, { fontSize: 21, fontWeight: "700", lineHeight: 29 }]}>
        {t("stockNewLowCount", { count: number(stock.newLowItemCount) })}
      </Text>
      <Text style={text}>{t("stockObservationHelp")}</Text>
      <Text style={text}>
        {t("stockObserved", {
          time: new Intl.DateTimeFormat(getFormatLocale(), {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: timezone,
          }).format(new Date(stock.preparedAt)),
        })}
      </Text>
      <Text style={text}>{t("branchTimezone", { timezone })}</Text>
      <Text style={text}>
        {t("stockCoverage", {
          known: number(stock.coverage.verifiedItems),
          unknown: number(stock.coverage.unavailableItems),
          excluded: number(stock.coverage.excludedItems),
        })}
      </Text>
      <Text style={text}>
        {t("stockListLimit", {
          shown: number(
            expanded ? stock.items.length : Math.min(3, stock.items.length),
          ),
          total: number(stock.totalLowItemCount),
        })}
      </Text>
      {stock.items.slice(0, expanded ? 20 : 3).map((item) => (
        <View key={item.itemId} style={{ gap: 5, paddingVertical: 8 }}>
          <Text
            accessibilityRole="header"
            style={[text, { fontWeight: "700", fontSize: 18 }]}
          >
            {item.name}
          </Text>
          <Text selectable style={text}>
            {t("stockOnHand")}: {formatStockQuantity(item.availableMilli)}{" "}
            {item.unit}
          </Text>
          <Text style={text}>
            {t(
              item.thresholdSource === "item"
                ? "stockItemThreshold"
                : "stockBranchThreshold",
            )}
            : {formatStockQuantity(item.thresholdMilli)} {item.unit}
          </Text>
          {item.availableMilli < 0 && (
            <Text style={text}>{t("stockNegative")}</Text>
          )}
        </View>
      ))}
      {!expanded && stock.items.length > 3 && (
        <Button
          secondary
          label={t("loadMore")}
          onPress={() => setExpanded(true)}
        />
      )}
    </View>
  );
}
