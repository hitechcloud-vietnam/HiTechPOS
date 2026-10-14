/*
 * Turning speech into text, from whichever provider a shop has chosen.
 *
 * WHERE THE KEY LIVES IS THE WHOLE DESIGN.
 *
 * A paid transcription key put into the app is a key on every waiter's phone,
 * in a file anybody can read, on devices that get lost and sold. It cannot be
 * rotated without reinstalling every handset, and one leaked key is billed to
 * the shop until somebody notices. So a key is never held here. A shop that
 * wants a cloud provider configures it once on the till, and the till does the
 * call: the audio goes to the shop's own server and the key stays on it.
 *
 * That leaves two kinds of provider, and they are chosen for different
 * reasons rather than one being better:
 *
 *   device   the phone's own recognition - Android's SpeechRecognizer, iOS's
 *            SFSpeechRecognizer, the Web Speech API in a browser. Free,
 *            private, needs no key, and on both phone platforms can work with
 *            the internet down once a language pack is installed. Weaker on
 *            proper nouns, which is most of a menu - though matching against
 *            the shop's own items recovers much of that (see voice-order.js).
 *
 *            NOT the Web Speech API on a phone. Chrome has it; the WebView an
 *            app is built on does not, on either platform. Relying on it means
 *            a feature that works at a desk and is invisible on every handset
 *            it was written for.
 *
 *   server   the shop's POS relays the audio to whichever provider it is
 *            configured for. Better with accents and noise, costs money per
 *            minute, needs the shop online, and is the only arrangement in
 *            which a key is not sitting in a waiter's pocket.
 *
 * Configuration is read in the order it should win: what this device was told
 * explicitly, then what the shop's server says, then the device's own
 * recogniser. A shop that has configured nothing gets something that works.
 *
 * HELD, NOT TIMED. The waiter presses, speaks for as long as they are
 * speaking, and lets go - the way every voice note anybody has ever sent
 * works. A fixed recording length is the wrong shape for an order: it cuts
 * off the table that wanted one more thing, and it makes the quick "two
 * coffees" wait out a timer for nothing. So a session is begun and ended by a
 * person, and both providers are driven through the same three calls.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Speech = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const STORE = 'posnic.voice';
  /*
   * What the SHOP decided, saved when the menu was last loaded.
   *
   * Its own key, separate from this device's own settings, because they are
   * different decisions with a deliberate precedence: a handset with a broken
   * microphone can be switched off without touching the shop, and a shop that
   * moves to a paid provider does not have to visit every phone.
   *
   * Read from storage rather than passed in, so every page gets the shop's
   * answer without each one having to remember to fetch it - and so a handset
   * that has gone offline since the last menu load still honours it.
   */
  const SHOP_STORE = 'posnic.voice.shop';

  const DEFAULTS = {
    provider: 'device',
    /* Indian English by default because that is the estate this serves, and a
       recogniser told the wrong locale mishears numbers before anything
       else. Overridden per shop. */
    language: 'en-IN',
  };

  /* A held button still needs an outer limit. Past this something is wrong -
     a phone in a pocket, a thumb resting on the screen - and a provider
     billed by the minute should not be paid for it. Generous, because a long
     table really does take half a minute to order. */
  const MAX_SECONDS = 45;

  /**
   * What this device should use.
   *
   * @param {object} [fromServer] voice settings the shop's server sent
   */
  function config(fromServer) {
    let local = {};
    let stored = {};
    try {
      local = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    } catch (e) {
      local = {};
    }
    try {
      stored = JSON.parse(localStorage.getItem(SHOP_STORE) || '{}') || {};
    } catch (e) {
      stored = {};
    }
    /* What was passed in beats what was last saved, so a caller holding a
       fresher answer is not overruled by yesterday's. */
    const fromShop = { ...stored, ...(fromServer || {}) };
    /* A key must never arrive here, whatever a server sends. Dropped rather
       than trusted, so a misconfigured server cannot put one on a handset. */
    const shop = { ...fromShop };
    delete shop.apiKey;
    delete shop.api_key;
    delete shop.secret;
    /* Nor may a server name its vendor here. The handset is told where the
       audio goes; which company transcribes it is the till's business, and a
       phone that knew would eventually be asked to hold the key for it. */
    delete shop.vendor;
    delete shop.voice_provider;

    return { ...DEFAULTS, ...shop, ...local };
  }

  function configure(patch) {
    const next = { ...config(), ...(patch || {}) };
    delete next.apiKey;
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch (e) {
      /* private mode: this session still honours it */
    }
    return next;
  }

  /** The browser or WebView's own recogniser, if it has one. */
  function deviceRecogniser() {
    return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
  }

  /**
   * The handset's OWN recogniser, reached the way a packaged app has to.
   *
   * THE WEB SPEECH API IS NOT IN A WEBVIEW. Chrome has it; the Android System
   * WebView an app is built on does not, and neither does WKWebView on iOS. So
   * the browser check above answers NO on exactly the two platforms this app
   * ships to, the mic button is never drawn, and the feature that works
   * perfectly at a desk is invisible on every phone it was written for. Worse
   * is the half-supported device, where the call is accepted and the promise
   * simply never settles - a button held down for ever with nothing happening.
   *
   * So on a phone the recognition is native: Android's SpeechRecognizer and
   * iOS's SFSpeechRecognizer, through the Capacitor plugin. Free, no key, no
   * account, and on both platforms it can work with the internet down once a
   * language pack is installed - which is the whole reason a shop would choose
   * the handset over a paid provider.
   *
   * Reached through the global bridge rather than an import, because these
   * files are classic scripts the page loads directly. Both doors are tried:
   * `Capacitor.Plugins` is populated from the native bridge's plugin headers,
   * and `registerPlugin` is the documented way in when it is not.
   */
  function nativeRecogniser() {
    const cap = globalThis.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) {
      return null;
    }
    if (cap.Plugins && cap.Plugins.SpeechRecognition) return cap.Plugins.SpeechRecognition;
    if (typeof cap.registerPlugin === 'function') {
      try {
        return cap.registerPlugin('SpeechRecognition');
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  const canRecord = () =>
    !!(globalThis.navigator && navigator.mediaDevices && globalThis.MediaRecorder);

  /**
   * Can this device transcribe at all, and how?
   *
   * ASYNC, because the native recogniser has to be asked. A handset can have
   * the plugin and still have no recogniser behind it - a stripped Android
   * build with no Google app, most often - and the honest answer needs that
   * round trip. Asked rather than assumed, so the mic button is absent where
   * it cannot work instead of present and disappointing.
   *
   * Never throws. A screen has to be able to ask this without a guard.
   */
  async function available(fromServer) {
    const chosen = config(fromServer).provider;
    if (chosen === 'off') return false;
    if (chosen === 'server') return canRecord(); // the till answers for itself

    const plugin = nativeRecogniser();
    if (plugin) {
      try {
        const answer = await plugin.available();
        return !!(answer && answer.available);
      } catch (e) {
        return false;
      }
    }
    return !!deviceRecogniser();
  }

  /*
   * A SESSION is what a held button drives.
   *
   * Three calls, the same for both providers: begun on press, `stop()` on
   * release to get the words, `cancel()` to throw the whole thing away. The
   * caller never learns which provider is behind it, which is the point.
   *
   *   { stop(): Promise<string>, cancel(): void, seconds(): number }
   */

  /** The handset's own recogniser, held open until somebody lets go. */
  function beginOnDevice({ language, onPartial }) {
    const Recogniser = deviceRecogniser();
    if (!Recogniser) throw new Error('This device cannot listen.');

    const recogniser = new Recogniser();
    recogniser.lang = language || DEFAULTS.language;
    /* Interim results so the screen can show words arriving. Several seconds
       of silence while somebody talks reads as a dead button. */
    recogniser.interimResults = true;
    /* Held open across pauses. Without this the recogniser decides for itself
       that the breath between "two chicken biryani" and "and three coffee" is
       the end of the sentence, and half the order is never heard. */
    recogniser.continuous = true;
    recogniser.maxAlternatives = 1;

    let best = '';
    let done = null;
    let failed = null;
    let finished = false;
    let cancelled = false;

    recogniser.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) text += `${event.results[i][0].transcript} `;
      best = text.trim();
      if (onPartial) onPartial(best);
    };
    recogniser.onerror = (event) => {
      const code = event && event.error;
      /* Not an error while somebody is still holding the button: they have
         simply not started talking yet. Only a refusal ends the session. */
      if (code === 'no-speech' || code === 'aborted') return;
      failed = new Error(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'The microphone is blocked for this app. Allow it in Settings.'
          : 'Could not listen just now.'
      );
      if (done) done();
    };
    recogniser.onend = () => {
      finished = true;
      if (done) done();
    };

    try {
      recogniser.start();
    } catch (e) {
      throw new Error('Could not start listening.');
    }

    const startedAt = Date.now();

    return {
      seconds: () => (Date.now() - startedAt) / 1000,
      cancel() {
        cancelled = true;
        try {
          if (recogniser.abort) recogniser.abort();
          else recogniser.stop();
        } catch (e) {
          /* already stopped */
        }
      },
      stop() {
        return new Promise((resolve, reject) => {
          const settle = () => {
            done = null;
            if (failed) return reject(failed);
            resolve(cancelled ? '' : best);
          };
          if (finished) return settle();
          done = settle;
          try {
            recogniser.stop();
          } catch (e) {
            settle();
          }
          /* A recogniser that never fires onend must not hang the button
             with a waiter standing at a table waiting for it. */
          setTimeout(() => {
            if (done) settle();
          }, 4000);
        });
      },
    };
  }

  /**
   * The phone's own recogniser, held open until somebody lets go.
   *
   * Same three calls as every other session. The permission is asked for here
   * rather than at launch, because a waiter who never presses the microphone
   * should never be asked for one - and a prompt that arrives with no context
   * is the one people refuse.
   */
  /**
   * Never let a promise from the bridge hold the screen.
   *
   * Every call below goes through here. A plugin call that never settles is
   * not a hypothetical: Android's recogniser ends itself on a silence, and
   * stop() on an already-stopped recogniser is exactly the call that hangs.
   * The browser path has had a settle timeout since it was written; this one
   * had none, which is why the Stop button could do nothing at all.
   */
  function within(promise, ms, fallback) {
    return Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  function beginOnNative(plugin, { language, onPartial }) {
    const startedAt = Date.now();
    /*
     * WHAT HAS BEEN SAID, IN TWO PARTS.
     *
     * `settled` is every utterance the recogniser has already finished with;
     * `partial` is the one it is in the middle of. Android hands back partials
     * as a WHOLE SENTENCE replacing the last, so they cannot be appended - but
     * across a restart they start again from nothing, and appending is then
     * exactly what is needed. Keeping the two apart is what makes a pause
     * survivable.
     */
    let settled = '';
    let partial = '';
    let handle = null;
    let stateHandle = null;
    let cancelled = false;
    let stopping = false;
    let listening = false;
    let restarts = 0;

    /* A recogniser that ends the instant it starts would otherwise be
       restarted for ever. Ten is far more than a long order needs. */
    const MAX_RESTARTS = 10;

    const heard = () => (settled + ' ' + partial).replace(/\s+/g, ' ').trim();

    const open = () =>
      plugin.start({
        language: language || DEFAULTS.language,
        partialResults: true,
        popup: false,
        maxResults: 1,
      });

    /*
     * ANDROID STOPS LISTENING ON ITS OWN, AND NOBODY WAS TOLD.
     *
     * SpeechRecognizer ends after a pause in speech - that is its normal
     * behaviour, not a fault - and this session simply carried on believing it
     * was live. A waiter who said a few dishes, thought, and carried on found
     * the second half was never heard, and the panel showed the first half as
     * though nothing had happened.
     *
     * So the end of an utterance is the end of an UTTERANCE, not of the order.
     * What was heard is banked and the recogniser is opened again, until the
     * person says they are finished.
     */
    const resume = async () => {
      if (cancelled || stopping || !listening) return;
      if (restarts >= MAX_RESTARTS) return;
      if ((Date.now() - startedAt) / 1000 >= MAX_SECONDS) return;

      if (partial) {
        settled = (settled + ' ' + partial).trim();
        partial = '';
      }
      restarts += 1;
      try {
        await open();
      } catch (e) {
        /* It will not reopen. What was already said still counts. */
        listening = false;
      }
    };

    /*
     * Opening is asynchronous and the button is already down. The promise is
     * kept so stop() can WAIT for it rather than race it: a waiter who says
     * two words and releases would otherwise be stopping a recogniser that had
     * not started, and the order would be silence.
     */
    const opening = (async () => {
      const granted = await plugin.requestPermissions().catch(() => null);
      if (granted && granted.speechRecognition && granted.speechRecognition !== 'granted') {
        throw new Error('The microphone is blocked for this app. Allow it in Settings.');
      }
      if (cancelled) return;

      handle = await plugin.addListener('partialResults', (data) => {
        const said = (data && data.matches && data.matches[0]) || '';
        /* Partial results ARRIVE AS A WHOLE SENTENCE, replacing the last one,
           rather than as words to append. Appending them would give
           "two two chicken two chicken biryani". */
        if (said) {
          partial = said;
          if (onPartial) onPartial(heard());
        }
      });

      /* And the moment it gives up, so the pause in the middle of an order is
         a pause and not the end of it. Optional: a plugin that does not report
         its state leaves this null and behaves exactly as it did before. */
      try {
        stateHandle = await plugin.addListener('listeningState', (data) => {
          const state = (data && data.status) || '';
          if (state === 'stopped') resume();
        });
      } catch (e) {
        /* no state events on this plugin version */
      }

      /* popup:false because the order is read back on our own sheet. Android's
         own dialogue would cover the menu, take the gesture over, and give a
         waiter two different confirmations to read. */
      await open();
      listening = true;
    })();

    const release = async () => {
      stopping = true;
      /* Each of these is given its own budget rather than the caller's, so one
         that never comes back cannot take the others - or the screen - with
         it. */
      if (listening) await within(plugin.stop().catch(() => null), 1500, null);
      listening = false;
      for (const h of [handle, stateHandle]) {
        if (h && h.remove) await within(h.remove().catch(() => null), 800, null);
      }
      handle = null;
      stateHandle = null;
    };

    return {
      seconds: () => (Date.now() - startedAt) / 1000,
      cancel() {
        cancelled = true;
        release();
      },
      async stop() {
        /*
         * Opening is waited for, but not for ever: a bridge that never answers
         * must not leave a waiter holding a dead screen.
         *
         * A REAL REFUSAL STILL HAS TO GET OUT. "The microphone is blocked for
         * this app" is the one message here that tells somebody what to go and
         * do, so it is caught, the recogniser is released either way, and then
         * it is re-thrown. Racing it away would turn a fixable permission into
         * a silent empty order.
         */
        let refused = null;
        await Promise.race([
          Promise.resolve(opening).catch((e) => {
            refused = e;
          }),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
        await release();
        if (refused) throw refused;
        return cancelled ? '' : heard();
      },
    };
  }

  /**
   * Record until released, then let the shop's own server transcribe it.
   *
   * One call to the POS. The provider and its key live there; this never
   * learns which was used, which is the point.
   */
  function beginOnServer({ language, onLevel }) {
    if (!canRecord()) throw new Error('This device cannot record.');

    const startedAt = Date.now();
    let recorder = null;
    let stream = null;
    let cancelled = false;
    const chunks = [];

    /*
     * Opening the microphone is asynchronous and the button is already down.
     * The promise is kept so stop() can WAIT for it rather than race it: a
     * waiter who says two words and releases would otherwise be stopping a
     * recorder that had not started, and the order would be silence.
     */
    const opening = navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((granted) => {
        stream = granted;
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return null;
        }
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.start();
        if (onLevel) meter(stream, onLevel, () => cancelled || !recorder);
        return recorder;
      })
      .catch(() => {
        throw new Error('The microphone is blocked for this app. Allow it in Settings.');
      });

    const release = () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };

    return {
      seconds: () => (Date.now() - startedAt) / 1000,
      cancel() {
        cancelled = true;
        try {
          if (recorder && recorder.state !== 'inactive') recorder.stop();
        } catch (e) {
          /* already stopped */
        }
        release();
      },
      async stop() {
        await opening;
        if (cancelled || !recorder) {
          release();
          return '';
        }

        const blob = await new Promise((resolve) => {
          recorder.onstop = () =>
            resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
          try {
            if (recorder.state !== 'inactive') recorder.stop();
            else recorder.onstop();
          } catch (e) {
            resolve(new Blob(chunks, { type: 'audio/webm' }));
          }
        });
        release();
        if (!blob.size) return '';

        const audio = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('Could not read the recording.'));
          reader.readAsDataURL(blob);
        });

        if (typeof POSNIC === 'undefined' || !POSNIC.api) {
          throw new Error('No server to transcribe with.');
        }
        const result = await POSNIC.api.post('/sales/transcribe', {
          audio,
          language,
          mimeType: blob.type,
        });
        return String((result && (result.text || (result.data && result.data.text))) || '').trim();
      },
    };
  }

  /**
   * How loud it is right now, for a bar that proves the microphone is live.
   *
   * A recording screen that does not move is one a waiter presses again
   * halfway through, losing the first half of the order.
   */
  function meter(stream, onLevel, stopped) {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    try {
      const context = new Ctx();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (stopped()) {
          try {
            context.close();
          } catch (e) {
            /* already closed */
          }
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += (data[i] - 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / data.length) / 40));
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      /* a level bar is a nicety; its absence must not stop a recording */
    }
  }

  /**
   * Begin listening. The caller decides when it ends.
   *
   * @param {object} options
   * @param {(text: string) => void} [options.onPartial] words as they arrive
   * @param {(level: number) => void} [options.onLevel] 0..1 loudness
   * @returns {{stop: () => Promise<string>, cancel: () => void, seconds: () => number}}
   */
  function start(options = {}) {
    const settings = config(options.fromServer);
    if (settings.provider === 'off') throw new Error('Voice ordering is turned off for this shop.');
    const shared = { language: settings.language, ...options };
    if (settings.provider === 'server') return beginOnServer(shared);

    /* On a phone the recogniser is native; in a browser it is the Web Speech
       API. Neither is a fallback for a failure of the other - they are the
       same feature on two platforms, and only one of them exists at a time. */
    const plugin = nativeRecogniser();
    return plugin ? beginOnNative(plugin, shared) : beginOnDevice(shared);
  }

  /**
   * Listen for a fixed stretch and resolve with what was said.
   *
   * Kept for a caller with nothing to hold - a hands-free screen, a test. The
   * handset's button uses start() instead, because a person deciding they
   * have finished speaking beats any timer.
   */
  async function listen(options = {}) {
    const session = start(options);
    await new Promise((resolve) => {
      setTimeout(resolve, (options.seconds || 8) * 1000);
    });
    return session.stop();
  }

  return {
    DEFAULTS,
    STORE,
    SHOP_STORE,
    MAX_SECONDS,
    config,
    configure,
    available,
    start,
    listen,
    deviceRecogniser,
    nativeRecogniser,
    canRecord,
  };
});
