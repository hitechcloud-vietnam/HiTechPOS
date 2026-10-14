(function () {
  "use strict";
  const t = (value) => window.I18N?.t(value) || value,
    esc = CaptainTables.esc;
  let rows = [],
    canManage = false,
    cleaningEnabled = false,
    selected = null,
    busy = false,
    dirty = false, editingSettings = false, closeReview = false, closeRequest = null;
  const parameters = new URLSearchParams(location.search), fromFloor = parameters.get("source") === "floor";
  let requestedTable = parameters.get("table");
  const at = (id) => document.getElementById(id);
  const status = (row) =>
    t(
      {
        available: "Available",
        occupied: "Occupied",
        cleaning: "Cleaning",
        held: "Held",
      }[row.status] || "Available",
    );
  const say = (text) => (at("table-management-message").textContent = t(text));
  async function load() {
    if (busy || selected) return false;
    busy = true;
    say("Loading...");
    try {
      const data = await POSNIC.api.get("/captain/v1/tables");
      if (!Array.isArray(data.tables))
        throw new Error("invalid_table_response");
      rows = CaptainTables.liveRows(data);
      cleaningEnabled = data.cleaningEnabled === true;
      canManage = data.canManage === true;
      try { localStorage.setItem(
        "kiosk_tableorders",
        JSON.stringify(
          rows.map((row) => ({
            ...row,
            service_state: row.status === "occupied" ? "available" : row.status,
          })),
        ),
      ); } catch { /* A full device cache must not hide the live table list. */ }
      list();
      say("");
      if(requestedTable){const target=rows.find(row=>row.tableorder_value===requestedTable);requestedTable=null;if(target){edit(target);if(target.closing || (target.orders?.length&&target.orders.every(order=>order.paid)))reviewClose();}}
      return true;
    } catch (error) {
      say(error.status === 403 ? "Permission is required." : "Connection failed");
      return false;
    } finally {
      busy = false;
    }
  }
  function list() {
    selected = null;
    closeReview = false; closeRequest = null;
    dirty = false;
    at("tables-refresh").hidden = false;
    at("table-management-content").innerHTML =
      `${canManage ? `<button type="button" class="profile-primary table-add" data-action="add">${esc(t("Add table"))}</button>` : ""}${!rows.length ? `<p class="me-note" role="status">${esc(t("No tables set up yet."))}</p>` : ""}<div class="managed-tables">${rows.map((row) => `<button type="button" class="managed-table" data-table="${esc(row.id)}"><span class="managed-shape shape-${esc(row.shape)}" aria-hidden="true"></span><strong translate="no">${esc(row.tableorder_value)}</strong><span class="managed-state state-${esc(row.status)}">${esc(status(row))}</span><small translate="no">${esc(CaptainTables.description(row))}</small></button>`).join("")}</div>`;
  }
  function field(label, id, value, type = "text") {
    return `<label class="profile-field">${esc(t(label))}<input id="${id}" name="${id}" class="ui-field" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="1" max="1000" step="1"' : ""}></label>`;
  }
  function neighbouringTables() {
    const candidates = rows.filter(row => row.id !== selected.id);
    if (!candidates.length) return "";
    return `<fieldset class="table-neighbours"><legend>${esc(t("Can combine with"))}</legend>${candidates.map(row => `<label><input type="checkbox" name="adjacent_table_ids" value="${esc(row.id)}" ${(selected.adjacent_table_ids || []).includes(row.id) ? "checked" : ""}><span translate="no"><strong>${esc(row.tableorder_value)}</strong><small>${esc(CaptainTables.description(row))}</small></span></label>`).join("")}</fieldset>`;
  }
  function edit(row, settings = false) {
    editingSettings = canManage && (settings || !row);
    selected = row || {
      tableorder_value: "",
      capacity: 0,
      max_capacity: 0,
      area: "",
      shape: "square",
      version: 0,
    };
    dirty = false;
    at("tables-refresh").hidden = true;
    say("");
    at("table-management-content").innerHTML = editingSettings
      ? `<form id="table-edit-form">${field("Table", "tableorder_value", selected.tableorder_value)}${field("Seat capacity", "capacity", selected.capacity || "", "number")}${field("Maximum seats", "max_capacity", selected.max_capacity || "", "number")}${field("Dining area", "area", selected.area)}<label class="profile-field">${esc(t("Table shape"))}<select class="ui-field" name="shape">${["square", "round", "rectangle"].map((shape) => `<option value="${shape}" ${selected.shape === shape ? "selected" : ""}>${esc(t(shape[0].toUpperCase() + shape.slice(1)))}</option>`).join("")}</select></label>${neighbouringTables()}<div class="profile-actions"><button type="button" class="profile-secondary" data-action="back">${esc(t("Cancel"))}</button><button type="submit" class="profile-primary">${esc(t("Save"))}</button></div></form>`
      : `<h2 translate="no">${esc(selected.tableorder_value)}</h2><p translate="no">${esc(CaptainTables.description(selected))}</p><p>${esc(status(selected))}</p>${stateButtons()}${canManage && !selected.seating ? `<div class="table-status-actions"><button type="button" class="profile-secondary" data-action="edit-table">${esc(t("Change"))}</button></div>` : ""}`;
    if (editingSettings) {
      at("tableorder_value").required = true;
      at("tableorder_value").maxLength = 6;
      at("tableorder_value").pattern = "[A-Za-z0-9]{1,6}";
      at("area").maxLength = 60;
      seatLimits();
    }
  }
  function seatLimits() {
    if (!editingSettings || !at("max_capacity")) return;
    at("max_capacity").min = String(Math.max(1, Number(at("capacity").value) || 1));
    at("max_capacity").placeholder = at("capacity").value;
  }
  function stateButtons() {
    if (!selected?.id) return "";
    if (selected.closing || (selected.orders?.length && selected.orders.every(order=>order.paid)))
      return `<div class="table-status-actions"><button type="button" class="profile-primary" data-action="close-review">${esc(t(selected.closing ? "Retry" : "Close order"))}</button></div>`;
    if (selected.seating && !selected.orders?.length) return "";
    if (selected.status === "occupied") return `<p class="me-note">${esc(t("Record the remaining payment first."))}</p>`;
    return `<div class="table-status-actions">${[
      "available",
      "cleaning",
      "held",
    ]
      .filter((value) => value !== selected.status && (value !== "cleaning" || cleaningEnabled))
      .map(
        (value) =>
          `<button type="button" class="profile-secondary" data-status="${value}">${esc(t({ available: "Available", cleaning: "Cleaning", held: "Held" }[value]))}</button>`,
      )
      .join("")}</div>`;
  }
  async function reviewClose() {
    if (dirty && !await CaptainConfirm.discard()) return;
    if (selected.seating) {
      const primary = rows.find(row => row.id === selected.seating.primary_id);
      if (!primary) { say("Table changed. Refresh and try again."); return; }
      selected = primary;
    }
    dirty=false;closeReview=true;
    closeRequest ||= {afterClose:selected.closing?.afterClose || "available",id:selected.id,version:selected.version,request_id:selected.closing?.request_id || crypto.randomUUID(),orderIds:selected.closing?.orderIds || selected.orders.map(order=>order.id)};
    at("table-management-content").innerHTML=`<h2>${esc(t("Close order"))}</h2><h3 translate="no">${esc(selected.seating?.labels?.join(" + ") || selected.tableorder_value)}</h3>${cleaningEnabled ? `<label class="profile-field">${esc(t("Status:"))}<select class="ui-field" id="table-after-close" ${selected.closing ? "disabled" : ""}><option value="available" ${closeRequest.afterClose === "available" ? "selected" : ""}>${esc(t("Available"))}</option><option value="cleaning" ${closeRequest.afterClose === "cleaning" ? "selected" : ""}>${esc(t("Cleaning"))}</option></select></label>` : ""}<div class="profile-actions"><button type="button" class="profile-secondary" data-action="back">${esc(t("Cancel"))}</button><button type="button" class="profile-primary" data-action="close-confirm">${esc(t("Close order"))}</button></div>`;
  }
  async function back() {
    if (busy) return;
    if (closeReview) {if(fromFloor){location.href="kot-management.html";return;}closeReview=false;edit(selected);return;}
    if (selected) {
      if (dirty && !await CaptainConfirm.discard()) return;
      if(editingSettings && selected.id){edit(selected);return;}
      list();
      say("");
    } else location.href = fromFloor ? "kot-management.html" : "me.html#preferences";
  }
  async function save(body, stateChange = false) {
    if (busy) return;
    busy = true;
    say("Loading...");
    at("table-management-content")
      .querySelectorAll("input,select,button")
      .forEach((el) => (el.disabled = true));
    try {
      await POSNIC.api.post(
        "/captain/v1/tables" + (stateChange === "close" ? "/close" : stateChange ? "/state" : ""),
        body,
      );
      if(stateChange === "close" && fromFloor){location.href="kot-management.html";return;}
      selected = null;
      closeReview = false;closeRequest = null;
      dirty = false;
      at("table-management-content").innerHTML="";
      at("tables-refresh").hidden=false;
      busy = false;
      await load();
    } catch (error) {
      if (error.status === 409) at("tables-refresh").hidden = false;
      say(
        error.status === 409
          ? "Table changed. Refresh and try again."
          : error.status === 403
            ? "Permission is required."
            : "Could not save. Please try again.",
      );
    } finally {
      busy = false;
      at("table-management-content")
        .querySelectorAll("input,select,button")
        .forEach((el) => (el.disabled = false));
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    at("tables-back").onclick = back;
    at("tables-refresh").onclick = async () => {
      if (selected) {
        if (dirty && !await CaptainConfirm.discard()) return;
        selected = null;
        dirty = false;
      }
      void MobileGestures.refresh();
    };
    at("table-management-content").addEventListener(
      "input",
      () => { dirty = true; seatLimits(); },
    );
    at("table-management-content").addEventListener(
      "change",
      () => { dirty = true; seatLimits(); },
    );
    at("table-management-content").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || busy) return;
      if (button.dataset.table)
        edit(rows.find((row) => row.id === button.dataset.table));
      if (button.dataset.action === "add") edit(null);
      if (button.dataset.action === "edit-table") edit(selected,true);
      if (button.dataset.action === "back") back();
      if (button.dataset.action === "close-review") reviewClose();
      if (button.dataset.action === "close-confirm") { closeRequest.afterClose = at("table-after-close")?.value || "available"; void save(closeRequest,"close"); }
      if (button.dataset.status)
        void save(
          {
            id: selected.id,
            version: selected.version,
            status: button.dataset.status,
          },
          true,
        );
    });
    at("table-management-content").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const fields = { ...Object.fromEntries(form), adjacent_table_ids: form.getAll("adjacent_table_ids") };
      void save({ ...fields, id: selected.id, version: selected.version });
    });
    MobileGestures.setRefresh(load);
    void load();
  });
  window.addEventListener("captain:back", (event) => {
    if(event.defaultPrevented || document.querySelector("dialog[open], #posnic-lock.is-open")) return;
    event.preventDefault();
    back();
  });
})();
