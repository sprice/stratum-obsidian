import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { ZoteroItemDetail } from "./backend-client";
import {
  FILENAME_STEM_FRONTMATTER_KEY,
  findExistingLiteratureNoteMatch,
  type LiteratureNoteCandidate,
  type LiteratureNoteIdentity,
} from "./literature-note-content";

export function toIdentity(detail: ZoteroItemDetail): LiteratureNoteIdentity {
  return {
    libraryType: detail.library.type,
    libraryId: detail.library.id,
    itemKey: detail.item.key,
  };
}

export function getNormalizedNotesFolder(notesFolder?: string): string {
  return normalizePath(notesFolder?.trim() ?? "").replace(/\/+$/, "");
}

export function isPathInsideFolder(path: string, folder: string): boolean {
  if (!folder) {
    return !normalizePath(path).includes("/");
  }

  const normalizedPath = normalizePath(path);
  return normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
}

export function getLiteratureNoteCandidates(
  app: App,
  preferredFolder?: string
): LiteratureNoteCandidate[] {
  const normalizedFolder = getNormalizedNotesFolder(preferredFolder);
  return app.vault
    .getMarkdownFiles()
    .filter((file) => isPathInsideFolder(file.path, normalizedFolder))
    .map((file) => ({
      path: file.path,
      name: file.name,
      frontmatter:
        (app.metadataCache.getFileCache(file)?.frontmatter as
          | Record<string, unknown>
          | undefined) ?? null,
    }));
}

export function getStoredFilenameStem(
  frontmatter: Record<string, unknown>
): string | null {
  const value = frontmatter[FILENAME_STEM_FRONTMATTER_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getStoredZoteroVersion(
  frontmatter: Record<string, unknown>
): number | null {
  const values = [frontmatter.zotero_item_version, frontmatter.zotero_version];

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

  return null;
}

export function findExistingLiteratureNote(
  app: App,
  identity: LiteratureNoteIdentity,
  preferredFolder?: string
): TFile | null {
  const match = findExistingLiteratureNoteMatch(
    getLiteratureNoteCandidates(app, preferredFolder),
    identity,
    preferredFolder
  );
  if (!match) {
    return null;
  }

  const file = app.vault.getAbstractFileByPath(match.candidate.path);
  return file instanceof TFile ? file : null;
}
