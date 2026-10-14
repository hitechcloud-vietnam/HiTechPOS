import { test, expect } from "@playwright/test";
import { createHash, createHmac } from "node:crypto";
const base = "http://192.168.1.8:42590/api",
  code = "ABCDEF123456",
  enrolmentId = "12345678-1234-1234-1234-123456789012";
const info = {
  edition: "community",
  mode: "desktop",
  version: "1.8.0",
  apiSchema: 1,
  syncProtocol: 1,
  features: { captainAccessV1: true },
};

for (const returning of [false, true])
  test(`approved cloud polling completes pairing and reaches the PIN step (${returning})`, async ({
    page,
  }) => {
    await phone(page);
    await page.evaluate(() => {
      const timeout = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) =>
        timeout(fn, ms === 5000 ? 10 : ms, ...args);
    });
    const cloud = "https://approved.posnic.io/api";
    await page.route("https://approved.posnic.io/**", (route) =>
      route.fulfill({
        json: route.request().url().endsWith("/pair")
          ? {
              token: "approved-access",
              expiresIn: 900,
              refreshToken: "r".repeat(43),
              sessionId: "cloud-session",
              shopKey: "shop",
              user: { id: "staff" },
              branches: [{ branch_id: "branch", store_id: "branch" }],
            }
          : info,
      }),
    );
    await page.route("https://www.posnic.com/**", (route) => {
      if (route.request().url().endsWith("/capabilities"))
        return route.fulfill({ json: { applications: ["captain"] } });
      if (route.request().url().endsWith("/requests"))
        return route.fulfill({
          json: {
            request: "a".repeat(43),
            authorizationUrl:
              "https://www.posnic.com/api/mobile/authorize?request=" +
              "a".repeat(43),
            expiresIn: 900,
          },
        });
      return route.fulfill({
        json: {
          baseUrl: cloud,
          code,
          application: "captain",
          localServers: [],
        },
      });
    });
    if (returning)
      await page.evaluate(async () => {
        await POSNIC.session.start({
          base: "https://approved.posnic.io/api",
          token: "previous",
          user: { id: "staff" },
          shopKey: "shop",
        });
        await CaptainAccess.setPin("1234");
        Capacitor.Plugins.SecureSession.openBrowser = async (v) => {
          window.openedAccount = v.url;
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
          await new Promise((resolve) => setTimeout(resolve, 20));
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: false,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        };
      });
    if (!(await page.locator("#captain-cloud-login").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-cloud-login").click();
    await expect
      .poll(() => page.evaluate(() => window.selectedCaptainBranch))
      .toBe("branch");
    expect(await page.evaluate(() => CaptainAccess.pinSet)).toBe(true);
    expect(await page.evaluate(() => POSNIC.session.base)).toBe(cloud);
  });
async function fillAddress(page, value) {
  if (await page.locator("#captain-address-toggle").isVisible()) await page.locator("#captain-address-toggle").click();
  await page.locator("#captain-server").fill(value);
}

async function phone(page, address = true) {
  await page.addInitScript(() => {
    let session = {},
      pin = null,
      locked = false;
    const result = () => ({
      pinSet: !!pin,
      locked,
      attempts: 5,
      profile: session.user
        ? { user: session.user, shopKey: session.shopKey, base: session.base }
        : null,
      session: locked ? undefined : session,
    });
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        SecureSession: {
          status: async () => result(),
          save: async (v) => {
            session = v.session;
            return result();
          },
          setPin: async (v) => {
            pin = v.pin;
            return result();
          },
          lock: async () => {
            locked = !!pin;
          },
          clear: async () => {
            session = {};
            pin = null;
            locked = false;
          },
          openBrowser: async (v) => {
            window.openedAccount = v.url;
          },
        },
        LocalNetwork: {
          getLocalIp: async () => ({ wifi: true, ip: "192.168.1.4" }),
        },
      },
    };
  });
  await page.route("http://192.168.1.8:42590/**", async (route) => {
    const url = new URL(route.request().url());
    let body = info;
    if (url.pathname.endsWith("/enrolment-proof"))
      body = {
        proof: createHmac(
          "sha256",
          createHash("sha256").update(code).digest("hex"),
        )
          .update(route.request().postDataJSON().nonce)
          .digest("hex"),
      };
    else if (url.pathname.endsWith("/pair"))
      body = {
        token: "test-access",
        expiresIn: 900,
        refreshToken: "r".repeat(43),
        sessionId: "session",
        shopKey: "shop",
        user: { id: "staff", name: "Waiter" },
        branches: [
          { branch_id: "branch", store_id: "branch", branch_name: "Shop" },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/index.html");
  if (address) await page.locator("#captain-address-toggle").click();
  await page.evaluate(() => {
    window.selectBranch = async (value) => {
      window.selectedCaptainBranch = value;
    };
    POSNIC.lock.choose = async () => {
      await CaptainAccess.setPin("1234");
      return true;
    };
  });
}

test("saved custom-port tills are checked first and duplicate discoveries are shown once", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate((base) => {
    POSNIC.server.pin(base);
    window.discoveryOrder = [];
    POSNIC.discovery.probe = async (url) => {
      window.discoveryOrder.push(url);
      return { base: url, info: { features: { captainAccessV1: true } } };
    };
    POSNIC.discovery.scanSubnet = async (_subnet, options) => {
      window.discoveryOrder.push("sweep");
      options.collect({ base, info: { features: { captainAccessV1: true } } });
    };
  }, base);
  if (await page.locator("#captain-change-shop").isVisible())
    await page.locator("#captain-change-shop").click();
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await expect(page.locator("#captain-results button")).toHaveCount(1);
  expect(
    (await page.evaluate(() => window.discoveryOrder)).slice(0, 2),
  ).toEqual([base, "sweep"]);
});
test("cancel releases a stuck native Wi-Fi lookup and permits retry", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate(() => {
    Capacitor.Plugins.LocalNetwork.getLocalIp = () => new Promise(() => {});
  });
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await page.locator("#captain-cancel").click();
  await expect(page.locator("#captain-cancel")).toBeHidden();
  await expect(page.locator("#captain-note")).toHaveText(
    "Connection cancelled.",
  );
  await page.evaluate(() => {
    Capacitor.Plugins.LocalNetwork.getLocalIp = async () => ({ wifi: false });
  });
  await page.locator("#captain-search-again").click();
  await expect(page.locator("#captain-note")).toContainText("shop Wi-Fi");
});
test("selecting a result rejects late progress and clears the previous address confirmation", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate((base) => {
    document.getElementById("captain-confirm").checked = true;
    POSNIC.discovery.scanSubnet = async (_subnet, options) => {
      options.collect({ base, info: { features: { captainAccessV1: true } } });
      await new Promise((r) => setTimeout(r, 300));
      options.onProgress(200, 253);
      options.collect({
        base: "http://192.168.1.9:5555/api",
        info: { features: {} },
      });
    };
  }, base);
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await page.locator("#captain-results button").first().click();
  await expect(page.locator("#captain-cancel")).toBeHidden();
  await page.waitForTimeout(400);
  await expect(page.locator("#captain-legacy")).toBeVisible();
  await expect(page.locator("#captain-results button")).toHaveCount(1);
  await expect(page.locator("#captain-confirm")).not.toBeChecked();
});
test("unreachable till is not mislabeled as an outdated API", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate(() => {
    POSNIC.discovery.probe = async () => null;
    POSNIC.discovery.probe.lastFailure = { reason: "UNREACHABLE" };
  });
  if (!(await page.locator("#captain-code-toggle").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-code-toggle").click();
  await fillAddress(page, base);
  await page.locator("#captain-code").fill(code);
  await page.locator("#captain-pair").click();
  await expect(page.locator("#captain-note")).toContainText("not answering");
  await expect(page.locator("#captain-note")).not.toContainText("Update");
});
test("a stuck network scan has a deadline and a useful retry message", async ({
  page,
}) => {
  await phone(page);
  await page.clock.install();
  await page.evaluate(() => {
    POSNIC.discovery.scanSubnet = () => new Promise(() => {});
  });
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await page.clock.fastForward(21000);
  await expect(page.locator("#captain-cancel")).toBeHidden();
  await expect(page.locator("#captain-note")).toContainText("Search timed out");
});
test("fresh setup offers Wi-Fi first and keeps the address one tap away", async ({
  page,
}) => {
  await page.goto("/index.html");
  await expect(
    page.getByRole("button", { name: "Scan shop QR code", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#captain-server")).toBeHidden();
  await expect(page.locator("#captain-search")).toBeVisible();
  await expect(page.locator("#captain-address-toggle")).toBeVisible();
  await expect(page.locator("#captain-legacy")).toBeHidden();
  await expect(page.locator("#serverBanner")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#captain-cloud-signup")).toBeHidden();
  await page.screenshot({
    path: "test-artifacts/captain-first-open.png",
    fullPage: true,
  });
});
test("QR checks proof before sending pairing credentials, then securely saves the grant and chooses PIN", async ({
  page,
}) => {
  await phone(page);
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("/captain/v1/")) requests.push(r.url());
  });
  await page.evaluate(
    ({ base, code, enrolmentId }) =>
      CaptainOnboarding.readQr(
        JSON.stringify({ app: "captain", server: base, code, enrolmentId }),
      ),
    { base, code, enrolmentId },
  );
  await expect
    .poll(() => page.evaluate(() => window.selectedCaptainBranch))
    .toBe("branch");
  expect(requests.map((url) => url.split("/").pop())).toEqual([
    "enrolment-proof",
    "pair",
  ]);
  expect(
    await page.evaluate(() => localStorage.getItem("posnic.session")),
  ).toBeNull();
  expect(await page.evaluate(() => CaptainAccess.pinSet)).toBe(true);
});
test("a wrong QR proof never receives the code", async ({ page }) => {
  await phone(page);
  let pairCalls = 0;
  await page.route("**/captain/v1/enrolment-proof", (r) =>
    r.fulfill({ json: { proof: "wrong" } }),
  );
  page.on("request", (r) => {
    if (r.url().endsWith("/captain/v1/pair")) pairCalls++;
  });
  await page.evaluate(
    ({ base, code, enrolmentId }) =>
      CaptainOnboarding.readQr(
        JSON.stringify({ app: "captain", server: base, code, enrolmentId }),
      ),
    { base, code, enrolmentId },
  );
  await expect(page.locator("#captain-note")).toContainText("not the till");
  expect(pairCalls).toBe(0);
});
test("pairing code needs a selected, manager-confirmed address", async ({
  page,
}) => {
  await phone(page);
  if (!(await page.locator("#captain-code-toggle").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-code-toggle").click();
  await fillAddress(page, base);
  await page.locator("#captain-code").fill(code);
  await page.locator("#captain-pair").click();
  await expect(page.locator("#captain-note")).toContainText("confirm");
  await page.locator("#captain-confirm").check();
  await page.locator("#captain-pair").click();
  await expect
    .poll(() => page.evaluate(() => window.selectedCaptainBranch))
    .toBe("branch");
});
test("multiple discovered tills require explicit selection; no Wi-Fi is named", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate(() => {
    POSNIC.discovery.scanSubnet = async (_subnet, options) => {
      for (const base of [
        "http://192.168.1.8:42590/api",
        "http://192.168.1.9:42590/api",
      ])
        options.collect({
          base,
          info: { features: { captainAccessV1: true } },
        });
    };
  });
  await page.route("http://192.168.1.9:42590/**", (route) =>
    route.fulfill({ json: info }),
  );
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await expect(page.locator("#captain-results button")).toHaveCount(2);
  expect(await page.evaluate(() => POSNIC.server.isConfigured)).toBe(false);
  await page.locator("#captain-results button").nth(1).click();
  await expect(page.locator("#captain-server")).toHaveValue(
    "http://192.168.1.9:42590/api",
  );
  await page.evaluate(() => {
    Capacitor.Plugins.LocalNetwork.getLocalIp = async () => ({
      wifi: false,
      ip: "",
    });
  });
  await page.locator("#captain-change-shop").click();
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await expect(page.locator("#captain-note")).toContainText(
    "Connect this phone to the shop Wi-Fi",
  );
});
test("cancellation during proof never submits pairing credentials", async ({
  page,
}) => {
  await phone(page);
  await page.route("**/captain/v1/enrolment-proof", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ json: { proof: "late" } }).catch(() => {});
  });
  let paired = false;
  page.on("request", (r) => {
    if (r.url().endsWith("/pair")) paired = true;
  });
  await page.evaluate(
    ({ base, code, enrolmentId }) =>
      CaptainOnboarding.readQr(
        JSON.stringify({ app: "captain", server: base, code, enrolmentId }),
      ),
    { base, code, enrolmentId },
  );
  await page.locator("#captain-cancel").click();
  await expect(page.locator("#captain-cancel")).toBeHidden();
  expect(paired).toBe(false);
});
test("recovery cannot move another staff member’s queued orders", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "posnic.pending-orders",
      JSON.stringify([
        {
          id: "saved",
          owner: {
            user: "other",
            shop: "shop",
            base: "http://192.168.1.8:42590/api",
          },
        },
      ]),
    ),
  );
  await page.evaluate(
    ({ base, code, enrolmentId }) =>
      CaptainOnboarding.readQr(
        JSON.stringify({ app: "captain", server: base, code, enrolmentId }),
      ),
    { base, code, enrolmentId },
  );
  await expect(page.locator("#captain-note")).toContainText("another staff");
  expect(await page.evaluate(() => OrderQueue.all()[0].id)).toBe("saved");
  expect(await page.evaluate(() => POSNIC.session.token)).toBeNull();
});
test("cloud uses external approval and a Captain-scoped request; unavailable accounts do not open a browser", async ({
  page,
}) => {
  await phone(page);
  let capability = false;
  await page.route("https://www.posnic.com/**", (route) => {
    if (route.request().url().endsWith("/capabilities"))
      return route.fulfill({
        json: { applications: capability ? ["captain"] : ["mobile-pos"] },
      });
    if (route.request().url().endsWith("/requests")) {
      expect(route.request().postDataJSON().application).toBe("captain");
      return route.fulfill({
        json: {
          request: "a".repeat(43),
          authorizationUrl:
            "https://www.posnic.com/api/mobile/authorize?request=" +
            "a".repeat(43),
          expiresIn: 900,
        },
      });
    }
    return route.fulfill({
      status: 202,
      json: { error: "authorization_pending" },
    });
  });
  if (!(await page.locator("#captain-cloud-login").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-cloud-login").click();
  await expect(page.locator("#captain-note")).toContainText("not available");
  expect(await page.evaluate(() => window.openedAccount)).toBeUndefined();
  capability = true;
  if (!(await page.locator("#captain-cloud-login").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-cloud-login").click();
  await expect
    .poll(() => page.evaluate(() => window.openedAccount))
    .toContain("/api/mobile/authorize");
  await page.locator("#captain-cancel").click();
  await expect(page.locator("#captain-cancel")).toBeHidden();
});

test("an entered address is verified before showing a separate staff sign-in screen", async ({
  page,
}) => {
  await phone(page);
  await fillAddress(page, base);
  await page.locator("#captain-connect").click();
  await expect(page.locator("#username")).toBeVisible();
  await expect(page.locator("#captain-onboarding")).toBeHidden();
  await expect(page.locator("#captain-selected-shop")).toHaveText(
    "192.168.1.8:42590",
  );
  await page.screenshot({
    path: "test-artifacts/captain-sign-in.png",
    fullPage: true,
  });
  await page.locator("#captain-change-shop").click();
  await expect(page.locator("#captain-server")).toHaveValue(base);
  await expect(page.locator("#username")).toBeHidden();
});

test("unreachable and cancelled addresses do not advance or replace the shop", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate(() => {
    POSNIC.discovery.probe = async () => null;
  });
  await fillAddress(page, base);
  await page.locator("#captain-connect").click();
  await expect(page.locator("#captain-note")).toContainText("Could not reach");
  await expect(page.locator("#username")).toBeHidden();
  expect(await page.evaluate(() => POSNIC.server.isConfigured)).toBe(false);
  await page.evaluate(() => {
    POSNIC.discovery.probe = () =>
      new Promise((resolve) => {
        window.finishProbe = resolve;
      });
  });
  await page.locator("#captain-connect").click();
  await page.locator("#captain-cancel").click();
  await page.evaluate((base) => window.finishProbe({ base }), base);
  await expect(page.locator("#captain-connect")).toBeEnabled();
  expect(await page.evaluate(() => POSNIC.server.isConfigured)).toBe(false);
});

test("setup fits a small phone and keeps discovery controls reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/index.html");
  for (const id of [
    "captain-address-toggle",
    "captain-search",
    "captain-scan",
    "captain-code-toggle",
    "captain-cloud-login",
  ])
    await expect(page.locator("#" + id)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-artifacts/captain-setup-small.png",
    fullPage: true,
  });
  await page
    .locator(".setup-settings")
    .click();
  await expect(page.locator("#captain-onboarding")).toBeVisible();
  await expect(page.locator("#serverUrlInput")).toHaveCount(0);
});

