/* Route indicators use server responses, never the phone's Wi-Fi attachment. */
(function () {
  "use strict";
  const seen = new Map();
  const t = text => window.I18N?.t(text) || text;
  function paint() {
    if (!window.POSNIC) return;
    const {server,net} = POSNIC;
    document.querySelectorAll("[data-route-signal]").forEach(button => {
      const local = button.dataset.routeSignal === "local";
      const base = (local ? server.lan : server.cloud) || (server.isLocal === local ? server.baseUrl : null);
      const answer = seen.get(base);
      const active = !!base && server.baseUrl === base && !net.offline;
      const reachable = !!answer?.reachable && Date.now() - answer.at < 60000;
      button.classList.toggle("is-reachable", reachable);
      button.classList.toggle("is-active", active && reachable);
      const name = local ? "Wi-Fi" : "Internet server";
      const status = reachable ? (local ? "Connected in the shop" : "Connected over the internet") : "Not connected";
      button.setAttribute("aria-label", t(name) + ": " + t(status));
      button.title = t(name) + ": " + t(status);
      button.dataset.reachable = String(reachable);
    });
  }
  window.addEventListener("posnic:route-health", event => {
    const {base,reachable} = event.detail || {};
    if (base && window.POSNIC?.server.canAdopt(base)) seen.set(base,{reachable,at:Date.now()});
    paint();
  });
  window.addEventListener("posnic:online", () => {
    if (window.POSNIC?.server.baseUrl) seen.set(POSNIC.server.baseUrl,{reachable:true,at:Date.now()});
    paint();
  });
  window.addEventListener("posnic:offline", () => { seen.clear(); paint(); });
  window.addEventListener("posnic:server-changed", paint);
  document.addEventListener("visibilitychange", paint);
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-route-signal]").forEach(button => button.addEventListener("click", () => {
      sessionStorage.setItem("posnic_change_server", "1");
      sessionStorage.setItem("posnic_connection_view", "settings");
      location.href = "index.html";
    }));
    paint();
    setInterval(() => { if (!document.hidden) paint(); },15000);
  });
})();
