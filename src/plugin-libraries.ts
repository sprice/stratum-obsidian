import type {
  ZoteroConnectionState,
  ZoteroGroupSummary,
} from "./backend-types";
import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings";
import { clearLibraryCollectionsState } from "./plugin-collections";
import {
  buildDefaultBulkLibrarySyncState,
  buildDefaultZoteroAutoSyncState,
} from "./zotero-sync";

export const PERSONAL_LIBRARY_NAME = "My Library";

export function buildLibraryIdentity(
  type: EnabledLibrary["type"],
  id: string,
): string {
  return `${type}:${id}`;
}

export function buildPersonalLibrary(userId: string): EnabledLibrary {
  return {
    type: "user",
    id: userId,
    name: PERSONAL_LIBRARY_NAME,
    identity: buildLibraryIdentity("user", userId),
  };
}

export function buildGroupLibrary(
  group: Pick<ZoteroGroupSummary, "id" | "name">,
): EnabledLibrary {
  return {
    type: "group",
    id: group.id,
    name: group.name,
    identity: buildLibraryIdentity("group", group.id),
  };
}

export function sortEnabledLibraries(
  libraries: EnabledLibrary[],
): EnabledLibrary[] {
  return [...libraries].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "user" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

export function getEligibleLocalSyncLibraries(
  plugin: StratumPlugin,
  libraries: EnabledLibrary[],
): EnabledLibrary[] {
  const enabledIdentities = new Set(
    plugin.settings.enabledLibraries.map((library) => library.identity),
  );

  return sortEnabledLibraries(
    libraries.filter((library) => enabledIdentities.has(library.identity)),
  );
}

function clearSyncCollectionsState(plugin: StratumPlugin): void {
  const hadPending =
    plugin.syncCollectionsPendingPromise !== null ||
    plugin.isLoadingSyncCollections;
  plugin.syncCollectionsPendingPromise = null;
  plugin.isLoadingSyncCollections = false;
  if (hadPending) {
    plugin.syncCollectionsRequestId += 1;
  }
  plugin.syncCollectionsLibraryIdentity = null;
  plugin.syncCollections = [];
  plugin.syncCollectionsError = null;
  plugin.hasLoadedSyncCollections = false;
  plugin.selectedSyncCollection = null;
}

function resolveSelectedSyncLibraryIdentity(
  plugin: StratumPlugin,
): string | null {
  return (
    plugin.selectedSyncLibrary?.identity ??
    plugin.settings.selectedSyncLibraryIdentity
  );
}

function haveSameLibraries(
  left: EnabledLibrary[],
  right: EnabledLibrary[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((library, index) => {
    const other = right[index];
    return library.identity === other?.identity && library.name === other.name;
  });
}

export function reconcileEnabledLocalSyncLibraries(
  plugin: StratumPlugin,
): boolean {
  if (
    plugin.discoveredLocalSyncLibraries.length === 0 &&
    plugin.localSyncLibraries.length === 0
  ) {
    return false;
  }

  const nextLibraries = getEligibleLocalSyncLibraries(
    plugin,
    plugin.discoveredLocalSyncLibraries,
  );
  const previousLibraries = plugin.localSyncLibraries;
  const previousSelectedIdentity = plugin.selectedSyncLibrary?.identity ?? null;
  const preferredIdentity = resolveSelectedSyncLibraryIdentity(plugin);

  plugin.localSyncLibraries = nextLibraries;
  plugin.selectedSyncLibrary =
    nextLibraries.find((library) => library.identity === preferredIdentity) ??
    nextLibraries[0] ??
    null;

  const nextSelectedIdentity = plugin.selectedSyncLibrary?.identity ?? null;
  let changed = !haveSameLibraries(previousLibraries, nextLibraries);

  if (plugin.settings.selectedSyncLibraryIdentity !== nextSelectedIdentity) {
    plugin.settings.selectedSyncLibraryIdentity = nextSelectedIdentity;
    changed = true;
  }

  if (previousSelectedIdentity !== nextSelectedIdentity) {
    clearSyncCollectionsState(plugin);
    if (plugin.settings.selectedSyncCollectionKey !== null) {
      plugin.settings.selectedSyncCollectionKey = null;
    }
    changed = true;
  }

  return changed;
}

export function getEnabledLibraryByIdentity(
  plugin: StratumPlugin,
  identity: string | null | undefined,
): EnabledLibrary | null {
  if (!identity) {
    return null;
  }

  return (
    plugin.settings.enabledLibraries.find(
      (library) => library.identity === identity,
    ) ?? null
  );
}

export function getKnownLibraryByIdentity(
  plugin: StratumPlugin,
  identity: string | null | undefined,
): EnabledLibrary | null {
  if (!identity) {
    return null;
  }

  return (
    getEnabledLibraryByIdentity(plugin, identity) ??
    plugin.localSyncLibraries.find(
      (library) => library.identity === identity,
    ) ??
    null
  );
}

export function getPersonalLibrary(
  plugin: StratumPlugin,
): EnabledLibrary | null {
  const userId =
    plugin.zoteroConnection?.zoteroUserId ??
    plugin.settings.lastKnownZoteroUserId;
  if (!userId) {
    return null;
  }

  return buildPersonalLibrary(userId);
}

export function getPrimaryEnabledLibrary(
  plugin: StratumPlugin,
): EnabledLibrary | null {
  const personal = getPersonalLibrary(plugin);
  if (personal) {
    const enabledPersonal = getEnabledLibraryByIdentity(
      plugin,
      personal.identity,
    );
    if (enabledPersonal) {
      return enabledPersonal;
    }
  }

  return sortEnabledLibraries(plugin.settings.enabledLibraries)[0] ?? null;
}

export function getSelectedSearchLibrary(
  plugin: StratumPlugin,
): EnabledLibrary | null {
  return (
    getEnabledLibraryByIdentity(
      plugin,
      plugin.selectedSearchLibrary?.identity,
    ) ?? getPrimaryEnabledLibrary(plugin)
  );
}

export function getActiveBulkSyncLibrary(
  plugin: StratumPlugin,
): EnabledLibrary | null {
  return getKnownLibraryByIdentity(
    plugin,
    plugin.settings.activeBulkSyncLibrary,
  );
}

export function clearLibrarySearchState(plugin: StratumPlugin): void {
  if (plugin.librarySearchDebounceTimer !== null) {
    window.clearTimeout(plugin.librarySearchDebounceTimer);
    plugin.librarySearchDebounceTimer = null;
  }

  plugin.librarySearchPendingPromise = null;
  plugin.librarySearchPendingQuery = null;
  plugin.librarySearchRequestId += 1;
  plugin.librarySearchQuery = "";
  plugin.librarySearchResults = [];
  plugin.librarySearchMeta = null;
  plugin.librarySearchError = null;
  plugin.isSearchingLibrary = false;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.selectedLibraryResult = null;
  plugin.isSelectedLibraryAbstractExpanded = false;
}

export function setSelectedSearchLibrary(
  plugin: StratumPlugin,
  library: EnabledLibrary | null,
): void {
  const nextLibrary =
    (library ? getEnabledLibraryByIdentity(plugin, library.identity) : null) ??
    getPrimaryEnabledLibrary(plugin);
  const previousIdentity = plugin.selectedSearchLibrary?.identity ?? null;
  const nextIdentity = nextLibrary?.identity ?? null;

  if (previousIdentity === nextIdentity) {
    plugin.selectedSearchLibrary = nextLibrary;
    return;
  }

  plugin.selectedSearchLibrary = nextLibrary;
  clearLibraryCollectionsState(plugin);
  clearLibrarySearchState(plugin);
}

export function ensureLibraryStateInitialized(
  plugin: StratumPlugin,
  library: EnabledLibrary,
): void {
  if (!plugin.settings.libraryAutoSync[library.identity]) {
    plugin.settings.libraryAutoSync[library.identity] =
      buildDefaultZoteroAutoSyncState();
  }

  if (!plugin.settings.libraryBulkSync[library.identity]) {
    plugin.settings.libraryBulkSync[library.identity] =
      buildDefaultBulkLibrarySyncState();
  }
}

export function getLibraryAutoSyncState(
  plugin: StratumPlugin,
  library: EnabledLibrary,
) {
  ensureLibraryStateInitialized(plugin, library);
  return plugin.settings.libraryAutoSync[library.identity];
}

export function getLibraryBulkSyncState(
  plugin: StratumPlugin,
  library: EnabledLibrary,
) {
  ensureLibraryStateInitialized(plugin, library);
  return plugin.settings.libraryBulkSync[library.identity];
}

function dropLibraryState(plugin: StratumPlugin, identity: string): void {
  delete plugin.settings.libraryAutoSync[identity];
  delete plugin.settings.libraryBulkSync[identity];
  if (plugin.settings.activeBulkSyncLibrary === identity) {
    plugin.settings.activeBulkSyncLibrary = null;
  }
}

export function syncLibraryStateMaps(plugin: StratumPlugin): void {
  const validIdentities = new Set(
    plugin.settings.enabledLibraries.map((library) => library.identity),
  );

  for (const library of plugin.settings.enabledLibraries) {
    ensureLibraryStateInitialized(plugin, library);
  }

  for (const identity of Object.keys(plugin.settings.libraryAutoSync)) {
    if (!validIdentities.has(identity)) {
      dropLibraryState(plugin, identity);
    }
  }

  for (const identity of Object.keys(plugin.settings.libraryBulkSync)) {
    if (!validIdentities.has(identity)) {
      dropLibraryState(plugin, identity);
    }
  }

  if (
    plugin.settings.activeBulkSyncLibrary &&
    !validIdentities.has(plugin.settings.activeBulkSyncLibrary)
  ) {
    plugin.settings.activeBulkSyncLibrary = null;
  }
}

export function setEnabledLibraries(
  plugin: StratumPlugin,
  libraries: EnabledLibrary[],
): void {
  plugin.settings.enabledLibraries = sortEnabledLibraries(libraries);
  syncLibraryStateMaps(plugin);
  setSelectedSearchLibrary(plugin, plugin.selectedSearchLibrary);
}

export function enableGroupLibrary(
  plugin: StratumPlugin,
  group: Pick<ZoteroGroupSummary, "id" | "name">,
): void {
  const nextLibraries = [
    ...plugin.settings.enabledLibraries.filter(
      (library) => library.identity !== buildLibraryIdentity("group", group.id),
    ),
    buildGroupLibrary(group),
  ];
  setEnabledLibraries(plugin, nextLibraries);
}

export function disableLibrary(plugin: StratumPlugin, identity: string): void {
  const nextLibraries = plugin.settings.enabledLibraries.filter(
    (library) => library.identity !== identity,
  );
  setEnabledLibraries(plugin, nextLibraries);
}

export function reconcileLibrariesFromConnection(
  plugin: StratumPlugin,
  connection: ZoteroConnectionState | null,
): boolean {
  if (!connection?.connected || !connection.zoteroUserId) {
    const previousGroups = JSON.stringify(plugin.availableGroups);
    plugin.availableGroups = [];
    setSelectedSearchLibrary(plugin, plugin.selectedSearchLibrary);
    return previousGroups !== JSON.stringify(plugin.availableGroups);
  }

  const nextAvailableGroups = connection.groups;
  const availableGroupById = new Map(
    nextAvailableGroups.map((group) => [group.id, group] as const),
  );
  const nextLibraries: EnabledLibrary[] = [];

  nextLibraries.push(buildPersonalLibrary(connection.zoteroUserId));

  for (const library of plugin.settings.enabledLibraries) {
    if (library.type === "user") {
      continue;
    }

    const group = availableGroupById.get(library.id);
    if (!group) {
      continue;
    }

    nextLibraries.push(buildGroupLibrary(group));
  }

  const previousLibraries = JSON.stringify(
    sortEnabledLibraries(plugin.settings.enabledLibraries),
  );
  const previousGroups = JSON.stringify(plugin.availableGroups);
  plugin.availableGroups = [...nextAvailableGroups].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  setEnabledLibraries(plugin, nextLibraries);
  return (
    previousLibraries !== JSON.stringify(plugin.settings.enabledLibraries) ||
    previousGroups !== JSON.stringify(plugin.availableGroups)
  );
}