test("first setup and connection settings use the same screen and save both addresses before login", async ({
  page,
}) => {
  await phone(page);
  await page.locator('[aria-label="Connection settings"]').click();
  await expect(page.locator("#captain-onboarding")).toBeVisible();
  await expect(page.locator("#serverModal")).toHaveCount(0);
  if (!(await page.locator("#connection-settings").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#connection-settings").click();
  await page.locator("#connection-lan").fill(base);
  await page.locator("#connection-cloud").fill("https://shop.posnic.io/api");
  await page.locator("#connection-save").click();
  await expect(page.locator("#captain-note")).toContainText("Saved");
  expect(
    await page.evaluate(() => ({
      lan: POSNIC.server.lan,
      cloud: POSNIC.server.cloud,
    })),
  ).toEqual({ lan: base, cloud: "https://shop.posnic.io/api" });
  await page.locator("#connection-back").click();
  await page.locator("#connection-back").click();
  await page.locator("#captain-change-shop").click();
  await expect(page.locator("#captain-onboarding")).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('posnic_editing_server'))).toBe('1');
});
test("a verified address update retains the current staff and pending order ownership", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate(async (base) => {
    await POSNIC.session.start({
      base,
      token: "retained",
      sessionId: "session",
      routeKey: "secret",
      user: { id: "staff" },
      shopKey: "shop",
      branches: [{ branch_id: "branch" }],
    });
    localStorage.setItem(
      "posnic.pending-orders",
      JSON.stringify([
        {
          id: "saved",
          owner: { user: "staff", shop: "shop", base, branch: "branch" },
        },
      ]),
    );
    CaptainOnboarding.open();
  }, base);
  const next = "http://192.168.1.21:42590/api";
  await page.route("http://192.168.1.21:42590/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/route-proof")
        ? {
            proof: createHmac("sha256", "secret")
              .update(route.request().postDataJSON().nonce)
              .digest("hex"),
          }
        : info,
    }),
  );
  await page.locator("#captain-address-toggle").click();
  await fillAddress(page, next);
  await page.locator("#captain-connect").click();
  await expect(page.locator("#captain-note")).toContainText("Connected");
  expect(await page.evaluate(() => POSNIC.session.user.id)).toBe("staff");
  expect(await page.evaluate(() => OrderQueue.all()[0].owner.base)).toBe(base);
  await page.evaluate(() => CaptainAccount.change("cloud"));
  expect(await page.evaluate(() => POSNIC.session.token)).toBe("retained");
});
test("expanded connection settings fit English and Arabic on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await phone(page);
  if (!(await page.locator("#connection-settings").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#connection-settings").click();
  for (const language of ["en", "ar"]) {
    await page.selectOption("#setup-language", language);
    await expect(page.locator("#connection-lan")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-builds/cloud-setup-arabic.png",
    fullPage: true,
  });
  await page.selectOption("#setup-language", "en");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#connection-back").click();
  await page.screenshot({
    path: "test-builds/cloud-setup-english.png",
    fullPage: true,
  });
});

test("connection details can be saved while locked without clearing the staff session", async ({
  page,
}) => {
  await phone(page);
  await page.evaluate(async (base) => {
    await POSNIC.session.start({
      base,
      token: "retained",
      sessionId: "original",
      routeKey: "key",
      user: { id: "staff" },
      shopKey: "shop",
    });
    await CaptainAccess.setPin("1234");
    await POSNIC.session.suspend();
    CaptainOnboarding.open();
  }, base);
  await fillAddress(page, base);
  await page.locator("#captain-connect").click();
  await expect(page.locator("#captain-note")).toContainText("Saved");
  expect(
    await page.evaluate(() => ({
      locked: CaptainAccess.locked,
      pin: CaptainAccess.pinSet,
      user: POSNIC.session.user.id,
    })),
  ).toEqual({ locked: true, pin: true, user: "staff" });
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("posnic.connection-candidates")),
    ),
  ).toEqual([base]);
});

