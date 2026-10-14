const key = "posnic.business.language";
export async function readLanguage() {
  return window.localStorage.getItem(key);
}
export async function writeLanguage(code: string) {
  window.localStorage.setItem(key, code);
}
