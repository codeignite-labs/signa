import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "nextjs-toploader": fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/nextjs-toploader/dist/index.js",
          import.meta.url,
        ),
      ),
      papaparse: fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/papaparse/papaparse.js",
          import.meta.url,
        ),
      ),
      "read-excel-file/browser": fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/read-excel-file/browser/index.js",
          import.meta.url,
        ),
      ),
      "canvas-confetti": fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/canvas-confetti/dist/confetti.module.mjs",
          import.meta.url,
        ),
      ),
      "qr-creator": fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/qr-creator/dist/qr-creator.es6.min.js",
          import.meta.url,
        ),
      ),
      "@tanstack/react-query": fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/@tanstack/react-query/build/modern/index.js",
          import.meta.url,
        ),
      ),
      "react-signature-canvas": fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/react-signature-canvas/dist/index.mjs",
          import.meta.url,
        ),
      ),
      sonner: fileURLToPath(
        new URL(
          "./apps/frontend/node_modules/sonner/dist/index.mjs",
          import.meta.url,
        ),
      ),
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
    // Bound jsdom workers so full-app coverage stays within local and CI memory.
    maxWorkers: 4,
    include: ["tests/frontend/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/frontend/setup.ts"],
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      include: [
        "apps/frontend/app/**/*.{ts,tsx}",
        "apps/frontend/components/**/*.{ts,tsx}",
        "apps/frontend/lib/**/*.{ts,tsx}",
      ],
      exclude: ["**/*.d.ts"],
      reporter: ["text-summary", "json", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage/frontend",
      // All authored runtime files remain in scope, including unimported modules.
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95,
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
