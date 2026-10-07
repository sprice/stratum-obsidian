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

function isPathInsideFolder(path: string, folder: string): boolean {
  if (!folder) {
    return !normalizePath(path).includes("/");
  }

  const normalizedPath = normalizePath(path);
  return normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
}

function getLiteratureNoteCandidates(
  app: App,
  preferredFolder?: string,
): LiteratureNoteCandidate[] {
  const normalizedFolder = getNormalizedNotesFolder(preferredFolder);
  return app.vault
    .getMarkdownFiles()
    .filter(
      (file) =>
        isPathInsideFolder(file.path, normalizedFolder) ||
        app.metadataCache.getFileCache(file)?.frontmatter?.stratum_note_type ===
          "literature-note",
    )
    .map((file) => ({
      path: file.path,
      name: file.name,
      frontmatter: app.metadataCache.getFileCache(file)?.frontmatter ?? null,
    }));
}

export function getStoredFilenameStem(
  frontmatter: Record<string, unknown>,
): string | null {
  const value = frontmatter[FILENAME_STEM_FRONTMATTER_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function findExistingLiteratureNote(
  app: App,
  identity: LiteratureNoteIdentity,
  preferredFolder?: string,
): TFile | null {
  const match = findExistingLiteratureNoteMatch(
    getLiteratureNoteCandidates(app, preferredFolder),
    identity,
    preferredFolder,
  );
  if (!match) {
    return null;
  }

  const file = app.vault.getAbstractFileByPath(match.candidate.path);
  return file instanceof TFile ? file : null;
}
