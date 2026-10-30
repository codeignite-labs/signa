import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "react-native": fileURLToPath(
        new URL("./tests/sdk/native-platform.tsx", import.meta.url),
      ),
      "react-native-webview": fileURLToPath(
        new URL("./tests/sdk/native-webview.tsx", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/sdk/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/sdk/setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/signa-react/src/**/*.{ts,tsx}",
        "packages/signa-react/browser/*.js",
        "packages/signa-react-native/src/**/*.{ts,tsx}",
      ],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage/sdk",
      thresholds: {
        perFile: true,
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95,
      },
    },
  },
});
