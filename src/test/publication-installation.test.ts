import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { installationFixture } from "./publication-installation-fixture";
import staticInstallation from "./fixtures/installation.json";
import {
  qualificationCache,
  qualifyTemplateInstallation,
} from "./qualify-template";
import {
  readTemplateInstallation,
  installationId,
} from "../publication-installation";
import { resolveInstallationResources } from "../publication-installation-resources";
import {
  enableVerifiedInstallation,
  removeInstallation,
} from "../publication-installation-state";
import { installedPublishingTemplate } from "../publication-installed-templates";
import {
  publishingTemplateFamilies,
  publishingTemplateEnabled,
  readPublishingTemplates,
} from "../publish-templates";
import {
  readRegistryFamilies,
  readRegistryReleases,
} from "../publication-registry-client";
import { registryListing } from "../publication-registry-cache";
const inflate = (bytes: Uint8Array, limit: number) =>
  inflateRawSync(bytes, { maxOutputLength: limit });
test("strict contract rejects executable choices, foreign origins, unsafe paths and unsupported adapters", () => {
  assert(readTemplateInstallation(installationFixture().manifest));
  const mutations: ((
    v: ReturnType<typeof installationFixture>["manifest"],
  ) => void)[] = [
    (v) => {
      v.schemaVersion = 2 as 1;
    },
    (v) => {
      v.adapter.contract = "remote-js" as "latex-manuscript-v1";
    },
    (v) => {
      v.adapter.classOptions = ["\\input{private}"];
    },
    (v) => {
      v.pin.metadata.download = "https://example.org/download";
    },
    (v) => {
      v.pin.runtime["class.cls"].path = "../class.cls";
    },
    (v) => {
      v.pin.runtime["script.js"] = {
        path: "script.js",
        sha256: "a".repeat(64),
      };
    },
    (v) => {
      v.assets[0].download = "https://example.org/style";
    },
    (v) => {
      v.assets[0].bytes = 33 * 1024 * 1024;
    },
    (v) => {
      v.pin.metadata.requiredFiles = ["/absolute/LICENSE"];
    },
    (v) => {
      v.pin.metadata.version = "2.0-r1";
    },
    (v) => {
      v.pin.validation = {};
    },
    (v) => {
      delete v.pin.runtime["class.cls"];
    },
  ];
  for (const mutate of mutations) {
    const { manifest } = installationFixture();
    mutate(manifest);
    assert.throws(() => readTemplateInstallation(manifest), /Invalid template/);
  }
});
test("static installation fixture matches the generated contract fixture", () => {
  // Browser and view fixtures load the JSON copy; keep it on the same contract.
  assert.deepEqual(staticInstallation, installationFixture().manifest);
  assert(readTemplateInstallation(staticInstallation));
});
test("dependency count and combined size are bounded without excluding notice dependencies", () => {
  const { manifest } = installationFixture();
  const base = manifest.pin.metadata.download.replace(/\/download$/, "");
  const dependencies = Array.from({ length: 21 }, (_, i) => ({
    id: `notice-${i}`,
    targetPath: `notices/notice-${i}.txt`,
    bytes: 1,
    sha256: "b".repeat(64),
    download: `${base}/dependencies/notice-${i}/download`,
    requiredFiles: ["official/LICENSE"],
  }));
  manifest.pin.metadata.dependencies = dependencies;
  const validation = manifest.pin.validation as { dependencies: unknown[] };
  validation.dependencies = dependencies.map(({ id, sha256, targetPath }) => ({
    id,
    sha256,
    targetPath,
  }));
  assert(readTemplateInstallation(manifest));
  validation.dependencies = dependencies.map(({ id, sha256, targetPath }) => ({
    targetPath,
    sha256,
    id,
  }));
  assert(
    readTemplateInstallation(manifest),
    "Dependency key order is not identity",
  );
  validation.dependencies.reverse();
  assert.throws(() => readTemplateInstallation(manifest), /Invalid template/);
  validation.dependencies.reverse();
  for (const d of dependencies) d.bytes = 32 * 1024 * 1024;
  assert.throws(() => readTemplateInstallation(manifest), /Invalid template/);
  manifest.pin.metadata.dependencies = Array.from(
    { length: 33 },
    () => dependencies[0],
  );
  assert.throws(() => readTemplateInstallation(manifest), /Invalid template/);
});
test("installation verifies generated assets, works offline, detects damage and repairs exact bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stratum-installation-"));
  try {
    const cache = qualificationCache(directory),
      { manifest, artifacts } = installationFixture();
    let downloads = 0;
    const fetch = ({ url }: { url: string }) => {
      downloads++;
      const bytes = artifacts.get(new URL(url).pathname);
      assert(bytes);
      return Promise.resolve(bytes);
    };
    const install = (online = true, signal?: AbortSignal) =>
      resolveInstallationResources(
        cache,
        manifest,
        fetch,
        inflate,
        signal,
        online,
      );
    const [first, second] = await Promise.all([install(), install()]);
    assert.deepEqual(first, second);
    assert.equal(downloads, 4);
    await install(false);
    assert.equal(downloads, 4);
    await writeFile(
      path.join(directory, `${manifest.assets[0].sha256}.bin`),
      "damaged",
    );
    await assert.rejects(install(false), /missing or damaged/);
    assert.deepEqual(await install(), first);
    assert.equal(downloads, 5);
    assert(!(await readdir(directory)).some((n) => n.endsWith(".tmp")));
    await assert.rejects(install(true, AbortSignal.abort()), /cancelled/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("interrupted generated downloads retry using previously verified cache entries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stratum-interrupted-"));
  try {
    const { manifest, artifacts } = installationFixture(),
      cache = qualificationCache(directory);
    let failed = true,
      count = 0;
    const fetch = ({ url }: { url: string }) => {
      count++;
      if (url.includes("/assets/") && failed)
        return Promise.reject(new Error("Network interrupted"));
      return Promise.resolve(artifacts.get(new URL(url).pathname)!);
    };
    await assert.rejects(
      resolveInstallationResources(cache, manifest, fetch, inflate),
      /interrupted/,
    );
    failed = false;
    await resolveInstallationResources(cache, manifest, fetch, inflate);
    assert.equal(count, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("multi-version state preserves legacy choices, custom templates and future records", () => {
  const original = readPublishingTemplates({
    templates: [{ id: "custom", name: "Synthetic custom" }],
    enabledIds: ["journal:ieee", "custom"],
    installations: [{ schemaVersion: 99, opaque: "Preserve future record" }],
  });
  const a = installationFixture().manifest,
    b = installationFixture("example", "2.0").manifest,
    c = installationFixture("another").manifest;
  const state = [a, b, c].reduce(enableVerifiedInstallation, original);
  assert.equal(state.installations?.length, 3);
  assert.equal(state.unavailableInstallations?.length, 1);
  assert(state.enabledIds?.includes("journal:ieee"));
  assert.equal(
    state.templates.find((t) => t.id === "custom")?.name,
    "Synthetic custom",
  );
  assert.deepEqual(enableVerifiedInstallation(state, a), state);
  assert.deepEqual(readPublishingTemplates(state), state);
  const changed = structuredClone(a);
  changed.name = "Changed";
  assert.throws(() => enableVerifiedInstallation(state, changed), /preserved/);
  assert.equal(
    removeInstallation(state, installationId(b)).installations?.length,
    2,
  );
  assert.equal(state.installations?.length, 3);
});
test("removing a version also removes recoverable duplicates without discarding opaque records", () => {
  const a = installationFixture().manifest;
  const b = installationFixture("example", "2.0").manifest;
  const future = { ...structuredClone(a), schemaVersion: 99 };
  const damaged = { schemaVersion: 1, name: "Recoverable later" };
  const state = readPublishingTemplates({
    installations: [a, structuredClone(a), b],
    unavailableInstallations: [future, damaged],
    enabledIds: [installationId(a), installationId(b)],
  });
  assert.equal(state.unavailableInstallations?.length, 3);
  const removed = readPublishingTemplates(
    removeInstallation(state, installationId(a)),
  );
  assert.deepEqual(removed.installations, [b]);
  assert.deepEqual(removed.enabledIds, [installationId(b)]);
  assert.deepEqual(removed.unavailableInstallations, [future, damaged]);
  assert.deepEqual(readPublishingTemplates(removed), removed);
  assert.equal(state.installations?.length, 2);
});

test("catalog cache supports offline browsing with validated responses", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stratum-listing-"));
  try {
    const cache = qualificationCache(directory),
      value = {
        schemaVersion: 1,
        templates: [{ id: "example", name: "Example", versionCount: 2 }],
      };
    const live = await registryListing(
      cache,
      "versions-example.name",
      readRegistryFamilies,
      () => Promise.resolve({ value, parsed: readRegistryFamilies(value) }),
    );
    assert(!live.offline);
    const offline = await registryListing(
      cache,
      "versions-example.name",
      readRegistryFamilies,
      () => Promise.reject(new Error("Offline")),
    );
    assert(offline.offline);
    assert.deepEqual(offline.items, live.items);
    assert.throws(() =>
      readRegistryReleases(
        {
          schemaVersion: 1,
          id: "example",
          releases: [
            {
              version: "1-r1",
              upstreamVersion: "1",
              revision: 1,
              available: false,
            },
          ],
        },
        "example",
      ),
    );
    assert.throws(() =>
      readRegistryFamilies({ schemaVersion: 99, templates: [] }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installed versions group in the publisher and retain independent enablement in settings", () => {
  const a = installationFixture().manifest;
  const b = installationFixture("example", "2.0").manifest;
  const templates = [a, b].map(installedPublishingTemplate);
  const state = {
    templates,
    installations: [a, b],
    enabledIds: [installationId(a)],
  };
  assert.equal(publishingTemplateFamilies(state).length, 1);
  assert.equal(publishingTemplateFamilies(state)[0].choices.length, 2);
  assert.equal(publishingTemplateFamilies(state, true).length, 2);
  assert(publishingTemplateEnabled(state, templates[0]));
  assert(!publishingTemplateEnabled(state, templates[1]));
});

test("qualification checks fresh metadata despite a warm persistent cache and cleans up failure", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "qualification-fresh-test-"),
  );
  try {
    const { manifest, artifacts } = installationFixture();
    const cachePath = path.join(directory, "cache");
    await resolveInstallationResources(
      qualificationCache(cachePath),
      manifest,
      ({ url }) => Promise.resolve(artifacts.get(new URL(url).pathname)!),
      inflate,
    );
    const cachedFiles = await readdir(cachePath);
    artifacts.set(
      manifest.pin.metadata.download.replace(/\/download$/, ""),
      new TextEncoder().encode('{"invalid":true}'),
    );
    await assert.rejects(
      qualifyTemplateInstallation(manifest, artifacts, cachePath),
      /incompatible/,
    );
    assert.deepEqual(
      await readdir(directory),
      ["cache"],
      "Fresh scratch must be removed on failure",
    );
    assert.deepEqual(
      await readdir(cachePath),
      cachedFiles,
      "Existing cache must be preserved",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
