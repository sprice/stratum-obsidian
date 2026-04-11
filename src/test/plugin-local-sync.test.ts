import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupLibrary,
  buildPersonalLibrary,
  reconcileEnabledLocalSyncLibraries,
} from "../plugin-libraries";
import {
  resolveBulkSyncDefaultAfterLocalReady,
  shouldRefreshLocalSyncAfterCloudConnection,
  shouldShowSyncTab,
} from "../local-sync-rules";
import type { ZoteroCollectionSummary } from "../backend-types";
import type { EnabledLibrary, StratumSettings } from "../settings-data";

function createSettings(params: {
  enabledLibraries: EnabledLibrary[];
  selectedSyncLibraryIdentity?: string | null;
  selectedSyncCollectionKey?: string | null;
}): StratumSettings {
  return {
    notesFolder: "Literature Notes",
    filenameFormat: "readable",
    bulkSyncEnabled: true,
    bulkSyncPreferenceInitialized: true,
    zoteroLocalApiPort: 23119,
    zoteroDataDir: "/Users/test/Zotero",
    pendingAuth: null,
    accountEmail: "test@example.com",
    accountLinkedAt: null,
    authSessionExpiresAt: null,
    lastKnownZoteroUserId: "123456",
    lastKnownZoteroUsername: "example-user",
    lastKnownZoteroConfirmedAt: null,
    selectedSyncLibraryIdentity: params.selectedSyncLibraryIdentity ?? null,
    selectedSyncCollectionKey: params.selectedSyncCollectionKey ?? null,
    itemFileMap: {},
    enabledLibraries: [...params.enabledLibraries],
    libraryAutoSync: {},
    libraryBulkSync: {},
    activeBulkSyncLibrary: null,
  };
}

test("reconcileEnabledLocalSyncLibraries adds newly enabled local libraries without reloading Zotero", () => {
  const personalLibrary = buildPersonalLibrary("123456");
  const groupLibrary = buildGroupLibrary({
    id: "2001",
    name: "Lab Group",
  });
  const collection = {
    key: "COLL1",
    name: "AI Reading List",
    parentCollectionKey: null,
    displayName: "AI Reading List",
  } satisfies ZoteroCollectionSummary;
  const plugin = {
    settings: createSettings({
      enabledLibraries: [personalLibrary, groupLibrary],
      selectedSyncLibraryIdentity: personalLibrary.identity,
      selectedSyncCollectionKey: collection.key,
    }),
    discoveredLocalSyncLibraries: [personalLibrary, groupLibrary],
    localSyncLibraries: [personalLibrary],
    selectedSyncLibrary: personalLibrary,
    selectedSyncCollection: collection,
    syncCollectionsLibraryIdentity: personalLibrary.identity,
    syncCollections: [collection],
    syncCollectionsError: null,
    isLoadingSyncCollections: false,
    hasLoadedSyncCollections: true,
    syncCollectionsRequestId: 0,
    syncCollectionsPendingPromise: null,
  };

  const changed = reconcileEnabledLocalSyncLibraries(plugin as never);

  assert.equal(changed, true);
  assert.deepEqual(
    plugin.localSyncLibraries.map((library) => library.identity),
    [personalLibrary.identity, groupLibrary.identity],
  );
  assert.equal(plugin.selectedSyncLibrary?.identity, personalLibrary.identity);
  assert.equal(plugin.selectedSyncCollection?.key, collection.key);
  assert.equal(
    plugin.settings.selectedSyncLibraryIdentity,
    personalLibrary.identity,
  );
  assert.equal(plugin.settings.selectedSyncCollectionKey, collection.key);
});