test("native account approval bypasses WebView CORS and can reopen after a browser launch failure", async ({ page }) => {
  await phone(page);
  let browserRequests = 0;
  await page.route("https://www.posnic.com/**", route => { browserRequests++; return route.abort(); });
  await page.evaluate(() => {
    window.nativeAccountCalls = [];
    window.browserAttempts = [];
    Capacitor.Plugins.CapacitorHttp = { request: async options => {
      window.nativeAccountCalls.push(options);
      if (options.url.endsWith("/capabilities")) return { status: 200, data: { applications: ["captain"] } };
      if (options.url.endsWith("/requests")) return { status: 200, data: JSON.stringify({ request: "a".repeat(43), authorizationUrl: "https://www.posnic.com/api/mobile/authorize?request=" + "a".repeat(43), expiresIn: 900 }) };
      return { status: 202, data: { error: "authorization_pending" } };
    } };
    Capacitor.Plugins.SecureSession.openBrowser = async ({ url }) => {
      window.browserAttempts.push(url);
      if (window.browserAttempts.length === 1) throw new Error("No activity");
    };
  });
  if (!(await page.locator("#captain-cloud-login").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-cloud-login").click();
  await expect(page.locator("#captain-open-browser")).toBeVisible();
  await expect(page.locator("#captain-note")).toContainText("Try again");
  await page.locator("#captain-open-browser").click();
  await expect.poll(() => page.evaluate(() => window.browserAttempts.length)).toBe(2);
  const state = await page.evaluate(() => ({ calls: window.nativeAccountCalls, attempts: window.browserAttempts }));
  expect(state.attempts[0]).toBe(state.attempts[1]);
  expect(state.calls.filter(call => call.url.endsWith("/requests"))).toHaveLength(1);
  expect(state.calls[1].data.application).toBe("captain");
  expect(state.calls.every(call => call.disableRedirects && call.connectTimeout === 7000 && call.readTimeout === 7000)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.nativeAccountCalls.some(call => call.url.endsWith("/token"))), { timeout: 8000 }).toBe(true);
  expect(browserRequests).toBe(0);
  await page.locator("#captain-cancel").click();
  await expect(page.locator("#captain-open-browser")).toBeHidden();
  await expect(page.locator("#captain-open-browser")).not.toHaveAttribute("href");
  await expect(page.locator("#captain-cloud-login")).toBeEnabled();
});

test("canceling a pending native account request never launches the browser later", async ({ page }) => {
  await phone(page);
  await page.evaluate(() => {
    Capacitor.Plugins.CapacitorHttp = { request: () => new Promise(resolve => { window.finishAccountRequest = resolve; }) };
  });
  if (!(await page.locator("#captain-cloud-login").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-cloud-login").click();
  await expect.poll(() => page.evaluate(() => typeof window.finishAccountRequest)).toBe("function");
  await page.locator("#captain-cancel").click();
  await expect(page.locator("#captain-cloud-login")).toBeEnabled();
  await page.evaluate(() => window.finishAccountRequest({ status: 200, data: { applications: ["captain"] } }));
  await expect(page.locator("#captain-note")).toHaveText("Connection cancelled.");
  expect(await page.evaluate(() => window.openedAccount)).toBeUndefined();
  await expect(page.locator("#captain-open-browser")).toBeHidden();
});

test("Continue always uses the address; Wi-Fi discovery has its own view", async ({ page }) => {
  await phone(page);
  await fillAddress(page, "");
  await expect(page.locator("#captain-connect")).toHaveText("Continue");
  await expect(page.locator("#captain-connect")).toBeDisabled();
  await page.evaluate(base => {
    POSNIC.discovery.scanSubnet = async (_subnet, options) => options.collect({ base, info: { features: { captainAccessV1: true } } });
  }, base);
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await expect(page.locator("#captain-server")).toBeHidden();
  await expect(page.locator("#captain-results button")).toHaveCount(1);
  await page.locator("#connection-back").click();
  await fillAddress(page, base);
  await expect(page.locator("#captain-connect")).toHaveText("Continue");
  await expect(page.locator("#captain-connect")).toBeEnabled();
});


test("Try now restores a suspended native session without restarting or changing server", async ({page}) => {
  await phone(page, false);
  const requests=[];
  await page.route('**/captain/v1/session',route=>{
    requests.push(route.request().headers().authorization);
    return route.fulfill({json:{status:true}});
  });
  await page.evaluate(async base=>{
    POSNIC.server.pin(base);
    await CaptainAccess.session.start({base,token:'resume-access',sessionId:'session',shopKey:'shop',user:{id:'staff'},expiresIn:900});
    await CaptainAccess.session.suspend();
    POSNIC.net.setOffline();
  },base);
  await expect(page.locator('#posnic-offline')).toBeVisible();
  await page.getByRole('button',{name:'Try now',exact:true}).click();
  await expect(page.locator('#posnic-offline')).toBeHidden();
  expect(requests).toContain('Bearer resume-access');
  expect(await page.evaluate(()=>CaptainAccess.session.active)).toBe(true);
  expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(base);
});

test("foreground health checks wait for native session restore after a delayed lock", async ({page}) => {
  await phone(page);
  await page.route('**/captain/v1/session',route=>route.fulfill({json:{status:true}}));
  await page.evaluate(async base=>{
    POSNIC.server.pin(base);
    await CaptainAccess.session.start({base,token:'resume-access',sessionId:'session',shopKey:'shop',user:{id:'staff'},expiresIn:900});
    const lock=Capacitor.Plugins.SecureSession.lock;
    Capacitor.Plugins.SecureSession.lock=async()=>{await new Promise(resolve=>setTimeout(resolve,150));return lock();};
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    document.dispatchEvent(new Event('visibilitychange'));
    await POSNIC.api.get('/captain/v1/session');
  },base);
  expect(await page.evaluate(()=>CaptainAccess.session.token)).toBe('resume-access');
  expect(await page.evaluate(()=>POSNIC.net.offline)).toBe(false);
  await expect(page.locator('#posnic-offline')).toBeHidden();
});


test("Retry finds a moved till on its custom port and never authorizes a neighbouring shop", async ({page}) => {
  await phone(page);
  const key='a'.repeat(64), moved='http://192.168.1.44:42590/api';
  const authorized=[];
  await page.route('http://192.168.1.*/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if (request.headers().authorization) authorized.push(request.url());
    if (url.port!=='42590' || !['192.168.1.2','192.168.1.44'].includes(url.hostname)) return route.abort('connectionrefused');
    if (url.pathname.endsWith('/runtime-info')) return route.fulfill({json:info});
    if (url.pathname.endsWith('/route-proof')) {
      expect(request.headers().authorization).toBeUndefined();
      const proof=url.hostname==='192.168.1.44'?createHmac('sha256',key).update(request.postDataJSON().nonce).digest('hex'):'another-shop';
      return route.fulfill({json:{proof}});
    }
    return route.fulfill({json:{status:true}});
  });
  const recovered=await page.evaluate(async ({base,key})=>{
    POSNIC.server.pin(base);
    await CaptainAccess.session.start({base,token:'secret-access',sessionId:'session',routeKey:key,shopKey:'shop',user:{id:'staff'},expiresIn:900});
    return POSNIC.net.check(true);
  },{base,key});
  expect(recovered).toBe(true);
  expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(moved);
  expect(authorized.length).toBeGreaterThan(0);
  expect(authorized.every(url=>url.startsWith(moved+'/'))).toBe(true);
  expect(await page.evaluate(()=>CaptainAccess.session.token)).toBe('secret-access');
});


test("approval stays pending in the browser and exchanges only after Captain returns", async ({ page }) => {
  await phone(page);
  let exchanges = 0, pairs = 0;
  await page.route("https://www.posnic.com/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("capabilities")) return route.fulfill({json:{applications:["captain"]}});
    if (path.endsWith("requests")) return route.fulfill({json:{request:"a".repeat(43), authorizationUrl:"https://www.posnic.com/api/mobile/authorize?request=approved", expiresIn:900}});
    exchanges++;
    return route.fulfill({json:{baseUrl:"https://azure.posnic.io/api",code,localServers:[]}});
  });
  await page.route("https://azure.posnic.io/**", route => {
    pairs++;
    return route.fulfill({json:{token:"access",sessionId:"session",expiresIn:900,shopKey:"shop",user:{id:"staff"},branches:[{branch_id:"branch",store_id:"branch"}]}});
  });
  await page.evaluate(() => {
    const timeout = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 5000 ? 10 : ms, ...args);
    Capacitor.Plugins.SecureSession.openBrowser = async () => {
      Object.defineProperty(document,"hidden",{configurable:true,value:true});
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
  if (!(await page.locator("#captain-cloud-login").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-cloud-login").click();
  await page.waitForTimeout(150);
  expect(exchanges).toBe(0);
  expect(pairs).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document,"hidden",{configurable:true,value:false});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => window.selectedCaptainBranch)).toBe("branch");
  expect(exchanges).toBe(1);
  expect(pairs).toBe(1);
});

test("a bare domain stays editable during discovery and supports changing server after sign-in selection", async ({ page }) => {
  await page.setViewportSize({width:360,height:800});
  await phone(page);
  await page.route("https://azure.posnic.io/**", route => route.fulfill({json:info}));
  const input = page.locator("#captain-server");
  await expect(input).toHaveAttribute("placeholder","azure.posnic.io");
  await input.fill("azure.posnic.io");
  await page.evaluate(() => POSNIC.server.adopt("http://192.168.1.8:42590/api"));
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("azure.posnic.io");
  const box = await input.boundingBox();
  expect(box.width).toBeGreaterThan(230);
  await page.screenshot({path:"test-artifacts/server-domain-phone.png",fullPage:true});
  await input.press("Enter");
  await expect(page.locator("#captain-selected-shop")).toHaveText("azure.posnic.io");
  await expect(page.locator("#captain-change-shop")).toHaveText("Change server");
  await page.locator("#captain-change-shop").click();
  await page.locator("#captain-address-toggle").click();
  await expect(input).toBeVisible();
  await input.fill("192.168.1.8:42590");
  await input.press("Enter");
  await expect(page.locator("#captain-selected-shop")).toHaveText("192.168.1.8:42590");
});


test("expired cloud exchange recovers once without another browser approval", async ({ page }) => {
  await phone(page);
  let approvals = 0, pairs = 0, exchanges = 0;
  await page.evaluate(() => {
    const timeout = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 5000 ? 10 : ms, ...args);
  });
  await page.route("https://www.posnic.com/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("capabilities")) return route.fulfill({json:{applications:["captain"]}});
    if (path.endsWith("requests")) {
      approvals++;
      return route.fulfill({json:{request:String(approvals).repeat(43),authorizationUrl:"https://www.posnic.com/api/mobile/authorize?request=fresh",expiresIn:900}});
    }
    exchanges++;
    if (exchanges === 2) expect(route.request().postDataJSON().recover).toBe(true);
    return route.fulfill({json:{baseUrl:"https://azure.posnic.io/api",code:exchanges===1?code:"123456ABCDEF",localServers:[]}});
  });
  await page.route("https://azure.posnic.io/**", route => {
    pairs++;
    if (pairs===1) return route.fulfill({status:401,json:{error:{code:"PAIR_EXPIRED",message:"This pairing code expired or was already used."}}});
    expect(route.request().postDataJSON().code).toBe("123456ABCDEF");
    return route.fulfill({json:{token:"access",sessionId:"session",expiresIn:900,shopKey:"shop",user:{id:"staff"},branches:[{branch_id:"branch",store_id:"branch"}]}});
  });
  if (!(await page.locator("#captain-cloud-login").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-cloud-login").click();
  await expect.poll(() => page.evaluate(() => window.selectedCaptainBranch)).toBe("branch");
  expect(approvals).toBe(1);
  expect(exchanges).toBe(2);
  expect(pairs).toBe(2);
});


test("pairing and backup addresses are focused views with a lossless Back action", async ({ page }) => {
  await phone(page);
  await fillAddress(page, "azure.posnic.io");
  if (!(await page.locator("#captain-code-toggle").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-code-toggle").click();
  await expect(page.locator("#captain-code")).toBeVisible();
  await expect(page.locator("#captain-cloud-login")).toBeHidden();
  await expect(page.locator("#captain-connect")).toBeHidden();
  await expect(page.locator("#connection-lan")).toBeHidden();
  await page.locator("#connection-back").click();
  await expect(page.locator("#captain-server")).toHaveValue("azure.posnic.io");
  await expect(page.locator("#captain-code")).toBeHidden();
  if (!(await page.locator("#connection-settings").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#connection-settings").click();
  await expect(page.locator("#connection-lan")).toBeVisible();
  await expect(page.locator("#captain-server")).toBeHidden();
  await expect(page.locator("#captain-cloud-login")).toBeHidden();
  await page.locator("#connection-back").click();
  await expect(page.locator("#captain-server")).toHaveValue("azure.posnic.io");
  await expect(page.locator("#captain-connect")).toBeEnabled();
});

test("Back cancels discovery and late results cannot replace the address screen", async ({ page }) => {
  await phone(page);
  await fillAddress(page, "azure.posnic.io");
  await page.evaluate(() => {
    POSNIC.discovery.scanSubnet = async (_subnet, options) => {
      window.finishDiscovery = () => options.collect({ base: "http://192.168.1.9:5555/api", info: { features: {} } });
      await new Promise(() => {});
    };
  });
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await expect.poll(() => page.evaluate(() => typeof window.finishDiscovery)).toBe("function");
  await page.locator("#connection-back").click();
  await page.evaluate(() => window.finishDiscovery());
  await expect(page.locator("#captain-server")).toHaveValue("azure.posnic.io");
  await expect(page.locator("#captain-connect")).toBeEnabled();
  await expect(page.locator("#captain-results")).toBeHidden();
  await expect(page.locator("#captain-results button")).toHaveCount(0);
});


test("leaving a selected Wi-Fi result cancels its pending navigation", async ({ page }) => {
  await phone(page);
  await page.evaluate(base => {
    POSNIC.discovery.scanSubnet = async (_subnet, options) => options.collect({ base, info: { features: {} } });
    POSNIC.discovery.probe = () => new Promise(resolve => { window.finishSelectedAddress = resolve; });
  }, base);
  if (!(await page.locator("#captain-search").isVisible())) await page.locator("#connection-back").click();
  await page.locator("#captain-search").click();
  await page.locator("#captain-results button").click();
  await expect.poll(() => page.evaluate(() => typeof window.finishSelectedAddress)).toBe("function");
  await page.locator("#connection-back").click();
  await page.evaluate(base => window.finishSelectedAddress({ base }), base);
  await expect(page.locator("#captain-address-toggle")).toBeVisible();
  await expect(page.locator("#username")).toBeHidden();
  expect(await page.evaluate(() => POSNIC.server.isConfigured)).toBe(false);
});

for (const width of [320, 900]) test(`sign-in recovery keeps staff input and native Back at ${width}px`, async ({page}) => {
  await phone(page);
  await page.setViewportSize({width,height:850});
  await page.emulateMedia({colorScheme:'dark'});
  await fillAddress(page,base);
  await page.locator('#captain-connect').click();
  await expect(page.locator('#username')).toBeVisible();
  await page.locator('#username').fill('staff-name');
  await page.locator('#captain-login-help').click();
  await expect(page.locator('#captain-recovery')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-artifacts/recovery-${width}.png`,fullPage:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('#captain-recovery')).toHaveCount(0);
  await expect(page.locator('#username')).toHaveValue('staff-name');
  await page.locator('#captain-login-help').click();
  await page.locator('[data-recovery=password]').click();
  await expect(page.locator('#password')).toBeFocused();
  await page.screenshot({path:`test-artifacts/signin-dark-${width}.png`,fullPage:true});
});


for (const screen of ['address','settings']) test(`Back during ${screen} verification ignores late completion`, async ({page})=>{
  await phone(page);
  await page.evaluate(async base=>{
    await POSNIC.session.start({base,token:'retained',sessionId:'session',routeKey:'secret',
      user:{id:'staff'},shopKey:'shop',branches:[{branch_id:'branch'}]});
    POSNIC.discovery.probe=async base=>({base});
    window.addressCalls=[];
    POSNIC.session.addAddress=async (base,signal)=>{
      window.addressCalls.push(base);
      window.addressSignal=signal;
      await new Promise(resolve=>window.finishAddress=resolve);
    };
    CaptainOnboarding.open();
  },base);
  if(screen==='settings'){
    await page.locator('#connection-settings').click();
    await page.locator('#connection-lan').fill(base);
    await page.locator('#connection-cloud').fill('https://shop.posnic.io/api');
    await page.locator('#connection-save').click();
  }else{
    await page.locator('#captain-address-toggle').click();
    await fillAddress(page,base);
    await page.locator('#captain-connect').click();
  }
  await page.waitForFunction(()=>window.finishAddress);
  await page.locator('#connection-back').click();
  expect(await page.evaluate(()=>window.addressSignal?.aborted)).toBe(true);
  await page.evaluate(()=>window.finishAddress());
  await expect(page.locator('#captain-onboarding')).toHaveAttribute('data-setup-view','start');
  await expect(page.locator('#captain-note')).toHaveText('');
  await expect(page.locator('#connection-settings')).toBeEnabled();
  expect(await page.evaluate(()=>window.addressCalls.length)).toBe(1);
  expect(await page.evaluate(()=>POSNIC.session.user.id)).toBe('staff');
});


for (const [width, count] of [[320, 1], [900, 2]]) {
  test(`Wi-Fi cards require Connect before staff sign-in at ${width}px`, async ({ page }) => {
    await phone(page, false);
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(count => {
      POSNIC.discovery.scanSubnet = async (_subnet, options) => {
        for (let i = 0; i < count; i++) options.collect({
          base: `http://192.168.1.${8 + i}:42590/api`, info: { features: { captainAccessV1: true } },
        });
      };
      POSNIC.discovery.probe = base => new Promise(resolve => {
        window.finishServerSelection = () => resolve({ base, info: { features: {} } });
      });
    }, count);
    await page.locator('#captain-search').click();
    const cards = page.locator('#captain-results button');
    await expect(cards).toHaveCount(count);
    await expect(cards.first()).toContainText('Connect');
    await expect(cards.first().locator('.setup-server-icon svg')).toBeVisible();
    expect(await cards.first().locator('strong').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(120);
    await expect(page.locator('#username')).toBeHidden();
    await expect(page.locator('#password')).toBeHidden();
    expect(await page.evaluate(() => POSNIC.server.isConfigured)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-artifacts/discovery-choice-${width}.png`, fullPage: true });
    await cards.last().click();
    await expect(cards.last()).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#username')).toBeHidden();
    await page.evaluate(() => window.finishServerSelection());
    await expect(page.locator('#captain-onboarding')).toBeHidden();
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#captain-selected-shop')).toHaveText(`192.168.1.${7 + count}:42590`);
    await expect(page.locator('#setup-signin-step')).toHaveAttribute('aria-current', 'step');
    await page.screenshot({ path: `test-artifacts/discovery-signin-${width}.png`, fullPage: true });
    await page.locator('#password').fill('private-password');
    await page.locator('#captain-change-shop').click();
    await expect(page.locator('#username')).toBeHidden();
    await expect(page.locator('#password')).toHaveValue('private-password');
    await expect(page.locator('#captain-search')).toBeVisible();
  });
}

test('failed Wi-Fi selection keeps credentials hidden and permits another server', async ({ page }) => {
  await phone(page, false);
  await page.evaluate(() => {
    POSNIC.discovery.scanSubnet = async (_subnet, options) => {
      for (const host of [8, 9]) options.collect({ base: `http://192.168.1.${host}:42590/api`, info: { features: {} } });
    };
    POSNIC.discovery.probe = async base => base.includes('.8:') ? null : { base, info: { features: {} } };
  });
  await page.locator('#captain-search').click();
  const cards = page.locator('#captain-results button');
  await expect(cards).toHaveCount(2);
  await cards.first().click();
  await expect(page.locator('#captain-note')).toContainText('Could not reach this shop');
  await expect(page.locator('#username')).toBeHidden();
  await expect(cards.last()).toBeEnabled();
  await cards.last().click();
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#captain-selected-shop')).toHaveText('192.168.1.9:42590');
});


test('successful staff sign-in remembers server-scoped usernames and preserves exact passwords', async ({ page }) => {
  await phone(page);
  await fillAddress(page, base);
  await page.locator('#captain-connect').click();
  await expect(page.locator('#username')).toBeVisible();
  await page.evaluate(() => {
    POSNIC.api.post = async (_path, payload) => {
      window.signinPayload = payload;
      return { user: { id: 'staff' }, branches: [{ store_id: 'one' }, { store_id: 'two' }] };
    };
    POSNIC.session.start = async () => {};
  });
  await page.locator('#username').fill('alex.staff');
  await page.locator('#password').fill('  exact password  ');
  await page.locator('#password').press('Enter');
  await expect(page.locator('#branch-section')).toBeVisible();
  expect(await page.evaluate(() => window.signinPayload.password)).toBe('  exact password  ');
  const saved = await page.evaluate(() => localStorage.getItem('posnic.signin-names.v1'));
  expect(JSON.parse(saved)).toEqual([{ base, names: ['alex.staff'] }]);
  expect(saved).not.toContain('password');
  await page.reload();
  await expect(page.locator('#username')).toHaveValue('alex.staff');
  await expect(page.locator('#saved-usernames option')).toHaveAttribute('value', 'alex.staff');
  await page.locator('#username').fill('alex');
  await expect(page.locator('.saved-signin-choices button')).toHaveText(['alex.staff']);
  await page.locator('.saved-signin-choices button').click();
  await expect(page.locator('#username')).toHaveValue('alex.staff');
  await expect(page.locator('#password')).toBeFocused();
  await expect(page.locator('#username')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#password')).toHaveAttribute('name', 'password');
});

test('same-server setup preserves typed credentials while another server clears them', async ({ page }) => {
  await phone(page);
  await fillAddress(page, base);
  await page.locator('#captain-connect').click();
  await page.locator('#username').fill('current.staff');
  await page.locator('#password').fill('current-secret');
  await page.locator('#captain-change-shop').click();
  await page.locator('#captain-address-toggle').click();
  await page.locator('#captain-connect').click();
  await expect(page.locator('#username')).toHaveValue('current.staff');
  await expect(page.locator('#password')).toHaveValue('current-secret');
  await page.evaluate(() => CaptainSignIn.remember('https://other.posnic.io/api', 'other.staff'));
  await page.route('https://other.posnic.io/**', route => route.fulfill({ json: info }));
  await page.locator('#captain-change-shop').click();
  await page.locator('#captain-address-toggle').click();
  await page.locator('#captain-server').fill('other.posnic.io');
  await page.locator('#captain-connect').click();
  await expect(page.locator('#username')).toHaveValue('other.staff');
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.locator('#saved-usernames option')).toHaveCount(1);
  await expect(page.locator('#saved-usernames option')).toHaveAttribute('value', 'other.staff');
  await page.locator('#username').fill('');
  await expect(page.locator('.saved-signin-choices button')).toHaveText(['other.staff']);
});

test('rejected login does not enter username suggestions and repeated Enter submits once', async ({ page }) => {
  await phone(page);
  await fillAddress(page, base);
  await page.locator('#captain-connect').click();
  await page.evaluate(() => {
    window.loginCalls = 0;
    POSNIC.api.post = () => { window.loginCalls++; return new Promise((_resolve, reject) => {
      window.rejectLogin = () => reject(Object.assign(new Error('Not accepted'), { status: 401 }));
    }); };
  });
  await page.locator('#username').fill('mistyped');
  await page.locator('#password').fill('wrong');
  await page.evaluate(() => { doLogin(); doLogin(); });
  expect(await page.evaluate(() => window.loginCalls)).toBe(1);
  await page.evaluate(() => window.rejectLogin());
  await expect(page.locator('#login-message')).toHaveText('Not accepted');
  expect(await page.evaluate(() => localStorage.getItem('posnic.signin-names.v1'))).toBeNull();
});

for(const theme of ['light','dark'])test(`connection choices and focused address ${theme}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await phone(page,false);
 await page.evaluate(theme=>window.CaptainAppearance.set(theme),theme);
 await expect(page.locator('#captain-search')).toBeVisible();
 for(const id of ['captain-scan','captain-code-toggle']){
  const colors=await page.locator('#'+id).evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));
  expect(colors.bg).not.toBe(colors.fg);if(theme==='dark')expect(colors.bg).not.toBe('rgb(248, 250, 252)');
 }
 await page.screenshot({path:`test-artifacts/connection-choices-${theme}.png`,fullPage:true});
 await page.locator('#captain-address-toggle').click();await expect(page.locator('#setup-methods')).toBeHidden();
 await page.locator('#captain-server').fill('my-shop.example');
 await page.locator('#connection-back').click();await page.locator('#captain-address-toggle').click();
 await expect(page.locator('#captain-server')).toHaveValue('my-shop.example');
 await page.screenshot({path:`test-artifacts/connection-address-${theme}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const theme of ['light','dark'])test(`saved connection returns directly to orders ${theme}`,async({page})=>{
 await phone(page,false);
 await expect(page.locator('#connection-orders')).toBeHidden();
 await page.evaluate(async({base,theme})=>{
  await POSNIC.session.start({base,token:'retained',sessionId:'session',routeKey:'secret',user:{id:'staff'},shopKey:'shop',branches:[{branch_id:'branch'}]});
  CaptainAppearance.set(theme);CaptainOnboarding.open();
 },{base,theme});
 await page.route('**/captain/v1/route-proof',route=>route.fulfill({json:{proof:createHmac('sha256','secret').update(route.request().postDataJSON().nonce).digest('hex')}}));
 await page.locator('#connection-settings').click();
 await expect(page.locator('#connection-orders')).toBeVisible();await expect(page.locator('.setup-steps')).toBeHidden();
 await page.locator('#connection-lan').fill(base);await page.locator('#connection-cloud').fill('');await page.locator('#connection-save').click();
 await expect(page.locator('#captain-note')).toContainText('Saved');await expect(page.locator('#connection-done')).toBeVisible();
 expect(await page.evaluate(()=>POSNIC.session.user.id)).toBe('staff');
 await page.screenshot({path:`test-artifacts/connection-return-${theme}.png`,fullPage:true});
 await page.route('**/kot-management.html',r=>r.fulfill({contentType:'text/html',body:'<h1>Orders</h1>'}));
 await page.locator('#connection-done').click();await expect(page).toHaveURL(/kot-management.html/);
 expect(await page.evaluate(()=>sessionStorage.getItem('posnic_editing_server'))).toBeNull();
});
