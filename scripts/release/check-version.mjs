import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function checkVersion(root = process.cwd(), tag) {
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  const json = (path) => JSON.parse(read(path));
  const version = json("package.json").version;
  if (!stableVersion.test(version))
    throw new Error("Expected a stable MAJOR.MINOR.PATCH application version");
  if (tag !== undefined && tag !== `v${version}`)
    throw new Error(`Tag must match v${version}`);
  for (const app of ["backend", "frontend"]) {
    if (json(`apps/${app}/package.json`).version !== version)
      throw new Error(`${app} version differs from application version`);
  }
  if (json(".release-please-manifest.json")["."] !== version)
    throw new Error("Release manifest version differs");
  const defaults = [
    ["Dockerfile", /ARG APP_VERSION=([^\s]+)/g],
    ["docker-compose.yml", /APP_VERSION:\s*\$\{APP_VERSION:-([^}]+)\}/g],
    ["apps/backend/src/env.schema.ts", /APP_VERSION:.*?default\('([^']+)'\)/g],
    ["apps/backend/src/app.service.ts", /APP_VERSION'\)\s*\|\|\s*'([^']+)'/g],
  ];
  for (const [path, pattern] of defaults) {
    const values = [...read(path).matchAll(pattern)].map((match) => match[1]);
    if (!values.length || values.some((value) => value !== version))
      throw new Error(`Version default drift in ${path}`);
  }
  return version;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--tag"))
    throw new Error("Usage: check-version.mjs [--tag vMAJOR.MINOR.PATCH]");
  console.log(
    `Application version verified: ${checkVersion(process.cwd(), args[1])}`,
  );
}
