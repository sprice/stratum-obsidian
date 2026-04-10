import {
  TFile,
  normalizePath,
  type CachedMetadata,
  type TAbstractFile,
} from "obsidian";
import {
  LIBRARY_ID_FRONTMATTER_KEY,
  LIBRARY_TYPE_FRONTMATTER_KEY,
  IDENTITY_FRONTMATTER_KEY,
  ITEM_KEY_FRONTMATTER_KEY,
} from "./literature-note-content";
import type { ItemFileMapEntry } from "./settings";
import type StratumPlugin from "./plugin";

function getNormalizedNotesFolder(plugin: StratumPlugin): string {
  return normalizePath(plugin.settings.notesFolder.trim()).replace(/\/+$/, "");
}

export function isPathInsideNotesFolder(
  plugin: StratumPlugin,
  path: string,
): boolean {
  const normalizedFolder = getNormalizedNotesFolder(plugin);
  const normalizedPath = normalizePath(path);
  if (!normalizedFolder) {
    return !normalizedPath.includes("/");
  }

  return (
    normalizedPath === normalizedFolder ||
    normalizedPath.startsWith(`${normalizedFolder}/`)
  );
}

export function getIdentityFromFrontmatter(
  frontmatter?: Record<string, unknown> | null,
): string | null {
  const identity = frontmatter?.[IDENTITY_FRONTMATTER_KEY];
  return typeof identity === "string" && identity.trim()
    ? identity.trim()
    : null;
}

export function getItemKeyFromFrontmatter(
  frontmatter?: Record<string, unknown> | null,
): string | null {
  const itemKey = frontmatter?.[ITEM_KEY_FRONTMATTER_KEY];
  return typeof itemKey === "string" && itemKey.trim() ? itemKey.trim() : null;
}

function getVersionFromFrontmatter(
  frontmatter?: Record<string, unknown> | null,
): number {
  const values = [
    frontmatter?.zotero_item_version,
    frontmatter?.zotero_version,
  ];

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function getLibraryTypeFromFrontmatter(
  frontmatter?: Record<string, unknown> | null,
): string | null {
  const libraryType = frontmatter?.[LIBRARY_TYPE_FRONTMATTER_KEY];
  return typeof libraryType === "string" && libraryType.trim()
    ? libraryType.trim()
    : null;
}

function getLibraryIdFromFrontmatter(
  frontmatter?: Record<string, unknown> | null,
): string | null {
  const libraryId = frontmatter?.[LIBRARY_ID_FRONTMATTER_KEY];
  return typeof libraryId === "string" && libraryId.trim()
    ? libraryId.trim()
    : null;
}

function queuePersistItemFileMap(plugin: StratumPlugin): void {
  if (plugin.itemFileMapPersistTimer !== null) {
    return;
  }

  plugin.itemFileMapPersistTimer = window.setTimeout(() => {
    plugin.itemFileMapPersistTimer = null;
    void plugin.saveSettings();
  }, 100);
}

function setItemFileMapEntry(
  plugin: StratumPlugin,
  identity: string,
  entry: ItemFileMapEntry,
): void {
  plugin.settings.itemFileMap[identity] = entry;
  queuePersistItemFileMap(plugin);
}

function removeItemFileMapEntriesForPath(
  plugin: StratumPlugin,
  path: string,
): void {
  let changed = false;
  for (const [identity, entry] of Object.entries(plugin.settings.itemFileMap)) {
    if (entry.filePath === path) {
      delete plugin.settings.itemFileMap[identity];
      changed = true;
    }
  }

  if (changed) {
    queuePersistItemFileMap(plugin);
  }
}

export function syncItemFileMapForFile(
  plugin: StratumPlugin,
  file: TFile,
  cache?: CachedMetadata | null,
): void {
  removeItemFileMapEntriesForPath(plugin, file.path);

  if (!isPathInsideNotesFolder(plugin, file.path)) {
    return;
  }

  const frontmatter =
    (cache?.frontmatter as Record<string, unknown> | undefined) ??
    (plugin.app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined) ??
    null;
  const identity = getIdentityFromFrontmatter(frontmatter);
  const itemKey = getItemKeyFromFrontmatter(frontmatter);
  if (!identity || !itemKey) {
    return;
  }

  setItemFileMapEntry(plugin, identity, {
    filePath: file.path,
    zoteroItemKey: itemKey,
    zoteroVersion: getVersionFromFrontmatter(frontmatter),
  });
}

export function handleItemFileRename(
  plugin: StratumPlugin,
  file: TAbstractFile,
  oldPath: string,
): void {
  removeItemFileMapEntriesForPath(plugin, oldPath);
  if (file instanceof TFile) {
    syncItemFileMapForFile(plugin, file);
  }
}

export function handleItemFileDelete(
  plugin: StratumPlugin,
  file: TAbstractFile,
): void {
  removeItemFileMapEntriesForPath(plugin, file.path);
}

export async function rebuildItemFileMap(plugin: StratumPlugin): Promise<void> {
  const nextMap: Record<string, ItemFileMapEntry> = {};

  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (!isPathInsideNotesFolder(plugin, file.path)) {
      continue;
    }

    const frontmatter =
      (plugin.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined) ?? null;
    const identity = getIdentityFromFrontmatter(frontmatter);
    const itemKey = getItemKeyFromFrontmatter(frontmatter);
    if (!identity || !itemKey) {
      continue;
    }

    nextMap[identity] = {
      filePath: file.path,
      zoteroItemKey: itemKey,
      zoteroVersion: getVersionFromFrontmatter(frontmatter),
    };
  }

  plugin.settings.itemFileMap = nextMap;
  await plugin.saveSettings();
}

