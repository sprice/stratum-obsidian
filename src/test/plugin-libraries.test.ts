import test from "node:test";
import assert from "node:assert/strict";
import type {
  ZoteroCollectionSummary,
  ZoteroConnectionState,
  ZoteroGroupSummary,
} from "../backend-types";
import {
  buildGroupLibrary,
  buildPersonalLibrary,
  disableLibrary,
  enableGroupLibrary,
  reconcileLibrariesFromConnection,
  setSelectedSearchLibrary,
} from "../plugin-libraries";
import type { EnabledLibrary, StratumSettings } from "../settings-data";
import {
  buildDefaultBulkLibrarySyncState,
  buildDefaultZoteroAutoSyncState,
} from "../zotero-sync";

function createMockPlugin(params?: {
  enabledLibraries?: EnabledLibrary[];
  selectedSearchLibrary?: EnabledLibrary | null;
  selectedSearchCollection?: ZoteroCollectionSummary | null;
  libraryCollections?: ZoteroCollectionSummary[];
  availableGroups?: ZoteroGroupSummary[];
  settings?: Partial<StratumSettings>;
}) {
  const userId = "123456";
  const personalLibrary = buildPersonalLibrary(userId);
  const enabledLibraries = params?.enabledLibraries ?? [personalLibrary];
  const settingsOverrides = params?.settings ?? {};
  const settings: StratumSettings = {
    notesFolder: "Notes/Literature Notes",
    filenameFormat: "readable",
    bulkSyncEnabled: false,
    zoteroLocalApiPort: 23119,
    zoteroDataDir: "/Users/test/Zotero",
    lastDeviceCode: null,
    accountEmail: "test@example.com",
    accountLinkedAt: null,
    authSessionExpiresAt: null,
    lastKnownZoteroUserId: userId,
    lastKnownZoteroUsername: "example-user",
    lastKnownZoteroConfirmedAt: null,
    selectedSyncLibraryIdentity: null,
    selectedSyncCollectionKey: null,
    itemFileMap: {},
    enabledLibraries: [...enabledLibraries],
    libraryAutoSync: {},
    libraryBulkSync: {},
    activeBulkSyncLibrary: null,
    ...settingsOverrides,
  };
  settings.enabledLibraries = [
    ...(settingsOverrides.enabledLibraries ?? enabledLibraries),
  ];
  settings.libraryAutoSync = { ...(settingsOverrides.libraryAutoSync ?? {}) };
  settings.libraryBulkSync = { ...(settingsOverrides.libraryBulkSync ?? {}) };

  return {
    settings,
    zoteroConnection: {
      connected: true,
      zoteroUserId: userId,
      zoteroUsername: "example-user",
      lastSyncedAt: null,
      tokenValid: true,
      groupsLoaded: true,
      groups: [],
    } satisfies ZoteroConnectionState,
    availableGroups: [...(params?.availableGroups ?? [])],
    selectedSearchLibrary:
      params?.selectedSearchLibrary ?? settings.enabledLibraries[0] ?? null,
    selectedSearchCollection: params?.selectedSearchCollection ?? null,
    libraryCollectionsLibraryIdentity:
      params?.selectedSearchLibrary?.identity ??
      settings.enabledLibraries[0]?.identity ??
      null,
    libraryCollections: [...(params?.libraryCollections ?? [])],
    libraryCollectionsError: "old collection error",
    isLoadingLibraryCollections: true,
    libraryCollectionsRequestId: 4,
    libraryCollectionsPendingPromise: Promise.resolve([]),
    librarySearchDebounceTimer: null,
    librarySearchPendingPromise: null,
    librarySearchPendingQuery: "attention",
    librarySearchRequestId: 7,
    librarySearchQuery: "attention",
    librarySearchResults: [{ key: "ABCD1234" }],
    librarySearchMeta: {
      source: "live",
      stale: false,
      rateLimited: false,
      retryAfterSeconds: null,
      libraryVersion: 12,
    },
    librarySearchError: "old error",
    isSearchingLibrary: true,
    highlightedLibrarySearchIndex: 3,
    selectedLibraryResult: { key: "ABCD1234" },
    isSelectedLibraryAbstractExpanded: true,
  };
}

test("enableGroupLibrary adds the group and initializes per-library sync state", () => {
  const plugin = createMockPlugin();

  enableGroupLibrary(plugin as never, {
    id: "2001",
    name: "Lab Group",
  });

  assert.deepEqual(
    plugin.settings.enabledLibraries.map((library) => library.identity),
    ["user:123456", "group:2001"],
  );
  assert.deepEqual(
    plugin.settings.libraryAutoSync["group:2001"],
    buildDefaultZoteroAutoSyncState(),
  );
  assert.deepEqual(
    plugin.settings.libraryBulkSync["group:2001"],
    buildDefaultBulkLibrarySyncState(),
  );
});

