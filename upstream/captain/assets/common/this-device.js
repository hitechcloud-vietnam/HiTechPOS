/*
 * WHAT THIS HANDSET CAN SAY ABOUT ITSELF.
 *
 * Owner: "every order should have some details. example what mobile, user
 * agent, ip address, mobile type or user account whatever infromation app can
 * know do it."
 *
 * When an order goes wrong - a duplicate, a wrong table, a price nobody
 * recognises - the question is which phone and whose hands. A user agent does
 * not answer it: on an Android app it is the same WebView string for every
 * handset in the building, so it says which Chrome shipped with the OS and
 * nothing about the device on the counter.
 *
 * So the app says what it actually knows: the model out of the user agent, the
 * build it is running, how it reached the till, and a random id it keeps for
 * itself so two orders from one phone can be recognised as one phone.
 *
 * WHAT IT DOES NOT SAY. The waiter's name and the address the request came
 * from are the SERVER's to record - both are read from the session and the
 * connection, not from here, because a phone that names its own user is a
 * phone that can name somebody else's. See the client block in the sales
 * controller.
 *
 * Nothing here is worth failing an order over: every read is wrapped, and a
 * phone that answers nothing simply sends less.
 */
(function (root) {
  'use strict';

  /*
   * `root` IS ONLY FOR THE EXPORT LINE at the bottom, which is the house rule
   * in this folder and has a test of its own. The browser globals are read as
   * globals; a test that wants to answer for them injects them.
   *
   * Worth knowing when reading this outside a browser: Node has had its own
   * `navigator` since 18, so a bare read there answers with the runtime's user
   * agent rather than a phone's - not an error, just a quietly wrong answer.
   * That is why the test hands them in rather than relying on what happens to
   * be global.
   */

  const DEVICE_KEY = 'posnic.device_id';

  /**
   * A name for this handset that survives a restart.
   *
   * Random and local: it identifies the phone to the shop's own records and to
   * nothing else. It is the difference between "three duplicate orders" and
   * "three duplicate orders from the same handset", which is the whole
   * question when a floor reports one.
   */
  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      /* Storage blocked. The order still goes; it is simply anonymous. */
      return '';
    }
  }

  /**
   * The phone, as far as the user agent will admit.
   *
   * Android puts the model in brackets, after the build tag:
   *   ... (Linux; Android 13; SM-A martin Build/TP1A) ...   -> SM-A martin
   * iOS names the family rather than the model, which is all Safari ever gives
   * anybody - "iPhone" is honest, and better than the whole string.
   */
  function deviceModel(agent) {
    const said = String(agent || '');

    const android = said.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/i);
    if (android && android[1]) {
      const model = android[1].trim();
      /* "wv" is the WebView marker, not a phone. */
      if (model && !/^wv$/i.test(model)) return model;
    }

    if (/iPad/i.test(said)) return 'iPad';
    if (/iPhone/i.test(said)) return 'iPhone';
    if (/Macintosh/i.test(said)) return 'Mac';
    if (/Windows/i.test(said)) return 'Windows PC';
    return '';
  }

  /** Native app or a browser tab, which changes what a problem can even be. */
  function shell() {
    try {
      const native =
        root.Capacitor &&
        root.Capacitor.isNativePlatform &&
        root.Capacitor.isNativePlatform();
      if (!native) return 'browser';
      const platform =
        (root.Capacitor.getPlatform && root.Capacitor.getPlatform()) || 'native';
      return `app/${platform}`;
    } catch (e) {
      return 'browser';
    }
  }

  /** Which door this order went through: the shop's own Wi-Fi, or the cloud. */
  function network() {
    try {
      const base = String((root.POSNIC && root.POSNIC.server && root.POSNIC.server.baseUrl) || '');
      if (!base) return '';
      if (/^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(base)) {
        return 'lan';
      }
      return 'cloud';
    } catch (e) {
      return '';
    }
  }

  /**
   * Everything above, as the block an order carries.
   *
   * Field names match what the till keeps (see _clientFacts in the sale
   * repository); anything it does not recognise is dropped there, so adding a
   * line here alone changes nothing - which is the intended direction.
   */
  function facts() {
    const agent = (() => {
      try {
        return navigator.userAgent || '';
      } catch (e) {
        return '';
      }
    })();

    const out = {
      app: 'captain',
      device_id: deviceId(),
      device_model: deviceModel(agent),
      platform: shell(),
      network: network(),
    };

    try {
      const build = root.POSNIC_BUILD;
      if (build && build.version) {
        out.app_version = build.commit ? `${build.version} (${build.commit})` : build.version;
      }
    } catch (e) {
      /* A dev build says nothing about its version, which is itself a fact. */
    }

    try {
      out.language = navigator.language || '';
    } catch (e) {
      /* nothing */
    }

    try {
      out.time_zone = root.Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      /* nothing */
    }

    try {
      if (typeof screen !== 'undefined' && screen.width && screen.height) {
        out.screen = `${screen.width}x${screen.height}`;
      }
    } catch (e) {
      /* nothing */
    }

    /* Empty strings are noise in a record somebody reads at three in the
       morning to work out which phone did something. */
    return Object.fromEntries(Object.entries(out).filter(([, value]) => value));
  }

  root.POSNIC = root.POSNIC || {};
  root.POSNIC.thisDevice = { facts, deviceId, deviceModel, network, shell };
})(typeof window !== 'undefined' ? window : globalThis);
