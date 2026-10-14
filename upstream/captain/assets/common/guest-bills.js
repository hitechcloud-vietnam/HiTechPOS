(function () {
  "use strict";
  const esc = (value) =>
    String(value ?? "").replace(
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
  let dialog,
    state,
    busy = false,
    stage = "setup",
    snapshot = null,
    error = "",
    draftKey = "",
    collectEnabled = false,
    owner = "";
  const t = (s) => (window.I18N ? I18N.t(s) : s);
  const base = () => POSNIC.session?.base || POSNIC.server.baseUrl;
  const money = (n) =>
    CaptainMoney.format(
      CaptainMoney.fromMinor(n, CaptainMoney.snapshot(snapshot || {})),
      CaptainMoney.snapshot(snapshot || {}),
    );
  const identity = () =>
    JSON.stringify([
      POSNIC.session?.shopKey || POSNIC.session?.base || POSNIC.server.baseUrl,
      POSNIC.session?.user?.id,
      localStorage.getItem("branch_id"),
    ]);
  function checkOwner() {
    if (identity() !== owner) {
      dialog?.close();
      throw new Error("Sign in with your account");
    }
  }
  function persist() {
    try {
      checkOwner();
      localStorage.setItem(
        draftKey,
        JSON.stringify({ owner, snapshot, state, stage }),
      );
      return true;
    } catch {
      error =
        "This phone could not save the split. Keep this screen open until it is sent.";
      return false;
    }
  }
  function guests() {
    return GuestBillMath.split(snapshot, state.plan);
  }
  function resetCount(count) {
    state.plan.guests = Array.from(
      { length: count },
      (_, i) => state.plan.guests[i] || t("Guest {0}").replace("{0}", i + 1),
    );
    state.plan.allocations = {};
    state.pending = null;
    persist();
    render();
  }
  function notice() {
    return error
      ? `<p class="guest-bill-error" role="status">${esc(error)}</p>`
      : "";
  }
  function render() {
    if (!dialog) return;
    const count = state.plan.guests.length;
    let body = "";
    if (!snapshot)
      body = `<p>${busy ? "Loading..." : "Could not load the bill."}</p><button data-action="reload">Retry</button>`;
    else if (stage === "setup")
      body = `<fieldset class="guest-bill-modes"><legend>How would you like to split?</legend><label><input type="radio" name="guest-split-mode" value="equal" ${state.plan.mode === "equal" ? "checked" : ""}><span><strong>Equal split</strong><small>Divide the total equally between guests.</small></span></label><label><input type="radio" name="guest-split-mode" value="items" ${state.plan.mode === "items" ? "checked" : ""}><span><strong>By guest / items</strong><small>Assign items to guests and share dishes.</small></span></label></fieldset>${snapshot.lines.some((line) => line.seat > 0) ? '<button type="button" data-action="by-seat">Assign by seat</button>' : ""}<div class="guest-bill-count"><span>Guests</span><button data-action="less" aria-label="Decrease guests" ${count <= 2 ? "disabled" : ""}>−</button><strong translate="no">${count}</strong><button data-action="more" aria-label="Increase guests" ${count >= 20 ? "disabled" : ""}>+</button></div><details><summary>Guest names</summary>${state.plan.guests.map((name, i) => `<label class="guest-bill-name"><span>${esc(t("Guest {0}").replace("{0}", i + 1))}</span><input data-name="${i}" maxlength="60" value="${esc(name)}" translate="no"></label>`).join("")}</details>`;
    else if (stage === "items")
      body = `<p>Choose who pays for each item. Use Share for a shared dish.</p>${snapshot.lines
        .map((line) => {
          const weights =
              state.plan.allocations[line.id] || state.plan.guests.map(() => 0),
            selected = weights
              .map((w, i) => (w ? i : -1))
              .filter((i) => i >= 0),
            shared = selected.length > 1;
          return `<section class="guest-bill-line"><div><strong translate="no">${esc(line.name)}</strong><span translate="no">${line.quantity} × · ${esc(money(line.amountMinor))}</span></div><label><span>Guest</span><select data-line="${esc(line.id)}"><option value="">${shared ? t("Shared") : t("Unassigned")}</option>${state.plan.guests.map((name, i) => `<option value="${i}" ${!shared && selected[0] === i ? "selected" : ""} translate="no">${esc(name)}</option>`).join("")}</select></label><details ${shared ? "open" : ""}><summary>Share</summary><p>Set the number of shares for each guest.</p><div class="guest-bill-shares">${state.plan.guests.map((name, i) => `<label><span translate="no">${esc(name)}</span><input type="number" min="0" max="1000" step="1" inputmode="numeric" data-share="${esc(line.id)}" data-guest="${i}" value="${weights[i]}" aria-label="${esc(name)}"></label>`).join("")}</div><button data-action="share-all" data-line-id="${esc(line.id)}">Share equally</button></details></section>`;
        })
        .join("")}`;
    else if (stage === "review") {
      const shares = guests();
      body = `<p>${collectEnabled ? "Review guest bills before collecting payment." : "Check each guest bill before sending it to the cashier."}</p>${shares.map((g) => `<details class="guest-bill-review"><summary><strong translate="no">${esc(g.name)}</strong><b translate="no">${esc(money(g.totalMinor))}</b></summary>${g.lines.map((line) => `<div><span translate="no">${esc(line.name)}${line.weight < line.weightTotal ? " (" + line.weight + "/" + line.weightTotal + ")" : ""}</span><span translate="no">${esc(money(line.amountMinor))}</span></div>`).join("")}</details>`).join("")}<div class="guest-bill-total"><strong>Total</strong><strong translate="no">${esc(money(snapshot.totalMinor))}</strong></div><p class="guest-bill-help">${collectEnabled ? "Collect payment" : "Payment is collected at the desktop cashier."}</p>`;
    }
    const valid = (() => {
      try {
        return !!snapshot && !!guests();
      } catch {
        return false;
      }
    })();
    dialog.innerHTML = `<header><button data-action="back" aria-label="Back">‹ <span>Back</span></button><h2>Split bill</h2><button data-action="close" aria-label="Close">×</button></header><div class="guest-bill-body">${snapshot ? `<div class="guest-bill-context"><strong>${esc(state.saleId ? snapshot.table : t("Table {0}").replace("{0}", snapshot.table))}</strong><b translate="no">${esc(money(snapshot.totalMinor))}</b></div>` : ""}${notice()}${body}</div><footer><button class="guest-bill-secondary" data-action="close">Cancel</button><button class="guest-bill-primary" data-action="next" ${busy || !snapshot || (stage !== "setup" && !valid) ? "disabled" : ""}>${busy ? "Loading..." : stage === "review" ? (state.pending ? "Retry" : collectEnabled ? "Collect payment" : "Send guest bills") : "Continue"}</button></footer>`;
    if (busy)
      dialog
        .querySelectorAll(
          'input,select,button[data-action="more"],button[data-action="less"],button[data-action="share-all"]',
        )
        .forEach((n) => (n.disabled = true));
    if (state.pending)
      dialog
        .querySelectorAll("input,select")
        .forEach((n) => (n.disabled = true));
    window.I18N?.apply(dialog);
  }
  async function reload() {
    if (busy) return;
    busy = true;
    error = "";
    render();
    try {
      checkOwner();
      const response = await POSNIC.api.get(
        "/sales/guestBills/table?branchId=" +
          encodeURIComponent(state.branchId) +
          "&table_number=" +
          encodeURIComponent(state.table) + (state.saleId ? "&saleId=" + encodeURIComponent(state.saleId) : ""),
      );
      checkOwner();
      if (response.type !== "success" || !response.data?.revision)
        throw new Error("Could not load the bill.");
      const changed = snapshot && snapshot.revision !== response.data.revision;
      snapshot = response.data;
      if (changed) {
        state.plan.allocations = {};
        state.pending = null;
        stage = "setup";
        error = "The table changed. Review the new bill before splitting.";
      }
      if (!state.plan.guests.length)
        state.plan.guests = Array.from(
          { length: snapshot.guests || 2 },
          (_, i) => t("Guest {0}").replace("{0}", i + 1),
        );
      persist();
    } catch (e) {
      error =
        e.status === 404
          ? "Update POS on the desktop to use split bills."
          : snapshot
            ? "Offline. You can prepare a split; connect before printing."
            : "Could not load the bill. Check the connection and retry.";
    } finally {
      busy = false;
      render();
    }
  }
  async function send() {
    if (busy) return;
    try {
      checkOwner();
      guests();
    } catch (e) {
      error = e.message;
      render();
      return;
    }
    if (
      state.pending &&
      (state.pending.owner !== owner || state.pending.base !== base())
    ) {
      error =
        "Reconnect to the server that authorized this phone. Orders are retained.";
      render();
      return;
    }
    if (!state.pending)
      state.pending = {
        owner,
        base: base(),
        body: {
          branchId: state.branchId,
          table_number: state.table,
          ...(state.saleId ? {saleId:state.saleId} : {}),
          revision: snapshot.revision,
          plan: JSON.parse(JSON.stringify(state.plan)),
          request_id: crypto.randomUUID(),
          ...(typeof storedBillCopies === "function" && storedBillCopies()
            ? { copies: Number(storedBillCopies()) }
            : {}),
        },
      };
    if (!persist()) {
      render();
      return;
    }
    busy = true;
    error = "";
    render();
    try {
      const response = await POSNIC.api.post(
        "/sales/guestBills/print",
        state.pending.body,
      );
      checkOwner();
      if (response.type !== "success" || !response.data?.queued)
        throw new Error("Could not send the guest bills.");
      localStorage.removeItem(draftKey);
      dialog.close();
      showToast("Guest bills sent to the cashier.");
    } catch (e) {
      if ([400, 401, 403, 404, 422].includes(e.status)) {
        state.pending = null;
        error =
          e.status === 404
            ? "Update POS on the desktop to use split bills."
            : "Could not send the guest bills.";
        persist();
        return;
      }
      if (e.status === 409) {
        state.pending = null;
        error = "The table changed. Review the new bill before splitting.";
        busy = false;
        await reload();
        return;
      }
      error =
        "Could not confirm printing. Retry sends the same guest bills without duplicating them.";
      persist();
    } finally {
      busy = false;
      render();
    }
  }
  function close() {
    persist();
    dialog.close();
  }
  function back() {
    if (busy || state.pending) {
      close();
      return;
    }
    if (stage === "review")
      stage = state.plan.mode === "equal" ? "setup" : "items";
    else if (stage === "items") stage = "setup";
    else {
      close();
      return;
    }
    error = "";
    persist();
    render();
  }
  async function open(table, target = {}) {
    if (busy) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "guest-bills";
      document.body.append(dialog);
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        back();
      });
      dialog.addEventListener("click", (e) => {
        const b = e.target.closest("[data-action]");
        if (!b || b.disabled) return;
        const a = b.dataset.action;
        if (a === "close") close();
        else if (a === "back") back();
        else if (a === "reload") reload();
        else if (a === "by-seat") {
          const seats = [
            ...new Set(
              snapshot.lines
                .map((line) => Number(line.seat) || 0)
                .filter(Boolean),
            ),
          ].sort((a, b) => a - b);
          if (seats.length < 2 || seats.length > 20) {
            error = "Choose between 2 and 20 guests.";
            render();
            return;
          }
          state.plan.mode = "items";
          state.plan.guests = seats.map((seat) =>
            t("Seat {0}").replace("{0}", seat),
          );
          state.plan.allocations = Object.fromEntries(
            snapshot.lines.map((line) => [
              line.id,
              seats.map((seat) =>
                !line.seat || seat === Number(line.seat) ? 1 : 0,
              ),
            ]),
          );
          state.pending = null;
          stage = "items";
          error = "";
          persist();
          render();
        } else if (a === "more" || a === "less")
          resetCount(state.plan.guests.length + (a === "more" ? 1 : -1));
        else if (a === "share-all") {
          state.plan.allocations[b.dataset.lineId] = state.plan.guests.map(
            () => 1,
          );
          persist();
          render();
        } else if (a === "next") {
          if (stage === "review") {
            if (collectEnabled && !state.pending) {
              const draft = {
                plan: JSON.parse(JSON.stringify(state.plan)),
                revision: snapshot.revision,
              };
              close();
              CaptainPayments.open(state.table, state.branchId, draft, {saleId:state.saleId});
            } else send();
            return;
          }
          stage =
            stage === "setup" && state.plan.mode === "items"
              ? "items"
              : "review";
          error = "";
          persist();
          render();
        }
      });
      dialog.addEventListener("change", (e) => {
        const el = e.target;
        if (el.name === "guest-split-mode") state.plan.mode = el.value;
        if (el.dataset.name !== undefined)
          state.plan.guests[Number(el.dataset.name)] =
            el.value.trim() ||
            t("Guest {0}").replace("{0}", Number(el.dataset.name) + 1);
        if (el.dataset.line)
          state.plan.allocations[el.dataset.line] = state.plan.guests.map(
            (_, i) => (el.value !== "" && i === Number(el.value) ? 1 : 0),
          );
        if (el.dataset.share) {
          const weights =
            state.plan.allocations[el.dataset.share] ||
            state.plan.guests.map(() => 0);
          weights[Number(el.dataset.guest)] = Math.max(
            0,
            Math.min(1000, Math.floor(Number(el.value) || 0)),
          );
          state.plan.allocations[el.dataset.share] = weights;
        }
        state.pending = null;
        persist();
        if (el.dataset.name !== undefined || el.dataset.share) {
          try {
            guests();
            dialog.querySelector("[data-action=next]").disabled = false;
          } catch {
            dialog.querySelector("[data-action=next]").disabled = true;
          }
        } else render();
      });
    }
    owner = identity();
    collectEnabled = false;
    state = {
      branchId: localStorage.getItem("branch_id"),
      table,
      saleId: String(target.saleId || ""),
      plan: { mode: "equal", guests: [], allocations: {} },
      pending: null,
    };
    snapshot = null;
    stage = "setup";
    error = "";
    draftKey = "posnic.guest-bills:v2:" + owner + ":" + (state.saleId ? "takeaway:" + state.saleId : table);
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (
        saved?.owner === owner &&
        saved?.state?.table === table &&
        (saved.state.saleId || "") === state.saleId &&
        saved.snapshot
      ) {
        state = saved.state;
        snapshot = saved.snapshot;
        stage = saved.stage || "setup";
      }
    } catch {}
    render();
    dialog.showModal();
    if (state.pending) {
      error =
        "Could not confirm printing. Retry sends the same guest bills without duplicating them.";
      stage = "review";
      render();
    } else {
      busy = true;
      render();
      try {
        collectEnabled = (await window.CaptainPayments?.available({saleId:state.saleId})) || false;
        checkOwner();
      } catch {
        busy = false;
        return;
      }
      busy = false;
      await reload();
    }
  }
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-split-table]");
    if (button) open(button.dataset.splitTable, {saleId:button.dataset.saleId});
  });
  window.addEventListener(
    "captain:back",
    (event) => {
      if (dialog?.open) {
        if (document.querySelector("#captain-payments[open]")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        back();
      }
    },
    true,
  );
  window.GuestBills = { open };
})();