test("setSelectedSearchLibrary resets search state when switching libraries", () => {
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
  const plugin = createMockPlugin({
    enabledLibraries: [personalLibrary, groupLibrary],
    selectedSearchLibrary: personalLibrary,
    selectedSearchCollection: collection,
    libraryCollections: [collection],
  });

  setSelectedSearchLibrary(plugin as never, groupLibrary);

  assert.equal(plugin.selectedSearchLibrary?.identity, "group:2001");
  assert.equal(plugin.selectedSearchCollection, null);
  assert.equal(plugin.libraryCollectionsLibraryIdentity, null);
  assert.deepEqual(plugin.libraryCollections, []);
  assert.equal(plugin.libraryCollectionsError, null);
  assert.equal(plugin.isLoadingLibraryCollections, false);
  assert.equal(plugin.librarySearchQuery, "");
  assert.deepEqual(plugin.librarySearchResults, []);
  assert.equal(plugin.librarySearchMeta, null);
  assert.equal(plugin.librarySearchError, null);
  assert.equal(plugin.isSearchingLibrary, false);
  assert.equal(plugin.highlightedLibrarySearchIndex, -1);
  assert.equal(plugin.selectedLibraryResult, null);
  assert.equal(plugin.isSelectedLibraryAbstractExpanded, false);
  assert.equal(plugin.libraryCollectionsRequestId, 5);
  assert.equal(plugin.librarySearchRequestId, 8);
});

test("disableLibrary removes group sync state and falls back to the personal library", () => {
  const personalLibrary = buildPersonalLibrary("123456");
  const groupLibrary = buildGroupLibrary({
    id: "2001",
    name: "Lab Group",
  });
  const plugin = createMockPlugin({
    enabledLibraries: [personalLibrary, groupLibrary],
    selectedSearchLibrary: groupLibrary,
    settings: {
      libraryAutoSync: {
        [personalLibrary.identity]: buildDefaultZoteroAutoSyncState(),
        [groupLibrary.identity]: buildDefaultZoteroAutoSyncState(),
      },
      libraryBulkSync: {
        [personalLibrary.identity]: buildDefaultBulkLibrarySyncState(),
        [groupLibrary.identity]: buildDefaultBulkLibrarySyncState(),
      },
      activeBulkSyncLibrary: groupLibrary.identity,
    },
  });

  disableLibrary(plugin as never, groupLibrary.identity);

  assert.deepEqual(
    plugin.settings.enabledLibraries.map((library) => library.identity),
    [personalLibrary.identity],
  );
  assert.equal(
    plugin.settings.libraryAutoSync[groupLibrary.identity],
    undefined,
  );
  assert.equal(
    plugin.settings.libraryBulkSync[groupLibrary.identity],
    undefined,
  );
  assert.equal(plugin.settings.activeBulkSyncLibrary, null);
  assert.equal(
    plugin.selectedSearchLibrary?.identity,
    personalLibrary.identity,
  );
  assert.equal(plugin.librarySearchQuery, "");
});

test("reconcileLibrariesFromConnection renames surviving groups and drops inaccessible ones", () => {
  const personalLibrary = buildPersonalLibrary("123456");
  const renamedGroup = buildGroupLibrary({
    id: "2001",
    name: "Old Group Name",
  });
  const removedGroup = buildGroupLibrary({
    id: "9999",
    name: "Removed Group",
  });
  const plugin = createMockPlugin({
    enabledLibraries: [personalLibrary, renamedGroup, removedGroup],
    selectedSearchLibrary: removedGroup,
    availableGroups: [
      { id: "9999", name: "Removed Group", type: "Private", numItems: 5 },
      { id: "2001", name: "Old Group Name", type: "Private", numItems: 4 },
    ],
    settings: {
      libraryAutoSync: {
        [personalLibrary.identity]: buildDefaultZoteroAutoSyncState(),
        [renamedGroup.identity]: buildDefaultZoteroAutoSyncState(),
        [removedGroup.identity]: buildDefaultZoteroAutoSyncState(),
      },
      libraryBulkSync: {
        [personalLibrary.identity]: buildDefaultBulkLibrarySyncState(),
        [renamedGroup.identity]: buildDefaultBulkLibrarySyncState(),
        [removedGroup.identity]: buildDefaultBulkLibrarySyncState(),
      },
      activeBulkSyncLibrary: removedGroup.identity,
    },
  });

  const changed = reconcileLibrariesFromConnection(plugin as never, {
    connected: true,
    zoteroUserId: "123456",
    zoteroUsername: "example-user",
    lastSyncedAt: "2026-03-28T00:00:00.000Z",
    tokenValid: true,
    groupsLoaded: true,
    groups: [
      { id: "3000", name: "Beta Group", type: "PublicOpen", numItems: 12 },
      { id: "2001", name: "Renamed Group", type: "Private", numItems: 4 },
    ],
  });

  assert.equal(changed, true);
  assert.deepEqual(
    plugin.availableGroups.map((group) => group.name),
    ["Beta Group", "Renamed Group"],
  );
  assert.deepEqual(
    plugin.settings.enabledLibraries.map((library) => ({
      identity: library.identity,
      name: library.name,
    })),
    [
      { identity: personalLibrary.identity, name: personalLibrary.name },
      { identity: "group:2001", name: "Renamed Group" },
    ],
  );
  assert.equal(
    plugin.settings.libraryAutoSync[removedGroup.identity],
    undefined,
  );
  assert.equal(
    plugin.settings.libraryBulkSync[removedGroup.identity],
    undefined,
  );
  assert.equal(plugin.settings.activeBulkSyncLibrary, null);
  assert.equal(
    plugin.selectedSearchLibrary?.identity,
    personalLibrary.identity,
  );
});
