import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { NextConfig } from "next";

const rootEnvKeys = new Set([
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_SIGNING_BASE_URL",
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  "NEXT_PUBLIC_MARKETING_URL",
  "INTERNAL_API_URL",
  "NEXT_OUTPUT",
]);

const workspaceRoot = resolveWorkspaceRoot();

loadWorkspaceFrontendEnv(workspaceRoot);

const internalApiUrl = (
  process.env.INTERNAL_API_URL ?? "http://127.0.0.1:3001"
).replace(/\/$/, "");
const apiRewriteTarget = internalApiUrl.endsWith("/api")
  ? internalApiUrl
  : `${internalApiUrl}/api`;
const marketingUrl = (
  process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3002"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  async redirects() {
    return [
      ...["docs", "guides", "resources"].map((section) => ({
        source: `/${section}/:path*`,
        destination: `${marketingUrl}/${section}/:path*`,
        permanent: false,
      })),
      {
        source: "/compliance",
        destination: `${marketingUrl}/compliance`,
        permanent: false,
      },
      {
        source: "/qualified-electronic-signature",
        destination: `${marketingUrl}/qualified-electronic-signature`,
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiRewriteTarget}/:path*`,
      },
    ];
  },
  images: {
    unoptimized: process.env.NEXT_OUTPUT === "export",
    remotePatterns: [
      {
        hostname: "localhost",
        pathname: "/api/storage/blobs/**",
        port: "3001",
        protocol: "http",
      },
    ],
  },
  output: process.env.NEXT_OUTPUT === "export" ? "export" : undefined,
  transpilePackages: ["@repo/shared"],
};

export default nextConfig;

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd();

  if (basename(cwd) === "frontend" && basename(dirname(cwd)) === "apps") {
    return resolve(cwd, "../..");
  }

  return cwd;
}

function loadWorkspaceFrontendEnv(root: string): void {
  for (const filename of [".env.local", ".env"]) {
    const envPath = resolve(root, filename);

    if (existsSync(envPath)) {
      loadEnvFile(envPath);
    }
  }
}

function loadEnvFile(envPath: string): void {
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;

    if (!rootEnvKeys.has(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = normalizeEnvValue(rawValue);
  }
}

function normalizeEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
  const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');

  if (isSingleQuoted || isDoubleQuoted) {
    return value.slice(1, -1);
  }

  return value.replace(/\s+#.*$/, "");
}
