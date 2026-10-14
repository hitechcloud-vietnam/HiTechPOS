import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:8082",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "node scripts/serve-preview.mjs",
    url: "http://127.0.0.1:8082",
    reuseExistingServer: true,
  },
  reporter: "list",
});
