/* One account hub; hash routes retain browser and Android Back navigation. */
(function () {
  "use strict";
  const titles = { home: "Me", account: "Account", language: "Language", preferences: "This phone", printers: "Printing" };
  const current = () => Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : "home";
  let renderedHash = location.hash;
  function render() {
    renderedHash = location.hash;
    const route = current();
    document.querySelectorAll("[data-me-page]").forEach(page => { page.hidden = page.dataset.mePage !== route; });
    document.querySelector(".me-title").textContent = window.I18N?.t(titles[route]) || titles[route];
  }
  function back() {
    if (window.CaptainProfile?.back()) return;
    if (current() === "printers") {
      history.replaceState(null, "", location.pathname + location.search + '#preferences');
      render();
      document.querySelector('a[href="#printers"]')?.focus();
      return;
    }
    if (current() !== "home") {
      history.replaceState(null, "", location.pathname + location.search);
      render();
    } else location.href = "kot-management.html";
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("me-back").addEventListener("click", back);
    render();
  });
  window.addEventListener("hashchange", () => {
    window.CaptainProfile?.back();
    if (window.CaptainProfile?.active) {
      history.replaceState(null, "", location.pathname + location.search + renderedHash);
      return;
    }
    render();
  });
  window.addEventListener("captain:back", event => {
    if (event.defaultPrevented || document.querySelector('dialog[open], #posnic-lock.is-open')) return;
    event.preventDefault();
    back();
  });
  window.CaptainMe = { render };
})();
