import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "next/navigation": fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/next/navigation.js",
          import.meta.url,
        ),
      ),
      "@": fileURLToPath(new URL("./apps/frontend", import.meta.url)),
      "@repo/shared/branding": fileURLToPath(
        new URL("./packages/shared/src/branding.ts", import.meta.url),
      ),
      "@repo/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/frontend/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/frontend/setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "apps/frontend/app/**/*.{ts,tsx}",
        "apps/frontend/components/**/*.{ts,tsx}",
        "apps/frontend/lib/**/*.{ts,tsx}",
      ],
      exclude: ["**/*.d.ts"],
      reporter: ["text-summary", "json", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage/frontend",
      // Full-app ratchet is an honest initial floor, not the 95% tracking goal.
      thresholds: {
        lines: 3.2,
        statements: 3.1,
        functions: 1.6,
        branches: 3.4,
        "apps/frontend/lib/api/http.ts": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 95,
        },
        "apps/frontend/app/auth-route-guard.tsx": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 95,
        },
        "apps/frontend/lib/branding/branding-cache.ts": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 95,
        },
        "apps/frontend/lib/forms/auth-forms.ts": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 95,
        },
      },
    },
  },
});
