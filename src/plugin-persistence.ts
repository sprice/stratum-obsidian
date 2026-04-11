import {
  AUTH_ACCESS_TOKEN_SECRET_ID,
  AUTH_REFRESH_TOKEN_SECRET_ID,
} from "./constants";
import { isPendingAuthStale } from "./auth-flow";
import {
  DEFAULT_SETTINGS,
  type EnabledLibrary,
  type ItemFileMapEntry,
  type PendingAuthFlow,
  type PendingAuthReturnTarget,
  type PendingAuthState,
  type PersistedAuthSession,
  type StratumSettings,
} from "./settings-data";
import type StratumPlugin from "./plugin";
import { buildPersonalLibrary, syncLibraryStateMaps } from "./plugin-libraries";
import {
  BULK_LIBRARY_SYNC_PHASES,
  type BulkLibrarySyncState,
  type ZoteroAutoSyncState,
  buildDefaultBulkLibrarySyncState,
  buildDefaultZoteroAutoSyncState,
} from "./zotero-sync";

type StoredSettingsData = Partial<
  Pick<
    StratumSettings,
    | "notesFolder"
    | "filenameFormat"
    | "bulkSyncEnabled"
    | "bulkSyncPreferenceInitialized"
    | "zoteroLocalApiPort"
    | "zoteroDataDir"
    | "pendingAuth"
    | "accountEmail"
    | "accountLinkedAt"
    | "authSessionExpiresAt"
    | "lastKnownZoteroUserId"
    | "lastKnownZoteroUsername"
    | "lastKnownZoteroConfirmedAt"
    | "selectedSyncLibraryIdentity"
    | "selectedSyncCollectionKey"
    | "enabledLibraries"
    | "activeBulkSyncLibrary"
  >
> & {
  lastDeviceCode?: string | null;
  authSession?: PersistedAuthSession | null;
  itemFileMap?: Record<string, ItemFileMapEntry>;
  libraryAutoSync?: Record<string, Partial<ZoteroAutoSyncState>>;
  libraryBulkSync?: Record<string, Partial<BulkLibrarySyncState>>;
  zoteroAutoSync?: Partial<ZoteroAutoSyncState>;
  bulkLibrarySync?: Partial<BulkLibrarySyncState>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiteratureNoteFilenameFormat(
  value: unknown,
): value is StratumSettings["filenameFormat"] {
  return value === "readable" || value === "citekey";
}

function isPersistedAuthSession(value: unknown): value is PersistedAuthSession {
  return (
    isRecord(value) &&
    typeof value.accessToken === "string" &&
    typeof value.refreshToken === "string" &&
    (value.expiresAt === null ||
      (typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)))
  );
}

function isItemFileMapEntry(value: unknown): value is ItemFileMapEntry {
  return (
    isRecord(value) &&
    typeof value.filePath === "string" &&
    typeof value.zoteroItemKey === "string" &&
    typeof value.zoteroVersion === "number" &&
    Number.isFinite(value.zoteroVersion)
  );
}

function isEnabledLibrary(value: unknown): value is EnabledLibrary {
  return (
    isRecord(value) &&
    (value.type === "user" || value.type === "group") &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.identity === "string"
  );
}

function isPendingAuthFlow(value: unknown): value is PendingAuthFlow {
  return value === "stratum-sign-in" || value === "zotero-connect";
}

function isPendingAuthReturnTarget(
  value: unknown,
): value is PendingAuthReturnTarget {
  return value === "stay-settings" || value === "open-panel-search";
}

function readPendingAuth(
  value: unknown,
  legacyDeviceCode?: string | null,
): PendingAuthState | null {
  if (isRecord(value)) {
    const code = typeof value.code === "string" ? value.code.trim() : "";
    const createdAt =
      typeof value.createdAt === "string" ? value.createdAt.trim() : "";
    if (
      code &&
      createdAt &&
      isPendingAuthFlow(value.flow) &&
      isPendingAuthReturnTarget(value.returnTarget)
    ) {
      return {
        code,
        flow: value.flow,
        returnTarget: value.returnTarget,
        createdAt,
      };
    }
  }

  const legacyCode = legacyDeviceCode?.trim();
  if (!legacyCode) {
    return null;
  }

  return {
    code: legacyCode,
    flow: "stratum-sign-in",
    returnTarget: "stay-settings",
    createdAt: new Date().toISOString(),
  };
}

