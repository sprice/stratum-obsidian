import {
  ANNOTATION_KEYS_FRONTMATTER_KEY,
  ATTACHMENT_KEYS_FRONTMATTER_KEY,
  NOTE_KEYS_FRONTMATTER_KEY,
} from "./literature-note-content";

export const AUTO_SYNC_FOCUS_COOLDOWN_MS = 30_000;

export const BULK_LIBRARY_SYNC_PHASES = [
  "idle",
  "running",
  "paused-rate-limit",
  "paused-error",
  "completed",
] as const;

export type BulkLibrarySyncPhase = (typeof BULK_LIBRARY_SYNC_PHASES)[number];

export interface ZoteroAutoSyncState {
  libraryVersion: number | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  initialRefreshCompleted: boolean;
}

export interface BulkLibrarySyncState {
  phase: BulkLibrarySyncPhase;
  startedAt: string | null;
  completedAt: string | null;
  snapshotLibraryVersion: number | null;
  totalResults: number | null;
  nextStart: number;
  pageSize: number;
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  lastError: string | null;
  retryAfterSeconds: number | null;
  failedItemKeys: string[];
}

export interface DeletedChildLookupCandidate {
  path: string;
  frontmatter?: Record<string, unknown> | null;
}

export const DEFAULT_ZOTERO_AUTO_SYNC_STATE: ZoteroAutoSyncState = {
  libraryVersion: null,
  lastSuccessfulSyncAt: null,
  lastError: null,
  initialRefreshCompleted: false,
};

export const DEFAULT_BULK_LIBRARY_SYNC_STATE: BulkLibrarySyncState = {
  phase: "idle",
  startedAt: null,
  completedAt: null,
  snapshotLibraryVersion: null,
  totalResults: null,
  nextStart: 0,
  pageSize: 100,
  processedCount: 0,
  createdCount: 0,
  updatedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  lastError: null,
  retryAfterSeconds: null,
  failedItemKeys: [],
};

export function buildDefaultZoteroAutoSyncState(): ZoteroAutoSyncState {
  return {
    ...DEFAULT_ZOTERO_AUTO_SYNC_STATE,
  };
}

export function buildDefaultBulkLibrarySyncState(): BulkLibrarySyncState {
  return {
    ...DEFAULT_BULK_LIBRARY_SYNC_STATE,
    failedItemKeys: [...DEFAULT_BULK_LIBRARY_SYNC_STATE.failedItemKeys],
  };
}

function toStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getRelativeUnit(
  deltaSeconds: number
): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  if (deltaSeconds < 60) {
    return {
      value: Math.max(-59, Math.min(59, Math.round(deltaSeconds))),
      unit: "second",
    };
  }

  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) {
    return {
      value: deltaMinutes,
      unit: "minute",
    };
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) {
    return {
      value: deltaHours,
      unit: "hour",
    };
  }

  return {
    value: Math.round(deltaHours / 24),
    unit: "day",
  };
}

export function formatRelativeSyncTime(
  timestamp: string,
  now = Date.now()
): string | null {
  const target = Date.parse(timestamp);
  if (!Number.isFinite(target)) {
    return null;
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });
  const deltaSeconds = Math.round((target - now) / 1000);
  const { value, unit } = getRelativeUnit(deltaSeconds);
  return formatter.format(value, unit);
}

export function getSyncStatusLabel(params: {
  isSyncing: boolean;
  isBulkSyncing?: boolean;
  autoSyncEnabled: boolean;
  state: ZoteroAutoSyncState;
  now?: number;
}): string {
  if (params.isBulkSyncing) {
    return "Zotero: syncing all papers...";
  }

  if (params.isSyncing) {
    return "Zotero: syncing...";
  }

  if (!params.autoSyncEnabled) {
    return "Zotero: auto-sync off";
  }

  if (params.state.lastError) {
    return "Zotero: sync failed";
  }

  if (!params.state.lastSuccessfulSyncAt) {
    return "Zotero: waiting to sync";
  }

  const relative = formatRelativeSyncTime(
    params.state.lastSuccessfulSyncAt,
    params.now
  );
  return relative ? `Zotero: synced ${relative}` : "Zotero: synced";
}

export function shouldSkipFocusSync(
  lastFocusSyncAt: number,
  now = Date.now(),
  cooldownMs = AUTO_SYNC_FOCUS_COOLDOWN_MS
): boolean {
  return lastFocusSyncAt > 0 && now - lastFocusSyncAt < cooldownMs;
}

export function getBulkLibrarySyncButtonLabel(
  state: BulkLibrarySyncState
): string {
  if (state.phase === "running") {
    return "Syncing Zotero papers...";
  }

  if (state.phase === "paused-rate-limit" || state.phase === "paused-error") {
    return "Resume Zotero sync";
  }

  return "Sync all Zotero papers";
}

export function getBulkLibrarySyncStatusMessage(params: {
  state: BulkLibrarySyncState;
  processedCount?: number;
}): string | null {
  const processedCount = params.processedCount ?? params.state.processedCount;

  if (params.state.phase === "running") {
    if (params.state.totalResults && params.state.totalResults > 0) {
      return `Syncing ${Math.min(processedCount, params.state.totalResults)} of ${params.state.totalResults} papers.`;
    }

    return processedCount > 0
      ? `Syncing papers. ${processedCount} processed so far.`
      : "Preparing your Zotero library...";
  }

  if (params.state.phase === "paused-rate-limit") {
    return params.state.retryAfterSeconds
      ? `Paused while Zotero asks us to slow down. Resume in about ${params.state.retryAfterSeconds} seconds.`
      : "Paused while Zotero asks us to slow down.";
  }

  if (params.state.phase === "paused-error") {
    return params.state.lastError ?? "Sync paused. Resume when ready.";
  }

  if (params.state.phase === "completed") {
    if (params.state.totalResults && params.state.totalResults > 0) {
      return `Finished syncing ${params.state.totalResults} papers.`;
    }

    return "Finished syncing your Zotero papers.";
  }

  return "Create or update literature notes for every paper in your Zotero library.";
}

export function findAffectedPathsForDeletedChildKeys(
  candidates: DeletedChildLookupCandidate[],
  deletedKeys: string[]
): string[] {
  const deleted = new Set(deletedKeys);
  if (deleted.size === 0) {
    return [];
  }

  const affectedPaths = new Set<string>();
  for (const candidate of candidates) {
    const trackedKeys = [
      ...toStringList(candidate.frontmatter?.[ATTACHMENT_KEYS_FRONTMATTER_KEY]),
      ...toStringList(candidate.frontmatter?.[NOTE_KEYS_FRONTMATTER_KEY]),
      ...toStringList(candidate.frontmatter?.[ANNOTATION_KEYS_FRONTMATTER_KEY]),
    ];

    if (trackedKeys.some((key) => deleted.has(key))) {
      affectedPaths.add(candidate.path);
    }
  }

  return Array.from(affectedPaths).sort((left, right) => left.localeCompare(right));
}
