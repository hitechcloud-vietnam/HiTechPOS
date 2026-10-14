/*
 * The app's connection to its shop: which server, which session, one client.
 *
 * A waiter's phone lives in two worlds during one shift. Inside the shop it is
 * on the same Wi-Fi as the till, which answers in single-digit milliseconds
 * whether or not the shop's internet is up. Step into the car park and that
 * address is gone, while the same shop is still reachable at its cloud
 * address. So the server is chosen, not configured once by hand:
 *
 *   1. an address someone pinned - an explicit choice always wins
 *   2. the shop's own server on this Wi-Fi
 *   3. the shop's cloud address, https://<code>.posnic.io/api
 *
 * and the choice is re-made whenever the active one stops answering.
 *
 * Everything reachable from here hangs off one global, POSNIC. Nothing else in
 * the app builds a URL, attaches a credential, or decides what a failure
 * means: it calls POSNIC.api and handles an ApiError. That is the whole reason
 * this file exists as one unit rather than a helper each screen reimplements.
 *
 * The safety rule behind automatic switching: the app only moves itself onto a
 * server it has PROVED holds the same shop. Signing in records a shop key - a
 * hash of the tenant licence, identical on the till and in its synced cloud
 * copy - against the address it came from. A server whose recorded key does
 * not match is offered to the user and never chosen silently. Two Posnic tills
 * on one industrial estate's Wi-Fi is not hypothetical.
 */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- config */

  const CLOUD_SUFFIX = '.posnic.io';
  const API_PATH = '/api';
  const LAN_PORT = 5555;

  const REQUEST_TIMEOUT_MS = 10000;

  /*
   * A LAN REQUEST GETS A LAN DEADLINE.
   *
   * Owner: "is there any way to smart switch between lan and internet between
   * communication."
   *
   * The switch itself has always worked. What made it feel like it did not is
   * how long the app waited before deciding: a till on the shop Wi-Fi answers
   * in under ten milliseconds, and it was given TEN SECONDS before being
   * called dead. So the first tap after a router reboot - or after a waiter
   * walks out of range mid-order - froze for ten seconds, and a waiter
   * concludes the app is broken long before that.
   *
   * Two and a half seconds is still two hundred and fifty times a healthy
   * round trip, and it is the same figure the address probe already uses, so
   * this is not a new guess about the network. The cloud keeps the long
   * deadline: it is a real journey over a phone's mobile data, and cutting it
   * short would fail requests that were going to succeed.
   */
  const LAN_REQUEST_TIMEOUT_MS = 2500;
  const PROBE_TIMEOUT_MS = 2500;
  /* A LAN round trip is under 10ms. A host silent for this long is not there. */
  /*
   * Measured on a real network rather than guessed, sweeping four subnets
   * with nothing to find - the worst case, and the one a waiter waits through:
   *
   *   32 at a time, 900ms   7.3s
   *   48 at a time, 700ms   4.4s
   *   64 at a time, 500ms   2.2s
   *
   * A LAN round trip is under 10ms, so 500ms is already fifty times the
   * budget an answer needs; anything longer is only waiting on addresses with
   * nothing behind them. 64 is where a phone's connection pool starts being
   * the limit rather than the network.
   */
  const SCAN_TIMEOUT_MS = 500;
  const SCAN_CONCURRENCY = 64;

  /*
   * THE ADDRESSES A TILL IS ACTUALLY AT, tried before the other two hundred.
   *
   * A sweep of 2..254 already starts low, but it starts low on ONE subnet at a
   * time while every other subnet is doing the same - and a Windows machine
   * offers four of them. Two hundred and fifty requests per network, fired
   * together, saturate the connection pool: the 500ms timeout starts when
   * fetch is CALLED, not when the socket opens, so the later batches time out
   * having never left the queue. The search then takes tens of seconds and
   * looks like a hang, which is what it was reported as.
   *
   * So the likely addresses go first, across every subnet, as one small
   * bounded pass. A router hands out .2 upwards and a till given a static
   * address gets a round number, so this is where it nearly always is - and it
   * is 30 probes rather than 1,016.
   */
  const LIKELY_HOSTS = [
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    100, 101, 102, 150, 200, 201, 250, 254,
  ];

  /*
   * And a hard stop on the whole thing.
   *
   * Without one the sweep is bounded only by how long the slowest of a
   * thousand queued requests takes to give up, which on a busy network is not
   * bounded in any way a person would call bounded. Twenty seconds is longer
   * than a real find ever takes and short enough that somebody still believes
   * the screen.
   */
  const SEARCH_DEADLINE_MS = 20000;

  /* Ask whether the active server is still there: rarely while it answers,
     often while it does not, because that is the only time it can change. */
  const HEALTH_OK_MS = 20000;
  const HEALTH_DOWN_MS = 4000;

  const STORE_SERVER = 'posnic.server';
  const STORE_SESSION = 'posnic.session';

  /* --------------------------------------------------------------- storage */

  function load(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}') || {};
    } catch (e) {
      /* Corrupt or unreadable is the same as absent: the app re-derives
         everything it needs, and refusing to start would be worse. */
      return {};
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* Private mode. The app still works, it just forgets between launches. */
    }
  }

  /* ----------------------------------------------------------------- debug */

  const originalConsole = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
  };

  const debug = (function () {
    const KEY = 'posnic.debug';
    const onDevServer =
      !/Android/i.test(navigator.userAgent || '') &&
      (location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.port === '5173');

    let enabled = false;

    function apply(on) {
      enabled = !!on;
      console.log = on ? originalConsole.log : function () {};
      console.debug = on ? originalConsole.debug : function () {};
      console.info = on ? originalConsole.info : function () {};
    }

    let stored = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch (e) {
      stored = null;
    }
    apply(stored === '1' || (stored !== '0' && onDevServer));

    return {
      get enabled() {
        return enabled;
      },
      enable() {
        try {
          localStorage.setItem(KEY, '1');
        } catch (e) {
          /* nothing to remember it with; the session still gets logs */
        }
        apply(true);
        originalConsole.info('POSNIC debug logging enabled');
      },
      disable() {
        try {
          localStorage.setItem(KEY, '0');
        } catch (e) {
          /* as above */
        }
        apply(false);
      },
    };
  })();

  /* ---------------------------------------------------------------- errors */

  /**
   * Everything POSNIC.api throws.
   *
   * One type with a machine-readable `code`, so a caller can branch on the
   * reason instead of matching English against `error.message`. `offline`
   * means the request never reached a server, which is the case the UI has to
   * treat differently from any answer a server gave.
   */
  class ApiError extends Error {
    constructor(message, { status = 0, code = 'REQUEST_FAILED', body = null } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.body = body;
    }

    get offline() {
      return this.status === 0;
    }

    get unauthorized() {
      return this.status === 401;
    }
  }

  /* ---------------------------------------------------------------- server */

  /* A bare shop code: what the shop is called, and what its address is built
     from. Deliberately narrow, so anything with a dot, colon or slash is
     treated as an address the user typed in full and is left alone. */
  const SHOP_CODE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

  const isPrivateHost = (hostname) =>
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

  const trimSlashes = (value) => String(value || '').trim().replace(/\/+$/, '');

  /**
   * Turn whatever someone typed into a base URL, or null.
   *
   * Accepts a shop code ("azure"), a hostname ("azure.posnic.io"), an address
   * with a port ("192.168.1.5:5555"), or a full URL carrying its own path
   * ("https://pos.myshop.com/api").
   */
  function normalize(value) {
    const text = trimSlashes(value);
    if (!text) return null;

    if (!/[.:/]/.test(text)) {
      return SHOP_CODE.test(text)
        ? `https://${text.toLowerCase()}${CLOUD_SUFFIX}${API_PATH}`
        : null;
    }

    let url;
    try {
      /* No scheme means an address, not a URL. A private address is http, since
         a till holds no certificate; anything else is https, because sending a
         shop's password in clear to a public host is not a default worth
         having. */
      if (/^https?:\/\//i.test(text)) {
        url = new URL(text);
      } else {
        const host = text.split('/')[0].split(':')[0];
        url = new URL((isPrivateHost(host) ? 'http://' : 'https://') + text);
      }
    } catch (e) {
      return null;
    }
    if (!url.hostname) return null;

    /*
     * A PUBLIC host is https, even when it was handed to us saying otherwise.
     *
     * Servers printed pairing codes reading `http://shop.posnic.io/api` for
     * months: nginx terminates TLS and forwards plain http, so Express saw
     * `http` and put that on the QR. A phone scanned it, the address 301'd,
     * and the handset reported that nothing answered - so the shop was told to
     * check whether their till was running.
     *
     * The server is fixed, and those codes are printed and stuck to walls.
     * Upgrading here means every one of them works without being reprinted.
     *
     * Only ever upwards, and only for a public host: a till on the shop's
     * Wi-Fi holds no certificate, and forcing https on it would break every
     * LAN install to tidy up a scheme.
     */
    if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) url.protocol = 'https:';

    if (isPrivateHost(url.hostname) && !url.port) url.port = String(LAN_PORT);

    const path = trimSlashes(url.pathname);
    if (path) return url.origin + path;

    /* The API answers under /api on every server, cloud or till. There is no
       root-mounted fallback: nothing is deployed that needs one. */
    return url.origin + API_PATH;
  }

  const isLanUrl = (url) => {
    try {
      return isPrivateHost(new URL(url).hostname);
    } catch (e) {
      return false;
    }
  };

  const originOf = (url) => {
    try {
      return new URL(url).origin;
    } catch (e) {
      return '';
    }
  };

  const server = (function () {
    let state = load(STORE_SERVER);
    let active = null;

    const persist = () => save(STORE_SERVER, state);

    function setActive(url, { announce = true } = {}) {
      const next = trimSlashes(url);
      if (!next || next === active) return false;
      const previous = active;
      active = next;
      state.active = next;
      persist();
      if (announce) {
        window.dispatchEvent(
          new CustomEvent('posnic:server-changed', {
            detail: { from: previous, to: next, local: isLanUrl(next) },
          })
        );
      }
      return true;
    }

    /* Whichever address was in use last is the opening bet, so no page ever
       renders without one. Resolution corrects it in the background. */
    active = normalize(state.pinned) || normalize(state.active) || null;

    return {
      get baseUrl() {
        return active;
      },
      get isLocal() {
        return !!active && isLanUrl(active);
      },
      get isConfigured() {
        return !!active || !!normalize(state.cloud) || !!normalize(state.lan);
      },
      get pinned() {
        return normalize(state.pinned);
      },
      get lan() {
        return normalize(state.lan);
      },
      get cloud() {
        return normalize(state.cloud);
      },
      get shopCode() {
        return state.shopCode || null;
      },
      get imageOrigin() {
        return originOf(active);
      },

      normalize,
      isLanUrl,

      /** Addresses to try, best first. */
      candidates() {
        const pinned = normalize(state.pinned);
        if (pinned) return [pinned];
        return [normalize(state.lan), normalize(state.cloud), normalize(state.active)]
          .filter(Boolean)
          .filter((url, i, all) => all.indexOf(url) === i);
      },

      /**
       * May the app move onto this address without asking?
       *
       * Yes when it is the pinned choice, when nobody is signed in (there is no
       * shop to be wrong about), or when this address is recorded as holding
       * the shop this device is signed in to.
       */
      canAdopt(url) {
        const clean = trimSlashes(url);
        if (!clean) return false;
        if (normalize(state.pinned) === clean) return true;
        const current = session.shopKey;
        if (!current) return true;
        return (state.servers || {})[clean] === current;
      },

      /**
       * Write down both of a shop's addresses at once.
       *
       * Owner: "when QR scan desktop app should able to share both online url
       * and offline lan url or host name."
       *
       * A scan used to set ONE address, so a phone set up at the counter knew
       * the till and nothing else - and the first time somebody carried it out
       * of range the app had no cloud address to fall back to. The opposite
       * happened too: set up from a cloud code, it ran every order over the
       * internet from two metres away until somebody thought to search the
       * Wi-Fi.
       *
       * The slots have always been separate and tried LAN first. This is only
       * the door that fills both of them in one go.
       *
       * Neither is made active here. Resolution decides which one answers,
       * which is the whole point of keeping two.
       */
      remember({ lan, cloud } = {}) {
        const lanUrl = normalize(lan);
        const cloudUrl = normalize(cloud);
        let wrote = false;

        /* Filed by what they ARE, not by which field they arrived in: a shop
           that pastes its cloud address into the LAN box should still end up
           with a working pair rather than two entries in the wrong slots. */
        for (const url of [lanUrl, cloudUrl].filter(Boolean)) {
          const slot = isLanUrl(url) ? 'lan' : 'cloud';
          if (state[slot] !== url) {
            state[slot] = url;
            wrote = true;
          }
        }

        if (wrote) persist();
        return { lan: normalize(state.lan), cloud: normalize(state.cloud) };
      },

      adopt(url) {
        const clean = trimSlashes(url);
        if (!clean) return false;
        if (!internetChoice.allowed(clean)) return false;
        if (isLanUrl(clean) && active && !isLanUrl(active)) internetChoice.reset(active);
        state[isLanUrl(clean) ? 'lan' : 'cloud'] = clean;
        return setActive(clean);
      },

      /*
       * WHICH NETWORK THE TILL WAS LAST REACHED ON.
       *
       * Owner: "lets say last time you connected to the server was in
       * different wifi but you try to connect same ip address with new wifi.
       * then it should tell about to connect the right wifi."
       *
       * A phone cannot read the Wi-Fi name without a location permission the
       * shop should not have to grant, and a waiter should not have to answer.
       * The subnet is free, needs no permission, and answers the only question
       * that matters: is this the network the till was on, or another one.
       *
       * 192.168.1.11 becomes "192.168.1". Only recorded for a LAN address,
       * because a cloud address says nothing about which Wi-Fi anybody is on.
       */
      rememberNetwork(url) {
        const clean = normalize(url);
        if (!clean || !isLanUrl(clean)) return;
        const match = String(clean).match(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/);
        if (!match) return;
        if (state.lanSubnet === match[1]) return;
        state.lanSubnet = match[1];
        persist();
      },

      get lanSubnet() {
        return state.lanSubnet || null;
      },

      /** Record that this address served this shop, proved by a sign-in. */
      recordShop(url, shopKey) {
        if (!url || !shopKey) return;
        state.servers = state.servers || {};
        state.servers[trimSlashes(url)] = String(shopKey);
        state[isLanUrl(url) ? 'lan' : 'cloud'] = trimSlashes(url);
        persist();
      },

      /** Pin an address by hand. An explicit choice is never overridden. */
      pin(url) {
        const base = normalize(url);
        if (!base) return null;
        /*
         * SIGNED OUT ONLY WHEN IT IS A DIFFERENT SHOP.
         *
         * Owner: "i chose different server then its logged out."
         *
         * This ended the session on ANY change of address, reasoning that a
         * credential signed by the server being left behind is worthless at
         * the new one. True between two shops, and wrong for the case this app
         * is built around: the SAME shop reached at its counter address and at
         * its cloud address. Moving between those two is the ordinary thing a
         * handset does when the Wi-Fi comes and goes, and it was costing a
         * waiter their sign-in every time somebody chose the other one by hand.
         *
         * The shop key is what tells them apart. It is a hash of the licence,
         * identical in the shop's own database and its cloud copy, recorded
         * against every address that has ever proved itself with a sign-in.
         *
         * An address nobody has signed into keeps the session rather than
         * ending it: if the token really is worthless there the server answers
         * 401, and a rejected credential is already dropped rather than
         * resent. Being wrong in that direction costs one refused request;
         * being wrong the other way costs a password mid-service.
         */
        if (base !== active) {
          const known = (state.servers || {})[base] || '';
          const mine = session.shopKey || '';
          if (known && mine && known !== mine) session.end();
        }
        state.pinned = base;
        state[isLanUrl(base) ? 'lan' : 'cloud'] = base;
        persist();
        setActive(base);
        return base;
      },

      unpin() {
        delete state.pinned;
        persist();
      },

      /** Remember the shop's cloud address without pinning it. */
      useShopCode(code) {
        const base = normalize(code);
        if (!base) return null;
        state.shopCode = String(code).trim().toLowerCase();
        state.cloud = base;
        persist();
        return base;
      },

      /** Forget everything about this device's shop. Used by sign-out. */
      forget() {
        state = {};
        active = null;
        persist();
      },
    };
  })();

  /* --------------------------------------------------------------- session */

  const session = (function () {
    if (window.CaptainAccess) return window.CaptainAccess.session;
    let state = load(STORE_SESSION);

    return {
      get token() {
        return state.token || null;
      },
      updateProfile(value) {
        if (!state.user || String(value.id) !== String(state.user.id || state.user._id)) return false;
        state.user = { ...state.user, name: value.name };
        save(STORE_SESSION, state);
        return true;
      },
      get shopKey() {
        return state.shopKey || null;
      },
      get user() {
        return state.user || null;
      },
      get active() {
        return !!state.token;
      },

      /**
       * Keep what a sign-in proved.
       *
       * A server older than the bearer-token work returns no token at all. That
       * is not a failure: the menu and placing an order are anonymous
       * endpoints and work regardless. Only the order, KOT and table screens
       * need the credential, and they say so when it is missing rather than
       * failing as if the network were down.
       */
      start({ token, shopKey, expiresIn, user } = {}) {
        state = {
          token: token || null,
          shopKey: shopKey || null,
          user: user || null,
          /* Stored so a stale credential can be recognised without a round
             trip. The server states its own lifetime so this never guesses. */
          expiresAt: expiresIn ? Date.now() + Number(expiresIn) * 1000 : null,
        };
        save(STORE_SESSION, state);
        if (shopKey) server.recordShop(server.baseUrl, shopKey);
      },

      end() {
        state = {};
        save(STORE_SESSION, state);
      },
    };
  })();

  /* ------------------------------------------------------------- discovery */

  /* Captured before the retrying client below exists, so a probe is always a
     single plain request: no credential, no failover, no recursion. */
  const rawFetch = window.fetch.bind(window);

  /*
   * WHO IS ANSWERING window.fetch.
   *
   * Capacitor's HTTP plugin replaces it with a bridge to native code, which
   * behaves differently from the browser's: it ignores an AbortSignal, and it
   * has its own idea of what a failure is. An address that a browser on the
   * same phone loads perfectly can fail inside the app for that reason alone,
   * and nothing on screen would say so.
   *
   * Recorded rather than reasoned about, because "works in Chrome, not in the
   * app" is otherwise a guess somebody has to make from a distance.
   */
  const transport = () => {
    try {
      const patched = !/\[native code\]/.test(String(window.fetch));
      const bridged = !!(window.Capacitor && window.Capacitor.isNativePlatform
        && window.Capacitor.isNativePlatform());
      return (bridged ? 'native' : 'browser') + (patched ? '+patched-fetch' : '');
    } catch (e) {
      return 'unknown';
    }
  };

  /*
   * The same request, by the other road.
   *
   * XMLHttpRequest and fetch are patched separately by the bridge and fail
   * separately, so when one cannot reach an address the other frequently can.
   * Only ever tried AFTER fetch has failed, so the normal path is untouched.
   */
  /*
   * A fetch the bridge has never seen.
   *
   * Capacitor's HTTP plugin replaces window.fetch on the page it runs in. A
   * fresh same-origin iframe gets its own window, and the browser's own fetch
   * with it - so this is the same request made by the engine underneath,
   * unpatched, and it is the only way to tell "the address is unreachable"
   * from "the bridge did not come back".
   *
   * The frame is kept while the request is in flight and removed after.
   * Detaching it early invalidates the function taken from it.
   */
  function pristineFetch() {
    try {
      if (!document.documentElement) return null;
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'display:none;width:0;height:0;border:0;';
      document.documentElement.appendChild(frame);
      const inner = frame.contentWindow;
      if (!inner || typeof inner.fetch !== 'function') {
        frame.remove();
        return null;
      }
      return {
        fetch: inner.fetch.bind(inner),
        done: () => {
          try {
            frame.remove();
          } catch (e) {
            /* the page is going away anyway */
          }
        },
      };
    } catch (e) {
      return null;
    }
  }

  function fetchByXhr(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      try {
        const request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.timeout = timeoutMs;
        request.setRequestHeader('Accept', 'application/json');
        request.onload = () =>
          resolve({ ok: request.status >= 200 && request.status < 300, status: request.status,
            json: async () => JSON.parse(request.responseText) });
        request.onerror = () => reject(new Error('xhr failed'));
        request.ontimeout = () => reject(new Error('xhr timed out'));
        request.send();
      } catch (e) {
        reject(e);
      }
    });
  }

  /* A Posnic server says so in a shape nothing else on a shop network
     produces. Accepting any reply from port 5555 would enrol a printer's
     status page or a router's admin panel as the till. */
  const looksLikePosnic = (info) =>
    !!info &&
    typeof info === 'object' &&
    typeof info.apiSchema !== 'undefined' &&
    typeof info.edition === 'string';

  /*
   * WHY A PROBE FAILED, in words somebody can act on.
   *
   * Every failure used to come back as null, and the screen said "nothing
   * answered at that address - check the shop code, or that POSNIC is running
   * on the till." That one sentence covered a wrong address, no internet, a
   * name that does not resolve, a certificate a phone will not accept, a
   * server that answered 500, and a server that answered perfectly but is not
   * a Posnic one. A shopkeeper cannot act on it and neither can anybody
   * helping them over the phone: "it says nothing answered" is the end of the
   * conversation rather than the start.
   *
   * So the reason is carried out. It costs nothing - the information was
   * already in the exception that was being discarded.
   */
  /* An exception said plainly enough to read down a telephone. */
  const describe = (e) => {
    if (!e) return 'no detail';
    return String((e.name ? e.name + ': ' : '') + (e.message || e)).slice(0, 120);
  };

  const REASONS = {
    BAD_ADDRESS: 'That is not an address this app can use.',
    UNREACHABLE: 'Could not reach it. Check the phone is online and the address is right.',
    TIMED_OUT: 'It did not answer in time. It may be slow, or not listening.',
    REFUSED: 'It answered, but refused: ',
    NOT_POSNIC: 'Something answered, but it is not a Posnic server.',
    UNREADABLE: 'It answered with something this app could not read.',
  };

  /**
   * Try one address.
   *
   * @returns {{base, info}|null} on success, null otherwise - unchanged, so
   *   every existing caller behaves exactly as before. `probe.lastFailure`
   *   holds why the most recent one failed, for a screen that wants to say.
   *
   * A REFUSAL IS ALSO RECORDED SOMEWHERE THAT SURVIVES A SWEEP.
   *
   * `probe.lastFailure` is one variable and a sweep runs sixty-four probes at
   * a time, so by the end it holds whatever the LAST of two hundred addresses
   * said - which is "nothing there", from an address with nothing there. The
   * one answer that mattered, from the till that replied 403, was overwritten
   * within milliseconds. That is why a refused handset was told the till could
   * not be found: the app had found it and then forgotten.
   *
   * @param {object} [opts.seen]  a collector the caller owns, so a refusal
   *   belongs to the sweep that saw it rather than to whoever ran last.
   */
  async function probe(url, timeoutMs = PROBE_TIMEOUT_MS, { seen = null } = {}) {
    const base = normalize(url);
    if (!base) {
      probe.lastFailure = { reason: 'BAD_ADDRESS', message: REASONS.BAD_ADDRESS, url };
      return null;
    }

    const target = base + '/runtime-info';
    const fail = (reason, extra, status) => {
      const failure = {
        reason,
        message: (REASONS[reason] || reason) + (extra || ''),
        url: target,
        base,
        /* The address without the /api a shopkeeper never typed: this is what
           goes on a screen and into a sentence somebody reads out loud. */
        host: String(base).replace(/\/api$/, ''),
        status: Number(status) || 0,
      };
      probe.lastFailure = failure;
      /*
       * SOMETHING ANSWERED. A dead address gives a connection error; only a
       * server sends a status code back. So a refusal is not a miss - it is
       * the till, found, saying no to this device - and a search that keeps
       * looking past it is spending a shop's Wi-Fi to find what it already
       * has.
       */
      if (reason === 'REFUSED' && seen) seen.push(failure);
      return null;
    };

    /*
     * A TRANSPORT KNOWN TO HANG GETS A SHORTER LEASH.
     *
     * Capacitor's patched fetch ignores an AbortSignal and can simply never
     * come back. Waiting the full budget on it and THEN trying the roads that
     * work would make a waiter stand at a table for twenty seconds to reach a
     * server that answers in under one. So when the bridge is in play the
     * first attempt gets a few seconds, and the fallbacks get the rest.
     */
    const bridged = /patched-fetch/.test(transport());
    const firstBudget = bridged ? Math.min(timeoutMs, 3000) : timeoutMs;
    const laterBudget = Math.max(2000, Math.min(timeoutMs, 5000));

    const controller = new AbortController();
    let timedOut = false;
    let timer;

    try {
      return await Promise.race([
        (async () => {
          const response = await rawFetch(target, {
            method: 'GET',
            signal: controller.signal,
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });
          if (!response) return fail('UNREACHABLE');
          if (!response.ok) return fail('REFUSED', String(response.status), response.status);

          let info;
          try {
            info = await response.json();
          } catch (e) {
            /*
             * A BODY THE FIRST ROAD COULD NOT READ IS A TRANSPORT FAULT, NOT A
             * VERDICT ABOUT THE SERVER.
             *
             * This used to give up here, which meant the one failure the fallback
             * roads exist for was the one failure that never reached them. The
             * emulator reported it exactly that way: ok:false, reason UNREADABLE,
             * road "first" - it never tried a second - against a server that
             * answers curl with two hundred bytes of perfectly good JSON.
             *
             * Capacitor's patched fetch is the thing in the middle, and it is
             * already known to mishandle the rest of this call: it ignores an
             * AbortSignal and can simply never come back. Handing back a response
             * whose body will not parse is the same class of fault, so it takes
             * the same road out.
             */
            const unreadable = new Error('unreadable body: ' + describe(e));
            unreadable.unreadable = true;
            throw unreadable;
          }
          if (!looksLikePosnic(info)) return fail('NOT_POSNIC');

          probe.lastFailure = null;
          return { base, info };
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('Server discovery timed out'));
            controller.abort();
          }, firstBudget);
        }),
      ]);
    } catch (e) {
      /* An abort is our own timer, not the network saying anything. Told
         apart because "it is slow" and "it is not there" send somebody to
         look in two different places. */
      /*
       * A TIMEOUT IS THE CASE THE FALLBACK EXISTS FOR, and the first draft
       * gave up on it.
       *
       * Capacitor's patched fetch ignores an AbortSignal and, on a real
       * handset against a real server, simply never came back - eight seconds
       * of nothing, reported as "it did not answer in time" about a server
       * that answers a browser on the same phone instantly. Falling back only
       * when fetch THREW meant never falling back at all.
       */
      /* Remembered, because it decides what to call this if every road
         fails: a body nobody could read is a different problem from an
         address nobody could reach, and they send somebody to look in two
         different places. */
      let unreadable = !!(e && e.unreadable);
      const notes = [
        '[' + transport() + ']',
        'fetch: ' + (unreadable ? describe(e) : timedOut ? 'hung' : describe(e)),
      ];

      /* The other roads, in the order most likely to work. An unpatched fetch
         from a fresh frame is the engine's own; XHR is patched separately from
         fetch and fails separately. */
      const roads = [
        ['clean-fetch', async (ms) => {
          const clean = pristineFetch();
          if (!clean) throw new Error('no frame');
          try {
            return await clean.fetch(target, {
              method: 'GET',
              headers: { Accept: 'application/json' },
              cache: 'no-store',
              signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined,
            });
          } finally {
            clean.done();
          }
        }],
        ['xhr', (ms) => fetchByXhr(target, ms)],
      ];

      for (const [name, attempt] of roads) {
        try {
          let roadTimer;
          let result;
          try {
            result = await Promise.race([
              (async () => {
                const response = await attempt(laterBudget);
                if (!response?.ok) return { response };
                try { return { response, info: await response.json() }; }
                catch { return { response, unreadable: true }; }
              })(),
              new Promise((_, reject) => {
                roadTimer = setTimeout(() => reject(new Error('Discovery timed out')), laterBudget);
              }),
            ]);
          } finally { clearTimeout(roadTimer); }
          const { response, info } = result;
          if (!response || !response.ok) {
            notes.push(name + ': ' + (response ? String(response.status) : 'no response'));
            continue;
          }
          if (result.unreadable) {
            unreadable = true;
            notes.push(name + ': unreadable body');
            continue;
          }
          if (!looksLikePosnic(info)) return fail('NOT_POSNIC', ' [' + name + ']');
          /* It worked by another road. The address is fine; the bridge is
             not, and the shopkeeper does not need to know that. */
          probe.lastFailure = null;
          probe.usedRoad = name;
          return { base, info };
        } catch (road) {
          notes.push(name + ': ' + describe(road));
        }
      }

      if (unreadable) return fail('UNREADABLE', ' ' + notes.join(' / '));
      return fail(timedOut ? 'TIMED_OUT' : 'UNREACHABLE', ' ' + notes.join(' / '));
    } finally {
      clearTimeout(timer);
    }
  }

  probe.lastFailure = null;
  probe.REASONS = REASONS;
  /* The till that answered and refused, if walking the candidate list met one.
     Kept apart from lastFailure because "it said no" and "nothing was there"
     send somebody to look in two completely different places. */
  probe.transport = transport;
  probe.usedRoad = null;

  /** The /24 networks this device is on, most reliable source first. */
  /* Host numbers this device holds, filled in by localSubnets(). See the
     comment in `add` for why they matter more than any guessed list. */
  let ownHosts = [];
  /* Only the subnets this phone is really on. See localSubnets(). */
  let ownSubnets = [];

  async function localSubnets() {
    const found = [];
    ownHosts = [];
    const add = (value) => {
      const match = String(value || '').match(/(?:\d{1,3}\.){3}\d{1,3}/);
      if (!match) return;
      const parts = match[0].split('.');
      const subnet = parts.slice(0, 3).join('.');
      if (!found.includes(subnet)) found.push(subnet);
      /*
       * AND THE HOST NUMBER THIS DEVICE ITSELF WAS GIVEN.
       *
       * The strongest hint there is about where the till sits. A router hands
       * out its pool in order, so the phone and the till are usually near each
       * other in it - and the pool is not always low: a real shop's till came
       * back on .170, which no list of "likely" numbers would have guessed.
       *
       * Knowing one address in the pool is worth more than guessing at the
       * shape of every router's defaults.
       */
      const host = Number(parts[3]);
      if (host >= 2 && host <= 254 && !ownHosts.includes(host)) ownHosts.push(host);
    };

    /* The native plugin reads the Wi-Fi interface outright. It is the only
       source that cannot be wrong. */
    try {
      const plugin =
        window.Capacitor && window.Capacitor.Plugins
          ? window.Capacitor.Plugins.LocalNetwork
          : null;
      if (plugin && typeof plugin.getLocalIp === 'function') {
        let timer;
        try {
          const result = await Promise.race([
            plugin.getLocalIp(),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500); }),
          ]);
          add(result && result.ip);
        } finally { clearTimeout(timer); }
      }
    } catch (e) {
      /* a browser: fall through to WebRTC */
    }

    if (!found.length) {
      await new Promise((resolve) => {
        const PeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (!PeerConnection) return resolve();
        let peer = null;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try {
            if (peer) peer.close();
          } catch (e) {
            /* already closed */
          }
          resolve();
        };
        try {
          peer = new PeerConnection({ iceServers: [] });
          peer.createDataChannel('posnic-discovery');
          peer.onicecandidate = (event) => {
            const candidate = event && event.candidate ? event.candidate.candidate : '';
            (candidate.match(/(?:\d{1,3}\.){3}\d{1,3}/g) || []).forEach((ip) => {
              if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) add(ip);
            });
            if (!event.candidate) finish();
          };
          peer
            .createOffer()
            .then((offer) => peer.setLocalDescription(offer))
            .catch(finish);
          setTimeout(finish, 1500);
        } catch (e) {
          finish();
        }
      });
    }

    /*
     * WHAT THIS PHONE IS ACTUALLY ON, kept apart from what we would guess.
     *
     * Everything above this line came from the phone's own network interface.
     * Everything below is a guess, and the two must not be confused: telling
     * somebody they are on the wrong Wi-Fi because 192.168.1 is on a list of
     * likely subnets would be a confident lie, and the whole point of the
     * message is that it can be trusted.
     */
    ownSubnets = found.slice();

    add(server.lan);
    /* Guesses, and last: what a consumer router hands out. */
    ['192.168.1', '192.168.0', '192.168.29', '10.0.0'].forEach((subnet) => {
      if (!found.includes(subnet)) found.push(subnet);
    });
    return found;
  }

  /** The host numbers of one subnet, likeliest first. */
  function hostOrder(ownHost) {
    /* The host that worked last, so a re-scan on the same network finishes on
       the first probe rather than the tenth batch. */
    const previous = String(server.lan || '').match(/(?:\d{1,3}\.){3}(\d{1,3})/);
    const first = previous ? Number(previous[1]) : null;

    const seen = new Set();
    const hosts = [];
    const add = (host) => {
      if (host < (ownHost ? 1 : 2) || host > 254 || host === ownHost || seen.has(host)) return;
      seen.add(host);
      hosts.push(host);
    };

    if (first) add(first);

    /*
     * THIS DEVICE'S OWN NEIGHBOURHOOD, before any general guess.
     *
     * A router hands out its pool in order, so whatever address the phone was
     * given, the till is usually within a dozen of it. A real shop's till came
     * back on .170 - not low, not round, and not on any list anybody would
     * have written. Its phone would have been in the same part of the pool.
     */
    for (const own of ownHost ? [ownHost, ...ownHosts] : ownHosts) {
      for (let step = 0; step <= 12; step += 1) {
        add(own - step);
        add(own + step);
      }
    }

    LIKELY_HOSTS.forEach(add);
    if (ownHost) add(1);
    for (let host = 2; host <= 254; host++) add(host);
    return hosts;
  }

  /** How many of those are the fast first pass: the known host, this device's
      neighbourhood, and the general guesses. Still under sixty probes. */
  const likelyCount = () => new Set([...LIKELY_HOSTS]).size + 1 + ownHosts.length * 25;

  function discoveryPorts() {
    const ports = [];
    for (const base of [server.lan, server.baseUrl]) {
      if (!base || !server.isLanUrl(base)) continue;
      try { const url = new URL(base); const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        if (port > 0 && port <= 65535 && !ports.includes(port)) ports.push(port);
      } catch {}
    }
    if (!ports.includes(LAN_PORT)) ports.push(LAN_PORT);
    return ports;
  }

  async function scanSubnet(subnet, { hosts, ownHost, onProgress, onBatch, shouldStop, concurrency, seen, collect, accept, ports = discoveryPorts() } = {}) {
    const list = hosts || hostOrder(ownHost);
    const width = concurrency || SCAN_CONCURRENCY;

    for (let start = 0; start < list.length; start += width) {
      if (shouldStop && shouldStop()) return null;
      const batch = list.slice(start, start + width);
      const results = (await Promise.all(batch.map(async host => {
        const hits = [];
        for (const port of ports) {
          if (shouldStop && shouldStop()) return hits;
          const hit = await probe(`http://${subnet}.${host}:${port}`, SCAN_TIMEOUT_MS, { seen });
          if (hit && (!accept || await accept(hit))) {
            hits.push(hit);
            if (!collect) break;
          }
        }
        return hits;
      }))).flat();
      // A completed batch must not redraw a cancelled search or a selected till.
      if (shouldStop && shouldStop()) return null;
      if (onBatch) onBatch(batch.length);
      if (onProgress) onProgress(Math.min(start + width, list.length), list.length);
      const hit = results.find(Boolean);
      if (collect) results.filter(Boolean).forEach(collect);
      else if (hit) return hit;
      /*
       * A REFUSAL ENDS THE SEARCH TOO.
       *
       * There is one till on a shop's Wi-Fi. Once it has answered - even to
       * say no - every remaining address is known to be empty, and sweeping
       * them is two hundred requests spent on a question already answered.
       * On the network that prompted this, that was the difference between a
       * refused handset asking once and a refused handset sweeping the subnet
       * on every attempt.
       */
      if (!collect && !accept && seen && seen.length) return null;
    }
    return null;
  }

  /**
   * Find the shop's own server on this Wi-Fi.
   *
   * The known address is checked first and alone: when it is right, which it is
   * on every shift after the first, this returns in under a second and no sweep
   * happens at all.
   */
  async function findOnWifi({ onProgress, shouldStop, skipKnown = false, accept, actualNetworkOnly = false } = {}) {
    /* Refusals seen during THIS search, kept here rather than in the one
       global a sweep of sixty-four parallel probes overwrites. */
    const seen = [];
    findOnWifi.lastRefusal = null;

    if (!skipKnown && server.lan) {
      if (onProgress) onProgress(0, 0, server.lan);
      const hit = await probe(server.lan, 1500, { seen });
      if (hit && (!accept || await accept(hit))) return hit;
      /* The address we already knew answered and said no. There is nothing a
         sweep can find that is better than that. */
      if (seen.length && !accept) {
        findOnWifi.lastRefusal = seen[0];
        return null;
      }
    }
    if (shouldStop && shouldStop()) return null;

    const networks = await localSubnets();
    const subnets = actualNetworkOnly ? ownSubnets.slice() : networks;

    /*
     * Every network at once, not one after another.
     *
     * This swept subnets in sequence, and a Windows machine has more networks
     * than anybody thinks: measured on the development desk it offered four -
     * the Wi-Fi, a minikube bridge and two WSL bridges - so a first run took
     * 24 seconds to find a till that was answering the whole time. A waiter
     * watching a screen do nothing for 24 seconds concludes the app is broken.
     *
     * Ranking them better was the other option and is guesswork: nothing in a
     * WebRTC candidate says which interface it came from. Searching all of
     * them together makes the ranking not matter, because only a real Posnic
     * server answers and the first one that does wins.
     */
    let stopped = false;
    /*
     * A deadline that nothing can outlive.
     *
     * The sweep used to be bounded only by how long the slowest of a thousand
     * queued requests took to give up, which on a busy network is not bounded
     * in any way a person would call bounded.
     */
    const deadline = Date.now() + SEARCH_DEADLINE_MS;
    const stop = () =>
      stopped || Date.now() > deadline || (shouldStop ? shouldStop() : false);

    /* Progress is reported as one number across the whole search rather than
       per subnet, because "3 of 4 networks" means nothing to the person
       holding the phone. */
    let done = 0;
    const total = subnets.length * 253;
    const report = (delta) => {
      done += delta;
      if (onProgress) onProgress(Math.min(done, total), total, 'this Wi-Fi');
    };

    /*
     * THE LIKELY ADDRESSES FIRST, everywhere, as one small pass.
     *
     * A till is nearly always low on its subnet or on a round static number,
     * so this is about thirty probes instead of a thousand and it answers in
     * about a second. Only when it finds nothing does the full sweep run.
     *
     * Doing it this way round is what stopped the search LOOKING like a hang:
     * the 500ms probe timeout starts when fetch is called, not when the socket
     * opens, so firing a thousand at once means the later ones time out having
     * never left the queue. A small pass actually runs.
     */
    const sweep = (hosts, concurrency) =>
      Promise.all(
        subnets.map((subnet) =>
          scanSubnet(subnet, {
            hosts,
            concurrency,
            seen,
            accept,
            shouldStop: stop,
            onProgress: () => report(0),
            onBatch: (size) => report(size),
          }).then((hit) => {
            /* The first answer ends the others: there is one till, and the
               remaining sweeps are only spending the phone's radio. A refusal
               is an answer, so it ends them too. */
            if (hit || (!accept && seen.length)) stopped = true;
            return hit;
          })
        )
      );

    const order = hostOrder();
    const likely = order.slice(0, likelyCount());

    const quick = (await sweep(likely, likely.length)).find(Boolean);
    if (quick) return quick;
    if (seen.length && !accept) {
      findOnWifi.lastRefusal = seen[0];
      return null;
    }
    if (stop()) return null;

    /*
     * And then the rest, narrower.
     *
     * The concurrency is divided across the subnets rather than applied to
     * each, so four networks do not put 256 requests in flight at once - which
     * is the state that made every later batch time out in the queue instead
     * of on the wire.
     */
    const rest = order.slice(likely.length);
    const width = Math.max(8, Math.floor(SCAN_CONCURRENCY / Math.max(1, subnets.length)));
    const found = (await sweep(rest, width)).find(Boolean) || null;
    if (!found && seen.length) findOnWifi.lastRefusal = seen[0];
    return found;
  }

  /*
   * The till that answered and said no, if this search met one.
   *
   * A screen reads this to tell a waiter something true - "the till at
   * 192.168.100.18 refused this phone" - instead of "no till found", which
   * sends somebody to check a router that is working perfectly.
   */
  findOnWifi.lastRefusal = null;

  /* ------------------------------------------------------------ resolution */

  let resolving = null;

  /*
   * AN ADDRESS THAT JUST FAILED IS NOT ASKED AGAIN IMMEDIATELY.
   *
   * A circuit breaker, and the smallest one that does the job. Without it a
   * dead till is re-dialled by every single request - each one paying the LAN
   * deadline before failing over - so a waiter taking a five dish order waits
   * that long five times, and the app looks broken rather than merely
   * disconnected.
   *
   * The breaker is only ever a SKIP AHEAD, never a refusal: if every address
   * is failing, the list is walked anyway rather than the app declaring itself
   * offline while a server sits there answering. Half a second of extra
   * waiting beats being wrong about which door is open.
   *
   * The health loop is the half-open probe that closes it again, so nothing
   * here has to schedule anything: this only decides the ORDER of a list that
   * was already being walked.
   */
  const COOL_OFF_MS = 15000;
  const failedAt = new Map();

  function noteFailure(url) {
    if (url) {
      failedAt.set(url, Date.now());
      window.dispatchEvent(new CustomEvent('posnic:route-health', {detail:{base:url,reachable:false}}));
    }
  }

  function noteSuccess(url) {
    if (url) {
      failedAt.delete(url);
      window.dispatchEvent(new CustomEvent('posnic:route-health', {detail:{base:url,reachable:true}}));
    }
  }

  function coolingOff(url) {
    const when = failedAt.get(url);
    return !!when && Date.now() - when < COOL_OFF_MS;
  }

  /*
   * How often a phone that cannot find its till may sweep the Wi-Fi for it.
   *
   * Long enough that a shop genuinely off the network is not probing sixty
   * addresses every few seconds until the battery is flat, short enough that a
   * till which came back on a new address is found inside one cup of coffee
   * rather than one shift.
   */
  const SWEEP_EVERY_MS = 45 * 1000;
  let sweptAt = 0;

  /*
   * HOW OFTEN A PHONE WORKING OVER THE INTERNET LOOKS FOR THE TILL AGAIN.
   *
   * The gap this closes: the till moves to a new address, the saved LAN
   * address is dead, the cloud answers, and the phone settles there. It keeps
   * working, so nothing complains - and it never sweeps, because a sweep only
   * happens when EVERY address has failed and one has not. The shop spends the
   * evening sending every order over the internet from two metres away, paying
   * a few hundred milliseconds a time, and stops entirely the moment the
   * broadband hiccups.
   *
   * Ten minutes, in the background, and only while there is a LAN address to
   * come home to. It never blocks a request: the order that triggered it has
   * already been answered by the cloud.
   */
  const COME_HOME_EVERY_MS = 10 * 60 * 1000;
  let cameHomeAt = 0;

  function comeHome() {
    /* An explicit choice is never second-guessed, and a phone with no till
       address has nowhere to come home to. */
    if (server.pinned || !server.lan) return;
    if (Date.now() - cameHomeAt < COME_HOME_EVERY_MS) return;
    cameHomeAt = Date.now();

    findOnWifi()
      .then((hit) => {
        if (!hit || !server.isLanUrl(hit.base) || !server.canAdopt(hit.base)) return;
        server.adopt(hit.base);
        server.rememberNetwork(hit.base);
      })
      .catch(() => {
        /* Still on the internet, still working. Nothing to say. */
      });
  }

  /**
   * Choose a server that answers, in preference order.
   *
   * Always walks the whole list rather than asking only whether the current one
   * is alive. Those are different questions, and the difference is the point: a
   * phone that fell back to the cloud yesterday would answer the second one
   * "yes" for ever and keep routing every order over the internet while
   * standing two metres from the till.
   *
   * One runs at a time, so a burst of failed requests cannot start a burst of
   * scans.
   */
  const internetChoice = (() => {
    let flight = null;
    const key = base => 'captain.internet-consent:' + (session.shopKey || '') + ':' + base;
    const read = base => { try { return sessionStorage.getItem(key(base)); } catch (_) { return null; } };
    const write = (base,value) => { try { sessionStorage.setItem(key(base),value); } catch (_) {} };
    const required = base => !isLanUrl(base) && isLanUrl(server.baseUrl || session.base || '');
    const allowed = base => !required(base) || read(base) === 'yes';
    function offerAgain(base) {
      if (document.getElementById('captain-internet-choice')) return;
      const button=document.createElement('button');button.id='captain-internet-choice';
      button.textContent='Shop Wi-Fi unavailable · Switch to internet';
      button.style.cssText='position:fixed;bottom:85px;left:12px;right:12px;z-index:2147483646;padding:14px;border:1px solid #a9bee8;border-radius:12px;background:#edf3ff;color:#183b75;font:500 14px system-ui';
      button.onclick=async()=>{write(base,'');button.remove();if(await ask(base)) net.check(true);};
      document.body.append(button);
    }
    async function ask(base) {
      if (allowed(base)) return true;
      if (read(base)==='no') { offerAgain(base); return false; }
      if (flight) { await flight; return allowed(base); }
      flight=new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.id='captain-internet-consent';
        dialog.setAttribute('aria-labelledby','internet-consent-title');
        dialog.style.cssText='width:min(380px,calc(100vw - 32px));box-sizing:border-box;border:1px solid var(--line,#dce4ee);border-radius:18px;padding:22px;background:var(--surface,#fff);color:var(--ink,#17243a);font:15px/1.5 Inter,system-ui;box-shadow:0 16px 60px #0004';
        dialog.innerHTML='<h2 id="internet-consent-title" style="font-size:20px;margin:0 0 12px">Switch to internet?</h2><p>The shop’s Wi-Fi server is unavailable. Use Posnic Cloud instead? Orders may reach the kitchen more slowly than over shop Wi-Fi.</p><p>Your pending orders stay saved on this phone if you choose to wait.</p><div style="display:flex;gap:10px"><button type="button" data-wait style="flex:1;min-height:48px;border:1px solid #cad5e4;border-radius:10px;background:#f4f7fb;color:#26394f">Stay on Wi-Fi</button><button type="button" data-switch style="flex:1;min-height:48px;border:0;border-radius:10px;background:#2459de;color:white">Switch to internet</button></div>';
        const finish=yes=>{write(base,yes?'yes':'no');dialog.close();dialog.remove();if(!yes)offerAgain(base);resolve(yes);};
        dialog.querySelector('[data-wait]').onclick=()=>finish(false);
        dialog.querySelector('[data-switch]').onclick=()=>finish(true);
        dialog.oncancel=e=>{e.preventDefault();finish(false);};
        document.body.append(dialog);dialog.showModal();
      }).finally(()=>{flight=null;});
      return flight;
    }
    return {ask,allowed,reset(base){write(base,'');document.getElementById('captain-internet-choice')?.remove();}};
  })();

  function resolve({ allowScan = false } = {}) {
    if (resolving) return resolving;

    resolving = (async () => {
      /* Warm addresses first, the ones that just failed after them - the same
         list, in the order most likely to answer on the first try. */
      const all = server.candidates();
      const order = [...all.filter((url) => !coolingOff(url)), ...all.filter(coolingOff)];

      for (const candidate of order) {
        const seen = [];
        const hit = await probe(candidate, PROBE_TIMEOUT_MS, { seen });
        if (hit && server.canAdopt(hit.base)) {
          if (!(await internetChoice.ask(hit.base))) continue;
          noteSuccess(hit.base);
          server.adopt(hit.base);
          /* Which Wi-Fi this worked on, so a phone that wakes up somewhere
             else can say so rather than blaming the till. */
          server.rememberNetwork(hit.base);
          /* Settling on the internet is not the same as being done. If there
             is a till on this Wi-Fi, it is faster and it survives the
             broadband going down, so go and find it. */
          if (!server.isLanUrl(hit.base)) comeHome();
          return hit.base;
        }
        /*
         * A REFUSAL IS NOT A DEAD ADDRESS, so it is not cooled off.
         *
         * The breaker exists to skip past addresses with nothing behind them.
         * A till that answered 403 has something behind it - it is up, on
         * this Wi-Fi, and deciding - and pushing it to the back of the list
         * for fifteen seconds is how a phone standing two metres from the
         * till ends up routing every order over mobile data instead.
         */
        if (seen.length) {
          resolve.lastRefusal = seen[0];
          continue;
        }
        noteFailure(candidate);
      }

      /*
       * EVERY KNOWN ADDRESS HAS FAILED, SO LOOK FOR A NEW ONE.
       *
       * This used to run only on the sign-in screen, because a sweep takes
       * seconds and mid-service that would stall the screen a waiter is
       * holding. The reasoning was right about the cost and wrong about when
       * it is paid: by the time control reaches this line every address the
       * phone knows has just failed, the app is already showing the offline
       * overlay, and there is no working screen left to stall.
       *
       * What that restriction cost, in a real shop, on a real evening: the
       * router handed the till a new DHCP lease on each restart - .2, then
       * .18, then .11 - and every handset went dead and STAYED dead, because
       * the one thing that could have found the till again was not allowed to
       * run. The only cure reachable from a dead screen was to sign out and
       * back in, which nobody can be expected to guess and which cannot be
       * explained down a phone to somebody carrying plates.
       *
       * Owner: "i cant explain them wifi and all. i want reliaant." A waiter
       * must never be told anything about Wi-Fi. The phone heals itself or the
       * feature does not work.
       *
       * Rate limited rather than free: a shop genuinely off the network would
       * otherwise sweep on every scheduled check, and sixty probes a few
       * seconds apart is a flat battery by closing time.
       */
      /*
       * A PINNED ADDRESS IS AN EXPLICIT CHOICE, so there is nothing to find.
       *
       * `canAdopt` refuses everything except the pinned address itself, so a
       * sweep here could only ever spend seconds and a slice of battery
       * proving it was not allowed to use what it found. Worse, it delays the
       * outage screen - the one thing that tells somebody the till is off -
       * behind a search that cannot help them.
       */
      /*
       * SAY IT IS DOWN NOW, THEN GO LOOKING.
       *
       * The sweep takes seconds. Waiting for it before showing anything means
       * a waiter taps an order and watches a screen that says nothing at all,
       * which reads as a frozen app and is the moment people start pressing
       * things. Every address has already failed, so the screen is telling the
       * truth the instant it appears - and if the search then finds the till,
       * the screen clears itself and nobody had to do anything.
       */
      if ((allowScan || Date.now() - sweptAt >= SWEEP_EVERY_MS) && !server.pinned) {
        sweptAt = Date.now();

        /*
         * Only announced when a search is actually about to happen. Where
         * nothing follows - a pinned address, or a sweep that just ran - the
         * caller reports the failure a moment later as it always did, and
         * moving that moment earlier would change what every other screen sees
         * without telling anybody anything new.
         */
        window.dispatchEvent(new CustomEvent('posnic:all-addresses-failed'));
        /*
         * Say that something is happening.
         *
         * A first run on a shop's Wi-Fi connects with no taps at all, which is
         * the point - but it took 24 seconds on the measured desk, and for all
         * of them the screen said nothing. Silence for that long is
         * indistinguishable from a broken app, and the person holding the
         * phone starts pressing things. The search is the same; only now it
         * admits to being under way.
         */
        window.dispatchEvent(new CustomEvent('posnic:searching', { detail: { done: 0, total: 0 } }));
        const hit = await findOnWifi({
          onProgress: (done, total) =>
            window.dispatchEvent(new CustomEvent('posnic:searching', { detail: { done, total } })),
        });
        window.dispatchEvent(new CustomEvent('posnic:searched', { detail: { found: !!hit } }));
        if (hit && server.canAdopt(hit.base)) {
          server.adopt(hit.base);
          server.rememberNetwork(hit.base);
          return hit.base;
        }
      }
      return null;
    })().finally(() => {
      resolving = null;
    });

    return resolving;
  }

  /* ------------------------------------------------------------------- api */

  /*
   * What may be replayed on the other server after a failure, and what may not.
   *
   * A network error says the reply did not arrive. It does NOT say the request
   * was not carried out: an order may have been written a millisecond before
   * the Wi-Fi dropped. Replaying it writes it twice, and because the till and
   * the cloud sync to each other the duplicate comes back, so the kitchen makes
   * two of everything and the shop is out of pocket.
   *
   * An allowlist of reads rather than a method check, because most reads here
   * are POSTs - they carry a branch id in a body - so "GET is safe" would have
   * disabled failover for nearly everything while protecting nothing.
   */
  const REPLAYABLE = new Set([
    '/items/accessQr',
    '/users/kioskMobileLogin',
    '/sales/getTablesWithActiveOrders',
    '/sales/getOrderHistory',
    '/sales/getListKot',
    '/sales/getFrequentItems',
  ]);

  const isReplayable = (path, method) =>
    method === 'GET' || method === 'HEAD' || REPLAYABLE.has(String(path).split('?')[0]);

  async function readBody(response) {
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      try {
        return await response.json();
      } catch (e) {
        return null;
      }
    }
    try {
      return await response.text();
    } catch (e) {
      return null;
    }
  }

  function toApiError(response, body) {
    const detail = body && body.error ? body.error : null;
    const message =
      (detail && detail.message) ||
      (body && body.message) ||
      `The server answered ${response.status}`;
    return new ApiError(message, {
      status: response.status,
      code: (detail && detail.code) || `HTTP_${response.status}`,
      body,
    });
  }

  /*
   * BOTH DOORS AT ONCE, when waiting would cost more than asking twice.
   *
   * Owner: "is there any way to smart switch between lan and internet between
   * communication."
   *
   * Everything else in this file switches AFTER a failure: something has to go
   * wrong, be noticed, and be recovered from, and a waiter watches all three.
   * This does not wait to be wrong. The request goes to the till, and if the
   * till has not answered in a moment it goes to the cloud as well. Whichever
   * replies first is the answer; the loser is cancelled mid-flight.
   *
   * WHY THIS IS SAFE, and it is the whole argument: an order carries an
   * idempotency key, and the server holds a unique index on it. If both copies
   * arrive, the second is refused by the DATABASE and the till hands back the
   * order that already exists. Not "unlikely to double" - cannot.
   *
   * So this is offered per request and taken up by exactly one caller, the one
   * that sends an order. Nothing else here may use it, because nothing else
   * carries the key that makes it safe.
   *
   * A quarter of a second before the second attempt: a healthy till answers in
   * ten milliseconds, so anything still silent at 250ms is not about to be
   * quick, and a shop whose Wi-Fi is fine never sends the second request at
   * all.
   */
  const HEDGE_AFTER_MS = 250;

  function race(send, primary, secondary) {
    let started = false;
    let timer = null;

    /*
     * ONE CONTROLLER EACH, and this is not a detail.
     *
     * A single shared controller cancels the WINNER too: the race settles as
     * soon as the response headers arrive, the abort fires, and the body is
     * torn out from under the read that was about to happen. It returned null
     * for a request that had plainly succeeded, which is the kind of failure
     * that looks like a server problem for a week.
     */
    const attempt = (base) => {
      const controller = new AbortController();
      const entry = { controller };
      entry.done = send(base, controller.signal).then((response) => ({ entry, response }));
      return entry;
    };

    const first = attempt(primary);

    let second = null;
    const startSecond = () => {
      if (!second) {
        started = true;
        second = attempt(secondary);
      }
      return second.done;
    };

    /* A primary that FAILS does not wait out the delay: the other door is
       tried the instant this one is known to be no good. */
    const firstChain = first.done.catch(() => startSecond());

    const laterChain = new Promise((resolve) => {
      timer = setTimeout(resolve, HEDGE_AFTER_MS);
    }).then(startSecond);

    return Promise.race([firstChain, laterChain]).then(
      (winner) => {
        clearTimeout(timer);
        /* Everyone who is not the winner is no longer wanted. Cancelling is
           what stops a phone holding two sockets open per order on a network
           that is already struggling. */
        if (winner.entry !== first) first.controller.abort();
        if (second && winner.entry !== second) second.controller.abort();
        lastRace = { hedged: started };
        return winner.response;
      },
      (cause) => {
        clearTimeout(timer);
        first.controller.abort();
        if (second) second.controller.abort();
        lastRace = { hedged: started };
        throw cause;
      }
    );
  }

  /* What the last race did, for a test to ask about. Nothing in the app reads
     it: a screen that behaved differently depending on which door answered
     would be the opposite of the point. */
  let lastRace = { hedged: false };

  /**
   * One request, with the base URL, the credential, a deadline and failover
   * applied in one place.
   *
   * Returns the parsed body. Throws ApiError for anything else, so a caller
   * never has to check `response.ok` or remember which endpoints need a token.
   */
  async function request(
    path,
    { method = 'GET', body, headers, raw = false, timeout, hedge = false } = {}
  ) {
    const authenticating = path === '/users/kioskMobileLogin' && method === 'POST';
    if (!authenticating && session.whenReady) await session.whenReady();
    if (!authenticating && session.managed && session.request)
      return session.request(path, {method, body, headers, raw, timeout});
    if (session.prepare && !authenticating) await session.prepare();
    if (!server.baseUrl) {
      throw new ApiError('No shop server has been chosen yet', { code: 'NO_SERVER' });
    }

    const send = async (base, outerSignal) => {
      if (!authenticating && session.managed && base !== session.base) throw new ApiError("Reconnect to the server that authorized this phone. Orders are retained.", { code: "SESSION_AUTHORITY" });
      const controller = new AbortController();
      /* A race can cancel a request that is no longer wanted. */
      if (outerSignal) outerSignal.addEventListener('abort', () => controller.abort());
      /*
       * The deadline follows the ADDRESS, not the request.
       *
       * A caller that named its own always wins; otherwise a till on the shop
       * Wi-Fi gets a LAN deadline and the cloud keeps the long one. This is
       * what turns a dead router from a ten second freeze into a pause.
       */
      const limit = timeout || (isLanUrl(base) ? LAN_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
      let timer;

      const requestHeaders = new Headers(headers || {});
      requestHeaders.set('Accept', 'application/json');
      if (!authenticating && session.token && !requestHeaders.has('Authorization')) {
        requestHeaders.set('Authorization', `Bearer ${session.token}`);
      }
      if (body !== undefined && !requestHeaders.has('Content-Type')) {
        requestHeaders.set('Content-Type', 'application/json');
      }

      try {
        return await Promise.race([
          (async () => {
            const response = await rawFetch(base + path, {
              method,
              headers: requestHeaders,
              body: body === undefined ? undefined : JSON.stringify(body),
              signal: controller.signal,
              cache: 'no-store',
              ...(session.managed ? {credentials:'omit',redirect:'error'} : {}),
            });
            // Include the response body in the deadline; headers alone are not a reply.
            const payload = raw && response.ok ? undefined : await readBody(response);
            return { response, payload };
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new DOMException('The shop server did not answer in time', 'AbortError'));
              controller.abort();
            }, limit);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };

    const base = server.baseUrl;

    /*
     * THE OTHER DOOR, when this request is safe to send through both.
     *
     * Only an address this device has PROVED holds the same shop: hedging onto
     * a stranger's till would put a table's order in somebody else's kitchen,
     * and that is a worse failure than any amount of waiting.
     */
    const other = hedge
      ? server.candidates().find((url) => url !== base && server.canAdopt(url) && internetChoice.allowed(url)) || null
      : null;

    let response;
    try {
      response = other ? await race(send, base, other) : await send(base);
      /* It answered, so it is warm again whatever it did a minute ago. */
      noteSuccess(base);
    } catch (cause) {
      /* And it did not, so resolution tries the other door FIRST rather than
         dialling this one again for every request in the burst that follows. */
      noteFailure(base);
      /* Find a working server whatever the request was, so the next attempt
         lands in the right place, then replay only if replaying is safe. */
      const moved = await resolve();
      if (moved) net.setOnline();
      else net.setOffline();

      if (moved && moved !== base && isReplayable(path, method)) {
        try {
          response = await send(moved);
        } catch (retryCause) {
          throw new ApiError('Could not reach the shop server', {
            code: 'OFFLINE',
            body: String(retryCause && retryCause.message),
          });
        }
      } else {
        throw new ApiError(
          cause && cause.name === 'AbortError'
            ? 'The shop server did not answer in time'
            : 'Could not reach the shop server',
          { code: cause && cause.name === 'AbortError' ? 'TIMEOUT' : 'OFFLINE' }
        );
      }
    }

    net.setOnline();
    const payload = response.payload;
    response = response.response;

    if (raw) {
      if (!response.ok) throw toApiError(response, payload);
      return response;
    }

    if (!response.ok) {
      const error = toApiError(response, payload);
      /* A credential the server will not accept is worse than none: every
         later request carries it and fails the same way. Drop it and let the
         sign-in screen take over.
         Only when there WAS one. A 401 with no token in hand means the server
         is older than the bearer-token work and refuses this route to
         everyone; clearing an empty session would just bounce the user back to
         a sign-in that cannot help. */
      if (error.status === 401 && session.token && !path.includes('kioskMobileLogin')) {
        if (session.suspend) await session.suspend();
        else session.end();
      }
      /*
       * A 401 on the SIGN-IN route means the password was wrong.
       *
       * Everywhere else a tokenless 401 really does mean an old server - one
       * from before the bearer-token work, refusing the route to everybody.
       * But kioskMobileLogin answers 401 for a bad credential, which is
       * correct and ordinary, and this turned that into "update POSNIC on the
       * till": a confident wrong diagnosis that sends somebody to upgrade
       * their server because they mistyped a password.
       *
       * The route is already excluded from the session-clearing branch above,
       * for the same reason. It was missed here.
       */
      if (error.status === 401 && !session.token && !path.includes('kioskMobileLogin')) {
        error.code = 'SERVER_TOO_OLD';
        error.message =
          'This shop’s server is too old for this screen. Update POSNIC on the till.';
      }

      /*
       * A TILL THAT REFUSES IS NOT A TILL THAT IS DOWN.
       *
       * Owner listed it as its own cause: "server not allowing (403)".
       *
       * Until now nothing in this file did anything with a 403. The search
       * path knew about refusals and said which till refused, but that screen
       * is only reached while somebody is looking for a server. A phone
       * already signed in and working never goes there, so mid-service a
       * refusal arrived as whatever generic error the calling screen happened
       * to show - usually "could not do that", which sends a waiter to find
       * the manager, who restarts a till that is working perfectly.
       *
       * A dead address gives a connection error; only a server sends a status.
       * So a 403 means the till is ON, on this Wi-Fi, and turning this phone
       * away - almost always because the shop has run out of handset slots.
       *
       * NOT session.end(). A 401 means this credential is no good and signing
       * in again is the answer. A 403 means the credential is fine and the
       * shop has no room, and throwing the waiter back to a sign-in screen
       * makes them type a password to be refused a second time.
       */
      if (error.status === 403 && !path.includes('kioskMobileLogin')) {
        /*
         * TWO DIFFERENT NOS, AND THEY SEND SOMEBODY TO DIFFERENT PLACES.
         *
         * Out of handset slots is a licence, and the shop fixes it on the
         * till. A phone the shop has TURNED OFF is a decision somebody made
         * about this handset, and the way back is to sign in again with the
         * password. Telling a waiter holding a revoked phone to free a slot
         * sends them to a screen that cannot help them.
         *
         * The till says which in the body; a 403 with nothing readable in it
         * is the older, commoner one.
         */
        const said =
          (error.body && error.body.error && error.body.error.code) ||
          (error.body && error.body.code) ||
          '';

        if (said === 'DEVICE_REVOKED') {
          error.code = 'DEVICE_REVOKED';
          error.message =
            'The shop has turned this phone off. Sign in again with the shop password to use it.';
        } else {
          error.code = 'TILL_REFUSED';
          error.message =
            'The till is turning this phone away. The shop has probably run out of handset slots - free one on the till, or add a slot, and try again.';
        }

        try {
          window.dispatchEvent(
            new CustomEvent('posnic:refused', {
              detail: { status: 403, host: server.baseUrl || '', code: error.code },
            })
          );
        } catch (e) {
          /* No events, no notice. The message on the error still stands. */
        }
      }

      throw error;
    }
    return payload;
  }

  const api = {
    ApiError,
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    /** For the rare case that needs the Response itself, such as printable HTML. */
    raw: (path, options) => request(path, { ...options, raw: true }),
  };

  /* --------------------------------------------------------------- network */

  const net = (function () {
    let offline = false;
    let delay = HEALTH_OK_MS;
    let timer = null;
    let attempts = 0;
    let nextAt = 0;
    let ticker = null;

    /*
     * Show that waiting is a real option.
     *
     * The app retries on its own, but a screen that only offers two buttons
     * looks like it is waiting for the user, so people tap Try now every few
     * seconds and conclude it is broken. Saying when the next attempt happens
     * turns doing nothing into a choice.
     */
    /*
     * WHILE IT IS LOOKING FOR THE TILL, SAY SO.
     *
     * A countdown says "trying again in 9s", which is true and reads as a
     * machine giving up slowly. When the phone is actually sweeping the Wi-Fi
     * for a till that has moved it is doing the one thing that will fix this,
     * and that is worth saying plainly to somebody who knows nothing about
     * networks and has a table waiting.
     *
     * Registered once: `net` is an IIFE, not something that runs per screen.
     */
    let searchingNow = null;
    /* Has this phone ever reached a server in this session? */
    let wasOnline = false;

    /*
     * The till answered and said no. Held so the outage screen can say which
     * thing is wrong, and cleared the moment anything answers properly.
     */
    let refusedBy = null;

    window.addEventListener('posnic:refused', (event) => {
      /* Not over the server editor: somebody in there already knows the
         address is the problem, and this would be telling them so twice. */
      if (choosingServer() || settingsOpen()) return;
      refusedBy = (event && event.detail) || { status: 403 };
      net.setOffline();
    });

    /*
     * Every address the phone knows has just failed. Show that immediately,
     * before the search that may fix it: the screen is already true, and a
     * waiter staring at nothing is a waiter who starts pressing things.
     */
    window.addEventListener('posnic:all-addresses-failed', () => {
      if (offline) return;
      /*
       * Only for a phone that WAS working a moment ago.
       *
       * That is the case this exists for: mid-service, the till moves, and a
       * waiter would otherwise hold a screen that says nothing for the length
       * of a sweep. A phone still starting up has not shown anybody anything
       * yet, and marking it down during its first look would put "Not
       * connected" in front of somebody who is in the middle of setting it up.
       */
      if (!wasOnline) return;
      /* Not while somebody is picking a server either. The whole point of that
         screen is that the address is wrong, so an outage notice over the top
         of it says only what they came there to fix. */
      if (choosingServer() || settingsOpen()) return;
      net.setOffline();
    });

    window.addEventListener('posnic:searching', (event) => {
      const { done, total } = (event && event.detail) || {};
      searchingNow = total
        ? `Looking for the till on the Wi-Fi (${done} of ${total})`
        : 'Looking for the till on the Wi-Fi';
      const status = document.getElementById('posnic-offline-status');
      if (status && offline) status.textContent = searchingNow;
    });

    window.addEventListener('posnic:searched', () => {
      searchingNow = null;
    });

    function countdown() {
      clearInterval(ticker);
      const status = document.getElementById('posnic-offline-status');
      if (!status) return;
      const paint = () => {
        if (!offline) return;
        /* A search in progress outranks the countdown: it is the thing that
           will end the wait, not the thing counting it. */
        if (searchingNow) {
          status.textContent = searchingNow;
          return;
        }
        const left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
        status.textContent =
          (attempts === 1 ? 'Tried once' : `Tried ${attempts} times`) +
          (left > 0 ? `, trying again in ${left}s` : ', trying again now');
      };
      paint();
      ticker = setInterval(paint, 1000);
    }

    /*
     * IS THIS PHONE EVEN ON THE RIGHT NETWORK?
     *
     * Owner: "last time you connected to the server was in different wifi but
     * you try to connect same ip address with new wifi. then it should tell
     * about to connect the right wifi."
     *
     * Only ever answers yes when it actually knows. A phone that could not
     * read its own address says nothing, because "you are on the wrong Wi-Fi"
     * told to somebody standing in the right shop sends them to reset a router
     * that is working, and one wrong message of that kind costs more trust
     * than ten right ones earn.
     */
    async function whichNetwork() {
      const wanted = server.lanSubnet;
      if (!wanted) return 'unknown';
      try {
        await localSubnets();
      } catch (e) {
        return 'unknown';
      }
      if (!ownSubnets.length) return 'unknown';
      return ownSubnets.includes(wanted) ? 'same' : 'elsewhere';
    }

    function settingsOpen() {
      const setup = document.getElementById('captain-onboarding');
      return !!(setup && !setup.hidden);
    }

    /*
     * SOMEBODY IS CHOOSING A SERVER. DO NOT FIGHT THEM.
     *
     * Owner: "still change server not working. still looking for same not
     * working old config and after two try its showing option to edit."
     *
     * Tapping Change shop server sets a flag and comes here. This file's own
     * DOMContentLoaded listener then started a health check against the
     * address the person had just said was wrong - and because that address is
     * dead, the check spends its full timeout, fails, schedules a retry and
     * goes round again. The editor is open the whole time, underneath an app
     * busy proving what everybody already knows.
     *
     * settingsOpen() covers the modal once it is UP, and misses this entirely:
     * net.start() runs on DOMContentLoaded and the modal opens sixty
     * milliseconds later, so the probe is already away before there is a modal
     * to notice.
     *
     * Two flags because they mark two moments. `posnic_change_server` is set
     * on the screen being left, before this page exists at all, which is the
     * only thing early enough to be read here. `posnic_editing_server` lasts
     * as long as the editor is open.
     */
    function choosingServer() {
      try {
        return (
          sessionStorage.getItem('posnic_change_server') === '1' ||
          sessionStorage.getItem('posnic_editing_server') === '1'
        );
      } catch (e) {
        /* private mode: behave as though nobody is, which is the old way */
        return false;
      }
    }

    function overlay() {
      let element = document.getElementById('posnic-offline');
      if (element) return element;

      element = document.createElement('div');
      element.id = 'posnic-offline';
      element.hidden = true;
      element.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'background:rgba(2,6,23,0.96)',
        'color:#fff',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:24px',
        'text-align:center',
        'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      ].join(';');
      element.innerHTML = `
        <div style="max-width:380px;width:100%;">
          <div style="font-size:42px;margin-bottom:12px;">!</div>
          <h2 id="posnic-offline-title" style="margin:0 0 8px;font-size:23px;font-weight:800;color:#f97316;">Shop server is not responding</h2>
          <p id="posnic-offline-body" style="margin:0 0 4px;color:#e5e7eb;font-size:14px;line-height:1.5;"></p>
          <div id="posnic-offline-url" style="margin:10px 0 4px;color:#94a3b8;font-size:12px;word-break:break-all;"></div>
          <div id="posnic-offline-status" style="margin:0 0 18px;color:#64748b;font-size:12px;min-height:16px;"></div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button type="button" id="posnic-offline-retry" style="border:none;border-radius:8px;background:#f97316;color:#111827;font-weight:800;padding:11px 18px;cursor:pointer;">Try now</button>
            <button type="button" id="posnic-offline-cloud" hidden style="border:1px solid #475569;border-radius:8px;background:#111827;color:#fff;font-weight:700;padding:11px 18px;cursor:pointer;">Use the internet</button>
            <button type="button" id="posnic-offline-settings" style="border:1px solid #475569;border-radius:8px;background:#111827;color:#fff;font-weight:700;padding:11px 18px;cursor:pointer;">Change server</button>
          </div>
        </div>`;
      document.body.appendChild(element);

      element.querySelector('#posnic-offline-retry').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Trying...';
        try {
          await net.check(true);
        } finally {
          button.disabled = false;
          button.textContent = 'Try now';
        }
      });
      /*
       * CHANGE SERVER DID NOTHING AT ALL.
       *
       * Owner: "now change server not allowing actually."
       *
       * This set `posnic.open-server-settings`, and nothing in the app has
       * ever read that key. The real flag is `posnic_change_server`, which the
       * tables screen sets and index.html reads to open the editor. So the
       * button navigated to the sign-in screen, no editor opened, the app
       * health-checked the same dead address, and the outage screen came
       * straight back - which from the outside is a button that does nothing.
       *
       * One name, set in one place, read in two. The KOT screen has always
       * used it; this is the odd one out finally spelling it the same way.
       */
      element.querySelector('#posnic-offline-settings').addEventListener('click', () => {
        try {
          sessionStorage.setItem('posnic_change_server', '1');
        } catch (e) {
          /* private mode: the page still opens, just without the sheet */
        }
        window.location.href = 'index.html';
      });

      /*
       * THE OTHER WAY OUT, SAID PLAINLY.
       *
       * Owner: "not able contact local server, would you like to connect via
       * internet server or change server."
       *
       * A shop with a cloud address can keep taking orders over the internet
       * while somebody sorts the Wi-Fi out, and before this the only way to
       * reach that was the Change server editor - which is a screen of
       * addresses, and a waiter is not going to type one.
       *
       * ADOPTED, NOT PINNED, deliberately. Pinning is an explicit choice that
       * nothing may override, so a phone pinned to the cloud at 7pm would
       * still be routing every order over the internet a week later, standing
       * two metres from a working till. Adopting means the till is preferred
       * again the moment it can be reached.
       */
      element.querySelector('#posnic-offline-cloud').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Connecting...';
        try {
          server.adopt(server.cloud);
          await net.check(true);
        } finally {
          button.disabled = false;
          button.textContent = 'Use the internet';
        }
      });
      return element;
    }

    const net = {
      get offline() {
        return offline;
      },

      setOffline() {
        offline = true;
        attempts += 1;
        delay = HEALTH_DOWN_MS;

        /*
         * Never wall off a device that has simply not been set up yet.
         *
         * "No connection" and "no server chosen" look identical from here and
         * are completely different problems. Painting the outage screen over a
         * fresh install hides the sign-in form and the settings gear, which
         * are the only two things that could fix it.
         */
        if (!server.isConfigured || settingsOpen()) return;
        // A configured staff session can keep taking orders from its cached menu.
        if ((session.active && window.POSNIC_ORDER_QUEUE_UI) || document.querySelector("[data-offline-page]")) {
          const old = document.getElementById('posnic-offline');
          if (old) old.style.display = 'none';
          document.documentElement.classList.remove('posnic-offline-active');
          window.dispatchEvent(new CustomEvent('posnic:offline'));
          return;
        }

        const element = overlay();
        const local = server.isLocal;

        /*
         * Name the thing that is down, and say whose it is.
         *
         * "No connection" reads as a problem with the phone, so people restart
         * the phone. The address is nearly always fine and the till is off, so
         * the screen says which one it is and what would fix it.
         */
        const title = element.querySelector('#posnic-offline-title');
        const body = element.querySelector('#posnic-offline-body');
        const url = element.querySelector('#posnic-offline-url');

        if (title) title.textContent = local ? 'The till is not responding' : 'The shop server is not responding';
        if (body) {
          body.textContent = local
            ? 'Cannot connect to the shop server. Make sure Posnic is running on the till and both devices are on the same network, then try again. Closing the Posnic window is OK if it is still running in the system tray.'
            : 'Cannot connect to the shop server. Check your internet connection, then try again.';
        }
        if (url) url.textContent = server.baseUrl || '';

        /*
         * The internet is only offered where there is one to offer, and only
         * while the phone is trying to reach a till. Offering "use the
         * internet" to a phone already on the internet is noise.
         */
        const cloudButton = element.querySelector('#posnic-offline-cloud');
        if (cloudButton) cloudButton.hidden = !(local && server.cloud);

        /*
         * WRONG WI-FI IS A DIFFERENT PROBLEM WITH A DIFFERENT ANSWER, and it
         * looks identical from here: the till does not answer either way. The
         * check needs the network interface, so it lands a moment later and
         * replaces the words rather than delaying the screen.
         */
        /*
         * NO NETWORK AT ALL OUTRANKS EVERYTHING ELSE.
         *
         * Owner: "app smart enough to find why not able to connect... wifi
         * change, or internet not available or server not responding or server
         * not allowing (403)."
         *
         * This is the one cause the phone can be certain of without asking
         * anybody, and it is the one a waiter can fix on their own in five
         * seconds. Told that the till is not responding while their Wi-Fi is
         * simply off, somebody goes and restarts a working computer.
         *
         * Checked before the network comparison below, which needs an
         * interface that a phone with everything switched off does not have.
         */
        /*
         * A REFUSAL OUTRANKS EVERYTHING, because it is the only cause here
         * that the till itself has confirmed. Everything below is inference
         * from silence; this is a server that answered.
         */
        if (refusedBy) {
          const turnedOff = refusedBy.code === 'DEVICE_REVOKED';
          if (title) {
            title.textContent = turnedOff
              ? 'The shop has turned this phone off'
              : 'The till is turning this phone away';
          }
          if (body) {
            body.textContent = turnedOff
              ? 'The till is on and answering, so the Wi-Fi is fine. Somebody at the shop stopped this handset. Signing in again with the shop password will let it back.'
              : 'The till is on and answering, so the Wi-Fi is fine. The shop has probably run out of handset slots. Free one on the till, or add a slot, then press Try now.';
          }
          if (url) url.textContent = refusedBy.host || server.baseUrl || '';
          ['loader', 'page-loader'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.hidden = true;
          });
          element.hidden = false;
          document.documentElement.classList.add('posnic-offline-active');
          countdown();
          return;
        }

        var nothingAtAll = false;
        try {
          nothingAtAll = navigator && navigator.onLine === false;
        } catch (e) {
          /* No navigator, no claim. */
        }

        if (nothingAtAll) {
          if (title) title.textContent = 'This phone is not on any network';
          if (body) {
            body.textContent =
              'Wi-Fi and mobile data are both off, so nothing can reach the till. Turn Wi-Fi on and join the shop network, and this will connect by itself.';
          }
          if (url) url.textContent = '';
        } else if (local) {
          whichNetwork()
            .then((where) => {
              if (!offline) return;

              if (where === 'elsewhere') {
                if (title) title.textContent = 'This phone is on a different Wi-Fi';
                if (body) {
                  body.textContent =
                    'The till is on the shop Wi-Fi and this phone is on another network, so it cannot see it. Connect this phone to the shop Wi-Fi and it will find the till again by itself.';
                }
                if (url) {
                  url.textContent = `Till was last reached on ${server.lanSubnet}.x, this phone is on ${ownSubnets.join(', ')}.x`;
                }
                return;
              }

              /*
               * Not knowing which network this is means saying nothing new.
               * The screen already carries words that are true either way, and
               * a guess here would send somebody to the wrong thing.
               */
              if (where !== 'same') return;

              /*
               * SAME NETWORK, NO ANSWER: THE TILL IS OFF.
               *
               * Owner: "sometime local desktop not started and not available.
               * that also we need to tell user deskttop app not started."
               *
               * This phone is on the network the till was last reached on and
               * the till is not answering, so the network is not the problem
               * and neither is the address. What is left is the computer: off,
               * asleep, or on with POSNIC not opened. Every one of those is
               * fixed by the same action, which is why they get one sentence
               * instead of three.
               *
               * "Not responding" made people restart the phone, because a
               * phone is the thing in their hand. Naming the computer sends
               * them to the thing that is actually off.
               */
              if (title) title.textContent = 'The till computer is not running POSNIC';
              if (body) {
                body.textContent =
                  'This phone is on the right Wi-Fi, so the till computer is switched off or POSNIC is not open on it. Switch it on and open POSNIC, and this phone will connect by itself.';
              }
            })
            .catch(() => {
              /* Cannot tell: the screen keeps the words it already has. */
            });
        }

        ['loader', 'page-loader'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.hidden = true;
        });
        element.hidden = false;
        document.documentElement.classList.add('posnic-offline-active');
        countdown();
      },

      setOnline() {
        wasOnline = true;
        /* Something answered properly, so whatever refused us has stopped. */
        refusedBy = null;
        delay = HEALTH_OK_MS;
        attempts = 0;
        clearInterval(ticker);
        if (!offline) return;
        offline = false;
        const element = document.getElementById('posnic-offline');
        if (element) element.hidden = true;
        document.documentElement.classList.remove('posnic-offline-active');
        window.dispatchEvent(new CustomEvent('posnic:online'));
      },

      hideOverlay() {
        const element = document.getElementById('posnic-offline');
        if (element) element.hidden = true;
        document.documentElement.classList.remove('posnic-offline-active');
      },

      async check(manual = false) {
        if (!manual && document.hidden) return false;
        try {
          if (manual && window.CaptainAccess) await window.CaptainAccess.resume();
          if (session.whenReady) await session.whenReady();
        } catch { return false; }
        if (session.managed && session.request) {
          if (window.CaptainAccess?.locked || session.needsReconnect) return false;
          try {
            await session.request('/captain/v1/session', {method:'GET', timeout:3000});
            net.setOnline();
            if (!server.isLocal) void recoverManagedServer(manual);
            return true;
          } catch (error) {
            if (error.code === 'PIN_LOCKED' || session.needsReconnect || [401,403].includes(error.status)) return false;
            if (await recoverManagedServer(manual)) return true;
            net.setOffline(); return false;
          }
        }
        /* A scheduled tick that arrives mid-edit stands aside too; a manual
           check is the editor itself asking, and always runs. */
        if (!manual && choosingServer()) return false;
        const chosen = await resolve({ allowScan: manual });
        if (chosen) {
          net.setOnline();
          return true;
        }
        net.setOffline();
        return false;
      },

      /* Exposed because the sign-in page has a boot check of its own and it
         has to make the same decision from the same facts. */
      choosingServer,

      start() {
        if (!server.isConfigured) return;
        /*
         * Not while somebody is picking one. The editor calls start() again
         * when it closes, so nothing is lost by waiting - and what is gained
         * is that the address they are typing over is not simultaneously
         * being dialled.
         */
        if (choosingServer()) return;
        net.check(false);
        const tick = () => {
          clearTimeout(timer);
          nextAt = Date.now() + delay;
          timer = setTimeout(async () => {
            await net.check(false);
            tick();
          }, delay);
        };
        tick();
      },
    };

    return net;
  })();

  /*
   * The last till that answered a candidate walk and refused.
   *
   * Reported by the self-test, because "right reason with evidence" is the
   * whole point of that screen: a phone falling back to the cloud while
   * standing beside a working till is a different fault from one that cannot
   * reach anything, and they look identical from the outside.
   */
  resolve.lastRefusal = null;

  let recoveryFlight = null, nextRecovery = 0;
  function recoverManagedServer(manual = false) {
    if (recoveryFlight) return recoveryFlight;
    if (!session.hasLocalConnection || (!manual && Date.now() < nextRecovery)) return Promise.resolve(null);
    nextRecovery = Date.now() + SWEEP_EVERY_MS;
    const shop = session.shopKey, user = session.user?.id;
    const stopped = () => document.hidden || session.shopKey !== shop || session.user?.id !== user || window.CaptainAccess?.locked;
    recoveryFlight = (async () => {
      const hit = await findOnWifi({actualNetworkOnly:true, skipKnown:true, shouldStop:stopped,
        accept:async candidate => {
          if (stopped()) return false;
          try { await session.addAddress(candidate.base); return !stopped(); }
          catch { return false; }
        }});
      if (!hit || stopped()) return null;
      server.recordShop(hit.base, shop);
      server.adopt(hit.base);
      await session.request('/captain/v1/session', {method:'GET',timeout:3000});
      net.setOnline();
      return hit.base;
    })().catch(() => null).finally(() => { recoveryFlight = null; });
    return recoveryFlight;
  }

  /* --------------------------------------------------------------- exports */

  window.POSNIC = {
    debug,
    server,
    session,
    api,
    net,
    discovery: { probe, findOnWifi, scanSubnet, localSubnets },
    resolve,
    ApiError,
    constants: {
      CLOUD_SUFFIX,
      API_PATH,
      LAN_PORT,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      lanRequestTimeoutMs: LAN_REQUEST_TIMEOUT_MS,
      coolOffMs: COOL_OFF_MS,
    },
    /*
     * The breaker, exposed so a test can ask it questions.
     *
     * Not for the app: nothing in a screen should be deciding which door is
     * warm. It is here because the alternative is a test that waits fifteen
     * real seconds to watch an address cool off, and a suite that sleeps is a
     * suite people stop running.
     */
    internetChoice,
    debugTiming: {
      noteFailure,
      noteSuccess,
      hedgeAfterMs: HEDGE_AFTER_MS,
      lastRace: () => lastRace,
      order: () => {
        const all = server.candidates();
        return [...all.filter((url) => !coolingOff(url)), ...all.filter(coolingOff)];
      },
    },
  };

  document.addEventListener('DOMContentLoaded', () => net.start());

  /* Coming back onto the shop Wi-Fi should not need a tap. */
  window.addEventListener('online', () => net.check(false));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) net.check(false);
  });
})();
