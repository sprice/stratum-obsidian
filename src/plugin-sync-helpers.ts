import { TFile } from "obsidian";
import type { ZoteroConnectionState } from "./backend-types";
import type StratumPlugin from "./plugin";
import {
  getIdentityFromFrontmatter,
  getItemKeyFromFrontmatter,
  isPathInsideNotesFolder,
} from "./plugin-note-index";

export function getTrackedLiteratureNotes(plugin: StratumPlugin): Array<{
  file: TFile;
  frontmatter: Record<string, unknown> | null;
}> {
  return plugin.app.vault
    .getMarkdownFiles()
    .filter((file) => isPathInsideNotesFolder(plugin, file.path))
    .map((file) => ({
      file,
      frontmatter:
        (plugin.app.metadataCache.getFileCache(file)?.frontmatter as
          | Record<string, unknown>
          | undefined) ?? null,
    }))
    .filter(
      (entry) =>
        Boolean(getIdentityFromFrontmatter(entry.frontmatter)) &&
        Boolean(getItemKeyFromFrontmatter(entry.frontmatter))
    );
}

export function isMissingZoteroItemError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /zotero item not found|failed to load zotero item detail/i.test(error.message)
  );
}

export function markZoteroTokenInvalid(plugin: StratumPlugin): void {
  if (updateLastKnownZoteroSnapshot(plugin, plugin.zoteroConnection)) {
    void plugin.saveSettings();
  }
  plugin.zoteroConnection = {
    connected: false,
    tokenValid: false,
    zoteroUserId:
      plugin.zoteroConnection?.zoteroUserId ?? plugin.settings.lastKnownZoteroUserId,
    zoteroUsername:
      plugin.zoteroConnection?.zoteroUsername ?? plugin.settings.lastKnownZoteroUsername,
    lastSyncedAt:
      plugin.zoteroConnection?.lastSyncedAt ??
      plugin.settings.lastKnownZoteroConfirmedAt,
  };
  plugin.refreshSettingTab();
  plugin.refreshViews();
}

export function markZoteroDisconnected(plugin: StratumPlugin): void {
  if (updateLastKnownZoteroSnapshot(plugin, plugin.zoteroConnection)) {
    void plugin.saveSettings();
  }
  plugin.zoteroConnection = {
    connected: false,
    tokenValid: null,
    zoteroUserId:
      plugin.zoteroConnection?.zoteroUserId ?? plugin.settings.lastKnownZoteroUserId,
    zoteroUsername:
      plugin.zoteroConnection?.zoteroUsername ?? plugin.settings.lastKnownZoteroUsername,
    lastSyncedAt:
      plugin.zoteroConnection?.lastSyncedAt ??
      plugin.settings.lastKnownZoteroConfirmedAt,
  };
  plugin.refreshSettingTab();
  plugin.refreshViews();
}

export function applyLastKnownZoteroSnapshot(
  plugin: StratumPlugin,
  state: ZoteroConnectionState | null
): ZoteroConnectionState | null {
  if (!state) {
    return null;
  }

  return {
    ...state,
    zoteroUserId: state.zoteroUserId ?? plugin.settings.lastKnownZoteroUserId,
    zoteroUsername:
      state.zoteroUsername ?? plugin.settings.lastKnownZoteroUsername,
    lastSyncedAt:
      state.lastSyncedAt ?? plugin.settings.lastKnownZoteroConfirmedAt,
  };
}

export function updateLastKnownZoteroSnapshot(
  plugin: StratumPlugin,
  state: Pick<
    ZoteroConnectionState,
    "zoteroUserId" | "zoteroUsername" | "lastSyncedAt"
  > | null
): boolean {
  if (!state) {
    return false;
  }

  let changed = false;

  if (
    state.zoteroUserId &&
    plugin.settings.lastKnownZoteroUserId !== state.zoteroUserId
  ) {
    plugin.settings.lastKnownZoteroUserId = state.zoteroUserId;
    changed = true;
  }

  if (
    state.zoteroUsername &&
    plugin.settings.lastKnownZoteroUsername !== state.zoteroUsername
  ) {
    plugin.settings.lastKnownZoteroUsername = state.zoteroUsername;
    changed = true;
  }

  if (
    state.lastSyncedAt &&
    plugin.settings.lastKnownZoteroConfirmedAt !== state.lastSyncedAt
  ) {
    plugin.settings.lastKnownZoteroConfirmedAt = state.lastSyncedAt;
    changed = true;
  }

  return changed;
}

export async function ensureZoteroConnection(
  plugin: StratumPlugin,
  options?: { refresh?: boolean }
): Promise<boolean> {
  if (!plugin.backend.hasSession()) {
    return false;
  }

  if (plugin.isLoadingZoteroConnection) {
    return false;
  }

  if (options?.refresh) {
    await plugin.refreshZoteroConnection();
  }

  return Boolean(plugin.zoteroConnection?.connected);
}
