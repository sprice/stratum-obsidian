import {
  ANNOTATION_KEYS_FRONTMATTER_KEY,
  ATTACHMENT_KEYS_FRONTMATTER_KEY,
  NOTE_KEYS_FRONTMATTER_KEY,
} from "./literature-note-content";

export const AUTO_SYNC_FOCUS_COOLDOWN_MS = 30_000;

export interface ZoteroAutoSyncState {
  libraryVersion: number | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  initialRefreshCompleted: boolean;
}

export interface DeletedChildLookupCandidate {
  path: string;
  frontmatter?: Record<string, unknown> | null;
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
  autoSyncEnabled: boolean;
  state: ZoteroAutoSyncState;
  now?: number;
}): string {
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
