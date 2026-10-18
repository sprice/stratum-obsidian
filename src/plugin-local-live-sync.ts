import {
  DEFAULT_NOTES_TEMPLATE,
  NOTES_TEMPLATE_KEY,
  needsNotesTemplateUpdate,
} from "./literature-note-template";
import {
  NOTE_LAYOUT_KEY,
  NOTE_LAYOUT_VERSION,
  readLiteratureNoteLayout,
} from "./literature-note-layout";
import { Platform, TFile, parseYaml } from "obsidian";
import { splitFrontmatterContent } from "./literature-note-frontmatter";
import { getLibraryAutoSyncState } from "./plugin-libraries";
import { refreshOpenedLiteratureNote } from "./plugin-note-refresh";
import type StratumPlugin from "./plugin";
import { refreshLocalSyncLibraries } from "./plugin-local-sync";
import {
  loadLocalZoteroNoteSnapshot,
  LocalZoteroApiError,
  LocalZoteroUnavailableError,
  loadLocalZoteroLibraries,
} from "./zotero-local";

type LiveSyncLibrary = StratumPlugin["localSyncLibraries"][number];
const POLL_MS = 30_000;
const RETRY_MS = 60_000;

function enabled(plugin: StratumPlugin): boolean {
  return (
    !plugin.isUnloaded &&
    Platform.isDesktopApp &&
    plugin.settings.bulkSyncEnabled &&
    plugin.backend.hasSession() &&
    Boolean(plugin.zoteroConnection?.connected)
  );
}

function schedule(plugin: StratumPlugin, delay: number): void {
  if (plugin.localLiveSyncDebounceTimer !== null) {
    window.clearTimeout(plugin.localLiveSyncDebounceTimer);
  }
  plugin.localLiveSyncDebounceTimer = null;
  if (!enabled(plugin)) return;
  plugin.localLiveSyncDebounceTimer = window.setTimeout(() => {
    plugin.localLiveSyncDebounceTimer = null;
    void poll(plugin);
  }, delay);
}

function setStatus(plugin: StratumPlugin, message: string | null): void {
  if (plugin.localLiveSyncError === message) return;
  plugin.localLiveSyncError = message;
  plugin.refreshViews();
}

export async function getTrackedNoteMetadata(
  plugin: StratumPlugin,
  library: LiveSyncLibrary,
): Promise<{
  layoutMigrationIdentities: Set<string>;
}> {
  const prefix = `${library.type}/${library.id}/`;
  const layoutMigrationIdentities = new Set<string>();

  for (const [identity, entry] of Object.entries(plugin.settings.itemFileMap)) {
    if (!identity.startsWith(prefix)) {
      continue;
    }

    const cachedFile = plugin.app.vault.getAbstractFileByPath(entry.filePath);
    const file =
      cachedFile instanceof TFile
        ? cachedFile
        : plugin.findExistingLiteratureNoteFile({
            libraryType: library.type,
            libraryId: library.id,
            itemKey: entry.zoteroItemKey,
          });
    if (!(file instanceof TFile)) {
      continue;
    }

    const frontmatter =
      plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    if (
      frontmatter &&
      Number(frontmatter[NOTE_LAYOUT_KEY]) !== NOTE_LAYOUT_VERSION
    ) {
      layoutMigrationIdentities.add(identity);
    } else if (frontmatter) {
      // Master retains the new frontmatter version when it restores its old
      // bottom callout. Inspect tracked notes through Obsidian's read cache so
      // an unchanged source can still migrate that mixed layout.
      const { body, frontmatter: actualFrontmatter } = splitFrontmatterContent(
        await plugin.app.vault.cachedRead(file),
        parseYaml,
      );
      const layout = readLiteratureNoteLayout(
        body,
        actualFrontmatter[NOTE_LAYOUT_KEY],
      );
      if (
        layout &&
        (layout.legacy ||
          needsNotesTemplateUpdate(
            layout.personal,
            actualFrontmatter[NOTES_TEMPLATE_KEY],
            plugin.settings.notesTemplate ?? DEFAULT_NOTES_TEMPLATE,
          ))
      )
        layoutMigrationIdentities.add(identity);
    }
  }

  return { layoutMigrationIdentities };
}

