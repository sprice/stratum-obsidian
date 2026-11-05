import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { packageFixture } from "./publication-package-fixture";
import { qualificationCache } from "./qualify-template";
import {
  packageRegistryListing,
  readPackageCatalog,
} from "../publication-package-catalog";
import { TEMPLATE_REGISTRY_ORIGIN } from "../publication-registry";

function entry() {
  const { p } = packageFixture();
  return {
    id: p.id,
    name: p.name,
    manifest: p,
    manifestSha256: "a".repeat(64),
  };
}

test("package discovery validates identity and manifests and exposes only installer pins", () => {
  const item = entry();
  assert.deepEqual(readPackageCatalog({ packages: [item] }), [
    {
      id: item.id,
      name: item.name,
      version: item.manifest.version,
      sha256: item.manifestSha256,
    },
  ]);
  for (const value of [
    null,
    [],
    {},
    { packages: [item, item] },
    { packages: [{ ...item, id: "different" }] },
    { packages: [{ ...item, name: "different" }] },
    { packages: [{ ...item, manifestSha256: "bad" }] },
    {
      packages: [
        { ...item, manifest: { ...item.manifest, spec: "unsupported" } },
      ],
    },
  ])
    assert.throws(() => readPackageCatalog(value));
});

test("package listing uses the configured origin, refreshes pins, and falls back to its validated offline cache", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "stratum-package-catalog-"),
  );
  try {
    const cache = qualificationCache(directory);
    const item = entry();
    const load = () =>
      packageRegistryListing(cache, (spec) => {
        assert.equal(
          spec.url,
          `${TEMPLATE_REGISTRY_ORIGIN}/api/template-packages/v1`,
        );
        assert.equal(spec.maxBytes, 4 * 1024 * 1024);
        return Promise.resolve(
          new TextEncoder().encode(JSON.stringify({ packages: [item] })),
        );
      });
    assert.equal((await load()).offline, false);
    item.manifestSha256 = "b".repeat(64);
    assert.equal((await load()).items[0].sha256, item.manifestSha256);
    const offline = await packageRegistryListing(cache, () =>
      Promise.reject(new Error("offline")),
    );
    assert.equal(offline.offline, true);
    assert.equal(offline.items[0].sha256, item.manifestSha256);
    const malformed = await packageRegistryListing(cache, () =>
      Promise.resolve(new TextEncoder().encode('{"packages":[{}]}')),
    );
    assert.equal(malformed.offline, true);
    assert.equal(malformed.items[0].sha256, item.manifestSha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
