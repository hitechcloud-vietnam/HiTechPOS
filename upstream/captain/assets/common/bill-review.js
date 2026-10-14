(function () {
  "use strict";
  const t = (value) => window.I18N?.t(value) || value;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  let dialog,
    table,
    branch,
    saleId,
    receipt = false,
    printRequestId,
    bill,
    generation = 0,
    busy = false,
    loading = false;
  function close() {
    if (busy) return;
    generation++;
    loading = false;
    dialog?.close();
  }
  function money(amount) {
    const policy = CaptainMoney.snapshot(bill);
    return CaptainMoney.format(CaptainMoney.fromMinor(amount, policy), policy);
  }
  function render(message = "") {
    const components = new Map();
    for (const line of bill?.lines || [])
      for (const part of line.components)
        components.set(part.key, (components.get(part.key) || 0) + part.minor);
    dialog.innerHTML = `<header><button type="button" data-bill-back aria-label="${esc(t("Back"))}">←</button><h2>${esc(t("Bill"))} · <bdi>${esc(table)}</bdi></h2><button type="button" data-bill-refresh aria-label="${esc(t("Refresh"))}" ${busy ? "disabled" : ""}>↻</button></header><div class="bill-review-body">${
      bill
        ? `<div class="bill-review-lines">${bill.lines.map((line) => `<div><span><strong translate="no">${esc(line.name)}</strong><small translate="no">× ${esc(line.quantity)}</small></span><span translate="no">${esc(money(line.amountMinor))}</span></div>`).join("")}</div><div class="bill-review-totals">${[
            ...components,
          ]
            .filter(([, value]) => value !== 0)
            .map(
              ([key, value]) =>
                `<div><span>${esc(t(bill.labels[key] || key))}</span><span translate="no">${esc(money(value))}</span></div>`,
            )
            .join(
              "",
            )}<div><strong>${esc(t("Total"))}</strong><strong translate="no">${esc(money(bill.totalMinor))}</strong></div><div><span>${esc(t("Paid"))}</span><span translate="no">${esc(money(bill.paidMinor))}</span></div><div><strong>${esc(t("Remaining balance"))}</strong><strong translate="no">${esc(money(bill.dueMinor))}</strong></div></div>`
        : ""
    }<p role="status">${esc(t(message))}</p></div><footer>${bill ? `<button type="button" data-bill-print>${esc(t("Print the bill"))}</button>${!receipt && bill.dueMinor > 0 ? `<button type="button" data-bill-split>${esc(t("Split bill"))}</button>${bill.collectEnabled ? `<button type="button" class="profile-primary" data-bill-pay>${esc(t("Collect payment"))}</button>` : ""}` : saleId ? `<button type="button" class="profile-primary" data-bill-back>${esc(t("Close"))}</button>` : `<a class="profile-primary" href="tables.html?source=floor&table=${encodeURIComponent(table)}">${esc(t("Close order"))}</a>`}` : `<button type="button" data-bill-refresh>${esc(t("Retry"))}</button>`}</footer>`;
    if (loading)
      dialog
        .querySelectorAll("button:not([data-bill-back])")
        .forEach((button) => (button.disabled = true));
  }
  async function load() {
    if (loading || busy) return;
    loading = true;
    const ticket = ++generation;
    const owner = POSNIC.session.shopKey;
    const user = POSNIC.session.user?.id;
    render("Loading...");
    try {
      const data = await POSNIC.api.get(
        "/captain/v1/bill?" + (saleId ? "saleId=" + encodeURIComponent(saleId) + (receipt ? "&receipt=true" : "") : "table=" + encodeURIComponent(table)),
      );
      if (ticket !== generation || !dialog.open) return;
      if (
        POSNIC.session.shopKey !== owner ||
        POSNIC.session.user?.id !== user ||
        localStorage.getItem("branch_id") !== branch
      ) {
        bill = null;
        close();
        return;
      }
      if (
        !Array.isArray(data.lines) ||
        !Number.isSafeInteger(data.totalMinor) ||
        !Number.isSafeInteger(data.dueMinor)
      )
        throw new Error("Could not load the bill.");
      bill = data;
      loading = false;
      render();
    } catch (error) {
      if (ticket === generation && dialog.open) {
        loading = false;
        render(error.message || "Could not load the bill.");
      }
    } finally {
      if (ticket === generation) loading = false;
    }
  }
  async function open(value, target = {}) {
    if (busy) return;
    generation++;
    loading = false;
    table = String(value);
    saleId = String(target.saleId || "");
    receipt = target.receipt === true;
    printRequestId = crypto.randomUUID();
    branch = localStorage.getItem("branch_id");
    bill = null;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "bill-review";
      document.body.append(dialog);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        close();
      });
      dialog.addEventListener("click", async (event) => {
        if (busy || (loading && !event.target.closest("[data-bill-back]"))) {
          event.preventDefault();
          return;
        }
        if (event.target.closest("[data-bill-back]")) close();
        if (event.target.closest("[data-bill-refresh]") && !busy) void load();
        if (event.target.closest("[data-bill-split]")) {
          await GuestBills.open(table, {saleId});
        }
        if (event.target.closest("[data-bill-pay]")) {
          await CaptainPayments.open(table, branch, null, {saleId});
        }
        const button = event.target.closest("[data-bill-print]");
        if (button && !busy) {
          busy = true;
          const controls = [...dialog.querySelectorAll("button")];
          controls.forEach((control) => (control.disabled = true));
          dialog.querySelector("[role=status]").textContent = t("Loading...");
          let printed = false;
          try {
            const copies =
              typeof storedBillCopies === "function"
                ? Number(storedBillCopies())
                : 0;
            const result = await POSNIC.api.post(receipt ? "/captain/v1/bill/reprint" : "/sales/requestBillPrint", {
              ...(receipt ? {request_id:printRequestId} : {}),
              branchId: branch,
              table_number: table,
              ...(saleId ? {saleId} : {}),
              ...(copies ? { copies } : {}),
            });
            if (result.type !== "success" || result.data?.status === false || result.status === false)
              throw new Error(result.message || "Could not load the bill.");
            printed = true;
            dialog.querySelector("[role=status]").textContent =
              t("Bill asked for");
          } catch (error) {
            dialog.querySelector("[role=status]").textContent = t(
              error.message,
            );
            button.disabled = false;
          } finally {
            busy = false;
            controls.forEach((control) => (control.disabled = false));
            button.disabled = printed;
          }
        }
      });
    }
    render("Loading...");
    if (!dialog.open) dialog.showModal();
    await load();
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-bill]");
    if (button) void open(button.dataset.reviewBill, {saleId:button.dataset.saleId,receipt:button.dataset.receipt === 'true'});
  });
  window.addEventListener(
    "captain:back",
    (event) => {
      if (
        dialog?.open &&
        !document.querySelector("dialog[open]:not(#bill-review)")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    },
    true,
  );
  window.addEventListener("captain:payment-recorded", event => {
    if (event.detail?.completed) { close(); return; }
    if (dialog?.open) void load();
  });
  window.CaptainBill = { open };
})();
