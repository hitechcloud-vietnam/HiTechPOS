import React, { useMemo, useRef } from "react";
import {
  PanResponder,
  Platform,
  ScrollView,
  View,
  type ScrollViewProps,
} from "react-native";
import { horizontalGesture } from "../domain/gestures";

type Props = ScrollViewProps & {
  scrollRef: React.RefObject<ScrollView | null>;
  width: number;
  rtl: boolean;
  canGoBack: boolean;
  details: boolean;
  blocked: boolean;
  onNavigate: (action: "back" | "next" | "previous") => void;
};

export function GestureScroll({
  scrollRef,
  width,
  rtl,
  canGoBack,
  details,
  blocked,
  onNavigate,
  ...props
}: Props) {
  const singleTouch = useRef(true);
  const origin = useRef({ x: 0, y: 0 });
  const latest = useRef({
    width,
    rtl,
    canGoBack,
    details,
    blocked,
    onNavigate,
  });
  latest.current = { width, rtl, canGoBack, details, blocked, onNavigate };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (event, gesture) => {
          if (gesture.numberActiveTouches === 1) {
            origin.current = {
              x: event.nativeEvent.pageX,
              y: event.nativeEvent.pageY,
            };
            singleTouch.current = true;
          } else singleTouch.current = false;
          return false;
        },
        onPanResponderMove: (_event, gesture) => {
          if (gesture.numberActiveTouches !== 1) singleTouch.current = false;
        },
        onPanResponderTerminate: () => {
          singleTouch.current = false;
        },
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          const p = latest.current;
          return (
            !p.blocked &&
            singleTouch.current &&
            horizontalGesture(
              gesture.moveX - origin.current.x,
              gesture.moveY - origin.current.y,
              origin.current.x,
              p.width,
              gesture.numberActiveTouches,
              p.rtl,
              Platform.OS === "ios" && p.canGoBack,
              p.details,
            ) !== null
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          const p = latest.current;
          // Touch count is zero on release; multi-touch is rejected when claiming.
          const action = horizontalGesture(
            gesture.moveX - origin.current.x,
            gesture.moveY - origin.current.y,
            origin.current.x,
            p.width,
            1,
            p.rtl,
            Platform.OS === "ios" && p.canGoBack,
            p.details,
          );
          if (!p.blocked && singleTouch.current && action) p.onNavigate(action);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );
  return (
    <View style={{ flex: 1 }} {...responder.panHandlers}>
      <ScrollView
        {...props}
        ref={scrollRef}
        alwaysBounceVertical
        scrollsToTop
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={
          props.keyboardDismissMode ??
          (Platform.OS === "ios" ? "interactive" : "on-drag")
        }
      />
    </View>
  );
}
