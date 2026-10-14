(function () {
  "use strict";
  const t = (value) => window.I18N?.t(value) || value;
  const byId = (id) => document.getElementById(id);
  let active = [],
    tables = [],
    ready = new Set(),
    readiness = [],
    filter = new URLSearchParams(location.search).get('filter') === 'ready' ? 'ready' : 'active',
    area = "";
  let revision = 0,
    tablesKnown = false,
    readyKnown = false,
    loading = false, floorKnown = false;
  // Count configured tables once, independently of the visible filter or area.
  window.CaptainFloorOccupancy = () => {
    if (!tablesKnown) return null;
    const configured = new Map(tables.map(row => [String(row.tableorder_value), row]));
    const busy = new Set(active.filter(card => !card.dataset.takeaway && !card.dataset.awaitingClose).map(card => card.dataset.tableNumber));
    return { total: configured.size, occupied: [...configured].filter(([id,row]) => row.status === 'occupied' || busy.has(id)).length };
  };
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const readyKey = card => card.dataset.saleId ? 'sale:' + card.dataset.saleId : card.dataset.takeaway ? '' : card.dataset.tableNumber;
  function render() {
    const grid = byId("tables-list");
    if (!grid || !floorKnown) return;
    const select = byId("floor-area");
    const areas = [
      ...new Set(tables.map((row) => row.area).filter(Boolean)),
    ].sort();
    if (area && !areas.includes(area)) area = "";
    const signature = JSON.stringify(areas);
    if (select.dataset.areas !== signature) {
      select.replaceChildren(
        new Option(t("All"), ""),
        ...areas.map((name) => new Option(name, name)),
      );
      select.dataset.areas = signature;
    }
    select.value = area;
    select.closest("label").hidden = !areas.length;
    const cards = active.map((node) => node.cloneNode(true));
    if (filter === "all" && tablesKnown) {
      for (const row of tables) {
        if (
          cards.some(
            (card) => card.dataset.tableNumber === String(row.tableorder_value),
          )
        )
          continue;
        const card = element("a", "floor-card");
        card.dataset.tableNumber = String(row.tableorder_value);
        card.dataset.awaitingClose = "true";
        card.href =
          "tables.html?source=floor&table=" +
          encodeURIComponent(row.tableorder_value);
        card.insertAdjacentHTML("beforeend", floorCardHeading(row.tableorder_value));
        card.append(
          element(
            "div",
            "floor-meta",
            t(
              {
                available: "Available",
                occupied: "Occupied",
                cleaning: "Cleaning",
                held: "Held",
              }[row.status] || "Unavailable",
            ),
          ),
        );
        cards.push(card);
      }
    }
    const shown = cards.filter((card) => {
      if (filter === "takeaway" && !card.dataset.takeaway) return false;
      if (filter === "all" && card.dataset.takeaway) return false;
      const row = tables.find(
        (row) => String(row.tableorder_value) === card.dataset.tableNumber,
      );
      if (area && row?.area !== area) return false;
      if (
        filter === "ready" &&
        (!readyKnown ||
          !ready.has(readyKey(card)))
      )
        return false;
      if (row) {
        card.dataset.shape = ["square", "round", "rectangle"].includes(
          row.shape,
        )
          ? row.shape
          : "square";
        const description = [
          row.area,
          row.capacity ? t("Seat capacity") + ": " + row.capacity : "",
        ]
          .filter(Boolean)
          .join(" · ");
        if (description) card.append(element("div", "floor-meta", description));
      }
      if (
        readyKnown &&
        ready.has(readyKey(card))
      )
      {
        const summaries = readiness.filter(summary => card.dataset.takeaway
          ? !summary.table && (!card.dataset.saleId || summary.saleId === card.dataset.saleId)
          : String(summary.table) === card.dataset.tableNumber);
        const count = summaries.reduce((sum, summary) => sum + summary.ready, 0);
        const remaining = summaries.reduce((sum, summary) => sum + summary.remaining, 0);
        card.append(element("span", "floor-ready", t("Ready") +
          (remaining > 0 ? ` · ${count} / ${remaining}` : "")));
        const items = summaries.flatMap(summary => summary.items || []);
        if (items.length) {
          const preview = element("div", "floor-meta", items.map(item => `${item.quantity} × ${item.name}`).join(" · "));
          preview.setAttribute("translate", "no");
          card.append(preview);
        }
      }
      return true;
    });
    if (filter !== "ready") {
      let pending = [];
      try {
        pending = window.POSNIC_ORDER_QUEUE_UI?.visibleRows() || [];
      } catch {}
      for (const order of pending) {
        const table = String(order.body?.kiosk_table_no || "");
        if (filter === "takeaway" && table) continue;
        const metadata = tables.find(
          (row) => String(row.tableorder_value) === table,
        );
        if (area && metadata?.area !== area) continue;
        // A pending order must not also appear as an available/clean table.
        // Keep any accepted active ticket, but replace the empty-table card.
        const empty = shown.findIndex(card =>
          card.dataset.tableNumber === table && card.dataset.awaitingClose === 'true');
        if (empty >= 0) shown.splice(empty, 1);
        const card = element("a", "floor-card");
        card.dataset.tableNumber = table;
        card.classList.add("is-pending");
        card.href = "pending.html";
        card.dataset.awaitingClose = "true";
        if (!table) { card.classList.add('is-takeaway'); card.dataset.takeaway = 'true'; }
        card.insertAdjacentHTML("beforeend", floorCardHeading(table || ('Take Away' + (order.body?.tokenId ? ' ' + order.body.tokenId : '')), !table));
        card.append(
          element(
            "div",
            "floor-meta",
            t("Saved on this phone · Not sent to kitchen"),
          ),
        );
        if (order.message) {
          card.append(element("div", "floor-meta", t(order.message)));
        }
        card.append(element("span", "floor-pending-action", t(
          order.state === "attention" ? "Needs attention" : "View",
        ) + " ›"));
        shown.push(card);
      }
    }
    grid.dataset.filter = filter;
    grid.replaceChildren(...shown);
    document
      .querySelectorAll("[data-floor-filter]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.floorFilter === filter),
        ),
      );
    const unavailable =
      (filter === "all" && !tablesKnown) || (filter === "ready" && !readyKnown);
    const status = byId("floor-filter-status");
    status.hidden =
      (!unavailable && shown.length > 0) || (filter === "active" && !area);
    status.textContent = unavailable
      ? t(loading ? "Loading..." : "Connection failed")
      : !shown.length
        ? t("No orders yet")
        : "";
    byId("no-orders-message").style.display =
      filter === "active" && !area && !shown.length ? "block" : "none";
  }
  async function update() {
    const ticket = ++revision;
    floorKnown = true;
    active = [...byId("tables-list").querySelectorAll(".floor-card")].map(
      (node) => node.cloneNode(true),
    );
    loading = true;
    render();
    const results = await Promise.allSettled([
      POSNIC.api.get("/captain/v1/tables"),
      POSNIC.api.get("/captain/v1/kitchen-ready"),
    ]);
    if (ticket !== revision) return;
    loading = false;
    if (
      results[0].status === "fulfilled" &&
      Array.isArray(results[0].value?.tables)
    ) {
      tables = CaptainTables.liveRows(results[0].value);
      tablesKnown = true;
    } else {
      tablesKnown = false;
      tables = [];
    }
    if (
      results[1].status === "fulfilled" &&
      Array.isArray(results[1].value?.tickets)
    ) {
      ready = new Set(
        results[1].value.tickets
          .filter((ticket) =>
            ticket.items.some((item) => item.ready > item.served),
          )
          .flatMap((ticket) => ticket.table ? [String(ticket.table)] : ['', 'sale:' + ticket.saleId]),
      );
      readyKnown = true;
      readiness = Array.isArray(results[1].value.readiness) ? results[1].value.readiness : [];
    } else {
      readyKnown = false;
      ready = new Set();
      readiness = [];
    }
    render();
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-floor-filter]").forEach((button) =>
      button.addEventListener("click", () => {
        filter = button.dataset.floorFilter;
        render();
      }),
    );
    let pendingSignature = "";
    window.addEventListener("captain:pending-changed", () => {
      let next = "";
      try {
        next = JSON.stringify(
          window.POSNIC_ORDER_QUEUE_UI?.visibleRows().map((row) => [
            row.key,
            row.state,
          ]) || [],
        );
      } catch {}
      if (next !== pendingSignature) {
        pendingSignature = next;
        render();
      }
    });
    byId("floor-area")?.addEventListener("change", (event) => {
      area = event.target.value;
      render();
    });
  });
  window.FloorDashboard = { update };
})();
