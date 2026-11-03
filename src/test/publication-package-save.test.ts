import assert from "node:assert/strict";
import test from "node:test";
import { packageFixture } from "./publication-package-fixture";
import { readPublishingTemplates } from "../publish-templates";
import { readPackageInstallation } from "../publication-package-installation";
import { loadRuntime } from "./runtime-harness";

function setup() {
  const { p } = packageFixture();
  const installation = { manifest: p, sha256: "a".repeat(64) };
  let download = () => Promise.resolve(installation);
  const plugin = {
    app: { vault: { configDir: "synthetic-config", adapter: {} } },
    settings: { publishingTemplates: readPublishingTemplates(undefined) },
    saveSettings: async () => {},
    refreshViews() {},
  };
  const { installPublishingPackage } = loadRuntime<{
    installPublishingPackage(
      this: void,
      plugin: unknown,
      request: unknown,
      signal: AbortSignal,
    ): Promise<string>;
  }>(
    "publication-package-installer.ts",
    { Modal: class {}, Component: class {} },
    { TextEncoder, TextDecoder },
    "browser",
    {
      "./publication-package-installation": {
        installTemplatePackage: () => download(),
        readPackageInstallation,
      },
      "./publish-desktop": { downloadPublicationResource() {} },
    },
  );
  const request = { id: p.id, version: p.version, sha256: installation.sha256 };
  const signal = new AbortController().signal;
  return {
    plugin,
    installation,
    request,
    signal,
    install: () => installPublishingPackage(plugin, request, signal),
    setDownload: (fn: typeof download) => {
      download = fn;
    },
  };
}

test("shared package installer enables a verified package and preserves older versions and built-ins", async () => {
  const s = setup();
  const old = structuredClone(s.installation);
  old.manifest.version = "0.9";
  for (const asset of old.manifest.assets)
    asset.download = asset.download?.replace("/1.0/", "/0.9/");
  s.plugin.settings.publishingTemplates = readPublishingTemplates({
    packageInstallations: [old],
    enabledIds: ["general", "download:unfamiliar:0.9"],
  });
  assert.equal(await s.install(), s.installation.manifest.name);
  const state = s.plugin.settings.publishingTemplates;
  assert.deepEqual(
    Array.from(state.packageInstallations ?? [], (p) => p.manifest.version),
    ["0.9", "1.0"],
  );
  assert.ok(state.enabledIds?.includes("download:unfamiliar:1.0"));
  assert.ok(state.enabledIds?.includes("download:unfamiliar:0.9"));
  await s.install();
  assert.equal(
    s.plugin.settings.publishingTemplates.packageInstallations?.length,
    2,
  );
});

test("shared package installer rolls back a failed save and rejects changed immutable versions", async () => {
  const s = setup();
  const previous = s.plugin.settings.publishingTemplates;
  s.plugin.saveSettings = () => Promise.reject(Error("save failed"));
  await assert.rejects(s.install(), /save failed/);
  assert.equal(s.plugin.settings.publishingTemplates, previous);
  s.plugin.saveSettings = async () => {};
  await s.install();
  s.setDownload(() =>
    Promise.resolve({ ...s.installation, sha256: "b".repeat(64) }),
  );
  await assert.rejects(s.install(), /immutable version has changed/);
  assert.equal(
    s.plugin.settings.publishingTemplates.packageInstallations?.[0].sha256,
    "a".repeat(64),
  );
});

test("shared package installer serializes registry and website requests and releases the lock after failure", async () => {
  const s = setup();
  let reject!: (e: Error) => void;
  s.setDownload(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const pending = s.install();
  await assert.rejects(s.install(), /Another installation/);
  reject(Error("cancelled"));
  await assert.rejects(pending, /cancelled/);
  s.setDownload(() => Promise.resolve(s.installation));
  await s.install();
});
