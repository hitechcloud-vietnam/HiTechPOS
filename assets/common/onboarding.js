(function () {
  "use strict";
  let operation = null;
  let selection = null;
  function cancelSelection() {
    selection?.abort();
    selection = null;
  }
  const $ = (id) => document.getElementById(id);
  function showStep(signIn) {
    if (signIn) { sessionStorage.removeItem("posnic_editing_server"); sessionStorage.removeItem("posnic_connection_view"); }
    const canReturn = POSNIC.session.active && !window.CaptainAccess?.locked;
    $("connection-orders").hidden = !canReturn;
    document.querySelector('.setup-steps').hidden = canReturn;
    $("captain-onboarding").hidden = signIn;
    $("captain-legacy").hidden = !signIn;
    $("login-section").dataset.authStep = signIn ? "signin" : "server";
    $("setup-server-step").setAttribute("aria-current", signIn ? "false" : "step");
    $("setup-signin-step").setAttribute("aria-current", signIn ? "step" : "false");
    if (signIn) window.CaptainSignIn?.selectServer(POSNIC.server.baseUrl);
    if (signIn) {
      const base = POSNIC.server.baseUrl;
      $("captain-selected-shop").textContent = base
        ? new URL(base).host
        : "Your shop";
    }
  }
  let view = "start";
  let navigationVersion = 0;
  function showView(next, focus = true) {
    showStep(false);
    view = next;
    $("connection-done").hidden = true;
    $("captain-onboarding").dataset.setupView = next;
    navigationVersion++;
    if (focus) { sessionStorage.setItem("posnic_editing_server", "1"); sessionStorage.setItem("posnic_connection_view", next); }
    const titles = {
      start: POSNIC.server.isConfigured ? "Change server" : "Connect to your shop",
      address: "Connect to your shop",
      code: "Enter pairing code",
      wifi: "Find shop on Wi-Fi",
      cloud: "Sign in with your account",
      settings: "Connection settings",
    };
    $("setup-heading").textContent = titles[next];

    $("setup-address-entry").hidden = !["address", "code"].includes(next);
    $("setup-wifi-hint").hidden = next !== "address";
    $("setup-methods").hidden = next !== "start";
    $("captain-address-toggle").hidden = next !== "start";
    $("setup-start-hint").hidden = next !== "start";
    $("captain-connect").hidden = next !== "address";
    $("captain-code-options").hidden = next !== "code";
    $("captain-code-options").open = next === "code";
    $("captain-code-toggle").setAttribute("aria-expanded", String(next === "code"));
    $("connection-addresses").hidden = next !== "settings";
    $("connection-addresses").open = next === "settings";
    $("captain-results").hidden = next !== "wifi";
    $("setup-results-hint").hidden = next !== "wifi";
    $("captain-search-again").hidden = next !== "wifi";
    $("connection-back").hidden = next === "start" && !POSNIC.server.isConfigured;
    note("");
    if (focus) $("setup-heading").focus();
  }
  function showCode() {
    showView("code");
    ($("captain-server").value.trim() ? $("captain-code") : $("captain-server")).focus();
  }
  const note = (text) => {
    $("captain-note").textContent = text;
  };
  const bytes = (value) => new TextEncoder().encode(value);
  const hex = (array) =>
    [...new Uint8Array(array)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const sha = async (value) => crypto.subtle.digest("SHA-256", bytes(value));
  async function verify(base, code, enrolmentId, signal) {
    const nonce = CaptainAccess.random();
    const answer = await CaptainAccess.post(
      base,
      "/captain/v1/enrolment-proof",
      { enrolmentId, nonce },
      signal,
    );
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(hex(await sha(code))),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = hex(await crypto.subtle.sign("HMAC", key, bytes(nonce)));
    if (answer.proof !== expected)
      throw new Error(
        "This is not the till your manager approved. Scan its QR again.",
      );
  }
  async function run(work) {
    if (operation || selection) return;
    $("captain-open-browser").hidden = true;
    $("captain-open-browser").removeAttribute("href");
    operation = new AbortController();
    $("captain-cancel").hidden = false;
    const controls = [
      "captain-connect",
      "captain-search",
      "captain-scan",
      "captain-code-toggle",
      "captain-pair",
      "captain-cloud-login",
      "captain-server",
      "captain-search-again",
      "connection-settings",
      "connection-save",
    ];
    controls.forEach((id) => {
      $(id).disabled = true;
    });
    try {
      await work(operation.signal);
    } catch (e) {
      if (!operation.signal.aborted) {
        if (view === "cloud") showView("address");
        note(e.message || "Could not connect. Try again.");
      }
    } finally {
      $("captain-open-browser").hidden = true;
      $("captain-open-browser").removeAttribute("href");
      operation = null;
      $("captain-cancel").hidden = true;
      controls.forEach((id) => {
        $(id).disabled = false;
      });
      updateConnectAction();
    }
  }
  function secure() {
    if (!window.CaptainAccess)
      throw new Error(
        "Install the Android app for secure pairing and PIN access. Address sign-in is still available below.",
      );
  }
  async function pair(details, signal, prepared) {
    secure();
    await CaptainAccess.ready;
    const base = POSNIC.server.normalize(details.server);
    if (!base) throw new Error("Choose a shop address first.");
    const code = String(details.code || "")
      .replace(/[ -]/g, "")
      .toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(code))
      throw new Error("Enter the pairing code shown on the till.");
    if (prepared) {
      /* Already exchanged through the approved browser flow. */
    } else if (details.enrolmentId)
      await verify(base, code, details.enrolmentId, signal);
    else {
      const hit = await POSNIC.discovery.probe(base, 3000);
      if (!hit) {
        const failure = POSNIC.discovery.probe.lastFailure;
        throw new Error(
          failure?.reason === "REFUSED"
            ? "The till refused this connection. Ask your manager to check Captain access."
            : failure?.reason === "NOT_POSNIC"
              ? "This address is not a Posnic till. Check the address with your manager."
              : "The till is not answering. Check the shop Wi-Fi and address, then retry or scan its QR.",
        );
      }
      if (!hit?.info?.features?.captainAccessV1)
        throw new Error(
          "Update Posnic on this till to approve Captain phones. Address sign-in remains available.",
        );
      if (!$("captain-confirm").checked)
        throw new Error(
          "Check this address with your manager, then confirm it below.",
        );
    }
    const waiting = OrderQueue.all();
    // Recovery can release the local lock, but never relabel queued orders.
    const grant =
      prepared ||
      (await CaptainAccess.post(
        base,
        "/captain/v1/pair",
        {
          code,
          device: POSNIC.thisDevice.facts(),
          codeVerifier: details.verifier,
        },
        signal,
      ));
    if (
      waiting.some(
        (row) =>
          !row.owner ||
          row.owner.user !== grant.user.id ||
          row.owner.shop !== grant.shopKey ||
          row.owner.base !== base ||
          (row.owner.branch &&
            row.owner.branch !== grant.branches?.[0]?.branch_id),
      )
    )
      throw new Error(
        "Saved orders belong to another staff member or server. Reconnect that original account first. Nothing was deleted.",
      );
    if (signal?.aborted)
      throw new Error("Connection cancelled. Ask your manager for a new code.");
    if (CaptainAccess.locked || POSNIC.session.active)
      await POSNIC.session.end();
    POSNIC.server.pin(base);
    await POSNIC.session.start({ ...grant, base });
    if (prepared) {
      POSNIC.server.remember({
        cloud: base,
        lan: grant.pendingConnections?.[0]?.addresses?.[0],
      });
      POSNIC.server.unpin();
    }
    sessionStorage.removeItem("posnic_editing_server");
    localStorage.setItem("kiosk_branch_list", JSON.stringify(grant.branches));
    localStorage.setItem("user_id", grant.user.id);
    const branch = grant.branches[0];
    localStorage.setItem("branch_id", branch.branch_id);
    localStorage.setItem(
      "kiosk_selected_branch",
      branch.store_id || branch.branch_id,
    );
    note("Phone approved. Choose your daily unlock PIN.");
    if (!(await POSNIC.lock.choose())) {
      await POSNIC.session.end();
      note("Setup paused. Ask your manager for a new code when you are ready.");
      return;
    }
    await selectBranch(branch.store_id || branch.branch_id);
  }
  async function search(signal) {
    $("captain-results").replaceChildren();
    const plugin = window.Capacitor?.Plugins?.LocalNetwork;
    if (!plugin)
      throw new Error(
        "Wi-Fi search works in the installed phone app. You can scan a QR or enter an address here.",
      );
    const network = await bounded(
      plugin.getLocalIp(),
      3000,
      signal,
      "Could not read this phone’s Wi-Fi. Retry, scan the till’s QR, or enter its address.",
    );
    if (signal.aborted) return;
    if (!network.wifi || !network.ip)
      throw new Error("Connect this phone to the shop Wi-Fi and try again.");
    const subnet = network.ip.split(".").slice(0, 3).join(".");
    if (
      !/^\d{1,3}(\.\d{1,3}){3}$/.test(network.ip) ||
      network.ip.split(".").some((part) => Number(part) > 255)
    )
      throw new Error(
        "Could not read a usable Wi-Fi address. Scan the till’s QR or enter its address.",
      );
    const results = $("captain-results");
    results.replaceChildren();
    let count = 0;
    const seen = [];
    const found = new Set();
    const deadline = Date.now() + 20000;
    const searchOperation = operation;
    const stopped = () =>
      signal.aborted || operation !== searchOperation || Date.now() >= deadline;
    const collect = (hit) => {
      if (stopped() || found.has(hit.base)) return;
      found.add(hit.base);
      count++;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "setup-server-card";
      button.innerHTML = '<span class="setup-server-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg></span><span class="setup-server-info"><strong translate="no"></strong><span class="setup-server-network">Wi-Fi</span></span><span class="setup-server-action"><span>Connect</span><span aria-hidden="true">→</span></span>';
      button.querySelector("strong").textContent = new URL(hit.base).host;
      if (!hit.info.features?.captainAccessV1) {
        const compatibility = document.createElement("small");
        compatibility.textContent = "· Update required for pairing";
        button.querySelector(".setup-server-info").append(compatibility);
      }
      button.onclick = async () => {
        if (selection || (operation && operation !== searchOperation)) return;
        searchOperation.abort();
        const controller = new AbortController();
        selection = controller;
        const choices = [...results.querySelectorAll("button")];
        choices.forEach((row) => { row.disabled = true; });
        button.setAttribute("aria-busy", "true");
        note("Connecting to your shop…");
        $("captain-server").value = hit.base;
        $("captain-confirm").checked = false;
        const selectedVersion = ++navigationVersion;
        try {
          await useAddress(hit.base, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted && navigationVersion === selectedVersion) note(error.message);
        } finally {
          if (selection === controller) selection = null;
          button.removeAttribute("aria-busy");
          choices.forEach((row) => { row.disabled = false; });
        }
      };
      results.append(button);
    };
    note("Checking saved till addresses…");
    const saved = [
      ...new Set([POSNIC.server.lan, POSNIC.server.baseUrl]),
    ].filter((base) => base && POSNIC.server.isLanUrl(base));
    await bounded(
      Promise.all(
        saved.map(async (base) => {
          const hit = await POSNIC.discovery.probe(base, 1200, { seen });
          if (hit) collect(hit);
        }),
      ),
      4000,
      signal,
      "Saved addresses did not answer.",
    ).catch((error) => {
      if (signal.aborted) throw error;
    });
    if (stopped()) return;
    await bounded(
      POSNIC.discovery.scanSubnet(subnet, {
        concurrency: 16,
        ownHost: Number(network.ip.split(".").pop()),
        seen,
        shouldStop: stopped,
        onProgress: (done, total) => {
          if (!stopped()) note(`Searching this Wi-Fi: ${done} / ${total}`);
        },
        collect,
      }),
      Math.max(1, deadline - Date.now()),
      signal,
      "Search timed out. Select a till already found, retry, or scan its QR.",
    );
    if (!signal.aborted && seen.length && !count) {
      const refused = seen[0];
      note(
        "The till at " +
          (refused.host || refused.base) +
          " answered and refused this phone (" +
          refused.status +
          "). Ask your manager to allow this device on the till.",
      );
      return;
    }
    if (!signal.aborted)
      note(
        count
          ? ""
          : seen.length
            ? "An address answered but refused access. Ask your manager to check the till address and Captain access."
            : "No compatible till found. Check that the till is open and both devices use the shop Wi-Fi, not guest Wi-Fi. Retry or scan its QR.",
      );
  }
  function bounded(work, milliseconds, signal, message) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (fn, value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        fn(value);
      };
      const abort = () => finish(reject, new Error("Connection cancelled."));
      if (signal.aborted) {
        Promise.resolve(work).catch(() => {});
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => finish(reject, new Error(message)),
        milliseconds,
      );
      Promise.resolve(work).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
  }
  async function accountRequest(method, path, body, signal) {
    const origin = "https://www.posnic.com";
    const capacitor = window.Capacitor;
    const http = capacitor?.isNativePlatform?.()
      ? capacitor.Plugins?.CapacitorHttp || capacitor.registerPlugin?.("CapacitorHttp")
      : null;
    if (!http && method === "POST") return CaptainAccess.post(origin, path, body, signal);
    return bounded((async () => {
      const response = http
        ? await http.request({ url: origin + path, method,
            headers: { "Accept": "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { data: body } : {}), responseType: "json",
            connectTimeout: 7000, readTimeout: 7000, disableRedirects: true })
        : await fetch(origin + path, { signal, credentials: "omit", redirect: "error" });
      const status = response.status;
      const data = http ? (typeof response.data === "string" ? JSON.parse(response.data) : response.data) : await response.json();
      if (status < 200 || status >= 300) throw Object.assign(new Error(data?.error?.message || data?.message || "Could not connect. Try again."), { status });
      return data;
    })(), 7500, signal, "Could not connect. Try again.");
  }
  async function openApproval(url) {
    try {
      await window.Capacitor.Plugins.SecureSession.openBrowser({ url });
    } catch {
      // Keep the pending approval alive and offer an explicit retry.
      note("Could not connect. Try again.");
    }
  }
  function updateConnectAction() {
    $("captain-connect").disabled = !!operation || !$("captain-server").value.trim();
  }
  // Do not spend a short-lived exchange code while the browser owns the screen.
  async function waitForForeground(signal, until) {
    while (document.hidden && !signal.aborted && Date.now() < until) {
      await new Promise(resolve => {
        const done = () => {
          clearTimeout(timer);
          document.removeEventListener("visibilitychange", done);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(1000, Math.max(0, until - Date.now())));
        document.addEventListener("visibilitychange", done, { once: true });
        signal.addEventListener("abort", done, { once: true });
      });
    }
    if (signal.aborted) throw new Error("Connection cancelled.");
    if (Date.now() >= until) throw new Error("Approval expired. Try again.");
    await bounded(CaptainAccess.resume(), 7500, signal, "Could not connect. Try again.");
    if (document.hidden) return waitForForeground(signal, until);
  }
  async function cloud(intent, signal) {
    secure();
    const origin = "https://www.posnic.com";
    note("Connecting to your shop…");
    const capabilities = await accountRequest("GET", "/api/mobile/capabilities", null, signal);
    if (!capabilities.applications?.includes("captain"))
      throw new Error("Captain cloud approval is not available on this account server yet. Use the till’s QR or local address.");
    const verifier = CaptainAccess.random();
    const challenge = btoa(
      String.fromCharCode(...new Uint8Array(await sha(verifier))),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const pending = await accountRequest(
      "POST",
      "/api/mobile/requests",
      {
        application: "captain",
        codeChallenge: challenge,
        deviceId: POSNIC.thisDevice.deviceId(),
        deviceName: "Posnic Captain",
        intent,
      },
      signal,
    );
    const url = new URL(pending.authorizationUrl);
    if (url.origin !== origin || url.pathname !== "/api/mobile/authorize")
      throw new Error("Invalid account approval address.");
    note(
      "Approve Captain in your browser. Matching code: " +
        pending.request.slice(-6).toUpperCase() +
        ". Then return here.",
    );
    const link = $("captain-open-browser");
    link.href = url.href;
    link.hidden = false;
    link.onclick = (event) => { event.preventDefault(); if (!signal.aborted) void openApproval(url.href); };
    await openApproval(url.href);
    const until = Date.now() + Math.min(900, pending.expiresIn) * 1000;
    while (Date.now() < until && !signal.aborted) {
      await new Promise((resolve) => {
        const timer = setTimeout(done, 5000);
        function done() {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        }
        signal.addEventListener("abort", done, { once: true });
      });
      if (signal.aborted) break;
      await waitForForeground(signal, until);
      let grant;
      try {
        grant = await accountRequest(
          "POST",
          "/api/mobile/token",
          { request: pending.request, codeVerifier: verifier },
          signal,
        );
      } catch (error) {
        if (
          !signal.aborted &&
          (!error.status || error.status >= 500 || error.status === 429)
        )
          continue;
        throw error;
      }
      if (grant.error === "authorization_pending") continue;
      const base = POSNIC.server.normalize(grant.baseUrl);
      if (!base || new URL(base).protocol !== "https:")
        throw new Error("Invalid cloud shop address.");
      await waitForForeground(signal, until);
      // Establish the cloud identity first; local credentials are kept separately.
      let approved;
      const exchange = () => CaptainAccess.post(
          base,
          "/captain/v1/pair",
          {
            code: grant.code,
            device: POSNIC.thisDevice.facts(),
            codeVerifier: verifier,
          },
          signal,
        );
      try {
        approved = await exchange();
      } catch (error) {
        if (error.code !== "PAIR_EXPIRED") throw error;
        // Consent is still valid: recover the one-use shop code once, bound to
        // the same request and PKCE verifier, without asking for another login.
        grant = await accountRequest("POST", "/api/mobile/token", {
          request: pending.request, codeVerifier: verifier, recover: true,
        }, signal);
        if (POSNIC.server.normalize(grant.baseUrl) !== base)
          throw new Error("Invalid cloud shop address.");
        await waitForForeground(signal, until);
        approved = await exchange();
      }
      await waitForForeground(signal, until);
      approved.connections = [];
      approved.cloudAuthorization = {
        connectionToken: grant.connectionToken,
        verifier,
      };
      approved.pendingConnections = grant.localServers || [];
      return pair({ server: base, code: grant.code }, signal, approved);
    }
    throw new Error(
      signal.aborted ? "Connection cancelled." : "Approval expired. Try again.",
    );
  }
  async function useAddress(base, signal) {
    const startedAt = navigationVersion;
    const hit = await POSNIC.discovery.probe(base, 5000);
    if (signal?.aborted || navigationVersion !== startedAt) return;
    if (!hit)
      throw new Error(
        "Could not reach this shop. Check the address or connect to the shop Wi-Fi.",
      );
    if (window.CaptainAccess?.locked) {
      POSNIC.server.remember({ lan: hit.base });
      localStorage.setItem(
        "posnic.connection-candidates",
        JSON.stringify([hit.base]),
      );
      note("Saved");
      return;
    }
    if (POSNIC.session.managed) {
      await POSNIC.session.addAddress(hit.base, signal);
      if (signal?.aborted || navigationVersion !== startedAt) return;
      note("Connected");
      return;
    }
    if (POSNIC.session.active && hit.base !== POSNIC.session.base)
      await POSNIC.session.end();
    if (signal?.aborted || navigationVersion !== startedAt) return;
    POSNIC.server.pin(hit.base);
    note("");
    showStep(true);
    $("username").focus();
  }
  window.CaptainOnboarding = {
    get busy() {
      return !!operation || !!selection;
    },
    open() {
      operation?.abort();
      cancelSelection();
      showView("start", false);
      sessionStorage.setItem("posnic_editing_server", "1");
      POSNIC.net.stop?.();
      $("login-section").style.display = "";
      $("branch-section").style.display = "none";
      $("connection-back").hidden = !POSNIC.server.isConfigured;
      $("captain-server").value = POSNIC.server.baseUrl || "";
      $("connection-lan").value = POSNIC.server.lan || (POSNIC.server.isLocal ? POSNIC.server.baseUrl : "") || "";
      $("connection-cloud").value = POSNIC.server.cloud || (!POSNIC.server.isLocal ? POSNIC.server.baseUrl : "") || "";
      showStep(false);
      note("");
      updateConnectAction();
      $("setup-heading").focus();
    },
    close() {
      navigationVersion++;
      operation?.abort();
      cancelSelection();
      POSNIC_CONNECT.stopScan();
      sessionStorage.removeItem("posnic_editing_server");
      sessionStorage.removeItem("posnic_connection_view");
      if (POSNIC.session.active) window.location.href = "kot-management.html";
      else showStep(POSNIC.server.isConfigured);
      POSNIC.net.start();
    },
    readQr(raw) {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return false;
      }
      if (data.app !== "captain" || !data.code) return false;
      POSNIC_CONNECT.stopScan();
      sessionStorage.removeItem("posnic_editing_server");
      void run((signal) => pair(data, signal));
      return true;
    },
  };
  function recoveryHelp() {
    if (document.getElementById("captain-recovery")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "captain-recovery";
    dialog.className = "captain-action-dialog";
    dialog.setAttribute("aria-labelledby", "captain-recovery-title");
    dialog.innerHTML = '<h2 id="captain-recovery-title">Help</h2><p>Ask your manager to reconnect this phone. Your orders are saved.</p><div class="recovery-actions"><button type="button" data-recovery="password">Use my password instead</button><button type="button" data-recovery="account">Sign in with your account</button><button type="button" data-recovery="back">Back</button></div>';
    const close = () => {window.removeEventListener("captain:back", back, true);dialog.close();dialog.remove();$("captain-login-help").focus();};
    const back = event => {event.preventDefault();event.stopImmediatePropagation();close();};
    dialog.addEventListener("cancel", back);
    window.addEventListener("captain:back", back, true);
    dialog.addEventListener("click", event => {
      const action = event.target.closest("[data-recovery]")?.dataset.recovery;
      if (!action) return;
      close();
      if (action === "password") $("password").focus();
      if (action === "account") {CaptainOnboarding.open();$("captain-cloud-login").click();}
    });
    document.body.append(dialog);window.I18N?.apply(dialog);dialog.showModal();
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("captain-server").value = POSNIC.server.baseUrl || "";
    updateConnectAction();
    $("captain-login-help").onclick = recoveryHelp;
    $("captain-code-toggle").onclick = showCode;
    $("captain-change-shop").onclick = () => CaptainOnboarding.open();
    $("captain-connect").onclick = () => {
      const input = $("captain-server").value.trim();
      if (!input) return;
      void run(async (signal) => {
        const base = POSNIC.server.normalize(input);
        if (!base)
          throw new Error("Check the shop code or address and try again.");
        note("Connecting to your shop…");
        await useAddress(base, signal);
      });
    };
    $("captain-server").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        $("captain-connect").click();
      }
    });
    window.addEventListener("posnic:server-changed", () => {
      if (
        POSNIC.server.isConfigured &&
        !sessionStorage.getItem("posnic_editing_server")
      ) {
        $("captain-server").value = POSNIC.server.baseUrl;
        showStep(true);
      }
    });
    $("captain-server").addEventListener("input", () => {
      sessionStorage.setItem("posnic_editing_server", "1");
      updateConnectAction();
      $("captain-confirm").checked = false;
    });
    $("captain-scan").onclick = () => {
      if (operation || selection) return;
      POSNIC_CONNECT.startScan((base) => {
        $("captain-server").value = base;
        void run((signal) => useAddress(base, signal));
      });
    };
    const findShop = () => {
      if (operation || selection) return;
      showView("wifi");
      void run(search);
    };
    $("captain-search").onclick = findShop;
    $("captain-search-again").onclick = findShop;
    $("connection-settings").onclick = () => {
      $("connection-lan").value = POSNIC.server.lan || (POSNIC.server.isLocal ? POSNIC.server.baseUrl : "") || "";
      $("connection-cloud").value = POSNIC.server.cloud || (!POSNIC.server.isLocal ? POSNIC.server.baseUrl : "") || "";
      showView("settings");
    };
    $("captain-pair").onclick = () =>
      void run((signal) =>
        pair(
          { server: $("captain-server").value, code: $("captain-code").value },
          signal,
        ),
      );
    $("captain-cloud-login").onclick = () => {
      if (operation || selection) return;
      showView("cloud");
      void run((signal) => cloud("login", signal));
    };
    $("captain-cloud-signup").onclick = () =>
      void run((signal) => cloud("signup", signal));
    $("captain-cancel").onclick = () => {
      operation?.abort();
      cancelSelection();
      POSNIC_CONNECT.stopScan();
      if (view === "cloud") showView("address");
      note("Connection cancelled.");
    };
    $("connection-orders").onclick = $("connection-done").onclick = () => CaptainOnboarding.close();
    $("connection-back").onclick = () => {
      if (view === "start") return CaptainOnboarding.close();
      operation?.abort();
      cancelSelection();
      POSNIC_CONNECT.stopScan();
      showView("start");
    };
    $("captain-address-toggle").onclick = () => showView("address");
    $("connection-save").onclick = () =>
      void run(async (signal) => {
        const startedAt = navigationVersion;
        const lan = $("connection-lan").value.trim(),
          cloud = $("connection-cloud").value.trim();
        const addresses = [lan, cloud]
          .filter(Boolean)
          .map((value) => POSNIC.server.normalize(value));
        if (!addresses.length || addresses.some((value) => !value))
          throw new Error("Check the shop code or address and try again.");
        if (POSNIC.session.managed) {
          for (const base of addresses) {
            if (signal.aborted || navigationVersion !== startedAt) return;
            await POSNIC.session.addAddress(base, signal);
          }
        } else {
          POSNIC.server.remember({ lan, cloud });
          if (window.CaptainAccess?.locked)
            localStorage.setItem(
              "posnic.connection-candidates",
              JSON.stringify(addresses),
            );
          else if (!POSNIC.session.active) {
            POSNIC.server.pin(addresses[0]);
            POSNIC.server.unpin();
          }
        }
        if (signal.aborted || navigationVersion !== startedAt) return;
        $("captain-server").value = POSNIC.server.baseUrl || addresses[0];
        $("connection-back").hidden = false;
        note("Saved");
        $("connection-done").hidden = !POSNIC.session.active || window.CaptainAccess?.locked;
      });
    showView("start", false);
    showStep(
      POSNIC.server.isConfigured &&
        !sessionStorage.getItem("posnic_change_server") &&
        !sessionStorage.getItem("posnic_editing_server"),
    );
  });
})();