function getIdentityCacheKey(identity: {
  libraryType: string;
  libraryId: string;
  itemKey: string;
}): string {
  return `${identity.libraryType}/${identity.libraryId}/${identity.itemKey}`;
}

export function findExistingLiteratureNoteFile(
  plugin: StratumPlugin,
  identity: {
    libraryType: string;
    libraryId: string;
    itemKey: string;
  },
): TFile | null {
  const cacheKey = getIdentityCacheKey(identity);
  const cachedEntry = plugin.settings.itemFileMap[cacheKey];
  if (cachedEntry && isPathInsideNotesFolder(plugin, cachedEntry.filePath)) {
    const cachedFile = plugin.app.vault.getAbstractFileByPath(
      cachedEntry.filePath,
    );
    if (cachedFile instanceof TFile) {
      return cachedFile;
    }

    delete plugin.settings.itemFileMap[cacheKey];
    queuePersistItemFileMap(plugin);
  }

  const noteFiles = plugin.app.vault
    .getMarkdownFiles()
    .filter((file) => isPathInsideNotesFolder(plugin, file.path));

  const repaired =
    noteFiles.find((file) => {
      const frontmatter =
        (plugin.app.metadataCache.getFileCache(file)?.frontmatter as
          | Record<string, unknown>
          | undefined) ?? null;
      return getIdentityFromFrontmatter(frontmatter) === cacheKey;
    }) ??
    noteFiles.find((file) => {
      const frontmatter =
        (plugin.app.metadataCache.getFileCache(file)?.frontmatter as
          | Record<string, unknown>
          | undefined) ?? null;
      return (
        getItemKeyFromFrontmatter(frontmatter) === identity.itemKey &&
        getLibraryTypeFromFrontmatter(frontmatter) === identity.libraryType &&
        getLibraryIdFromFrontmatter(frontmatter) === identity.libraryId
      );
    });

  if (!repaired) {
    return null;
  }

  syncItemFileMapForFile(plugin, repaired);
  return repaired;
}

export function rememberLiteratureNoteFile(
  plugin: StratumPlugin,
  detail: {
    library: { type: string; id: string };
    item: { key: string; version: number };
  },
  file: TFile,
): void {
  setItemFileMapEntry(
    plugin,
    getIdentityCacheKey({
      libraryType: detail.library.type,
      libraryId: detail.library.id,
      itemKey: detail.item.key,
    }),
    {
      filePath: file.path,
      zoteroItemKey: detail.item.key,
      zoteroVersion: detail.item.version,
    },
  );
}
