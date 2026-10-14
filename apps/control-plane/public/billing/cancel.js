'use strict';
/* Landing page for the gateway's cancelUrl: nothing was paid. Show the
   order code and send the owner back to /account to pick a plan again. */
(function () {
  var code = new URLSearchParams(location.search).get('orderCode');
  if (code && /^\d{1,20}$/.test(code)) {
    document.getElementById('order').textContent = 'Mã giao dịch: ' + code;
  }
  setTimeout(function () { location.href = '/account'; }, 8000);
})();