function readEnabledLibraries(value: unknown): EnabledLibrary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isEnabledLibrary)
    .map((library) => ({
      type: library.type,
      id: library.id.trim(),
      name: library.name.trim(),
      identity: library.identity.trim(),
    }))
    .filter((library) => library.id && library.name && library.identity);
}

function readItemFileMap(value: unknown): Record<string, ItemFileMapEntry> {
  if (!isRecord(value)) {
    return {};
  }

  const nextMap: Record<string, ItemFileMapEntry> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (isItemFileMapEntry(entry)) {
      nextMap[key] = entry;
    }
  }

  return nextMap;
}

function readZoteroAutoSyncState(value: unknown): Partial<ZoteroAutoSyncState> {
  if (!isRecord(value)) {
    return {};
  }

  const nextState: Partial<ZoteroAutoSyncState> = {};

  if (
    value.libraryVersion === null ||
    (typeof value.libraryVersion === "number" &&
      Number.isFinite(value.libraryVersion))
  ) {
    nextState.libraryVersion = value.libraryVersion;
  }

  if (
    typeof value.lastSuccessfulSyncAt === "string" ||
    value.lastSuccessfulSyncAt === null
  ) {
    nextState.lastSuccessfulSyncAt = value.lastSuccessfulSyncAt;
  }

  if (typeof value.lastError === "string" || value.lastError === null) {
    nextState.lastError = value.lastError;
  }

  if (typeof value.initialRefreshCompleted === "boolean") {
    nextState.initialRefreshCompleted = value.initialRefreshCompleted;
  }

  return nextState;
}

function readZoteroAutoSyncStateMap(
  value: unknown,
): Record<string, Partial<ZoteroAutoSyncState>> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([identity, state]) => [
      identity,
      readZoteroAutoSyncState(state),
    ]),
  );
}

function readBulkLibrarySyncState(
  value: unknown,
): Partial<BulkLibrarySyncState> {
  if (!isRecord(value)) {
    return {};
  }

  const nextState: Partial<BulkLibrarySyncState> = {};

  if (
    typeof value.phase === "string" &&
    BULK_LIBRARY_SYNC_PHASES.includes(
      value.phase as (typeof BULK_LIBRARY_SYNC_PHASES)[number],
    )
  ) {
    nextState.phase = value.phase as BulkLibrarySyncState["phase"];
  }

  if (typeof value.startedAt === "string" || value.startedAt === null) {
    nextState.startedAt = value.startedAt;
  }
  if (typeof value.completedAt === "string" || value.completedAt === null) {
    nextState.completedAt = value.completedAt;
  }
  if (typeof value.collectionKey === "string" || value.collectionKey === null) {
    nextState.collectionKey = value.collectionKey;
  }
  if (
    typeof value.collectionName === "string" ||
    value.collectionName === null
  ) {
    nextState.collectionName = value.collectionName;
  }
  if (
    value.snapshotLibraryVersion === null ||
    (typeof value.snapshotLibraryVersion === "number" &&
      Number.isFinite(value.snapshotLibraryVersion))
  ) {
    nextState.snapshotLibraryVersion = value.snapshotLibraryVersion;
  }
  if (
    value.totalResults === null ||
    (typeof value.totalResults === "number" &&
      Number.isFinite(value.totalResults))
  ) {
    nextState.totalResults = value.totalResults;
  }

  const numericFields = [
    "nextStart",
    "pageSize",
    "processedCount",
    "createdCount",
    "updatedCount",
    "skippedCount",
    "failedCount",
    "enrichmentFailureCount",
    "retryAfterSeconds",
  ] as const;

  for (const field of numericFields) {
    const candidate = value[field];
    if (candidate === null && field === "retryAfterSeconds") {
      nextState[field] = null;
      continue;
    }

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      nextState[field] = candidate;
    }
  }

  if (typeof value.lastError === "string" || value.lastError === null) {
    nextState.lastError = value.lastError;
  }

  if (Array.isArray(value.failedItemKeys)) {
    nextState.failedItemKeys = value.failedItemKeys
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return nextState;
}

