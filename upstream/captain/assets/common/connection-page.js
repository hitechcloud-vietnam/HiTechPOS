/* Every connection entry point opens the same setup component. */
function openServerModal() {
  window.CaptainOnboarding.open();
}
function closeServerModal() {
  window.CaptainOnboarding.close();
}
document.addEventListener("DOMContentLoaded", () => {
  const build = window.POSNIC_BUILD;
  const line = document.getElementById("appVersionLine");
  if (line)
    line.textContent = build?.version
      ? "Captain " + build.version
      : "Captain dev build";
  if (window.SelfTest) SelfTest.fromLocation();
  if (
    sessionStorage.getItem("posnic_change_server") === "1" ||
    sessionStorage.getItem("posnic_editing_server") === "1"
  ) {
    sessionStorage.removeItem("posnic_change_server");
    openServerModal();
    if (sessionStorage.getItem("posnic_connection_view") === "settings") {
      document.getElementById("connection-settings").click();
    }
    if (sessionStorage.getItem("posnic_find_on_wifi") === "1") {
      sessionStorage.removeItem("posnic_find_on_wifi");
      document.getElementById("captain-search").click();
    }
  }
});
