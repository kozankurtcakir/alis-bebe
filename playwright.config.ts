import { defineConfig, devices } from "@playwright/test";

const url = "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/hazirlik.ts",
  globalTeardown: "./e2e/temizlik.ts",
  forbidOnly: !!process.env.CI,
  use: { baseURL: url, locale: "tr-TR" },
  projects: [
    {
      name: "masaustu",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@yuk/,
    },
    { name: "mobil", use: { ...devices["Pixel 7"] }, grepInvert: /@yuk/ },
    // Binlerce kayıt yazan testler; öbür testlerin listelerini bozmasın diye en sonda.
    {
      name: "yuk",
      use: { ...devices["Desktop Chrome"] },
      grep: /@yuk/,
      dependencies: ["masaustu", "mobil"],
    },
  ],
  // Önce "npm run build" gerekir: testler gerçek üretim derlemesine karşı çalışır.
  webServer: {
    command: "npm run start -- -p 3100",
    url,
    reuseExistingServer: false,
    env: { SITE_URL: url },
  },
});
