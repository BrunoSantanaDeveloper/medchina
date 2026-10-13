import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // The app's tsconfig says `jsx: "preserve"` because Next compiles JSX itself.
  // Vitest has no Next in front of it, so a `.test.tsx` that renders a
  // component reached the parser as raw JSX and failed — which is why the suite
  // had no component tests although @testing-library/react is installed. The
  // transform is set here, for tests only; the app build is untouched.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
  },
});
