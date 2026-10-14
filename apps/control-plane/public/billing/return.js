'use strict';
/* Landing page for the gateway's returnUrl. Activation happens on the
   webhook, so this page only shows the order code and sends the owner back
   to /account, which shows the subscription and payment history. */
(function () {
  var code = new URLSearchParams(location.search).get('orderCode');
  if (code && /^\d{1,20}$/.test(code)) {
    document.getElementById('order').textContent = 'Mã giao dịch: ' + code;
  }
  setTimeout(function () { location.href = '/account'; }, 5000);
})();
