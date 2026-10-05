import { readEnabledTabs } from "../stratum-tabs";
import assert from "node:assert/strict";
import test from "node:test";
import { loadPluginSettings, savePluginSettings } from "../plugin-persistence";

test("loadPluginSettings rewrites stored settings when orphaned autoSync keys are present", async () => {
  const savedValues: unknown[] = [];
  const plugin = {
    loadData: () =>
      Promise.resolve({
        autoSyncEnabled: true,
        autoSyncIntervalMinutes: 15,
        openAlexEnrichmentCache: {
          "10.1000/test": {
            fetchedAt: "2026-04-01T00:00:00.000Z",
            updatedDate: null,
            status: "enriched",
          },
        },
        pendingOpenAlexEnrichmentByLibrary: {
          "user:1": {
            ITEM1: {
              doi: "10.1000/test",
              queuedAt: "2026-04-01T00:00:00.000Z",
            },
          },
        },
        libraryBulkSync: {
          "user:1": {
            pendingEnrichmentCount: 2,
          },
        },
      }),
    saveData: (value: unknown) => {
      savedValues.push(value);
      return Promise.resolve();
    },
    app: {
      secretStorage: {
        getSecret() {
          return null;
        },
        setSecret() {},
      },
    },
  };

  await loadPluginSettings(plugin as never);

  assert.equal(savedValues.length, 1);
  const persisted = savedValues[0] as Record<string, unknown>;
  assert.equal("autoSyncEnabled" in persisted, false);
  assert.equal("autoSyncIntervalMinutes" in persisted, false);
  assert.equal("openAlexEnrichmentCache" in persisted, false);
  assert.equal("pendingOpenAlexEnrichmentByLibrary" in persisted, false);
  assert.equal("legacyZoteroAutoSync" in persisted, false);
  assert.equal("legacyBulkLibrarySync" in persisted, false);
  assert.equal(persisted.bulkSyncEnabled, false);
  assert.equal(persisted.bulkSyncPreferenceInitialized, false);
  assert.equal(persisted.zoteroLocalApiPort, 23119);
  assert.deepEqual(persisted.libraryBulkSync, {});
});

test("loadPluginSettings preserves the new bulk sync initialization flag", async () => {
  const plugin = {
    loadData: () =>
      Promise.resolve({
        bulkSyncEnabled: true,
        bulkSyncPreferenceInitialized: true,
      }),
    saveData: () => {
      throw new Error("saveData should not be called");
    },
    app: {
      secretStorage: {
        getSecret() {
          return null;
        },
        setSecret() {},
      },
    },
    settings: undefined as
      | {
          bulkSyncEnabled: boolean;
          bulkSyncPreferenceInitialized: boolean;
        }
      | undefined,
  };

  await loadPluginSettings(plugin as never);

  assert.ok(plugin.settings);
  assert.equal(plugin.settings.bulkSyncEnabled, true);
  assert.equal(plugin.settings.bulkSyncPreferenceInitialized, true);
});

test("loadPluginSettings leaves legacy installs without the bulk sync initialization flag uninitialized", async () => {
  const plugin = {
    loadData: () =>
      Promise.resolve({
        accountEmail: "test@example.com",
        bulkSyncEnabled: false,
      }),
    saveData: () => {
      throw new Error("saveData should not be called");
    },
    app: {
      secretStorage: {
        getSecret() {
          return null;
        },
        setSecret() {},
      },
    },
    settings: undefined as
      | {
          bulkSyncEnabled: boolean;
          bulkSyncPreferenceInitialized: boolean;
        }
      | undefined,
  };

  await loadPluginSettings(plugin as never);

  assert.ok(plugin.settings);
  assert.equal(plugin.settings.bulkSyncEnabled, false);
  assert.equal(plugin.settings.bulkSyncPreferenceInitialized, false);
});

