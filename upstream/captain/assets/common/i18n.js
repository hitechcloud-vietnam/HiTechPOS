/* Offline interface translations. Shop content is excluded with translate="no". */
(function (root) {
  'use strict';
  const packs = {}, patterns = {}, originals = new WeakMap(), attributes = new WeakMap();
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const SKIP = 'script,style,noscript,textarea,[translate="no"],[data-i18n-ignore],[contenteditable="true"]';
  let current = 'en', watching = false;
  const normalize = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function register(code, words) {
    packs[code] = Object.assign(packs[code] || {}, words);
    patterns[code] = Object.keys(packs[code]).filter(key => /\{\d+\}/.test(key))
      .filter(key => key.replace(/\{\d+\}/g, '').replace(/[^a-z]/gi, '').length >= 2)
      .sort((a, b) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
      .map(key => {
        const ids = [];
        const chunks = key.split(/(\{\d+\})/g).map(part => {
          if (/^\{\d+\}$/.test(part)) { ids.push(part); return '(.*?)'; }
          return escape(part);
        });
        return { key, ids, re: new RegExp('^' + chunks.join('') + '$') };
      });
  }
  function t(sentence, fallback) {
    const source = normalize(sentence);
    if (current === 'en') return fallback == null ? String(sentence ?? '') : fallback;
    const words = packs[current] || {};
    if (words[source]) return words[source];
    for (const entry of patterns[current] || []) {
      // Generic table/name placeholders must not swallow another status on a
      // combined line. Translate those segments separately below instead.
      if (source.includes(' · ') && !entry.key.split(' · ').slice(1).some(part => /[a-z]{2}/i.test(part))) continue;
      const match = source.match(entry.re);
      if (!match) continue;
      const values = Object.fromEntries(entry.ids.map((id, i) => [id, match[i + 1]]));
      return words[entry.key].replace(/\{\d+\}/g, id => values[id] ?? id);
    }
    if (source.includes(' · ')) return source.split(' · ').map(part => t(part)).join(' · ');
    const counted = source.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (counted && words[counted[2]]) return counted[1] + ' ' + words[counted[2]];
    return fallback == null ? String(sentence ?? '') : fallback;
  }
  function format(sentence, values) {
    return t(sentence).replace(/\{(\d+)\}/g, (all, index) => values[index] == null ? all : String(values[index]));
  }
  function skipped(node) {
    return !!(node.nodeType === 1 ? node : node.parentElement)?.closest?.(SKIP);
  }
  function translateText(node) {
    if (skipped(node)) return;
    let saved = originals.get(node);
    // A renderer can reuse a node for a different status or count.
    if (!saved || node.nodeValue !== saved.rendered) saved = { source: node.nodeValue };
    const text = normalize(saved.source);
    const result = t(text);
    saved.rendered = result === text ? saved.source : saved.source.replace(saved.source.trim(), result);
    originals.set(node, saved);
    if (node.nodeValue !== saved.rendered) node.nodeValue = saved.rendered;
  }
  function translateAttributes(element) {
    if (!element.hasAttribute || skipped(element)) return;
    const saved = attributes.get(element) || {};
    for (const name of ATTRS) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name);
      let entry = saved[name];
      if (!entry || value !== entry.rendered) entry = { source: value };
      entry.rendered = t(entry.source);
      saved[name] = entry;
      if (value !== entry.rendered) element.setAttribute(name, entry.rendered);
    }
    attributes.set(element, saved);
  }
  function apply(node) {
    if (!node || skipped(node)) return;
    if (node.nodeType === 3) { translateText(node); return; }
    if (node.nodeType !== 1) return;
    translateAttributes(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) translateText(text);
    node.querySelectorAll(ATTRS.map(name => '[' + name + ']').join(',')).forEach(translateAttributes);
  }
  function languages() { return root.CAPTAIN_LANGUAGES || [{code:'en',name:'English'}, {code:'ta',name:'தமிழ்'}]; }
  function populate(select) {
    if (!select || select.dataset.languagesReady) return;
    select.dataset.languagesReady = 'true';
    select.setAttribute('translate', 'no');
    select.replaceChildren(...languages().map(language => {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = language.name;
      option.lang = language.code;
      option.dir = language.dir || 'ltr';
      return option;
    }));
    select.value = current;
  }
  function use(code, options) {
    current = code === 'en' || packs[code] ? code : 'en';
    if (!options || options.remember !== false) {
      try { localStorage.setItem('posnic.language', current); } catch {}
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = current;
      document.documentElement.dir = languages().find(language => language.code === current)?.dir || 'ltr';
      apply(document.documentElement);
      document.querySelectorAll('[data-language-picker],#app-language,#me-language').forEach(select => {
        populate(select); select.value = current;
      });
      globalThis.dispatchEvent?.(new CustomEvent('posnic:language-changed', {detail: current}));
    }
    return current;
  }
  function start() {
    if (root.POSNIC_LANG_TA) { register('ta', root.POSNIC_LANG_TA); delete root.POSNIC_LANG_TA; }
    let language = 'en';
    try { language = localStorage.getItem('posnic.language') || 'en'; } catch {}
    use(language, {remember:false});
    document.querySelectorAll('[data-language-picker]').forEach(select => {
      populate(select);
      select.addEventListener('change', () => use(select.value));
    });
    if (watching || typeof MutationObserver !== 'function') return;
    watching = true;
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) apply(node);
        if (record.type === 'characterData') apply(record.target);
        if (record.type === 'attributes') translateAttributes(record.target);
      }
    }).observe(document.documentElement, {childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
    for (const name of ['alert', 'confirm', 'prompt']) {
      if (typeof root[name] !== 'function') continue;
      const original = root[name].bind(root);
      root[name] = (message, ...args) => original(t(message), ...args);
    }
  }
  root.I18N = {register,t,format,use,start,apply,populate,languages,known:()=>['en', ...Object.keys(packs).filter(code=>code!=='en')],language:()=>current};
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
