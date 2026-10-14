(function () {
  "use strict";
  const routes = [
    [
      "kot-management.html",
      "Tables",
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    ],
    [
      "order-history.html",
      "Order history",
      '<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',
    ],
    [
      "pending.html",
      "Order sync",
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ],
    [
      "me.html",
      "Account",
      '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    ],
  ];
  document.addEventListener("DOMContentLoaded", () => {
    const current = location.pathname.split("/").pop();
    if (!routes.some(([path]) => path === current)) return;
    const nav = document.createElement("nav");
    nav.className = "captain-navigation";
    nav.setAttribute("aria-label", "Captain");
    for (const [path, label, icon] of routes) {
      const link = document.createElement("a");
      link.href = path;
      if (path === current) link.setAttribute("aria-current", "page");
      link.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${icon}</svg><span></span>`;
      link.querySelector("span").textContent = window.I18N?.t(label) || label;
      nav.append(link);
    }
    document.querySelector(".captain-navigation")?.remove();
    document.body.classList.add("with-primary-navigation");
    document.body.append(nav);
    const pending = nav.querySelector('a[href="pending.html"]');
    const badge = document.createElement("b");
    badge.className = "navigation-count";
    badge.setAttribute("translate", "no");
    pending.append(badge);
    function refreshCount() {
      let count = 0;
      try {
        count = window.POSNIC_ORDER_QUEUE_UI?.visibleRows().length || 0;
      } catch {}
      badge.hidden = !count;
      badge.textContent = String(count);
    }
    window.addEventListener("captain:pending-changed", refreshCount);
    refreshCount();
  });
})();
