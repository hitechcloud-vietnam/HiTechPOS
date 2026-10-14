/* These are branch settings; the server checks the manager's permission. */
(function () {
  "use strict";
  const at = id => document.getElementById(id), t = text => window.I18N?.t(text) || text;
  let busy = false, dirty = false, generation = 0;
  function message(text) { at("payment-settings-message").textContent = t(text); }
  function paint() {
    const enabled = at("payment-settings-enabled").checked;
    at("payment-settings-options").hidden = !enabled;
    at("payment-settings-cashier").hidden = enabled;
    const hasMethod = !!document.querySelector('input[name="method"]:checked');
    at("payment-settings-save").disabled = busy || (enabled && !hasMethod);
    at("payment-settings-method-error").hidden = !enabled || hasMethod;
  }
  async function back() {
    if (busy || (dirty && !await CaptainConfirm.discard())) return;
    generation++;
    location.href = "me.html#preferences";
  }
  async function load() {
    if (busy) return;
    const ticket = ++generation;
    at("payment-settings-form").hidden = true;
    at("payment-settings-retry").hidden = true;
    message("Loading...");
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => POSNIC.api.get("/captain/v1/payment-settings")),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('settings_timeout')), 20000); }),
      ]);
      if (ticket !== generation) return;
      if (typeof value.enabled !== "boolean" || !Array.isArray(value.methods) || typeof value.printReceipt !== "boolean") throw new Error("invalid_settings");
      at("payment-settings-enabled").checked = value.enabled;
      at("payment-settings-print").checked = value.printReceipt;
      document.querySelectorAll('input[name="method"]').forEach(input => { input.checked = value.methods.includes(input.value); });
      dirty = false;
      paint();
      at("payment-settings-form").hidden = false;
      message("");
    } catch (error) {
      if (ticket !== generation) return;
      message(error.status === 403 ? "Permission is required." : "Connection failed");
      at("payment-settings-retry").hidden = error.status === 403;
    } finally {
      clearTimeout(timer);
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    at("payment-settings-back").onclick = back;
    at("payment-settings-cancel").onclick = back;
    at("payment-settings-retry").onclick = load;
    const form = at("payment-settings-form");
    form.querySelector('a[href^="branch-details"]').addEventListener("click", async event => {
      event.preventDefault();
      const destination = event.currentTarget.href;
      if (busy || (dirty && !await CaptainConfirm.discard())) return;
      location.href = destination;
    });
    form.addEventListener("change", () => { dirty = true; paint(); });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || at("payment-settings-save").disabled) return;
      const value = { enabled: at("payment-settings-enabled").checked, printReceipt: at("payment-settings-print").checked, methods: [...document.querySelectorAll('input[name="method"]:checked')].map(input => input.value) };
      busy = true;
      form.querySelectorAll("input,button").forEach(input => { input.disabled = true; });
      message("Loading...");
      try {
        const result = await POSNIC.api.post("/captain/v1/payment-settings", value);
        if (result.saved !== true || result.enabled !== value.enabled || result.printReceipt !== value.printReceipt ||
          !Array.isArray(result.methods) || result.methods.length !== value.methods.length ||
          new Set(result.methods).size !== result.methods.length || result.methods.some(method => !value.methods.includes(method)))
          throw new Error("unconfirmed_save");
        dirty = false;
        message("Saved");
      } catch (error) { message(error.status === 403 ? "Permission is required." : "Could not save. Please try again."); }
      finally {
        busy = false;
        form.querySelectorAll("input,button").forEach(input => { input.disabled = false; });
        paint();
      }
    });
    void load();
  });
  window.addEventListener("captain:back", event => { if(event.defaultPrevented || document.querySelector("dialog[open], #posnic-lock.is-open")) return; event.preventDefault(); back(); });
})();
