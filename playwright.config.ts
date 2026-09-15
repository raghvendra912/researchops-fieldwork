import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const localPort = process.env.DEV_PORT ?? "3001";
const localBaseUrl = `http://127.0.0.1:${localPort}`;
const browserPath = process.env.E2E_BROWSER_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseUrl ? undefined : {
    command: "npm run dev",
    url: `${localBaseUrl}/api/health`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...(browserPath ? { launchOptions: { executablePath: browserPath } } : {}) } },
  ],
});