function readBulkLibrarySyncStateMap(
  value: unknown,
): Record<string, Partial<BulkLibrarySyncState>> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([identity, state]) => [
      identity,
      readBulkLibrarySyncState(state),
    ]),
  );
}

function readStoredSettings(value: unknown): Omit<
  Partial<StratumSettings>,
  "itemFileMap" | "libraryAutoSync" | "libraryBulkSync"
> & {
  itemFileMap: Record<string, ItemFileMapEntry>;
  libraryAutoSync: Record<string, Partial<ZoteroAutoSyncState>>;
  libraryBulkSync: Record<string, Partial<BulkLibrarySyncState>>;
  legacyZoteroAutoSync: Partial<ZoteroAutoSyncState>;
  legacyBulkLibrarySync: Partial<BulkLibrarySyncState>;
} {
  if (!isRecord(value)) {
    return {
      itemFileMap: {},
      libraryAutoSync: {},
      libraryBulkSync: {},
      legacyZoteroAutoSync: {},
      legacyBulkLibrarySync: {},
    };
  }

  const nextSettings: Omit<
    Partial<StratumSettings>,
    "itemFileMap" | "libraryAutoSync" | "libraryBulkSync"
  > & {
    itemFileMap: Record<string, ItemFileMapEntry>;
    libraryAutoSync: Record<string, Partial<ZoteroAutoSyncState>>;
    libraryBulkSync: Record<string, Partial<BulkLibrarySyncState>>;
    legacyZoteroAutoSync: Partial<ZoteroAutoSyncState>;
    legacyBulkLibrarySync: Partial<BulkLibrarySyncState>;
  } = {
    itemFileMap: readItemFileMap(value.itemFileMap),
    libraryAutoSync: readZoteroAutoSyncStateMap(value.libraryAutoSync),
    libraryBulkSync: readBulkLibrarySyncStateMap(value.libraryBulkSync),
    legacyZoteroAutoSync: readZoteroAutoSyncState(value.zoteroAutoSync),
    legacyBulkLibrarySync: readBulkLibrarySyncState(value.bulkLibrarySync),
  };

  if (typeof value.notesFolder === "string") {
    nextSettings.notesFolder = value.notesFolder;
  }
  if (isLiteratureNoteFilenameFormat(value.filenameFormat)) {
    nextSettings.filenameFormat = value.filenameFormat;
  }
  if (typeof value.bulkSyncEnabled === "boolean") {
    nextSettings.bulkSyncEnabled = value.bulkSyncEnabled;
  }
  if (typeof value.bulkSyncPreferenceInitialized === "boolean") {
    nextSettings.bulkSyncPreferenceInitialized =
      value.bulkSyncPreferenceInitialized;
  }
  if (
    typeof value.zoteroLocalApiPort === "number" &&
    Number.isFinite(value.zoteroLocalApiPort) &&
    value.zoteroLocalApiPort > 0
  ) {
    nextSettings.zoteroLocalApiPort = Math.round(value.zoteroLocalApiPort);
  }
  if (typeof value.zoteroDataDir === "string") {
    nextSettings.zoteroDataDir = value.zoteroDataDir;
  }
  if ("pendingAuth" in value || "lastDeviceCode" in value) {
    nextSettings.pendingAuth = readPendingAuth(
      value.pendingAuth,
      typeof value.lastDeviceCode === "string" || value.lastDeviceCode === null
        ? value.lastDeviceCode
        : null,
    );
  }
  if (typeof value.accountEmail === "string" || value.accountEmail === null) {
    nextSettings.accountEmail = value.accountEmail;
  }
  if (
    typeof value.accountLinkedAt === "string" ||
    value.accountLinkedAt === null
  ) {
    nextSettings.accountLinkedAt = value.accountLinkedAt;
  }
  if (
    typeof value.authSessionExpiresAt === "number" &&
    Number.isFinite(value.authSessionExpiresAt)
  ) {
    nextSettings.authSessionExpiresAt = value.authSessionExpiresAt;
  } else if (value.authSessionExpiresAt === null) {
    nextSettings.authSessionExpiresAt = null;
  }
  if (
    typeof value.lastKnownZoteroUserId === "string" ||
    value.lastKnownZoteroUserId === null
  ) {
    nextSettings.lastKnownZoteroUserId = value.lastKnownZoteroUserId;
  }
  if (
    typeof value.lastKnownZoteroUsername === "string" ||
    value.lastKnownZoteroUsername === null
  ) {
    nextSettings.lastKnownZoteroUsername = value.lastKnownZoteroUsername;
  }
  if (
    typeof value.lastKnownZoteroConfirmedAt === "string" ||
    value.lastKnownZoteroConfirmedAt === null
  ) {
    nextSettings.lastKnownZoteroConfirmedAt = value.lastKnownZoteroConfirmedAt;
  }
  if (
    typeof value.selectedSyncLibraryIdentity === "string" ||
    value.selectedSyncLibraryIdentity === null
  ) {
    nextSettings.selectedSyncLibraryIdentity =
      value.selectedSyncLibraryIdentity;
  }
  if (
    typeof value.selectedSyncCollectionKey === "string" ||
    value.selectedSyncCollectionKey === null
  ) {
    nextSettings.selectedSyncCollectionKey = value.selectedSyncCollectionKey;
  }
  if (
    value.activeBulkSyncLibrary === null ||
    typeof value.activeBulkSyncLibrary === "string"
  ) {
    nextSettings.activeBulkSyncLibrary = value.activeBulkSyncLibrary;
  }
  nextSettings.enabledLibraries = readEnabledLibraries(value.enabledLibraries);

  return nextSettings;
}

