import { branchDay } from "./preparedOverview";

export type ReportPeriod =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "lastSeven"
  | "thisMonth"
  | "lastMonth"
  | "custom"
  | "all";
export type ReportRange = { from: string; to: string };
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function shiftDay(value: string, days: number) {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** Calendar dates belong to the branch, including DST changes and week boundaries. */
export function reportRange(
  period: ReportPeriod,
  timezone: string,
  custom?: ReportRange,
  now = new Date(),
): ReportRange | null {
  const today = branchDay(timezone, now);
  const monday = shiftDay(
    today,
    -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: shiftDay(today, -1), to: shiftDay(today, -1) };
    case "thisWeek":
      return { from: monday, to: today };
    case "lastWeek":
      return { from: shiftDay(monday, -7), to: shiftDay(monday, -1) };
    case "lastSeven":
      return { from: shiftDay(today, -7), to: shiftDay(today, -1) };
    case "thisMonth":
      return { from: today.slice(0, 8) + "01", to: today };
    case "lastMonth": {
      const to = shiftDay(today.slice(0, 8) + "01", -1);
      return { from: to.slice(0, 8) + "01", to };
    }
    case "custom":
      if (
        !custom ||
        !validDay(custom.from) ||
        !validDay(custom.to) ||
        custom.from > custom.to ||
        custom.to > today
      )
        throw new Error("Invalid report range");
      return custom;
    case "all":
      return null; // Server resolves the first recorded date; never guess it on the phone.
  }
}
