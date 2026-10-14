const fs = require("fs"),
  path = require("path"),
  acorn = require("acorn");
const { fromMarkup, decoded } = require("./tamil-gaps");
const keys = new Set([...fromMarkup().keys()]);
const add = (s) => {
  s = decoded(s).replace(/\s+/g, " ").trim();
  if (
    s.length > 1 &&
    s.length < 900 &&
    /[a-zA-Z]{2}/.test(s) &&
    !/^\{\d+\}$/.test(s) &&
    !/[;=<>]|(?:https?:|assets\/)/.test(s) &&
    !/^[-.#/]|^[a-z]+(?:[-_.][a-z]+)+$/.test(s)
  )
    keys.add(s);
};
function markup(s) {
  for (const m of s.matchAll(/(?:^|>)([^<>]+)(?=<|$)/g)) add(m[1]);
  for (const m of s.matchAll(
    /(?:placeholder|title|aria-label|alt)=["']([^"']+)["']/g,
  ))
    add(m[1]);
}
function concatenated(node, index = { value: 0 }) {
  if (node.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node.type === "BinaryExpression" && node.operator === "+")
    return concatenated(node.left, index) + concatenated(node.right, index);
  return `{${index.value++}}`;
}
function visit(n, parent, anc = []) {
  if (!n || !n.type) return;
  let value;
  if (
    n.type === "BinaryExpression" &&
    n.operator === "+" &&
    !(parent?.type === "BinaryExpression" && parent.operator === "+")
  ) {
    const joined = concatenated(n);
    if (joined.includes("<")) markup(joined);
  }
  if (n.type === "Literal" && typeof n.value === "string") value = n.value;
  if (n.type === "TemplateLiteral")
    value = n.quasis
      .map(
        (q, i) => q.value.cooked + (i < n.expressions.length ? `{${i}}` : ""),
      )
      .join("");
  if (value) {
    if (value.includes("<")) {
      if (!(parent?.type === "BinaryExpression" && parent.operator === "+"))
        markup(value);
    } else if (
      !(parent?.type === "Property" && parent.key === n) &&
      !anc.some(
        (a) =>
          a.type === "CallExpression" &&
          /^console\./.test(
            a.callee?.object?.name + "." + a.callee?.property?.name,
          ),
      )
    ) {
      if (
        /^[A-Z][a-z]+(?:\s|[.!?:])/.test(value) ||
        /\s[a-zA-Z]{2,}/.test(value) ||
        /^(Close|Cancel|Save|Retry|Continue|Back|Next|Loading|Language|Settings|Search|Table|Menu|Orders|Subtotal|Total|Discount|Tax|Cash|Card|Online|Offline|Print|Quantity|Remove|Delete|Edit|Add|Clear|Apply|Confirm|Dine-in|Takeaway)$/.test(
          value,
        )
      )
        add(value);
    }
  }
  for (const [k, v] of Object.entries(n)) {
    if (k === "parent") continue;
    if (Array.isArray(v)) v.forEach((c) => visit(c, n, [...anc, n]));
    else if (v?.type) visit(v, n, [...anc, n]);
  }
}
// item-localization is shared catalogue validation, not Captain interface copy.
function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["vendor", "images", "css", "locales"].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) scan(f);
    else if (
      e.name.endsWith(".js") &&
      !e.name.endsWith(".min.js") &&
      !/^(i18n|lang-ta|item-localization\.js|languages\.js|speech\.js|voice-order\.js|sounds-like)/.test(
        e.name,
      )
    ) {
      try {
        visit(
          acorn.parse(fs.readFileSync(f, "utf8"), {
            ecmaVersion: "latest",
            sourceType: "script",
          }),
        );
      } catch (e) {
        console.error(f, e.message);
      }
    }
  }
}
scan("assets");
for (const file of ["config.js", "indexedDB.js"])
  visit(acorn.parse(fs.readFileSync(file, "utf8"), { ecmaVersion: "latest" }));
for (const f of fs.readdirSync(".").filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(f, "utf8");
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(acorn.parse(m[1], { ecmaVersion: "latest" }));
    } catch {}
  }
}
const catalog = require("../assets/common/locales/en.json");
const ignore = new Set(require("./translation-source-exclusions.json"));
const missing = [...keys]
  .filter((key) => !catalog[key] && !ignore.has(key))
  .sort();
console.log(JSON.stringify(missing, null, 2));
if (missing.length) process.exitCode = 1;
