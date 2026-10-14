import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cacheProductImages,
  productImageUrl,
  readImage,
  imageKey,
  type ImageFiles,
} from "../src/services/imageCache";
import { trainingItems, trainingShop } from "../src/data/training";
const shop = {
  ...trainingShop,
  mode: "live" as const,
  baseUrl: "http://192.168.1.2:5555/api",
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
test("image URLs stay credential-free and local images use the paired API path", () => {
  assert.equal(
    productImageUrl("/uploads/a.png", shop.baseUrl),
    "http://192.168.1.2:5555/api/uploads/a.png",
  );
  assert.equal(
    productImageUrl("https://cdn.example/a.png", shop.baseUrl),
    "https://cdn.example/a.png",
  );
  for (const url of [
    "file:///secret",
    "javascript:alert(1)",
    "https://user:password@cdn.example/a",
    "http://other-host/a",
  ])
    assert.equal(productImageUrl(url, shop.baseUrl), null);
});

test("image cleanup retains all active images and cancellation never starts cleanup", async () => {
  const item = { ...trainingItems[0]!, image: "/uploads/current.png" };
  const scope = JSON.stringify([shop.baseUrl, shop.id, shop.branchId]);
  const key = imageKey(scope, productImageUrl(item.image, shop.baseUrl)!);
  let cleanups = 0;
  const files: ImageFiles = {
    get: async () => "file:cached",
    put: async () => {
      throw Error("must not download");
    },
    prune: async (keep) => {
      cleanups++;
      assert.deepEqual([...keep], [key]);
    },
  };
  await cacheProductImages(
    [item],
    shop,
    files,
    new AbortController().signal,
    () => {},
  );
  const stopped = new AbortController();
  stopped.abort();
  await cacheProductImages([], shop, files, stopped.signal, () => {});
  assert.equal(cleanups, 1);
});
test("completed images survive retries; failed transfers do not publish or block other products", async () => {
  const saved = new Map<string, string>();
  const files: ImageFiles = {
    get: async (key) => saved.get(key) ?? null,
    put: async (key) => {
      saved.set(key, "file:" + key);
      return "file:" + key;
    },
  };
  const items = trainingItems
    .slice(0, 2)
    .map((item, index) => ({ ...item, image: "/uploads/" + index + ".png" }));
  let requests = 0;
  const first: typeof fetch = async (url) => {
    requests++;
    if (String(url).includes("1.png")) throw Error("offline");
    return new Response(png, {
      headers: { "Content-Type": "image/png" },
    });
  };
  const ready: string[] = [];
  await cacheProductImages(
    items,
    shop,
    files,
    new AbortController().signal,
    (id) => ready.push(id),
    first,
  );
  assert.equal(saved.size, 1);
  assert.deepEqual(ready, [items[0]!.id]);
  requests = 0;
  await cacheProductImages(
    items,
    shop,
    files,
    new AbortController().signal,
    () => {},
    async () => {
      requests++;
      return new Response(png, {
        headers: { "Content-Type": "image/png" },
      });
    },
  );
  assert.equal(requests, 1);
  assert.equal(saved.size, 2);
});
test("oversized, non-image and interrupted streams are rejected before persistence", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    readImage(
      "https://example.test",
      signal,
      async () =>
        new Response("<html>not an image</html>", {
          headers: { "Content-Type": "image/png" },
        }),
    ),
    /invalidImage/,
  );
  await assert.rejects(
    readImage(
      "https://example.test",
      signal,
      async () =>
        new Response("html", { headers: { "Content-Type": "text/html" } }),
    ),
    /invalidImage/,
  );
  await assert.rejects(
    readImage(
      "https://example.test",
      signal,
      async () =>
        new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
          headers: { "Content-Type": "image/png" },
        }),
    ),
    /invalidImage/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readImage(
      "https://example.test",
      controller.signal,
      async () =>
        new Response(new Uint8Array([1]), {
          headers: { "Content-Type": "image/png" },
        }),
    ),
    /cancelled/,
  );
});

test("desktop root uploads are cached after an API-path 404 and work offline", async () => {
  const saved = new Map<string, string>();
  const files: ImageFiles = {
    get: async (key) => saved.get(key) ?? null,
    put: async (key, bytes) => {
      assert.deepEqual(bytes, png);
      saved.set(key, "file:" + key);
      return "file:" + key;
    },
  };
  const item = { ...trainingItems[0]!, image: "/uploads/demo/product.png" };
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.headers, undefined);
    return String(url).includes("/api/uploads/")
      ? new Response("{}", { status: 404 })
      : new Response(png, { headers: { "Content-Type": "image/png" } });
  };
  await cacheProductImages(
    [item],
    shop,
    files,
    new AbortController().signal,
    () => {},
    fetcher,
  );
  assert.deepEqual(calls, [
    shop.baseUrl + "/uploads/demo/product.png",
    "http://192.168.1.2:5555/uploads/demo/product.png",
  ]);
  assert.equal(saved.size, 1);
  let shown = 0;
  await cacheProductImages(
    [item],
    shop,
    files,
    new AbortController().signal,
    () => {
      shown++;
    },
    async () => {
      throw Error("offline");
    },
  );
  assert.equal(shown, 1);
});

test("upload fallback does not retry permissions, foreign origins, non-upload paths or redirects", async () => {
  for (const [url, status] of [
    [shop.baseUrl + "/uploads/a.png", 403],
    [shop.baseUrl + "/uploads/a.png", 401],
    [shop.baseUrl + "/uploads/a.png", 302],
    ["https://cdn.example/api/uploads/a.png", 404],
    [shop.baseUrl + "/private/a.png", 404],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      () =>
        readImage(
          url,
          new AbortController().signal,
          async () => {
            calls++;
            return new Response("{}", { status });
          },
          shop.baseUrl,
        ),
      /invalidImage/,
    );
    assert.equal(calls, 1);
  }
});
