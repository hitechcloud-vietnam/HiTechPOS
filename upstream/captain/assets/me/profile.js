/* Account details use the current restaurant identity; no local-only profile edits. */
(function () {
  "use strict";
  const t = (text) => window.I18N?.t(text) || text;
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
  let page,
    home,
    current = "",
    busy = false,
    profile,
    generation = 0, nameDraft = "", phoneNumber = "", phoneChallenge = null, resendAt = 0, phoneTimer, phonePassword = "", phoneCode = "", contactKind = "phone", cooldowns = {phone:0,email:0};
  function dirty() {
    if (["phone", "phone-code"].includes(current)) return (page.querySelector("#phone-number")?.value ?? phoneNumber) !== String(profile?.[contactKind] || "") || nameDraft !== String(profile?.name || "");
    if (current === "password") return [...page.querySelectorAll("input")].some(input => input.value !== "");
    const name = page?.querySelector("#profile-name");
    return current === "profile" && name && name.value !== String(profile?.name ?? "");
  }
  function back() {
    if (!current) return false;
    if (busy) return true;
    if (current === "phone-code") { phoneCode = page.querySelector("#phone-code").value; showPhone(); return true; }
    if (current === "phone") { phonePassword = ""; renderProfile(nameDraft); return true; }
    if (dirty()) {
      void CaptainConfirm.discard().then(confirmed => { if (confirmed) leave(); });
      return true;
    }
    leave();
    return true;
  }
  function leave() {
    clearInterval(phoneTimer);
    phonePassword = "";
    generation++;
    page.hidden = true;
    home.hidden = false;
    current = "";
    window.CaptainMe?.render();
  }
  function field(label, id, type, value = "", autocomplete = "off") {
    return `<label class="profile-field">${esc(t(label))}<input class="ui-field" id="${id}" name="${id}" type="${type}" value="${esc(value)}" autocomplete="${autocomplete}" required></label>`;
  }
  function show(view) {
    if (busy) return;
    current = view;
    home.hidden = true;
    page.hidden = false;
    document.querySelector(".me-title").textContent = t(
      view === "password" ? "Change password" : "Profile details",
    );
    page.innerHTML =
      view === "password"
        ? `<form id="profile-form">${field("Current password", "currentPassword", "password", "", "current-password")}${field("New password", "newPassword", "password", "", "new-password")}${field("Confirm password", "confirmPassword", "password", "", "new-password")}<p class="me-note">${esc(t("Use at least 10 characters and repeat the new password."))}</p><p class="me-note">${esc(t("After changing your password, sign in again. Saved orders stay on this phone."))}</p>${actions()}</form>`
        : `<p role="status">${esc(t("Loading..."))}</p>`;
    if (view === "profile") void load();
  }
  function actions() {
    return `<p id="profile-message" role="status"></p><div class="profile-actions"><button type="button" data-profile-back class="profile-secondary">${esc(t("Cancel"))}</button><button class="profile-primary" type="submit">${esc(t("Save"))}</button></div>`;
  }
  async function load() {
    const requestGeneration = ++generation;
    let timer;
    page.innerHTML = `<p role="status">${esc(t("Loading..."))}</p>`;
    try {
      const loaded = await Promise.race([
        Promise.resolve().then(() => POSNIC.api.get("/captain/v1/profile")),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('profile_timeout')), 20000); }),
      ]);
      if (current !== "profile" || requestGeneration !== generation) return;
      profile = loaded;
      renderProfile();
    } catch {
      if (current !== "profile" || requestGeneration !== generation) return;
      page.innerHTML = `<p role="status">${esc(t("Connection failed"))}</p><button type="button" class="profile-primary" data-profile-retry>${esc(t("Retry"))}</button>`;
    } finally {
      clearTimeout(timer);
    }
  }
  function renderProfile(name = profile.name) {
    clearInterval(phoneTimer);
    current = "profile";
    document.querySelector(".me-title").textContent = t("Profile details");
    page.innerHTML = `<form id="profile-form">${field("Name", "profile-name", "text", name, "name")}<div class="profile-detail"><span>${esc(t("Email"))}</span><strong translate="no">${esc(profile.email || "—")}</strong><button type="button" class="profile-secondary" data-profile-email>${esc(t("Change"))}</button></div><div class="profile-detail"><span>${esc(t("Phone number"))}</span><strong translate="no">${esc(profile.phone || "—")}</strong><button type="button" class="profile-secondary" data-profile-phone>${esc(t("Change"))}</button></div>${actions()}</form>`;
    page.querySelector("input").maxLength = 100;
  }
  const normalizePhone = value => contactKind === 'email' ? String(value || '').trim().toLowerCase() : String(value || '').replace(/[ ()-]/g, '');
  function canResumePhone() {
    return current === 'phone' && phoneChallenge && !phoneChallenge.invalid &&
      Date.parse(phoneChallenge.expiresAt) > Date.now() &&
      normalizePhone(page.querySelector('#phone-number')?.value) === phoneChallenge.phone;
  }
  function phoneClock() {
    const button = page.querySelector('[data-phone-send],[data-phone-resend]');
    if (!button) return;
    const resume = canResumePhone();
    const password = page.querySelector('#phone-password');
    if (password) password.required = !resume;
    const seconds = resume ? 0 : Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    const label = resume ? 'Continue' : button.hasAttribute('data-phone-send') ? 'Send verification code' : 'Resend code';
    button.textContent = t(label) + (seconds ? ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})` : '');
    button.disabled = busy || seconds > 0;
  }
  function showPhone(code = false) {
    clearInterval(phoneTimer);
    current = code ? "phone-code" : "phone";
    document.querySelector(".me-title").textContent = t(code ? "Code" : contactKind === "email" ? "Email" : "Phone number");
    page.innerHTML = `<form id="phone-form">${code ? `<p translate="no" dir="ltr">${esc(phoneNumber)}</p>${field("Code", "phone-code", "text", phoneCode, "one-time-code")}` : `${field(contactKind === "email" ? "Email" : "Phone number", "phone-number", contactKind === "email" ? "email" : "tel", phoneNumber, contactKind === "email" ? "email" : "tel")}${field("Current password", "phone-password", "password", phonePassword, "current-password")}<p class="me-note">${esc(t(contactKind === "email" ? "Enter a valid email address." : "Enter a phone number with country code."))}</p>`}<p id="profile-message" role="status"></p><div class="profile-actions"><button type="button" class="profile-secondary" data-profile-back>${esc(t("Back"))}</button><button type="submit" class="profile-primary" ${code ? '' : 'data-phone-send'}>${esc(t(code ? "Continue" : "Send verification code"))}</button></div>${code ? `<button type="button" class="profile-secondary phone-resend" data-phone-resend>${esc(t("Resend code"))}</button>` : ''}</form>`;
    const input = page.querySelector('input');
    input.dir = 'ltr';
    if (code) { input.inputMode = 'numeric'; input.pattern = '[0-9]{6}'; input.maxLength = 6; }
    else { input.maxLength = contactKind === 'email' ? 254 : 25; input.placeholder = contactKind === 'email' ? 'name@example.com' : '+919000000000'; }
    phoneClock(); phoneTimer = setInterval(phoneClock, 1000);
    if (code) input.focus();
  }
  async function phoneSubmit(resend = false) {
    if (busy) return;
    const verifying = current === 'phone-code' && !resend;
    if (!resend && canResumePhone()) { phoneNumber = phoneChallenge.phone; showPhone(true); return; }
    if (!verifying && Date.now() < resendAt) return;
    if (!verifying && current === 'phone') phoneNumber = normalizePhone(page.querySelector('#phone-number').value);
    const message = page.querySelector('#profile-message');
    if (!verifying && !(contactKind === 'email' ? /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(phoneNumber) : /^\+[1-9]\d{7,14}$/.test(phoneNumber))) { message.textContent = t(contactKind === 'email' ? 'Enter a valid email address.' : 'Enter a phone number with country code.'); return; }
    if (!verifying && current === 'phone') phonePassword = page.querySelector('#phone-password').value;
    const body = verifying ? {challenge:phoneChallenge.challenge,code:page.querySelector('#phone-code').value} : {[contactKind]:phoneNumber,currentPassword:phonePassword};
    busy = true;
    page.querySelectorAll('button,input').forEach(node => node.disabled = true);
    message.textContent = t('Loading...');
    try {
      const result = await POSNIC.api.post('/captain/v1/profile/' + contactKind + '/' + (verifying ? 'verify' : 'start'), body);
      if (verifying) {
        if (result.saved !== true || result[contactKind] !== phoneNumber) throw new Error('unconfirmed');
        phonePassword = "";
        profile[contactKind] = result[contactKind];
        try { await POSNIC.session.updateProfile?.(profile); } catch { /* The server has saved the verified phone. */ }
        renderProfile(nameDraft);
        page.querySelector('#profile-message').textContent = t('Saved');
      } else {
        if (typeof result.challenge !== 'string' || !result.challenge || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('unconfirmed');
        phoneCode = "";
        phoneChallenge = { ...result, phone: phoneNumber };
        resendAt = Date.now() + Math.max(60, Number(result.retryAfter) || 60) * 1000;
        showPhone(true);
      }
    } catch (error) {
      if (error.status === 429) resendAt = Date.now() + 60000;
      if (verifying && error.status === 409) { resendAt = 0; phoneChallenge.invalid = true; }
      message.textContent = t(error.status === 404 ? 'This shop’s server is too old for this screen. Update POSNIC on the till.' : error.status === 400 ? (verifying ? 'Check the verification code.' : 'The current password is incorrect.') : error.status === 409 ? (contactKind === 'email' && !verifying ? 'This email address is unavailable.' : 'Request a new verification code.') : error.status === 429 ? 'Resend code' : verifying ? 'Could not save. Please try again.' : contactKind === 'email' ? 'Could not send the code. Check email settings or try again later.' : 'Could not send the code. Check SMS settings or try again later.');
    } finally {
      busy = false;
      page.querySelectorAll('button,input').forEach(node => node.disabled = false);
      phoneClock();
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (["phone", "phone-code"].includes(current)) { void phoneSubmit(); return; }
    const values = Object.fromEntries(new FormData(event.target));
    const message = page.querySelector("#profile-message");
    const password = current === "password";
    if (password && new TextEncoder().encode(values.newPassword).length > 54) {
      message.textContent = t("Choose a shorter password.");
      return;
    }
    if (
      password &&
      (values.newPassword.length < 10 ||
        values.newPassword !== values.confirmPassword)
    ) {
      message.textContent = t(
        "Use at least 10 characters and repeat the new password.",
      );
      return;
    }
    busy = true;
    page
      .querySelectorAll("button,input")
      .forEach((node) => (node.disabled = true));
    message.textContent = t("Loading...");
    try {
      const result = await POSNIC.api.post(
        password ? "/captain/v1/password" : "/captain/v1/profile",
        password ? values : { name: values["profile-name"] },
      );
      if (password) {
        if (result.saved !== true) throw new Error("Unconfirmed");
        await POSNIC.session.end();
        // Preserve the restaurant cache and durable orders for the same user to resume.
        current = "";
        busy = false;
        location.href = "index.html";
      } else {
        profile = result;
        page.querySelector("#profile-name").value = result.name;
        await POSNIC.session.updateProfile?.(result);
        document.getElementById("me-who").textContent = result.name;
        document.getElementById("me-home-who").textContent = result.name;
        message.textContent = t("Saved");
      }
    } catch (error) {
      message.textContent = t(
        password && error.status === 400
          ? "The current password is incorrect."
          : "Could not save. Please try again.",
      );
    } finally {
      busy = false;
      page
        .querySelectorAll("button,input")
        .forEach((node) => (node.disabled = false));
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    home = document.querySelector(".me-body");
    page = document.createElement("main");
    page.classList.add("me-body", "profile-page");
    page.hidden = true;
    home.after(page);
    document
      .getElementById("me-profile")
      .addEventListener("click", () => show("profile"));
    document
      .getElementById("me-password")
      .addEventListener("click", () => show("password"));
    page.addEventListener("submit", submit);
    page.addEventListener("input", event => { if (event.target.id === "phone-number") phoneClock(); });
    page.addEventListener("click", (event) => {
      if (event.target.closest("[data-profile-phone],[data-profile-email]") && !busy) { cooldowns[contactKind] = resendAt; contactKind = event.target.closest('[data-profile-email]') ? 'email' : 'phone'; resendAt = cooldowns[contactKind]; nameDraft = page.querySelector('#profile-name').value; phoneNumber = profile[contactKind] || ''; phoneChallenge = null; phoneCode = ''; phonePassword = ''; showPhone(); }
      if (event.target.closest("[data-phone-resend]")) void phoneSubmit(true);
      if (event.target.closest("[data-profile-back]")) back();
      if (event.target.closest("[data-profile-retry]")) void load();
    });
  });
  window.addEventListener("captain:back", (event) => {
    if (current && !event.defaultPrevented && !document.querySelector("dialog[open], #posnic-lock.is-open")) {
      event.preventDefault();
      back();
    }
  });
  window.addEventListener("beforeunload", event => {
    if (busy || dirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.CaptainProfile = { back, get active() { return Boolean(current); } };
})();
