import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkVersion } from "./check-version.mjs";

const paths = [
  "package.json",
  "apps/backend/package.json",
  "apps/frontend/package.json",
  ".release-please-manifest.json",
  "Dockerfile",
  "docker-compose.yml",
  "apps/backend/src/env.schema.ts",
  "apps/backend/src/app.service.ts",
];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "signa-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), readFileSync(path));
  }
  return root;
}

test("accepts coordinated source versions and matching stable tag", (t) => {
  const root = fixture(t);
  const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
  assert.equal(checkVersion(root, `v${version}`), version);
  for (const tag of [
    "v99.0.0",
    `v${version}-rc.1`,
    "main",
    "v01.2.3",
    "v1.2.3;echo unsafe",
  ])
    assert.throws(() => checkVersion(root, tag), /Tag must match/);
});
for (const path of paths) {
  test(`rejects missing or inconsistent versions in ${path}`, (t) => {
    const root = fixture(t);
    writeFileSync(
      join(root, path),
      readFileSync(path, "utf8").replaceAll(
        JSON.parse(readFileSync("package.json")).version,
        "9.8.7",
      ),
    );
    assert.throws(() => checkVersion(root));
  });
}
