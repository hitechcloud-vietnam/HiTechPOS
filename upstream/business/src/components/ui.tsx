import React, { createContext, useContext } from "react";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
type UIStyles = Record<
  "button" | "secondary" | "disabled" | "card",
  StyleProp<ViewStyle>
> &
  Record<"buttonText" | "secondaryText", StyleProp<TextStyle>>;
export const UIContext = createContext<UIStyles | null>(null);
function useStyles() {
  const value = useContext(UIContext);
  if (!value) throw new Error("UI styles missing");
  return value;
}
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  expanded,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  expanded?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled,
        ...(expanded === undefined ? {} : { expanded }),
      }}
      aria-expanded={expanded}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  return <View style={useStyles().card}>{children}</View>;
}
