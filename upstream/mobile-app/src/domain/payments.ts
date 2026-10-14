import type { Shop, UpiAccount } from "./types";
export function upiUri(
  account: UpiAccount,
  amount: number,
  currency: string,
  reference: string,
): string {
  if (
    !account.active ||
    currency !== "INR" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/.test(account.vpa)
  )
    throw new Error("upiUnavailable");
  const fields = {
    pa: account.vpa,
    pn: account.name,
    am: (amount / 100).toFixed(2),
    cu: "INR",
    tn: reference,
  };
  return (
    "upi://pay?" +
    Object.entries(fields)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&")
  );
}
export function selectedAccount(shop: Shop, id?: string): UpiAccount | null {
  return (
    shop.upiAccounts.find(
      (a) => a.active && a.id === (id || shop.defaultUpiAccountId),
    ) ??
    shop.upiAccounts.find((a) => a.active) ??
    null
  );
}
