type LiveSyncItemFileMapEntry = {
  filePath: string;
  zoteroItemKey: string;
  zoteroVersion: number;
};

type LiveSyncLibrary = {
  type: "user" | "group";
  id: string;
};

export type TrackedRefreshCandidate = {
  identity: string;
  itemKey: string;
  filePath: string;
};

const WATCHED_ZOTERO_DATA_FILES = new Set([
  "zotero.sqlite",
  "zotero.sqlite-wal",
  "zotero.sqlite-shm",
]);

export function isWatchedZoteroDataFile(
  filename: string | Uint8Array | null | undefined,
): boolean {
  if (!filename) {
    return false;
  }

  const value =
    typeof filename === "string"
      ? filename
      : new TextDecoder().decode(filename);
  return WATCHED_ZOTERO_DATA_FILES.has(value.trim());
}

export function shouldTriggerLocalLiveSyncFromWatchEvent(
  filename: string | Uint8Array | null | undefined,
): boolean {
  if (!filename) {
    return true;
  }

  return isWatchedZoteroDataFile(filename);
}

export function getTrackedLibraryRefreshCandidates(params: {
  itemFileMap: Record<string, LiveSyncItemFileMapEntry>;
  library: LiveSyncLibrary;
  previousItemVersions: Record<string, number>;
  currentItemVersions: Record<string, number>;
  trackedChildKeysByIdentity?: Record<string, string[]>;
}): TrackedRefreshCandidate[] {
  const prefix = `${params.library.type}/${params.library.id}/`;
  const candidates: TrackedRefreshCandidate[] = [];

  for (const [identity, entry] of Object.entries(params.itemFileMap)) {
    if (!identity.startsWith(prefix)) {
      continue;
    }

    if (
      hasTrackedItemVersionChanged(
        entry.zoteroItemKey,
        params.previousItemVersions,
        params.currentItemVersions,
      )
    ) {
      candidates.push({
        identity,
        itemKey: entry.zoteroItemKey,
        filePath: entry.filePath,
      });
      continue;
    }

    const trackedChildKeys =
      params.trackedChildKeysByIdentity?.[identity] ?? [];
    if (
      trackedChildKeys.some((childKey) =>
        hasTrackedItemVersionChanged(
          childKey,
          params.previousItemVersions,
          params.currentItemVersions,
        ),
      )
    ) {
      candidates.push({
        identity,
        itemKey: entry.zoteroItemKey,
        filePath: entry.filePath,
      });
    }
  }

  return candidates.sort((left, right) =>
    left.identity.localeCompare(right.identity),
  );
}

function hasTrackedItemVersionChanged(
  itemKey: string,
  previousItemVersions: Record<string, number>,
  currentItemVersions: Record<string, number>,
): boolean {
  const previousVersion = previousItemVersions[itemKey];
  const currentVersion = currentItemVersions[itemKey];
  const hasPreviousVersion =
    typeof previousVersion === "number" && Number.isFinite(previousVersion);
  const hasCurrentVersion =
    typeof currentVersion === "number" && Number.isFinite(currentVersion);

  if (!hasPreviousVersion && !hasCurrentVersion) {
    return false;
  }

  if (hasPreviousVersion !== hasCurrentVersion) {
    return true;
  }

  return previousVersion !== currentVersion;
}
