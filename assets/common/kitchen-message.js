(function (win) {
  "use strict";
  const t = (s) => win.I18N?.t(s) || s,
    el = (id) => document.getElementById(id);
  let owner,
    key,
    draft,
    recorder,
    busy = false,
    refreshing = null,
    leaving = false,
    sending = false;
  let hold=null, suppressRecordClick=false;
  const identity = () =>
    JSON.stringify([
      win.POSNIC.session.shopKey,
      win.POSNIC.session.user?.id,
      localStorage.getItem("branch_id"),
    ]);
  function check() {
    if (identity() !== owner) throw Error(t("Sign in with your account"));
  }
  const api = async (action, body = {}) => {
    check();
    const result = await win.POSNIC.api.post(
      "/captain/v1/kitchen-audio/" + action,
      body,
      { timeout: 15000 },
    );
    check();
    return result;
  };
  function save(value = draft) {
    check();
    localStorage.setItem(key, JSON.stringify(value));
  }
  function error(e) {
    el("voice-error").textContent = [
      "NotAllowedError",
      "NotFoundError",
      "NotReadableError",
    ].includes(e?.name)
      ? t("Microphone unavailable. Check app permissions.")
      : e?.message || t("Could not save. Please try again.");
  }
  const icons = {
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    send: '<path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  function button(id, icon, label) {
    const node = el(id);
    node.setAttribute("aria-label", t(label));
    node.title = t(label);
    if (node.dataset.icon !== icon) {
      node.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[icon] + "</svg>";
      node.dataset.icon = icon;
    }
  }
  function render() {
    const recording = recorder?.state === "recording";
    const working =
      busy || sending || ["opening", "saving"].includes(recorder?.state);
    const duration = recorder?.elapsed() || draft?.duration || 0;
    button(
      "voice-record",
      recording ? "pause" : "mic",
      recording
        ? "Pause recording"
        : draft
          ? "Resume recording"
          : "Record voice note",
    );
    button(
      "voice-discard",
      draft?.sent ? "close" : "trash",
      draft?.sent ? "Close" : "Discard recording",
    );
    button("voice-send", "send", "Send to kitchen");
    const audio = el("voice-preview");
    button(
      "voice-play",
      audio.paused ? "play" : "pause",
      audio.paused ? "Play recording" : "Pause playback",
    );
    el("voice-record").hidden = !!draft?.sent;
    el("voice-record").disabled =
      working || !!draft?.id || (!recording && duration >= 30000);
    el("voice-send").hidden = (!draft && !recording) || !!draft?.sent;
    el("voice-send").disabled = working;
    el("voice-discard").hidden = !draft && !recording;
    el("voice-discard").disabled = working;
    el("voice-play").hidden = !draft?.data || recording;
    el("voice-play").disabled = working;
    if (audio.getAttribute("src") !== (draft?.data || ""))
      audio.src = draft?.data || "";
    const seconds = Math.floor(
      (!audio.paused ? audio.currentTime * 1000 : duration) / 1000,
    );
    el("voice-duration").textContent =
      Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    el("voice-composer").dataset.recording = String(recording);
    el("voice-composer").dataset.hasRecording=String(!!draft || recording);
    const canvas = el("voice-wave"),
      ctx = canvas.getContext("2d"),
      peaks = recorder?.peaks?.length ? recorder.peaks : draft?.peaks || [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(canvas).color;
    for (let i = 0; i < 48; i++) {
      const height = Math.min(
        canvas.height,
        Math.max(3, (peaks[i] || 0.04) * canvas.height * 3),
      );
      ctx.fillRect(i * 5 + 1, (canvas.height - height) / 2, 3, height);
    }
    const status = t(
      recording
        ? hold?.cancel ? "Release to discard" : hold?.locked ? "Recording locked · Tap to pause" : hold?.active ? "Slide left to cancel · Slide up to lock" : "Recording…"
        : draft?.complete
          ? "Playback completed"
          : draft?.sent
            ? "Queued for playback"
            : draft
              ? "Voice note saved on this phone"
              : "Tap to record, then review and send.",
    );
    if (el("voice-status").textContent !== status) el("voice-status").textContent = status;
  }
  function stop() {
    return recorder?.pause() || Promise.resolve(true);
  }
  async function record() {
    if (busy || sending || leaving || draft?.id) return;
    el("voice-error").textContent = "";
    try {
      check();
      document.querySelectorAll('audio').forEach(audio=>audio.pause());
      if (recorder.state === "recording") await stop();
      else await recorder.start();
    } catch (e) {
      error(e);
    }
  }
  async function send() {
    if (busy || sending || draft?.sent) return;
    sending = true;
    render();
    const saved = await stop();
    if (saved === false || !draft) {
      sending = false;
      render();
      return;
    }
    el("voice-preview").pause();
    busy = true;
    el("voice-error").textContent = "";
    render();
    try {
      check();
      save();
      if(!draft.archiveId){draft.archiveId=crypto.randomUUID();save();}
      if(!draft.archived){
        const stored=await api('archive',{id:draft.archiveId,data:draft.data,duration:draft.duration});
        if(!stored?.stored)throw Error(t('Could not save. Please try again.'));
        draft.archived=true;draft.storage=stored.storage;save();
      }
      // Persist the session before uploading so an ambiguous response retries the same message.
      if (!draft.id) {
        const session = await api("start");
        if (!session?.id) throw Error(t("Could not save. Please try again."));
        draft.id = session.id;
        save();
      }
      const result = await api("voice", { id: draft.id, data: draft.data });
      if (result?.id !== draft.id || !result.queued)
        throw Error(t("Could not save. Please try again."));
      draft.sent = true;
      save();
      await refresh();
    } catch (e) {
      error(e);
      if(draft?.archived){await refresh();el('voice-error').textContent=t('Recording saved. Kitchen delivery is not confirmed. Reconnect to the kitchen and retry.');}
    } finally {
      busy = false;
      sending = false;
      render();
    }
  }
  function historyPlayer(job) {
    const row=document.createElement('article');row.className='voice-history-item';
    const label=document.createElement('p');label.className='voice-message-time';label.textContent=new Date(job.created).toLocaleString();
    const track=document.createElement('div');track.className='voice-track';
    const play=document.createElement('button');play.type='button';play.className='voice-history-play';
    const audio=document.createElement('audio');audio.hidden=true;audio.preload='none';
    const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='100';seek.value='0';seek.setAttribute('aria-label',t('Playback position'));
    const time=document.createElement('span');time.className='voice-message-time';
    const draw=()=>{play.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[audio.paused?'play':'pause']+'</svg>';play.setAttribute('aria-label',t(audio.paused?'Play recording':'Pause playback'));const seconds=Math.floor(audio.currentTime || job.duration/1000 || 0);time.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(Number.isFinite(audio.duration))seek.value=String(audio.currentTime/audio.duration*100);};
    play.onclick=async()=>{try{check();if(busy||sending)return;if(await stop()===false)return;if(!audio.paused){audio.pause();return;}play.disabled=true;if(!audio.src){const result=await api('playback',{id:job.id});if(!/^data:audio\//.test(result.data||''))throw Error(t('Recording unavailable'));audio.src=result.data;}document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause();});await audio.play();}catch(e){error(e);}finally{play.disabled=false;draw();}};
    seek.oninput=()=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(seek.value)/100;};
    for(const name of ['play','pause','ended','timeupdate'])audio.addEventListener(name,draw);
    track.append(play,seek,time,audio);row.append(track,label);draw();return row;
  }
  function refresh() {
    if(refreshing)return refreshing;
    el('voice-refresh').disabled=true;
    refreshing=(async()=>{
      try{
        const [history,status]=await Promise.allSettled([api('recordings'),api('status')]);
        const host=el('voice-history');
        if(history.status==='fulfilled'){
          const jobs=history.value.recordings||[],signature=JSON.stringify(jobs);
          if(host.dataset.signature!==signature){host.querySelectorAll('audio').forEach(a=>a.pause());host.replaceChildren(...jobs.map(historyPlayer));host.dataset.signature=signature;}
          if(!jobs.length && !host.children.length){const empty=document.createElement('p');empty.textContent=t('Sent recordings will appear here for replay.');host.append(empty);}
        }else if(status.status==='fulfilled'){
          host.replaceChildren();
          for(const job of status.value.jobs||[]){const row=document.createElement('div');row.className='voice-history-item';row.textContent=t(job.complete?'Playback completed':'Queued for playback');for(const target of job.targets||[]){const p=document.createElement('p');p.textContent=target.label+' · '+t(target.status);row.append(p);}host.append(row);}
        }
        if(status.status==='fulfilled'){
          if(draft?.sent && status.value.jobs?.some(job=>job.id===draft.id&&job.complete)){draft.complete=true;save();render();}
          el('voice-error').textContent='';
        }else if(history.status==='fulfilled')el('voice-error').textContent=t('Recordings are available. Connect to the kitchen POS to broadcast a message.');
        else error(status.reason);
        return history.status==='fulfilled'||status.status==='fulfilled';
      }catch(e){error(e);return false;}
      finally{refreshing=null;el('voice-refresh').disabled=false;}
    })();return refreshing;
  }
  async function back(event) {
    event?.preventDefault();
    event?.stopImmediatePropagation();
    if (busy || sending || leaving) return;
    leaving = true;
    // Finish saving a recording before navigation; returning restores this staff member's draft.
    const saved = await stop();
    if (saved === false) {
      leaving = false;
      return;
    }
    try {
      if (draft) save();
    } catch (e) {
      error(e);
      leaving = false;
      return;
    }
    win.location.assign("kot-management.html");
  }
  async function init() {
    try {
      await win.POSNIC.session.whenReady?.();
      if (
        !win.POSNIC.session.user?.id ||
        !win.POSNIC.session.shopKey ||
        !localStorage.getItem("branch_id")
      )
        throw Error(t("Sign in with your account"));
      owner = identity();
      key = "posnic.kitchen-voice:" + owner;
      draft = JSON.parse(localStorage.getItem(key) || "null");
      recorder = new win.CaptainVoiceRecorder({
        initial: draft,
        saved: async (value) => {
          check();
          const next = { ...value, created: draft?.created || Date.now() };
          save(next);
          draft = next;
        },
        changed: render,
        error,
      });
      render();
      el("voice-play").onclick = async () => {
        const audio = el("voice-preview");
        try {
          if (audio.paused) await audio.play();
          else audio.pause();
        } catch {
          error(Error(t("Recording failed. Please record again.")));
        }
        render();
      };
      for (const event of ["play", "pause", "ended", "timeupdate"])
        el("voice-preview").addEventListener(event, render);
      const recordButton=el('voice-record');
      recordButton.onclick=()=>{if(suppressRecordClick){suppressRecordClick=false;return;}void record();};
      recordButton.onpointerdown=event=>{
        if(event.button!==0 || recordButton.disabled)return;
        suppressRecordClick=false;
        if(recorder.state==='recording')return;
        const gesture={x:event.clientX,y:event.clientY,active:false,cancel:false,locked:false};hold=gesture;
        recordButton.setPointerCapture?.(event.pointerId);
        gesture.timer=setTimeout(()=>{gesture.active=true;gesture.start=record();},220);
      };
      recordButton.onpointermove=event=>{
        if(!hold?.active)return;
        hold.cancel=event.clientX-hold.x < -65;
        if(hold.y-event.clientY>65){hold.locked=true;hold.cancel=false;}
        render();
      };
      const release=async event=>{
        const gesture=hold;if(!gesture)return;clearTimeout(gesture.timer);
        if(!gesture.active){hold=null;return;}
        suppressRecordClick=true;
        await gesture.start;
        if(!gesture.locked || event.type==='pointercancel'){
          if(gesture.cancel && event.type!=='pointercancel'){
            try{check();await recorder.discard();localStorage.removeItem(key);draft=null;}catch(e){error(e);}
          }else await stop();
        }
        hold=null;render();
      };
      recordButton.onpointerup=release;recordButton.onpointercancel=release;
      el("voice-send").onclick = send;
      if (!win.MobileGestures) el("voice-refresh").onclick = refresh;
      win.MobileGestures?.setRefresh(refresh);
      document.querySelector(".me-back").onclick = back;
      win.addEventListener("captain:back", back, true);
      el("voice-discard").onclick = async () => {
        if (busy || sending) return;
        try {
          check();
          el("voice-preview").pause();
          await recorder.discard();
          localStorage.removeItem(key);
          draft = null;
          render();
        } catch (e) {
          error(e);
        }
      };
      await refresh();
    } catch (e) {
      error(e);
      el("voice-record").disabled = true;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  win.addEventListener("pagehide", stop);
  init();
})(window);