function readLegacyPersistedAuthSession(
  value: unknown,
): PersistedAuthSession | null {
  if (!isRecord(value)) {
    return null;
  }

  return isPersistedAuthSession(value.authSession) ? value.authSession : null;
}

function readSecret(plugin: StratumPlugin, id: string): string | null {
  const value = plugin.app.secretStorage.getSecret(id);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function writeSecret(
  plugin: StratumPlugin,
  id: string,
  value: string | null,
): void {
  plugin.app.secretStorage.setSecret(id, value ?? "");
}

function hasLegacyPendingEnrichmentCount(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if ("pendingEnrichmentCount" in value) {
    return true;
  }

  return Object.values(value).some(
    (entry) => isRecord(entry) && "pendingEnrichmentCount" in entry,
  );
}

export async function loadPluginSettings(plugin: StratumPlugin): Promise<void> {
  const rawData = (await plugin.loadData()) as StoredSettingsData | null;
  const data = readStoredSettings(rawData);
  const { legacyZoteroAutoSync, legacyBulkLibrarySync, ...persistedSettings } =
    data;
  const hasLegacySettingKeys =
    isRecord(rawData) &&
    ("autoSyncEnabled" in rawData || "autoSyncIntervalMinutes" in rawData);
  const hasLegacyPendingAuth = isRecord(rawData) && "lastDeviceCode" in rawData;
  const hasLegacyOpenAlexKeys =
    isRecord(rawData) &&
    ("openAlexEnrichmentCache" in rawData ||
      "pendingOpenAlexEnrichmentByLibrary" in rawData);
  const hasLegacyPendingEnrichmentCounts =
    isRecord(rawData) &&
    (hasLegacyPendingEnrichmentCount(rawData.bulkLibrarySync) ||
      hasLegacyPendingEnrichmentCount(rawData.libraryBulkSync));
  const libraryAutoSync = Object.fromEntries(
    Object.entries(data.libraryAutoSync).map(([identity, state]) => [
      identity,
      {
        ...buildDefaultZoteroAutoSyncState(),
        ...state,
      },
    ]),
  );
  const libraryBulkSync = Object.fromEntries(
    Object.entries(data.libraryBulkSync).map(([identity, state]) => [
      identity,
      {
        ...buildDefaultBulkLibrarySyncState(),
        ...state,
        failedItemKeys: [...(state.failedItemKeys ?? [])],
      },
    ]),
  );
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    ...persistedSettings,
    itemFileMap: {
      ...DEFAULT_SETTINGS.itemFileMap,
      ...(persistedSettings.itemFileMap ?? {}),
    },
    enabledLibraries: [...(persistedSettings.enabledLibraries ?? [])],
    libraryAutoSync,
    libraryBulkSync,
    activeBulkSyncLibrary: persistedSettings.activeBulkSyncLibrary ?? null,
  };

  let shouldPersist =
    hasLegacyPendingAuth ||
    hasLegacySettingKeys ||
    hasLegacyOpenAlexKeys ||
    hasLegacyPendingEnrichmentCounts;
  if (isPendingAuthStale({ pendingAuth: plugin.settings.pendingAuth })) {
    plugin.settings.pendingAuth = null;
    shouldPersist = true;
  }
  if (
    plugin.settings.enabledLibraries.length === 0 &&
    plugin.settings.lastKnownZoteroUserId
  ) {
    plugin.settings.enabledLibraries = [
      buildPersonalLibrary(plugin.settings.lastKnownZoteroUserId),
    ];
    shouldPersist = true;
  }

  const personalLibraryIdentity = plugin.settings.lastKnownZoteroUserId
    ? buildPersonalLibrary(plugin.settings.lastKnownZoteroUserId).identity
    : null;
  if (
    personalLibraryIdentity &&
    Object.keys(plugin.settings.libraryAutoSync).length === 0 &&
    Object.keys(legacyZoteroAutoSync).length > 0
  ) {
    plugin.settings.libraryAutoSync[personalLibraryIdentity] = {
      ...buildDefaultZoteroAutoSyncState(),
      ...legacyZoteroAutoSync,
    };
    shouldPersist = true;
  }
  if (
    personalLibraryIdentity &&
    Object.keys(plugin.settings.libraryBulkSync).length === 0 &&
    Object.keys(legacyBulkLibrarySync).length > 0
  ) {
    plugin.settings.libraryBulkSync[personalLibraryIdentity] = {
      ...buildDefaultBulkLibrarySyncState(),
      ...legacyBulkLibrarySync,
      failedItemKeys: [...(legacyBulkLibrarySync.failedItemKeys ?? [])],
    };
    shouldPersist = true;
  }

  for (const state of Object.values(plugin.settings.libraryBulkSync)) {
    if (state.phase !== "running") {
      continue;
    }

    state.phase = "paused-error";
    state.lastError = "Sync interrupted. Start sync again when ready.";
    state.retryAfterSeconds = null;
    shouldPersist = true;
  }

  if (plugin.settings.activeBulkSyncLibrary !== null) {
    plugin.settings.activeBulkSyncLibrary = null;
    shouldPersist = true;
  }

  syncLibraryStateMaps(plugin);

  const legacySession = readLegacyPersistedAuthSession(rawData);
  if (legacySession && !getStoredAuthSession(plugin)) {
    persistAuthSessionSecrets(plugin, legacySession);
    plugin.settings.authSessionExpiresAt = legacySession.expiresAt;
    shouldPersist = true;
  }

  const storedSession = getStoredAuthSession(plugin);
  if (!storedSession && plugin.settings.authSessionExpiresAt !== null) {
    plugin.settings.authSessionExpiresAt = null;
    shouldPersist = true;
  }

  // If secrets exist but settings were wiped (plugin was deleted and reinstalled),
  // clear the orphaned secrets so the user starts fresh.
  if (storedSession && !plugin.settings.accountEmail) {
    persistAuthSessionSecrets(plugin, null);
    plugin.settings.authSessionExpiresAt = null;
    shouldPersist = true;
  }

  if (legacySession) {
    shouldPersist = true;
  }

  if (shouldPersist) {
    await savePluginSettings(plugin);
  }
}

export async function savePluginSettings(plugin: StratumPlugin): Promise<void> {
  await plugin.saveData(plugin.settings);
}

export function persistAuthSessionSecrets(
  plugin: StratumPlugin,
  session: PersistedAuthSession | null,
): void {
  writeSecret(
    plugin,
    AUTH_ACCESS_TOKEN_SECRET_ID,
    session?.accessToken ?? null,
  );
  writeSecret(
    plugin,
    AUTH_REFRESH_TOKEN_SECRET_ID,
    session?.refreshToken ?? null,
  );
}

export function getStoredAuthSession(
  plugin: StratumPlugin,
): PersistedAuthSession | null {
  const accessToken = readSecret(plugin, AUTH_ACCESS_TOKEN_SECRET_ID);
  const refreshToken = readSecret(plugin, AUTH_REFRESH_TOKEN_SECRET_ID);

  if (!accessToken && !refreshToken) {
    return null;
  }

  if (!accessToken || !refreshToken) {
    persistAuthSessionSecrets(plugin, null);
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: plugin.settings.authSessionExpiresAt,
  };
}
