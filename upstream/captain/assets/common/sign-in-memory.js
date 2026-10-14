/* Remember successful account names per server; passwords belong to the
 * device password manager and the existing secure session, never this store. */
(function () {
  "use strict";
  const key = "posnic.signin-names.v1";
  let selected = null;
  let suggestions;
  function showSuggestions() {
    const username = document.getElementById("username");
    if (!username || !selected) return;
    if (!suggestions) {
      suggestions = document.createElement("div");
      suggestions.className = "saved-signin-choices";
      suggestions.setAttribute("role", "group");
      suggestions.setAttribute("aria-labelledby", "saved-signin-label");
      username.closest(".mb-3").append(suggestions);
      username.addEventListener("input", showSuggestions);
      username.addEventListener("focus", showSuggestions);
    }
    const query = username.value.trim().toLocaleLowerCase();
    const matches = names(selected).filter(name => name.toLocaleLowerCase().includes(query));
    suggestions.replaceChildren(...matches.map(name => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.translate = false;
      button.addEventListener("click", () => {
        // A different account must not inherit the previous account's password.
        if (username.value !== name) document.getElementById("password").value = "";
        username.value = name;
        username.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("password").focus();
      });
      return button;
    }));
    suggestions.hidden = matches.length === 0;
  }
  const normalize = base => window.POSNIC?.server.normalize(base) || "";
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter(row => row && typeof row.base === "string" &&
        Array.isArray(row.names)).slice(0, 10) : [];
    } catch { return []; }
  }
  function names(base) {
    return (read().find(row => row.base === normalize(base))?.names || [])
      .filter(name => typeof name === "string" && name.length > 0 && name.length <= 254).slice(0, 8);
  }
  function selectServer(base) {
    base = normalize(base);
    if (!base) return;
    const username = document.getElementById("username");
    const password = document.getElementById("password");
    const list = document.getElementById("saved-usernames");
    if (!username || !password || !list) return;
    if (selected && selected !== base) {
      username.value = "";
      password.value = "";
    }
    selected = base;
    const saved = names(base);
    list.replaceChildren(...saved.map(name => {
      const option = document.createElement("option");
      option.value = name;
      return option;
    }));
    // Never overwrite typing or a password-manager supplied username.
    if (!username.value && saved.length) username.value = saved[0];
    showSuggestions();
  }
  function remember(base, username) {
    base = normalize(base);
    username = String(username || "").trim();
    if (!base || !username || username.length > 254) return;
    const entries = read().filter(row => row.base !== base);
    entries.unshift({ base, names: [username, ...names(base).filter(name => name !== username)].slice(0, 8) });
    try { localStorage.setItem(key, JSON.stringify(entries.slice(0, 10))); } catch { /* Sign-in must still work. */ }
    if (selected === base) selectServer(base);
  }
  window.CaptainSignIn = { selectServer, remember };
})();
