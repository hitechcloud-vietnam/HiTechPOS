/* Item text follows the existing app language; stored IDs and names stay canonical. */
(function (host) {
  'use strict';
  host.ItemLanguage = {
    name(item) { return host.PosnicItemText.name(item, host.I18N?.language() || ''); }
  };
  host.addEventListener('posnic:language-changed', () => {
    // Re-read the offline catalogue/cart, without submitting an order or changing quantities.
    if (document.getElementById('product-list') && typeof host.loadProducts === 'function') host.loadProducts();
    if (document.getElementById('cart-summary') && typeof host.renderCart === 'function') host.renderCart(null, true);
  });
})(window);