async function runPoll(plugin: StratumPlugin): Promise<void> {
  if (!enabled(plugin) || plugin.isBulkLibrarySyncRunning()) return;
  const port = plugin.settings.zoteroLocalApiPort;
  const accountId = plugin.settings.accountId;
  const current = () =>
    enabled(plugin) &&
    plugin.settings.accountId === accountId &&
    plugin.settings.zoteroLocalApiPort === port &&
    !plugin.isBulkLibrarySyncRunning();
  const available = await loadLocalZoteroLibraries({ port }).catch(
    (error: unknown) => {
      if (error instanceof LocalZoteroApiError && error.status === 404) {
        throw new Error(
          "Automatic refresh requires Zotero 7 or later with the local API enabled.",
        );
      }
      throw error;
    },
  );
  if (
    plugin.localZoteroUserId &&
    available.userId !== plugin.localZoteroUserId
  ) {
    throw new Error(
      "The local Zotero account changed. Reconnect the matching account to resume automatic refresh.",
    );
  }
  if (!current()) return;
  if (!plugin.localSyncLibraries.length) {
    await refreshLocalSyncLibraries(plugin);
    if (!plugin.localSyncLibraries.length) {
      throw new Error(
        plugin.localSyncLibrariesError ??
          "No local Zotero libraries available.",
      );
    }
  }
  for (const key of plugin.localLiveSyncSnapshots.keys()) {
    if (
      !Object.hasOwn(
        plugin.settings.itemFileMap,
        key.slice(key.indexOf("/") + 1),
      )
    ) {
      plugin.localLiveSyncSnapshots.delete(key);
    }
  }
  for (const library of [...plugin.localSyncLibraries]) {
    if (
      !available.libraries.some(
        (entry) => entry.type === library.type && entry.id === library.id,
      )
    )
      continue;
    const libraryCurrent = () =>
      current() &&
      plugin.localSyncLibraries.some(
        (entry) => entry.type === library.type && entry.id === library.id,
      );
    const prefix = `${library.type}/${library.id}/`;
    const metadata = await getTrackedNoteMetadata(plugin, library);
    for (const [identity, entry] of Object.entries(
      plugin.settings.itemFileMap,
    )) {
      if (!identity.startsWith(prefix)) continue;
      if (!libraryCurrent()) return;
      const snapshot = await loadLocalZoteroNoteSnapshot({
        port,
        library,
        itemKey: entry.zoteroItemKey,
      });
      if (!libraryCurrent()) return;
      const key = `${port}/${identity}`;
      if (
        plugin.localLiveSyncSnapshots.get(key) === snapshot &&
        !metadata.layoutMigrationIdentities.has(identity)
      )
        continue;
      const file =
        plugin.app.vault.getAbstractFileByPath(entry.filePath) ??
        plugin.findExistingLiteratureNoteFile({
          libraryType: library.type,
          libraryId: library.id,
          itemKey: entry.zoteroItemKey,
        });
      if (!(file instanceof TFile)) continue;
      const refresh = refreshOpenedLiteratureNote(plugin, file, {
        background: true,
        sourceMissing: snapshot === "deleted",
        canRefresh: libraryCurrent,
      });
      if (!refresh) continue;
      await refresh;
      if (!libraryCurrent()) return;
      if (getLibraryAutoSyncState(plugin, library).lastError) {
        throw new Error(
          "Automatic refresh paused; unfinished notes will be retried.",
        );
      }
      // Advance only after applying the source successfully. A fresh session
      // refreshes each tracked note once so changes while Obsidian was closed
      // are never silently adopted as a baseline.
      plugin.localLiveSyncSnapshots.set(key, snapshot);
    }
  }
  setStatus(plugin, null);
}

function poll(plugin: StratumPlugin): Promise<void> {
  if (plugin.localLiveSyncRunPromise) return plugin.localLiveSyncRunPromise;
  let delay = POLL_MS;
  const pending = runPoll(plugin)
    .catch((error: unknown) => {
      delay = RETRY_MS;
      if (!enabled(plugin)) return;
      const message =
        error instanceof LocalZoteroUnavailableError
          ? "Zotero unavailable. Saved notes remain available."
          : error instanceof LocalZoteroApiError && error.status === 403
            ? "Enable Zotero’s local API in Settings → Advanced to resume automatic refresh."
            : error instanceof Error
              ? error.message
              : "Automatic refresh paused. Will retry.";
      setStatus(plugin, message);
    })
    .finally(() => {
      plugin.localLiveSyncRunPromise = null;
      schedule(plugin, delay);
    });
  plugin.localLiveSyncRunPromise = pending;
  return pending;
}

export function notifyLocalLiveSyncAfterBulkSync(plugin: StratumPlugin): void {
  schedule(plugin, 0);
}

export function reconcileLocalLiveSync(plugin: StratumPlugin): void {
  if (!enabled(plugin)) {
    schedule(plugin, 0);
    plugin.localLiveSyncSnapshots.clear();
    setStatus(plugin, null);
    return;
  }
  if (!plugin.localLiveSyncFocusRegistered) {
    plugin.localLiveSyncFocusRegistered = true;
    plugin.registerDomEvent(window, "focus", () => schedule(plugin, 0));
  }
  if (!plugin.localLiveSyncRunPromise) schedule(plugin, 0);
}
