import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Windows + Turbopack can take over two minutes to compile the first route
  // in a cold workspace; journey assertions get their own deterministic room.
  timeout: 300_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The first Next development compilation is intentionally serialized
  // locally; two browser engines compiling the same route can exceed the
  // navigation timeout on Windows even though the production build is valid.
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["iPhone 13"] } },
    {
      name: "chromium-320",
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 800 }, hasTouch: true },
    },
  ],
  webServer: {
    // Browser tests exercise the same optimized artifact shipped to Vercel.
    // This is slower on a cold checkout, but avoids development compiler races
    // and guarantees that a standalone test command cannot use a stale build.
    command: `npm run build && npx --no-install next start --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});
