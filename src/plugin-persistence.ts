import {
  AUTH_ACCESS_TOKEN_SECRET_ID,
  AUTH_REFRESH_TOKEN_SECRET_ID,
} from "./constants";
import {
  DEFAULT_SETTINGS,
  type ItemFileMapEntry,
  type PersistedAuthSession,
  type StratumSettings,
} from "./settings";
import type StratumPlugin from "./plugin";
import { BULK_LIBRARY_SYNC_PHASES } from "./zotero-sync";

type StoredSettingsData = Partial<
  Pick<
    StratumSettings,
    | "notesFolder"
    | "filenameFormat"
    | "autoSyncEnabled"
    | "autoSyncIntervalMinutes"
    | "lastDeviceCode"
    | "accountEmail"
    | "accountLinkedAt"
    | "authSessionExpiresAt"
  >
> & {
  authSession?: PersistedAuthSession | null;
  itemFileMap?: Record<string, ItemFileMapEntry>;
  zoteroAutoSync?: Partial<StratumSettings["zoteroAutoSync"]>;
  bulkLibrarySync?: Partial<StratumSettings["bulkLibrarySync"]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiteratureNoteFilenameFormat(
  value: unknown
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

function readZoteroAutoSyncState(
  value: unknown
): Partial<StratumSettings["zoteroAutoSync"]> {
  if (!isRecord(value)) {
    return {};
  }

  const nextState: Partial<StratumSettings["zoteroAutoSync"]> = {};

  if (
    value.libraryVersion === null ||
    (typeof value.libraryVersion === "number" &&
      Number.isFinite(value.libraryVersion))
  ) {
    nextState.libraryVersion = value.libraryVersion;
  }

  if (typeof value.lastSuccessfulSyncAt === "string" || value.lastSuccessfulSyncAt === null) {
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

function readBulkLibrarySyncState(
  value: unknown
): Partial<StratumSettings["bulkLibrarySync"]> {
  if (!isRecord(value)) {
    return {};
  }

  const nextState: Partial<StratumSettings["bulkLibrarySync"]> = {};

  if (
    typeof value.phase === "string" &&
    BULK_LIBRARY_SYNC_PHASES.includes(
      value.phase as (typeof BULK_LIBRARY_SYNC_PHASES)[number]
    )
  ) {
    nextState.phase = value.phase as StratumSettings["bulkLibrarySync"]["phase"];
  }

  if (typeof value.startedAt === "string" || value.startedAt === null) {
    nextState.startedAt = value.startedAt;
  }
  if (typeof value.completedAt === "string" || value.completedAt === null) {
    nextState.completedAt = value.completedAt;
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
    (typeof value.totalResults === "number" && Number.isFinite(value.totalResults))
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

function readStoredSettings(
  value: unknown
): Omit<Partial<StratumSettings>, "itemFileMap" | "zoteroAutoSync" | "bulkLibrarySync"> & {
  itemFileMap: Record<string, ItemFileMapEntry>;
  zoteroAutoSync: Partial<StratumSettings["zoteroAutoSync"]>;
  bulkLibrarySync: Partial<StratumSettings["bulkLibrarySync"]>;
} {
  if (!isRecord(value)) {
    return {
      itemFileMap: {},
      zoteroAutoSync: {},
      bulkLibrarySync: {},
    };
  }

  const nextSettings: Omit<
    Partial<StratumSettings>,
    "itemFileMap" | "zoteroAutoSync" | "bulkLibrarySync"
  > & {
    itemFileMap: Record<string, ItemFileMapEntry>;
    zoteroAutoSync: Partial<StratumSettings["zoteroAutoSync"]>;
    bulkLibrarySync: Partial<StratumSettings["bulkLibrarySync"]>;
  } = {
    itemFileMap: readItemFileMap(value.itemFileMap),
    zoteroAutoSync: readZoteroAutoSyncState(value.zoteroAutoSync),
    bulkLibrarySync: readBulkLibrarySyncState(value.bulkLibrarySync),
  };

  if (typeof value.notesFolder === "string") {
    nextSettings.notesFolder = value.notesFolder;
  }
  if (isLiteratureNoteFilenameFormat(value.filenameFormat)) {
    nextSettings.filenameFormat = value.filenameFormat;
  }
  if (typeof value.autoSyncEnabled === "boolean") {
    nextSettings.autoSyncEnabled = value.autoSyncEnabled;
  }
  if (
    typeof value.autoSyncIntervalMinutes === "number" &&
    Number.isFinite(value.autoSyncIntervalMinutes)
  ) {
    nextSettings.autoSyncIntervalMinutes = value.autoSyncIntervalMinutes;
  }
  if (typeof value.lastDeviceCode === "string" || value.lastDeviceCode === null) {
    nextSettings.lastDeviceCode = value.lastDeviceCode;
  }
  if (typeof value.accountEmail === "string" || value.accountEmail === null) {
    nextSettings.accountEmail = value.accountEmail;
  }
  if (typeof value.accountLinkedAt === "string" || value.accountLinkedAt === null) {
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

  return nextSettings;
}

function readLegacyPersistedAuthSession(
  value: unknown
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

function writeSecret(plugin: StratumPlugin, id: string, value: string | null): void {
  plugin.app.secretStorage.setSecret(id, value ?? "");
}

export async function loadPluginSettings(plugin: StratumPlugin): Promise<void> {
  const rawData = (await plugin.loadData()) as StoredSettingsData | null;
  const data = readStoredSettings(rawData);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    ...data,
    itemFileMap: {
      ...DEFAULT_SETTINGS.itemFileMap,
      ...(data?.itemFileMap ?? {}),
    },
    zoteroAutoSync: {
      ...DEFAULT_SETTINGS.zoteroAutoSync,
      ...(data?.zoteroAutoSync ?? {}),
    },
    bulkLibrarySync: {
      ...DEFAULT_SETTINGS.bulkLibrarySync,
      ...(data?.bulkLibrarySync ?? {}),
    },
  };

  let shouldPersist = false;
  if (plugin.settings.bulkLibrarySync.phase === "running") {
    plugin.settings.bulkLibrarySync.phase = "paused-error";
    plugin.settings.bulkLibrarySync.lastError =
      "Bulk Zotero sync was interrupted. Resume when ready.";
    plugin.settings.bulkLibrarySync.retryAfterSeconds = null;
    shouldPersist = true;
  }

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
  session: PersistedAuthSession | null
): void {
  writeSecret(plugin, AUTH_ACCESS_TOKEN_SECRET_ID, session?.accessToken ?? null);
  writeSecret(plugin, AUTH_REFRESH_TOKEN_SECRET_ID, session?.refreshToken ?? null);
}

export function getStoredAuthSession(
  plugin: StratumPlugin
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
