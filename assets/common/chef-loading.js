(function () {
  'use strict';
  const variants = ['hat', 'steam', 'stir'];
  const selector = '#page-loader > .loader, #loader > .spinner-border, .section-loader > .spinner-border, .floor-loading, [data-chef-loading]';
  function decorate(host) {
    if (host.querySelector('.chef-loading-art')) return;
    const variant = variants[Math.floor(Math.random() * variants.length)];
    const art = document.createElement('span');
    art.className = 'chef-loading-art chef-loading-' + variant;
    art.setAttribute('aria-hidden', 'true');
    const hat = '<path d="M8 14a5 5 0 0 1-1-10 6 6 0 0 1 10 0 5 5 0 0 1-1 10v6H8Zm0 3h8"/>';
    const pot = '<path d="M5 10h14v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Zm-3 2h3m14 0h3M4 8h16"/>';
    art.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + (variant === 'hat' ? hat : pot) + '</svg>' +
      (variant === 'hat' ? '<span class="chef-loading-shadow"></span>' : variant === 'steam' ? '<span class="chef-loading-steam"><b></b><b></b><b></b></span>' : '<span class="chef-loading-spoon"></span>');
    host.classList.add('chef-loading-host');
    if (host.matches('.loader, .spinner-border')) {
      host.setAttribute('role', 'status');
      host.setAttribute('aria-label', window.I18N?.t('Loading...') || 'Loading...');
    }
    host.prepend(art);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(selector)) decorate(node);
    node.querySelectorAll(selector).forEach(decorate);
  }
  function start() {
    scan(document.documentElement);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan)))
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
