import { defineConfig, devices } from "@playwright/test";

const url = "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  use: { baseURL: url, locale: "tr-TR" },
  projects: [
    { name: "masaustu", use: { ...devices["Desktop Chrome"] } },
    { name: "mobil", use: { ...devices["Pixel 7"] } },
  ],
  // Önce "npm run build" gerekir: testler gerçek üretim derlemesine karşı çalışır.
  webServer: {
    command: "npm run start -- -p 3100",
    url,
    reuseExistingServer: false,
    env: { SITE_URL: url },
  },
});
