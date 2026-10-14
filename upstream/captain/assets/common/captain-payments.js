(function () {
  "use strict";
  const messages = [
    { label: "Set up UPI in Branch details. UPI QR payments require INR.", t: "lang_captain_upi_setup" },
    { label: "Collect payment", t: "lang_captain_collect_payment" },
    { label: "Payment details", t: "lang_captain_payment_details" },
    { label: "Remaining balance", t: "lang_captain_remaining_balance" },
    { label: "All remaining guests", t: "lang_captain_all_remaining_guests" },
    { label: "Amount received", t: "lang_captain_amount_received" },
    { label: "Change to return", t: "lang_captain_change_to_return" },
    {
      label: "Payment reference (optional)",
      t: "lang_captain_payment_reference",
    },
    {
      label: "I verified this payment on the terminal or bank app.",
      t: "lang_captain_payment_verified",
    },
    { label: "Record payment", t: "lang_captain_record_payment" },
    { label: "Payment recorded", t: "lang_captain_payment_recorded" },
    {
      label:
        "Confirm only after receiving the money. This does not charge a card or bank account.",
      t: "lang_captain_confirm_received",
    },
    {
      label:
        "Payment status is not confirmed. Retry this request; do not collect the money again.",
      t: "lang_captain_payment_uncertain",
    },
    {
      label:
        "Connect to the shop server before collecting payment. You can still take orders offline.",
      t: "lang_captain_payment_connect",
    },
    {
      label: "Another payment changed this bill. Review the remaining balance.",
      t: "lang_captain_payment_changed",
    },
    {
      label:
        "This phone could not save the payment request. Do not collect payment yet.",
      t: "lang_captain_payment_storage",
    },
    {
      label: "Return to the original server to confirm this payment.",
      t: "lang_captain_payment_server",
    },
    {
      label: "Payment collection is not enabled for this phone.",
      t: "lang_captain_payment_disabled",
    },
    {
      label: "Enter an amount at least equal to the bill.",
      t: "lang_captain_payment_short",
    },
    { label: "Paid", t: "lang_paid" },
    { label: "Cash", t: "lang_cash" },
    { label: "Card", t: "lang_card" },
    { label: "UPI", t: "lang_upi" },
    { label: "Close", t: "lang_close" },
    { label: "Retry", t: "lang_retry" },
    { label: "Loading...", t: "lang_loading" },
    { label: "Cancel", t: "lang_cancel" },
    { label: "Guest", t: "lang_guest" },
  ];
  const t = (text) =>
    window.I18N
      ? I18N.t(text)
      : window.PosnicPro?.i18n?.t(
          messages.find((m) => m.label === text)?.t || text,
          text,
        ) || text;
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const mobile = () => !!window.POSNIC;
  const base = () =>
    mobile() ? POSNIC.session?.base || POSNIC.server.baseUrl : location.origin;
  const branch = () =>
    mobile()
      ? localStorage.getItem("branch_id")
      : String(PosnicPro.local.get("branch_id_set") || "");
  function request(method, path, body) {
    if (mobile()) return POSNIC.api[method](path, body);
    return new Promise((resolve, reject) =>
      PosnicPro[method](
        {
          url: path.replace(/^\//, ""),
          data: method === "get" ? body : JSON.stringify(body),
          processData: method === "get",
        },
        resolve,
        (e) =>
          reject(
            Object.assign(new Error(e?.responseJSON?.error?.message || e?.responseJSON?.message || "request_failed"), { status: e?.status }),
          ),
      ),
    );
  }
  const root = () =>
    mobile() ? "/captain/v1/payments" : "/sales/tablePayments";
  let splitDraft = null,
    dialog,
    plan,
    pending,
    busy = false,
    reviewing = false,
    receipt = null,
    table = "",
    saleId = "",
    branchId = "",
    key = "",
    error = "",
    selected = "",
    method = "Cash",
    received = "",
    reference = "",
    verified = false;
  let mixed = false, tenderAmounts = {};
  const tenderRows = () => (plan?.methods || []).map(m => {
    let value;
    try { value = CaptainMoney.toMinor(tenderAmounts[m] || 0, monetary()); } catch { value = NaN; }
    return {method:m, amountMinor:value, receivedMinor:value, verified:m !== 'Cash' && verified};
  }).filter(row => row.amountMinor !== 0);
  const tenderTotal = () => tenderRows().reduce((sum,row) => sum + row.amountMinor, 0);
  function tenderReview(rows) {
    return rows.map(row => `<div><span>${esc(t(row.method === 'Upi' ? 'UPI' : row.method))}</span><strong translate="no">${esc(money(row.amountMinor))}</strong></div>`).join('');
  }
  const monetary = () => CaptainMoney.snapshot(plan || {});
  const money = n => CaptainMoney.format(CaptainMoney.fromMinor(Number(n || 0), monetary()), monetary());
  const cashMinor = () => { try { return CaptainMoney.toMinor(received || 0, monetary()); } catch { return NaN; } };
  const receivedDefault = () => CaptainMoney.fromMinor(amount(), monetary()).toFixed(monetary().currencyDigits);
  const amount = () =>
    selected === ""
      ? plan?.dueMinor || 0
      : plan?.guests[Number(selected)]?.totalMinor || 0;
  let qrReady = false;
  function upiUri() {
    const payee = plan?.upiPayee;
    const currency = monetary();
    if (!payee?.id || !payee?.name || currency.currencyDigits !== 2 ||
        !(currency.currencyCode === "INR" || (!currency.currencyCode && currency.currencySymbol === "₹")) ||
        !Number.isSafeInteger(amount()) || amount() <= 0) return "";
    const fields = { pa: payee.id, pn: payee.name, am: (amount() / 100).toFixed(2), cu: "INR", tn: saleId ? table : "Table " + table };
    return "upi://pay?" + Object.entries(fields).map(([k,v]) => k + "=" + encodeURIComponent(v)).join("&");
  }
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify({ pending, plan }));
      return true;
    } catch {
      error =
        "This phone could not save the payment request. Do not collect payment yet.";
      return false;
    }
  };
  function render() {
    if (!dialog) return;
    let body = "";
    if (!reviewing) qrReady = false;
    if (plan) {
      body = `<div class="cp-balance"><span>${esc(t("Remaining balance"))}</span><strong translate="no">${esc(money(plan.dueMinor))}</strong></div>`;
      body += `<div class="cp-guests">${plan.guests.map((g) => `<div><span translate="no">${esc(g.name)}</span><span>${g.paid ? esc(t("Paid")) : `<span translate="no">${esc(money(g.totalMinor))}</span>`}</span></div>`).join("")}</div>`;
      if (plan.dueMinor > 0 && !pending)
        body += `
        ${plan.guests.filter((g) => !g.paid).length > 1 ? `<label>${esc(t("Guest"))}<select id="cp-guest"><option value="">${esc(t("All remaining guests"))}</option>${plan.guests.map((g, i) => (g.paid ? "" : `<option value="${i}" ${selected === String(i) ? "selected" : ""} translate="no">${esc(g.name)} · ${esc(money(g.totalMinor))}</option>`)).join("")}</select></label>` : ""}
        <div class="cp-methods" role="group" aria-label="${esc(t("Collect payment"))}">${plan.methods.map((m) => `<button type="button" data-method="${m}" aria-pressed="${method === m}">${esc(t(m === "Upi" ? "UPI" : m))}</button>`).join("")}</div>
        ${method === "Upi" ? (upiUri() ? `<section class="cp-upi"><strong translate="no">${esc(plan.upiPayee.name)}</strong><div translate="no" dir="ltr">${esc(plan.upiPayee.id)}</div><div id="cp-qr" role="img" aria-label="${esc(t("UPI"))}"></div><strong translate="no">${esc(money(amount()))}</strong></section>` : `<p class="cp-error">${esc(t("Set up UPI in Branch details. UPI QR payments require INR."))}</p>`) : ""}
        ${method === "Cash" ? `<label>${esc(t("Amount received"))}<input id="cp-received" inputmode="decimal" type="number" min="0" step="${1 / monetary().factor}" value="${esc(received)}"></label><div class="cp-change"><span>${esc(t("Change to return"))}</span><strong id="cp-change" translate="no">${esc(money(Math.max(0, cashMinor() - amount())))}</strong></div>` : `<label>${esc(t("Payment reference (optional)"))}<input id="cp-reference" maxlength="100" value="${esc(reference)}"></label><label class="cp-confirm"><input type="checkbox" id="cp-verified" ${verified ? "checked" : ""}><span>${esc(t("I verified this payment on the terminal or bank app."))}</span></label>`}
        <p class="cp-help">${esc(t("Confirm only after receiving the money. This does not charge a card or bank account."))}</p>`;
      if (plan.dueMinor === 0)
        body += `<p role="status">${esc(t("Payment recorded"))}</p>`;
    } else if (!error)
      body = `<p>${esc(t(busy ? "Loading..." : "Connect to the shop server before collecting payment. You can still take orders offline."))}</p>`;
    if (plan?.dueMinor > 0 && !pending && !reviewing && !receipt && plan.mixedPayment && plan.methods.length > 1) {
      if (mixed) body = `<p class="cp-paying-guest">${esc(t('Guest'))}: <strong translate="no">${esc(selected === '' ? t('All remaining guests') : plan.guests[Number(selected)].name)}</strong></p><div class="cp-balance"><span>${esc(t('Total'))}</span><strong translate="no">${esc(money(amount()))}</strong></div>` +
        plan.methods.map(m => `<label>${esc(t(m === 'Upi' ? 'UPI' : m))}<input data-tender="${esc(m)}" inputmode="decimal" type="number" min="0" step="${1 / monetary().factor}" value="${esc(tenderAmounts[m] || '')}"></label>`).join('') +
        `<div class="cp-change"><span>${esc(t('Remaining balance'))}</span><strong id="cp-tender-remaining" translate="no">${esc(money(amount() - tenderTotal()))}</strong></div><label class="cp-confirm"><input type="checkbox" id="cp-verified" ${verified ? 'checked' : ''}><span>${esc(t('I verified this payment on the terminal or bank app.'))}</span></label>`;
      body += `<label class="cp-confirm"><input type="checkbox" id="cp-mixed" ${mixed ? 'checked' : ''}><span>${esc(t('Split payment'))}</span></label>`;
    }
    if (reviewing && plan && !pending) {
      const guest = selected === "" ? t("All remaining guests") : plan.guests[Number(selected)].name;
      body = `<section class="cp-review"><h3>${esc(t("Payment details"))}</h3><div><span>${esc(t("Guest"))}</span><strong>${esc(guest)}</strong></div><div><span>${esc(t("Total"))}</span><strong>${esc(money(amount()))}</strong></div><div><span>${esc(t("Collect payment"))}</span><strong>${esc(t(mixed ? "Split payment" : method === "Upi" ? "UPI" : method))}</strong></div>${method === "Cash" ? `<div><span>${esc(t("Amount received"))}</span><strong>${esc(money(cashMinor()))}</strong></div><div><span>${esc(t("Change to return"))}</span><strong>${esc(money(cashMinor()-amount()))}</strong></div>` : `<div><span>${esc(t("Payment reference (optional)"))}</span><strong>${esc(reference || '—')}</strong></div>`}<p class="cp-help">${esc(t("Confirm only after receiving the money. This does not charge a card or bank account."))}</p></section>`;
    }
    if (reviewing && mixed && !pending) body += `<section class="cp-review">${tenderReview(tenderRows())}</section>`;
    if (receipt) {
      const at = new Date(receipt.at);
      body = `<section class="cp-review cp-receipt"><h3 role="status">${esc(t("Payment recorded"))}</h3><div><span>${esc(t("Total"))}</span><strong translate="no">${esc(money(receipt.amountMinor))}</strong></div><div><span>${esc(t("Collect payment"))}</span><strong>${esc(t(receipt.method === "Upi" ? "UPI" : receipt.method))}</strong></div>${receipt.method === "Cash" ? `<div><span>${esc(t("Amount received"))}</span><strong translate="no">${esc(money(receipt.receivedMinor))}</strong></div><div><span>${esc(t("Change to return"))}</span><strong translate="no">${esc(money(receipt.changeMinor))}</strong></div>` : ''}${receipt.reference ? `<div><span>${esc(t("Payment reference (optional)"))}</span><strong translate="no">${esc(receipt.reference)}</strong></div>` : ''}<div class="cp-balance"><span>${esc(t("Remaining balance"))}</span><strong translate="no">${esc(money(plan.dueMinor))}</strong></div>${Number.isFinite(at.getTime()) ? `<p translate="no">${esc(at.toLocaleString())}</p>` : ''}${receipt.staff ? `<p translate="no">${esc(receipt.staff)}</p>` : ''}</section>`;
    }
    dialog.innerHTML = `<header><h2>${esc(t("Collect payment"))} <small translate="no">${esc(table)}</small></h2><button type="button" data-action="close" aria-label="${esc(t("Close"))}">×</button></header><div class="cp-body">${saleId ? `<p class="cp-help">${esc(t("Payment only. Food stays active until handed over."))}</p>` : ""}${body}${error ? `<p class="cp-error" role="status">${esc(t(error))}</p>${error === "Payment collection is not enabled for this phone." ? `<p class="cp-help">${esc(t("Payment is collected at the desktop cashier."))}</p><a class="cp-settings" href="payment-settings.html">${esc(t("Payment settings"))}</a>` : ""}` : ""}</div><footer><button type="button" data-action="${reviewing ? "back" : "close"}">${esc(t(reviewing ? "Back" : plan?.dueMinor === 0 ? "Close" : "Cancel"))}</button>${receipt ? (plan?.dueMinor > 0 ? `<button type="button" class="cp-primary" data-action="continue">${esc(t("Continue"))}</button>` : "") : plan?.dueMinor === 0 ? "" : `<button type="button" class="cp-primary" data-action="record" ${busy ? "disabled" : ""}>${esc(t(busy ? "Loading..." : pending || !plan ? "Retry" : reviewing ? "Record payment" : "Continue"))}${plan && !pending ? ` · <span translate="no">${esc(money(amount()))}</span>` : ""}</button>`}</footer>`;
    const qr = dialog.querySelector("#cp-qr");
    if (qr) {
      try {
        new QRCode(qr, { text: upiUri(), width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
        qr.removeAttribute("title");
        qrReady = true;
      } catch {
        qr.textContent = t("Set up UPI in Branch details. UPI QR payments require INR.");
      }
    }
    if (method === "Upi" && plan && !pending && !qrReady) {
      const submit = dialog.querySelector('[data-action="record"]');
      if (submit) submit.disabled = true;
    }
    if (busy || pending)
      dialog
        .querySelectorAll("input,select,[data-method]")
        .forEach((el) => (el.disabled = true));
  }
  async function load() {
    if (busy) return;
    busy = true;
    error = "";
    render();
    try {
      plan = await request("post", root() + "/table", {
        table_number: table,
        branchId,
        ...(splitDraft || {}),
        ...(saleId ? { saleId } : {}),
      });
      if (!plan?.id || !plan.enabled)
        throw Object.assign(new Error("Disabled"), { status: 403 });
      method = plan.methods.includes(method) ? method : plan.methods[0];
      mixed = false; tenderAmounts = {};
      selected = "";
      received = receivedDefault();
      verified = false;
    } catch (e) {
      plan = null;
      error =
        e.status === 403
          ? "Payment collection is not enabled for this phone."
          : e.status
            ? (e.message && e.message !== "request_failed" ? e.message : "Try again in a moment.")
            : "Connect to the shop server before collecting payment. You can still take orders offline.";
    } finally {
      busy = false;
      render();
      if (!dialog.open && plan && !plan.paidMinor) close();
    }
  }
  function celebratePayment() {
    document.querySelectorAll('.cp-celebration').forEach(node => node.remove());
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const scene = document.createElement('div');
    scene.className = 'cp-celebration';
    scene.setAttribute('aria-hidden', 'true');
    scene.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:grid;place-items:center;overflow:hidden;';
    const seal = document.createElement('span');
    seal.style.cssText = 'position:absolute;width:76px;height:76px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#fff4bd,#efb934);color:#654100;border:2px solid #ffe6a0;box-shadow:0 8px 32px #b77c0026;font:600 38px Inter,sans-serif;';
    seal.textContent = '✓';
    scene.append(seal);
    for (let i = 0; i < 8; i++) {
      const coin = document.createElement('span');
      const angle = (i / 8) * Math.PI * 2;
      const x = Math.cos(angle) * 108, y = Math.sin(angle) * 92 - 22;
      coin.style.cssText = 'position:absolute;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#fff7ce 10%,#f6c44d 48%,#d9971e);border:2px solid #ffe5a0;box-shadow:inset 0 0 0 3px #bf831e40,0 3px 7px #8a570022;';
      scene.append(coin);
      coin.animate([
        {transform:'translate(0,18px) scale(.3)',opacity:0},
        {offset:.18,opacity:1},
        {offset:.65,transform:`translate(${x}px,${y}px) rotate(110deg) scale(1)`,opacity:1},
        {transform:`translate(${x*1.15}px,${y+45}px) rotate(180deg) scale(.65)`,opacity:0},
      ], {duration:1000,delay:i*25,fill:'both',easing:'cubic-bezier(.2,.7,.3,1)'});
    }
    (dialog.open ? dialog : document.body).append(scene);
    seal.animate([{transform:'scale(.5)',opacity:0},{offset:.22,transform:'scale(1.08)',opacity:1},{offset:.35,transform:'scale(1)',opacity:1},{offset:.8,transform:'scale(1)',opacity:1},{transform:'scale(.95)',opacity:0}],{duration:1450,fill:'both'});
    setTimeout(() => scene.remove(), 1500);
  }
  async function record() {
    let paymentCelebration = false;
    if (busy) return;
    if (!plan && !pending) {
      await load();
      return;
    }
    if (!pending) {
      if (mixed && (tenderRows().length < 2 || tenderRows().some(row => !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) || tenderTotal() !== amount())) {
        error = 'Payment amounts must equal the bill.'; render(); return;
      }
      if (method === "Upi" && !qrReady) return;
      const paid = amount(),
        cash = cashMinor();
      if (method === "Cash" && (!Number.isFinite(cash) || cash < paid)) {
        error = "Enter an amount at least equal to the bill.";
        render();
        return;
      }
      if (method !== "Cash" && !verified) {
        error = "I verified this payment on the terminal or bank app.";
        render();
        return;
      }
      if (!reviewing) { reviewing = true; error = ""; render(); return; }
      reviewing = false;
      pending = {
        base: base(),
        body: {
          branchId,
          planId: plan.id,
          version: plan.version,
          guest: selected === "" ? null : Number(selected),
          amountMinor: paid,
          method,
          receivedMinor: method === "Cash" ? cash : paid,
          reference,
          ...(mixed ? {tenders:tenderRows()} : {}),
          ...(method === "Upi" ? { upi: { ...plan.upiPayee, verified: true } } : {}),
          request_id: crypto.randomUUID(),
        },
      };
      if (!save()) {
        pending = null;
        render();
        return;
      }
    }
    if (pending.base !== base()) {
      error = "Return to the original server to confirm this payment.";
      render();
      return;
    }
    busy = true;
    error = "";
    render();
    try {
      const result = await request("post", root() + "/record", pending.body);
      if (result.confirmed !== pending.body.request_id)
        throw new Error("Unconfirmed");
      receipt = result.payments?.find(payment => payment.id === result.confirmed) || {
        ...pending.body, changeMinor: pending.body.receivedMinor - pending.body.amountMinor,
      };
      plan = result;
      mixed = false; tenderAmounts = {}; method = plan.methods?.[0] || 'Cash';
      pending = null;
      localStorage.removeItem(key);
      selected = "";
      received = receivedDefault();
      verified = false;
      reference = "";
      error = "";
      paymentCelebration = true;
      const completed = plan.dueMinor === 0 && !(receipt.method === "Cash" && receipt.changeMinor > 0);
      if (completed) dialog.close();
      window.dispatchEvent(
        new CustomEvent("captain:payment-recorded", {
          detail: { table, remaining: plan.dueMinor, completed,
            message: t("Payment recorded") + ' · ' + money(receipt.amountMinor) + ' · ' + t(receipt.method === 'Upi' ? 'UPI' : receipt.method) },
        }),
      );
    } catch (e) {
      if ([400, 403, 409, 422].includes(e.status)) {
        pending = null;
        localStorage.removeItem(key);
        busy = false;
        await load();
        error =
          e.status === 403
            ? "Payment collection is not enabled for this phone."
            : "Another payment changed this bill. Review the remaining balance.";
      } else {
        error =
          "Payment status is not confirmed. Retry this request; do not collect the money again.";
        save();
      }
    } finally {
      busy = false;
      render();
      if (paymentCelebration) {
        try { celebratePayment(); } catch { /* Decorative feedback must never affect a confirmed payment. */ }
      }
    }
  }
  async function close() {
    if (busy) return;
    reviewing = false;
    dialog.close();
    if (receipt && plan?.dueMinor === 0 && !pending) window.dispatchEvent(new CustomEvent('captain:payment-recorded', {
      detail: { table, remaining: 0, completed: true, message: t('Payment recorded') + ' · ' + money(receipt.amountMinor) + ' · ' + t(receipt.method === 'Upi' ? 'UPI' : receipt.method) }
    }));
    if (plan && !pending && !busy && plan.paidMinor === 0)
      request("post", root() + "/release", { planId: plan.id, branchId }).catch(
        () => {},
      );
  }
  function setup() {
    if (dialog) return;
    const style = document.createElement("style");
    style.textContent = `#captain-payments .cp-review>div{display:flex;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid #e4e8ee;overflow-wrap:anywhere}#captain-payments .cp-review strong{text-align:end}#captain-payments .cp-upi{text-align:center;margin:20px 0;padding:16px;border:1px solid #e4e8ee;border-radius:12px;overflow-wrap:anywhere}#captain-payments #cp-qr{width:268px;max-width:100%;padding:24px;background:white;margin:12px auto}#captain-payments #cp-qr img,#captain-payments #cp-qr canvas{max-width:100%;height:auto}#captain-payments .cp-upi>strong:last-child{font-size:26px} #captain-payments{width:min(100vw,480px);max-width:100vw;max-height:100dvh;height: min(100dvh,780px);border:0;border-radius:18px;padding:0;color:#172033;background:#fff;font:inherit;box-shadow:0 16px 60px #0004}#captain-payments::backdrop{background:#15223b88}#captain-payments[open]{display:flex;flex-direction:column}#captain-payments *{box-sizing:border-box}#captain-payments header,#captain-payments footer{display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid #e4e8ee}#captain-payments h2{font-size:20px;margin:0;flex:1}#captain-payments h2 small{font-size:14px;display:block;color:#667085;margin-top:4px}#captain-payments button{min-height:46px;padding:10px 16px;border:1px solid #dbe1eb;border-radius:10px;background:white;color:inherit;font:inherit;font-weight:600;cursor:pointer}#captain-payments button:disabled{opacity:.55;cursor:wait}#captain-payments .cp-body{padding:20px;overflow:auto;flex:1}#captain-payments footer{border-top:1px solid #e4e8ee;border-bottom:0;padding-bottom:max(16px,env(safe-area-inset-bottom))}#captain-payments .cp-primary{flex:1;background:#5146e5;color:white;border-color:#5146e5}#captain-payments .cp-balance{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}#captain-payments .cp-balance strong{font-size:26px}#captain-payments .cp-guests{margin-bottom:22px;border:1px solid #e4e8ee;border-radius:12px;padding:4px 14px}#captain-payments .cp-guests>div{display:flex;justify-content:space-between;padding:12px 0;gap:12px}#captain-payments label{display:block;margin:16px 0;font-weight:600}#captain-payments input:not([type=checkbox]),#captain-payments select{display:block;width:100%;min-height:48px;padding:10px;margin-top:8px;border:1px solid #cbd3df;border-radius:10px;font:inherit;background:white;color:inherit}#captain-payments .cp-methods{display:flex;gap:8px;flex-wrap:wrap}#captain-payments .cp-methods button{flex:1}#captain-payments [aria-pressed=true]{border-color:#5146e5;background:#efedff;color:#3529aa}#captain-payments .cp-change{display:flex;justify-content:space-between;gap:10px}#captain-payments .cp-confirm{display:flex;align-items:flex-start;gap:10px;line-height:1.5}#captain-payments .cp-confirm input{width:22px;height:22px;flex:none}#captain-payments .cp-help{color:#667085;font-size:13px;line-height:1.5;margin-top:22px}#captain-payments .cp-error{padding:12px;background:#fff5e6;color:#754700;border-radius:10px;line-height:1.5}@media(max-width:480px){#captain-payments{width:100%;height:100dvh;max-height:100dvh;border-radius:0;margin:0}#captain-payments header{padding-top:calc(16px + env(safe-area-inset-top,0px))}}`;
    style.textContent += `#captain-payments{color:var(--ink,#172033);background:var(--surface,#fff)}#captain-payments button,#captain-payments input:not([type=checkbox]),#captain-payments select{background:var(--surface,#fff);color:var(--ink,#172033);border-color:var(--line,#dbe1eb)}#captain-payments header,#captain-payments footer,#captain-payments .cp-guests,#captain-payments .cp-upi,#captain-payments .cp-review>div{border-color:var(--line,#e4e8ee)}#captain-payments .cp-primary{background:var(--accent,#2459de);color:var(--accent-ink,#fff);border-color:var(--accent,#2459de)}#captain-payments [aria-pressed=true]{background:var(--accent-soft,#edf2ff);color:var(--accent,#2459de);border-color:var(--accent,#2459de)}#captain-payments .cp-help,#captain-payments h2 small{color:var(--ink-soft,#667085)}#captain-payments h2,#captain-payments .cp-review>div>*{min-width:0;overflow-wrap:anywhere}`;
    document.head.append(style);
    dialog = document.createElement("dialog");
    dialog.id = "captain-payments";
    dialog.setAttribute("aria-label", t("Collect payment"));
    document.body.append(dialog);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (reviewing && !busy) { reviewing = false; render(); } else close();
    });
    dialog.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "close") close();
      if (action === "back" && !busy) { reviewing = false; render(); }
      if (action === "record" && !receipt) record();
      if (action === "continue" && !busy) { receipt = null; render(); }
      const m = e.target.closest("[data-method]")?.dataset.method;
      if (m) {
        method = m;
        verified = false;
        error = "";
        render();
      }
    });
    dialog.addEventListener("change", (e) => {
      if (e.target.id === "cp-guest") {
        selected = e.target.value;
        received = receivedDefault();
        verified = false;
        render();
      }
      if (e.target.id === 'cp-mixed') {
        mixed = e.target.checked; method = mixed ? 'Mixed' : plan.methods[0];
        tenderAmounts = {}; verified = false; error = ''; received = receivedDefault(); render();
      }
      if (e.target.id === "cp-verified") {
        verified = e.target.checked;
        if (verified && error === "I verified this payment on the terminal or bank app.") {
          error = "";
          dialog.querySelector(".cp-error")?.remove();
        }
      }
    });
    dialog.addEventListener("input", (e) => {
      if (e.target.dataset.tender) {
        tenderAmounts[e.target.dataset.tender] = e.target.value;
        verified = false;
        const confirmation = dialog.querySelector('#cp-verified'); if (confirmation) confirmation.checked = false;
        dialog.querySelector('#cp-tender-remaining').textContent = money(amount() - tenderTotal());
      }
      if (e.target.id === "cp-reference") reference = e.target.value;
      if (e.target.id === "cp-received") {
        received = e.target.value;
        dialog.querySelector("#cp-change").textContent = money(
          Math.max(0, cashMinor() - amount()),
        );
      }
    });
  }
  async function open(value, branchValue, draft, target = {}) {
    setup();
    if (busy) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    reviewing = false;
    receipt = null;
    mixed = false; tenderAmounts = {};
    splitDraft = draft || null;
    table = String(value);
    saleId = String(target.saleId || "");
    branchId = String(branchValue || branch());
    const identity = saleId ? "takeaway:" + saleId : table;
    key = "posnic.payment:" + base() + ":" + branchId + ":" + identity;
    plan = null;
    pending = null;
    error = "";
    selected = "";
    reference = "";
    verified = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const candidate = localStorage.key(i);
        if (
          candidate.startsWith("posnic.payment:") &&
          candidate.endsWith(":" + branchId + ":" + identity)
        ) {
          const prior = JSON.parse(localStorage.getItem(candidate) || "null");
          if (prior?.pending) {
            key = candidate;
            break;
          }
        }
      }
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved?.pending) {
        pending = saved.pending;
        plan = saved.plan;
        error =
          "Payment status is not confirmed. Retry this request; do not collect the money again.";
      }
    } catch {}
    render();
    if (!dialog.open) dialog.showModal();
    if (!pending) await load();
  }
  async function available(target = {}) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const storedKey = localStorage.key(i);
        if (storedKey.startsWith("posnic.payment:")) {
          const saved = JSON.parse(localStorage.getItem(storedKey) || "null");
          if (saved?.pending?.body?.branchId === String(branch()) &&
              (!target.saleId || storedKey.endsWith(":takeaway:" + target.saleId))) return true;
        }
      }
    } catch {}
    try {
      const options = await request(
            "get",
            mobile()
              ? "/captain/v1/payment-options"
              : "/sales/tablePayments/options",
          );
      return options.enabled === true && (!target.saleId || options.takeawayPayments === true);
    } catch {
      return false;
    }
  }
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-collect-table]");
    if (button) open(button.dataset.collectTable, button.dataset.branchId, null, {saleId:button.dataset.saleId});
  });
  window.addEventListener("captain:back", (e) => {
    if (!dialog?.open) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (busy) return;
    if (reviewing) { reviewing = false; render(); } else close();
  }, true);
  window.CaptainPayments = { open, available };
})();
