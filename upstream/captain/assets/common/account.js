(function () {
  let changing = false;
  const t = (text) => window.I18N?.t(text) || text;
  function confirmChange(hasCart) {
    return new Promise((resolve) => {
      const previous = document.activeElement;
      const dialog = document.createElement("dialog");
      dialog.id = "account-signout";
      dialog.setAttribute("aria-labelledby", "account-signout-title");
      const title = document.createElement("h2");
      title.id = "account-signout-title";
      title.textContent = t("Sign out");
      const who = document.createElement("p");
      who.translate = false;
      who.textContent =
        POSNIC.session.user?.name || POSNIC.session.user?.email || "";
      const info = document.createElement("p");
      info.textContent = t(
        hasCart
          ? "Discard changes?"
          : "Signing out clears this phone's menu, tables and cart, and asks for the shop password next time.",
      );
      const actions = document.createElement("footer");
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = t("Cancel");
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.dataset.confirmSignout = "";
      confirm.textContent = t("Sign out");
      const finish = (value) => {
        window.removeEventListener("captain:back", back, true);
        dialog.close();
        dialog.remove();
        previous?.focus();
        resolve(value);
      };
      const back = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(false);
      };
      cancel.onclick = () => finish(false);
      confirm.onclick = () => finish(true);
      dialog.addEventListener("cancel", back);
      window.addEventListener("captain:back", back, true);
      actions.append(cancel, confirm);
      dialog.append(title, who, info, actions);
      document.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    });
  }
  async function change(mode = "staff") {
    if (changing) return;
    const say = (text) =>
      typeof showErrorPopup === "function"
        ? showErrorPopup(text)
        : alert(window.I18N ? I18N.t(text) : text);
    if (window.OrderQueue?.all().length) {
      say(
        "Send saved orders before switching accounts. Connection settings remain available.",
      );
      return;
    }
    changing = true;
    const owner = JSON.stringify([
      POSNIC.session.shopKey,
      POSNIC.session.user?.id,
    ]);
    try {
      const cart = typeof getData === "function" ? await getData("cart") : [];
      if (!(await confirmChange(cart.length > 0))) return;
      if (
        JSON.stringify([POSNIC.session.shopKey, POSNIC.session.user?.id]) !==
        owner
      )
        return;
      if (window.OrderQueue?.all().length) {
        say(
          "Send saved orders before switching accounts. Connection settings remain available.",
        );
        return;
      }
      await POSNIC.session.end();
      localStorage.removeItem("user_id");
      sessionStorage.removeItem("posnic_editing_server");
      if (mode === "cloud") sessionStorage.setItem("posnic_change_server", "1");
      await clearKioskLocalCache({
        keepServer: true,
        redirectTo: "index.html",
      });
    } catch (error) {
      say(error.message);
    } finally {
      changing = false;
    }
  }
  window.CaptainAccount = { change };
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-account-change]");
    if (button) void change(button.dataset.accountChange);
  });
})();
