'use strict';

/*
 * HiTechPOS help center: client-side search over /help/search-index.json
 * and the collapsible navigation on small screens. Loaded as a file (no
 * inline script) so it works under the control plane's CSP.
 */
(function () {
  document.documentElement.classList.add('js');

  /* Case- and diacritic-insensitive form: "Hoá đơn" -> "hoa don". */
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch('/help/search-index.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (rows) {
          return rows.map(function (r) { return Object.assign({}, r, { ft: fold(r.t), fx: fold(r.x), fp: fold(r.p) }); });
        })
        .catch(function () { indexPromise = null; return []; });
    }
    return indexPromise;
  }

  function score(row, terms) {
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var inTitle = row.ft.indexOf(t) !== -1;
      var inText = row.fx.indexOf(t) !== -1 || row.fp.indexOf(t) !== -1;
      if (!inTitle && !inText) return 0;
      total += (inTitle ? 5 : 0) + (inText ? 1 : 0);
    }
    if (row.ft.indexOf(terms.join(' ')) === 0) total += 5;
    if (!row.p) total += 1; /* whole page */
    return total;
  }

  /* Short excerpt of the text around the first matching term. The folded
     string keeps the original's length for Vietnamese, so offsets match. */
  function snippet(row, terms) {
    var text = row.x || '';
    var at = -1;
    for (var i = 0; i < terms.length && at === -1; i++) at = row.fx.indexOf(terms[i]);
    if (at === -1 || fold(text).length !== text.length) return esc(text.slice(0, 120)) + (text.length > 120 ? '…' : '');
    var start = Math.max(0, at - 40);
    /* begin on a word boundary */
    var space = start > 0 ? text.indexOf(' ', start) : -1;
    if (space !== -1 && space < at) start = space + 1;
    var part = text.slice(start, start + 140);
    var foldedPart = row.fx.slice(start, start + 140);
    var out = '';
    var pos = 0;
    var re = new RegExp(terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
    var m;
    while ((m = re.exec(foldedPart)) && m[0]) {
      out += esc(part.slice(pos, m.index)) + '<mark>' + esc(part.slice(m.index, m.index + m[0].length)) + '</mark>';
      pos = m.index + m[0].length;
    }
    out += esc(part.slice(pos));
    return (start > 0 ? '…' : '') + out + (start + 140 < text.length ? '…' : '');
  }

  function bind(box) {
    var input = box.querySelector('input');
    var list = box.querySelector('.results');
    var active = -1;
    var hits = [];

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function highlight(i) {
      var links = list.querySelectorAll('a');
      for (var k = 0; k < links.length; k++) links[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
      active = i;
      if (links[i]) links[i].scrollIntoView({ block: 'nearest' });
    }
    function render(query) {
      var terms = fold(query).split(/\s+/).filter(Boolean);
      if (!terms.length) { close(); return; }
      loadIndex().then(function (rows) {
        if (fold(input.value).split(/\s+/).filter(Boolean).join(' ') !== terms.join(' ')) return; /* stale */
        hits = rows.map(function (r) { return { r: r, s: score(r, terms) }; })
          .filter(function (h) { return h.s > 0; })
          .sort(function (a, b) { return b.s - a.s; })
          .slice(0, 8);
        list.innerHTML = hits.length
          ? hits.map(function (h, i) {
            return '<li role="presentation"><a role="option" id="' + input.id + '-opt' + i + '" href="' + esc(h.r.u) + '"><b>' + esc(h.r.t) + '</b>'
              + (h.r.p ? '<small>' + esc(h.r.p) + '</small>' : '') + '<span class="snip">' + snippet(h.r, terms) + '</span></a></li>';
          }).join('')
          : '<li class="empty">Không tìm thấy kết quả. Thử từ khoá khác, ví dụ “QR”, “hoá đơn”, “mật khẩu”.</li>';
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        active = -1;
      });
    }

    input.addEventListener('focus', loadIndex);
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); highlight(Math.min(active + 1, hits.length - 1)); }
      else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
      else if (e.key === 'Enter') {
        var target = hits[active] || hits[0];
        if (target) { e.preventDefault(); location.href = target.r.u; }
      } else if (e.key === 'Escape') { input.value = ''; close(); }
    });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) close(); });

    /* /help/?q=... opens with the query already searched. */
    var q = new URLSearchParams(location.search).get('q');
    if (q && !document.querySelector('[data-help-search] input[data-q-used]')) {
      input.value = q;
      input.setAttribute('data-q-used', '1');
      render(q);
    }
  }

  function init() {
    var boxes = document.querySelectorAll('[data-help-search]');
    for (var i = 0; i < boxes.length; i++) bind(boxes[i]);

    var toggle = document.querySelector('.navtoggle');
    var side = document.querySelector('.side');
    if (toggle && side) {
      toggle.addEventListener('click', function () {
        var open = side.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    /* "/" focuses search, as on most help sites. */
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
        var first = document.querySelector('[data-help-search] input');
        if (first) { e.preventDefault(); first.focus(); }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
