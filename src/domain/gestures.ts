/** Interior record paging only: system back owns both screen edges. */
export function recordSwipe(
  dx: number,
  dy: number,
  startX: number,
  width: number,
  touches: number,
  rtl = false,
): "next" | "previous" | null {
  if (
    touches !== 1 ||
    startX < 28 ||
    startX > width - 28 ||
    Math.abs(dx) < 64 ||
    Math.abs(dx) < Math.abs(dy) * 1.6
  )
    return null;
  return (rtl ? dx > 0 : dx < 0) ? "next" : "previous";
}
export function adjacentIndex(
  index: number,
  length: number,
  direction: "next" | "previous",
) {
  const next = index + (direction === "next" ? 1 : -1);
  return index < 0 || index >= length || next < 0 || next >= length
    ? index
    : next;
}
