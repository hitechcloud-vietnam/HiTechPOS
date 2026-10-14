(function () {
  'use strict';
  function back() {
    // Never return to the rejected receipt page or trust a cross-origin referrer.
    let destination = 'kot-management.html';
    try {
      const previous = new URL(document.referrer);
      const allowed = ['kot-management.html', 'products.html', 'cart.html', 'order-history.html', 'me.html', 'my-sales.html', 'pending.html'];
      if (previous.origin === location.origin && allowed.includes(previous.pathname.split('/').pop()))
        destination = previous.href;
    } catch {}
    location.href = destination;
  }
  document.querySelectorAll('[data-permission-back]').forEach(button => button.addEventListener('click', back));
  window.addEventListener('captain:back', event => { event.preventDefault(); back(); });
})();
