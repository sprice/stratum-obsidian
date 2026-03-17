import { TFile } from "obsidian";
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

export async function ensureZoteroConnectionForSync(
  plugin: StratumPlugin
): Promise<boolean> {
  if (!plugin.backend.hasSession()) {
    return false;
  }

  if (plugin.isLoadingZoteroConnection) {
    return false;
  }

  if (!plugin.zoteroConnection?.connected) {
    await plugin.refreshZoteroConnection();
  }

  return Boolean(plugin.zoteroConnection?.connected);
}
