import assert from "node:assert/strict";
import test from "node:test";
import { loadPluginSettings } from "../plugin-persistence";

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
