/** Keep vertical scrolling, multi-touch and system edge navigation distinct. */
export function horizontalGesture(
  dx: number,
  dy: number,
  startX: number,
  width: number,
  touches: number,
  rtl: boolean,
  edgeBack: boolean,
  details: boolean,
): "back" | "next" | "previous" | null {
  if (touches !== 1 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6)
    return null;
  const atEdge = startX < 28 || startX > width - 28;
  const leadingEdge = rtl ? startX > width - 28 : startX < 28;
  if (atEdge)
    return edgeBack && leadingEdge && (rtl ? dx < 0 : dx > 0) ? "back" : null;
  if (!details) return null;
  return (rtl ? dx > 0 : dx < 0) ? "next" : "previous";
}

export function adjacentRecord(
  ids: string[],
  current: string,
  direction: "next" | "previous",
) {
  const index = ids.indexOf(current);
  return index < 0 ? undefined : ids[index + (direction === "next" ? 1 : -1)];
}