test("loadPluginSettings migrates legacy lastDeviceCode into pendingAuth", async () => {
  const savedValues: unknown[] = [];
  const plugin = {
    loadData: () =>
      Promise.resolve({
        lastDeviceCode: "handoff-123",
      }),
    saveData: (value: unknown) => {
      savedValues.push(value);
      return Promise.resolve();
    },
    app: {
      secretStorage: {
        getSecret() {
          return null;
        },
        setSecret() {},
      },
    },
  };

  await loadPluginSettings(plugin as never);

  assert.equal(savedValues.length, 1);
  const persisted = savedValues[0] as Record<string, unknown>;
  assert.equal("lastDeviceCode" in persisted, false);
  assert.deepEqual(persisted.pendingAuth, {
    code: "handoff-123",
    flow: "stratum-sign-in",
    returnTarget: "stay-settings",
    createdAt: (persisted.pendingAuth as { createdAt: string }).createdAt,
  });
  assert.equal(
    typeof (persisted.pendingAuth as { createdAt: string }).createdAt,
    "string",
  );
});

test("loadPluginSettings clears stale pendingAuth state", async () => {
  const savedValues: unknown[] = [];
  const plugin = {
    loadData: () =>
      Promise.resolve({
        pendingAuth: {
          code: "handoff-123",
          flow: "zotero-connect",
          returnTarget: "stay-settings",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    saveData: (value: unknown) => {
      savedValues.push(value);
      return Promise.resolve();
    },
    app: {
      secretStorage: {
        getSecret() {
          return null;
        },
        setSecret() {},
      },
    },
  };

  await loadPluginSettings(plugin as never);

  assert.equal(savedValues.length, 1);
  const persisted = savedValues[0] as Record<string, unknown>;
  assert.equal(persisted.pendingAuth, null);
});

test("unsupported item reports survive settings reload and discard malformed entries", async () => {
  const item = { itemKey: "NEW", title: "Future item", itemType: "futureType" };
  const plugin = {
    loadData: () =>
      Promise.resolve({
        enabledLibraries: [
          { type: "user", id: "1", name: "My Library", identity: "user:1" },
        ],
        libraryBulkSync: {
          "user:1": { unsupportedItems: [item, null, { title: "broken" }] },
        },
      }),
    saveData: async () => {},
    app: { secretStorage: { getSecret: () => null, setSecret: () => {} } },
    settings: undefined as
      import("../settings-data").StratumSettings | undefined,
  };
  await loadPluginSettings(plugin as never);
  assert.deepEqual(
    plugin.settings?.libraryBulkSync["user:1"].unsupportedItems,
    [item],
  );
});

test("publishing preferences migrate with defaults and preserve explicit desktop setup", async () => {
  const create = (data: unknown) => ({
    loadData: () => Promise.resolve(data),
    saveData: () => Promise.resolve(),
    app: { secretStorage: { getSecret: () => null, setSecret() {} } },
    settings: {} as {
      enabledTabs: { publish: boolean };
      publishPdfSetupComplete: boolean;
      pandocPath: string;
      tectonicPath: string;
    },
  });
  const legacy = create({});
  await loadPluginSettings(legacy as never);
  assert.equal(legacy.settings.enabledTabs.publish, true);
  assert.equal(legacy.settings.publishPdfSetupComplete, false);
  const configured = create({
    publishEnabled: false,
    publishPdfSetupComplete: true,
    pandocPath: " /example/pandoc ",
    tectonicPath: "/example/tectonic",
  });
  await loadPluginSettings(configured as never);
  assert.equal(configured.settings.enabledTabs.publish, false);
  assert.equal(configured.settings.publishPdfSetupComplete, true);
  assert.equal(configured.settings.pandocPath, "/example/pandoc");
  assert.equal(configured.settings.tectonicPath, "/example/tectonic");
});

test("Publish visibility migrates once and the shared tab preference wins on reload", async () => {
  let data: unknown = { publishEnabled: false, enabledTabs: { reader: false } };
  const plugin = {
    settings: {} as import("../settings-data").StratumSettings,
    loadData: () => Promise.resolve(data),
    saveData: (value: unknown) => {
      data = structuredClone(value);
      return Promise.resolve();
    },
    app: { secretStorage: { getSecret: () => null, setSecret() {} } },
  };
  await loadPluginSettings(plugin as never);
  assert.equal(plugin.settings.enabledTabs.publish, false);
  assert.equal(plugin.settings.enabledTabs.reader, false);
  plugin.settings.enabledTabs.publish = true;
  await savePluginSettings(plugin as never);
  await loadPluginSettings(plugin as never);
  assert.equal(plugin.settings.enabledTabs.publish, true);
  assert.equal(plugin.settings.enabledTabs.reader, false);
  data = { publishEnabled: false, enabledTabs: { publish: true } };
  await loadPluginSettings(plugin as never);
  assert.equal(plugin.settings.enabledTabs.publish, true);
});

test("publishing readiness survives reload and rejects malformed cache data", async () => {
  const cache = {
    version: 1,
    pandocPath: "",
    tectonicPath: "",
    readiness: {
      word: true,
      pdf: true,
      pandoc: { path: "/synthetic/pandoc", version: "3" },
      tectonic: { path: "/synthetic/tectonic", version: "0.17" },
    },
  };
  for (const value of [
    cache,
    { ...cache, version: 2 },
    { ...cache, readiness: { ...cache.readiness, tectonic: null } },
  ]) {
    const plugin = {
      loadData: () => Promise.resolve({ publishReadinessCache: value }),
      saveData: () => Promise.resolve(),
      app: { secretStorage: { getSecret: () => null, setSecret() {} } },
      settings: {} as import("../settings-data").StratumSettings,
    };
    await loadPluginSettings(plugin as never);
    assert.deepEqual(
      plugin.settings.publishReadinessCache,
      value === cache ? cache : null,
    );
  }
});

test("tab preferences survive save/reload and legacy settings default on", async () => {
  let data: unknown = {};
  const plugin = {
    settings: { enabledTabs: readEnabledTabs(undefined) },
    loadData: () => Promise.resolve(data),
    saveData: (value: unknown) => {
      data = structuredClone(value);
      return Promise.resolve();
    },
    app: { secretStorage: { getSecret: () => null, setSecret() {} } },
  };
  await loadPluginSettings(plugin as never);
  assert.deepEqual(plugin.settings.enabledTabs, readEnabledTabs(undefined));
  plugin.settings.enabledTabs.reader = false;
  plugin.settings.enabledTabs.sync = false;
  await savePluginSettings(plugin as never);
  plugin.settings.enabledTabs.reader = true;
  await loadPluginSettings(plugin as never);
  assert.equal(plugin.settings.enabledTabs.reader, false);
  assert.equal(plugin.settings.enabledTabs.sync, false);
  assert.equal(plugin.settings.enabledTabs.browse, true);
});

test("available citation styles survive reload, retain the default, and reject malformed identifiers", async () => {
  let data: unknown = {
    citationStyle: "ieee",
    availableCitationStyles: [
      "modern-language-association",
      "../invalid",
      null,
    ],
  };
  const plugin = {
    settings: {} as import("../settings-data").StratumSettings,
    loadData: () => Promise.resolve(data),
    saveData: (value: unknown) => {
      data = structuredClone(value);
      return Promise.resolve();
    },
    app: { secretStorage: { getSecret: () => null, setSecret() {} } },
  };
  await loadPluginSettings(plugin as never);
  assert.deepEqual(plugin.settings.availableCitationStyles, [
    "modern-language-association",
    "ieee",
  ]);
  plugin.settings.availableCitationStyles = ["apa", "ieee"];
  await savePluginSettings(plugin as never);
  await loadPluginSettings(plugin as never);
  assert.deepEqual(plugin.settings.availableCitationStyles, ["apa", "ieee"]);
  assert.equal(plugin.settings.citationStyle, "ieee");
  data = {};
  await loadPluginSettings(plugin as never);
  assert.equal(plugin.settings.citationStyle, "apa");
  assert.equal(plugin.settings.availableCitationStyles?.length, 5);
});
