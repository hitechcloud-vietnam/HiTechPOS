/* Recovery stays navigable, even when the server cannot answer. */
(function () {
  "use strict";
  const at=id=>document.getElementById(id), t=text=>window.I18N?.t(text)||text;
  let flight, confirmed=false, routeRevision=0;
  function back() {
    const guide=at('help-gestures');
    if(guide?.open){guide.open=false;guide.querySelector('summary').focus();return;}
    location.href='me.html';
  }
  function paint() {
    at('help-route').textContent=t(POSNIC.server.isLocal?'Wi-Fi':'Internet server');
    at('help-address').textContent=POSNIC.server.baseUrl || '';
    at('help-status').textContent=t(flight?'Checking':POSNIC.session.needsReconnect?'Reconnect required':(!confirmed || POSNIC.net.offline)?'Not connected':POSNIC.server.isLocal?'Connected in the shop':'Connected over the internet');
  }
  function retry() {
    if(flight)return flight;
    const revision=++routeRevision;
    let timer;
    at('help-retry').disabled=true;
    // A suspended native/network request must not leave recovery disabled.
    // Each retry owns its result; a timed-out attempt cannot repaint a newer one.
    const work=Promise.resolve().then(async()=>{
      await POSNIC.session.ready;
      if(revision!==routeRevision)return false;
      if(POSNIC.session.needsReconnect) await POSNIC.session.retryAccess();
      if(revision!==routeRevision)return false;
      return POSNIC.server.isConfigured && await POSNIC.net.check(true) === true;
    });
    flight=Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),20000);})])
      .then(reachable=>{if(revision===routeRevision)confirmed=reachable;})
      .catch(()=>{if(revision===routeRevision)confirmed=false;})
      .finally(()=>{clearTimeout(timer);if(revision===routeRevision){routeRevision++;flight=null;at('help-retry').disabled=false;paint();}});
    paint();return flight;
  }
  document.addEventListener('DOMContentLoaded',()=>{
    at('help-back').onclick=back;
    at('help-retry').onclick=retry;
    at('help-server').onclick=()=>{sessionStorage.setItem('posnic_change_server','1');sessionStorage.setItem('posnic_connection_view','settings');location.href='index.html';};
    at('help-pending').onclick=()=>sessionStorage.setItem('captain_pending_return','help.html');
    const build=window.POSNIC_BUILD;
    at('help-version').textContent=build?.version?'Captain '+build.version+(build.commit?' ('+build.commit+')':''):'Captain dev build';
    MobileGestures.setRefresh(retry);
    void retry();
    window.addEventListener('posnic:offline',paint);window.addEventListener('posnic:online',()=>{confirmed=true;paint();});window.addEventListener('posnic:server-changed',()=>{routeRevision++;confirmed=false;flight=null;at('help-retry').disabled=false;paint();});
  });
  window.addEventListener('captain:back',event=>{if(event.defaultPrevented || document.querySelector('dialog[open], #posnic-lock.is-open'))return;event.preventDefault();back();});
})();
