import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

test("external settings reload waits for local citation saves and reloads style titles", async () => {
  const queue = loadRuntime<typeof import("../citation-style-collection")>(
    "citation-style-collection.ts",
    {},
  );
  class HostComponent {}
  const runtime = loadRuntime<typeof import("../plugin")>(
    "plugin.ts",
    new Proxy<Record<string, unknown>>({}, { get: () => HostComponent }),
    {},
    "node",
    {
      "./citation-style-collection": queue,
      "./citation-resources": {
        loadCitationResources: () => Promise.resolve(),
      },
    },
  );
  let reads = 0;
  let invalidations = 0;
  const plugin = {
    isUnloaded: false,
    loadData: () => {
      reads++;
      return Promise.resolve({
        citationStyle: "journal",
        availableCitationStyles: ["journal"],
        citationLanguage: "en-GB",
        citationStyleTitles: { journal: "Synthetic journal", invalid: 42 },
      });
    },
    settings: {
      citationStyle: "apa",
      citationLanguage: "en-US",
      availableCitationStyles: ["apa"],
      citationStyleTitles: {},
    },
    citations: {
      invalidate: () => {
        invalidations++;
      },
    },
    refreshSettingTab() {},
  };
  let finish!: () => void;
  const saving = queue.changeCitationPreferences(
    plugin as never,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const reloading = runtime.default.prototype.onExternalSettingsChange.call(
    plugin as never,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    reads,
    0,
    "Reload must not replace resources or settings during an active save",
  );
  finish();
  await Promise.all([saving, reloading]);
  assert.equal(reads, 1);
  assert.equal(plugin.settings.citationStyle, "journal");
  assert.equal(plugin.settings.citationLanguage, "en-GB");
  assert.equal(
    JSON.stringify(plugin.settings.availableCitationStyles),
    '["journal"]',
  );
  assert.equal(
    JSON.stringify(plugin.settings.citationStyleTitles),
    '{"journal":"Synthetic journal"}',
  );
  assert.equal(invalidations, 1);
});
