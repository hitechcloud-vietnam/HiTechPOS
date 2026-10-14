'use strict';

/*
 * HiTechPOS public site. Loaded from 'self' (no inline script), so it works
 * under the control plane's CSP. Pages are complete without it: the pricing
 * page ships with server-checked numbers (test/public-pages.test.js), and
 * this script only refreshes them from GET /api/plans and adds the billing
 * cycle picker. Every value from the API is written with textContent.
 */
(function () {
  var fmt = new Intl.NumberFormat('vi-VN');
  var vnd = function (n) { return fmt.format(n) + ' ₫'; };
  var PROVIDER_NAMES = { payos: 'payOS', pay2s: 'Pay2S' };

  function each(selector, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
  }

  /* Same arithmetic as src/plans.js quote(): integer VND, the discount is
     rounded down in the customer's favour. */
  function net(plan, months, cycles) {
    var cycle = cycles.find(function (c) { return c.months === months; });
    if (!cycle) return null;
    var subtotal = plan.monthlyPrice * months;
    return subtotal - Math.floor((subtotal * cycle.discountPercent) / 100);
  }

  function hydratePricing(cat) {
    var plans = {};
    cat.plans.forEach(function (p) { plans[p.id] = p; });

    each('[data-plan-name]', function (el) {
      var p = plans[el.getAttribute('data-plan-name')];
      if (p) el.textContent = p.name;
    });
    each('[data-price]', function (el) {
      var p = plans[el.getAttribute('data-plan')];
      var total = p && net(p, Number(el.getAttribute('data-months')), cat.cycles);
      if (total != null) el.textContent = vnd(total);
    });
    each('[data-per-month]', function (el) {
      var p = plans[el.getAttribute('data-plan')];
      var months = Number(el.getAttribute('data-months'));
      var total = p && net(p, months, cat.cycles);
      if (total != null) el.textContent = vnd(Math.round(total / months));
    });
    each('[data-discount]', function (el) {
      var months = Number(el.getAttribute('data-months'));
      var c = cat.cycles.find(function (x) { return x.months === months; });
      if (c) el.textContent = c.discountPercent ? c.discountPercent + '%' : '0%';
    });
    each('[data-limit]', function (el) {
      var p = plans[el.getAttribute('data-plan')];
      if (!p) return;
      var v = p.limits[el.getAttribute('data-limit')];
      el.textContent = v == null ? 'Không giới hạn' : fmt.format(v);
    });
    each('[data-has]', function (el) {
      var p = plans[el.getAttribute('data-plan')];
      if (!p) return;
      var has = p.features.indexOf(el.getAttribute('data-feature')) !== -1;
      el.setAttribute('data-has', has ? '1' : '0');
      el.className = (el.className.replace(/\b(yes|no)\b/g, '').trim() + (has ? ' yes' : ' no')).trim();
      el.textContent = has ? '✓' : '–';
      var sr = document.createElement('span');
      sr.className = 'sr';
      sr.textContent = has ? ' Có' : ' Không';
      el.appendChild(sr);
    });
    if (cat.trialDays) each('[data-trial-days]', function (el) { el.textContent = String(cat.trialDays); });
    var names = (cat.paymentProviders || []).map(function (id) { return PROVIDER_NAMES[id]; }).filter(Boolean);
    if (names.length) each('[data-providers]', function (el) { el.textContent = names.join(' hoặc '); });

    setupCyclePicker(cat, plans);
  }

  function setupCyclePicker(cat, plans) {
    var pick = document.querySelector('[data-cycle-pick]');
    if (!pick || !cat.cycles.length) return;
    var buttons = [];
    function select(months) {
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.value) === months)); });
      var cycle = cat.cycles.find(function (c) { return c.months === months; });
      each('[data-cycle-total]', function (el) {
        var p = plans[el.getAttribute('data-plan')];
        if (!p || !cycle) return;
        if (months === 1) { el.textContent = 'Thanh toán hàng tháng'; return; }
        var total = net(p, months, cat.cycles);
        el.textContent = 'Trả trước ' + months + ' tháng: ' + vnd(total) +
          (cycle.discountPercent ? ' (giảm ' + cycle.discountPercent + '%)' : '') +
          ' – tương đương ' + vnd(Math.round(total / months)) + '/tháng';
      });
    }
    cat.cycles.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.value = String(c.months);
      b.textContent = c.months + ' tháng' + (c.discountPercent ? ' (−' + c.discountPercent + '%)' : '');
      b.addEventListener('click', function () { select(c.months); });
      buttons.push(b);
      pick.appendChild(b);
    });
    pick.hidden = false;
    select(cat.cycles[0].months);
  }

  /* Shows the VAT treatment the server actually applies (SAAS_VAT_RATE). */
  function hydrateVat(cat) {
    var el = document.querySelector('[data-vat-note]');
    if (!el || !cat.plans.length) return;
    fetch('/api/plans/' + encodeURIComponent(cat.plans[0].id) + '/quote?months=1')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (q) {
        if (q && typeof q.vatRate === 'number') {
          el.textContent = 'Giá niêm yết chưa gồm thuế GTGT. Thuế GTGT ' + q.vatRate + '% được cộng vào số tiền thanh toán và hiển thị trước khi bạn thanh toán.';
        }
      })
      .catch(function () {});
  }

  if (document.querySelector('[data-pricing]')) {
    fetch('/api/plans')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cat) {
        if (!cat || !Array.isArray(cat.plans) || !Array.isArray(cat.cycles)) return;
        hydratePricing(cat);
        hydrateVat(cat);
      })
      .catch(function () { /* keep the static prices */ });
  }
})();