test("reconcileEnabledLocalSyncLibraries clears sync selection when the selected library is no longer enabled", () => {
  const personalLibrary = buildPersonalLibrary("123456");
  const groupLibrary = buildGroupLibrary({
    id: "2001",
    name: "Lab Group",
  });
  const collection = {
    key: "COLL1",
    name: "AI Reading List",
    parentCollectionKey: null,
    displayName: "AI Reading List",
  } satisfies ZoteroCollectionSummary;
  const plugin = {
    settings: createSettings({
      enabledLibraries: [personalLibrary],
      selectedSyncLibraryIdentity: groupLibrary.identity,
      selectedSyncCollectionKey: collection.key,
    }),
    discoveredLocalSyncLibraries: [personalLibrary, groupLibrary],
    localSyncLibraries: [personalLibrary, groupLibrary],
    selectedSyncLibrary: groupLibrary,
    selectedSyncCollection: collection,
    syncCollectionsLibraryIdentity: groupLibrary.identity,
    syncCollections: [collection],
    syncCollectionsError: "old error",
    isLoadingSyncCollections: true,
    hasLoadedSyncCollections: true,
    syncCollectionsRequestId: 3,
    syncCollectionsPendingPromise: Promise.resolve([]),
  };

  const changed = reconcileEnabledLocalSyncLibraries(plugin as never);

  assert.equal(changed, true);
  assert.deepEqual(
    plugin.localSyncLibraries.map((library) => library.identity),
    [personalLibrary.identity],
  );
  assert.equal(plugin.selectedSyncLibrary?.identity, personalLibrary.identity);
  assert.equal(plugin.selectedSyncCollection, null);
  assert.equal(plugin.syncCollectionsLibraryIdentity, null);
  assert.deepEqual(plugin.syncCollections, []);
  assert.equal(plugin.syncCollectionsError, null);
  assert.equal(plugin.isLoadingSyncCollections, false);
  assert.equal(plugin.hasLoadedSyncCollections, false);
  assert.equal(plugin.syncCollectionsPendingPromise, null);
  assert.equal(plugin.syncCollectionsRequestId, 4);
  assert.equal(
    plugin.settings.selectedSyncLibraryIdentity,
    personalLibrary.identity,
  );
  assert.equal(plugin.settings.selectedSyncCollectionKey, null);
});

test("resolveBulkSyncDefaultAfterLocalReady enables bulk sync for first-time desktop setup", () => {
  assert.deepEqual(
    resolveBulkSyncDefaultAfterLocalReady({
      isDesktopApp: true,
      hasSession: true,
      zoteroConnected: true,
      bulkSyncEnabled: false,
      bulkSyncPreferenceInitialized: false,
    }),
    {
      bulkSyncEnabled: true,
      bulkSyncPreferenceInitialized: true,
      changed: true,
    },
  );
});

test("resolveBulkSyncDefaultAfterLocalReady does not override an initialized preference", () => {
  assert.deepEqual(
    resolveBulkSyncDefaultAfterLocalReady({
      isDesktopApp: true,
      hasSession: true,
      zoteroConnected: true,
      bulkSyncEnabled: false,
      bulkSyncPreferenceInitialized: true,
    }),
    {
      bulkSyncEnabled: false,
      bulkSyncPreferenceInitialized: true,
      changed: false,
    },
  );
});

test("shouldRefreshLocalSyncAfterCloudConnection only probes local Zotero when needed", () => {
  assert.equal(
    shouldRefreshLocalSyncAfterCloudConnection({
      isDesktopApp: true,
      hasSession: true,
      zoteroConnected: true,
      bulkSyncEnabled: true,
      bulkSyncPreferenceInitialized: true,
    }),
    true,
  );
  assert.equal(
    shouldRefreshLocalSyncAfterCloudConnection({
      isDesktopApp: true,
      hasSession: true,
      zoteroConnected: true,
      bulkSyncEnabled: false,
      bulkSyncPreferenceInitialized: false,
    }),
    true,
  );
  assert.equal(
    shouldRefreshLocalSyncAfterCloudConnection({
      isDesktopApp: true,
      hasSession: true,
      zoteroConnected: true,
      bulkSyncEnabled: false,
      bulkSyncPreferenceInitialized: true,
    }),
    false,
  );
  assert.equal(
    shouldRefreshLocalSyncAfterCloudConnection({
      isDesktopApp: false,
      hasSession: true,
      zoteroConnected: true,
      bulkSyncEnabled: true,
      bulkSyncPreferenceInitialized: false,
    }),
    false,
  );
});

test("shouldShowSyncTab is desktop-only and requires Stratum sign-in", () => {
  assert.equal(
    shouldShowSyncTab({
      isDesktopApp: true,
      hasSession: true,
    }),
    true,
  );
  assert.equal(
    shouldShowSyncTab({
      isDesktopApp: true,
      hasSession: false,
    }),
    false,
  );
  assert.equal(
    shouldShowSyncTab({
      isDesktopApp: false,
      hasSession: true,
    }),
    false,
  );
});
