import assert from "node:assert/strict";
import test from "node:test";
import { loadPluginSettings } from "../plugin-persistence";

test("loadPluginSettings rewrites stored settings when orphaned autoSync keys are present", async () => {
  const savedValues: unknown[] = [];
  const plugin = {
    loadData: async () => ({
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
    saveData: async (value: unknown) => {
      savedValues.push(value);
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
  assert.equal(persisted.zoteroLocalApiPort, 23119);
  assert.deepEqual(persisted.libraryBulkSync, {});
});
