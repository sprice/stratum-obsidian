import {
  TFile,
  htmlToMarkdown,
  normalizePath,
  parseYaml,
  stringifyYaml,
} from "obsidian";
import type { App } from "obsidian";
import type { ZoteroItemDetail, OpenAlexEnrichment } from "./backend-client";
import { buildLiteratureNoteContent } from "./literature-note-content";
import {
  getAsciiFallbackFileStem,
  getCollisionSuffix,
  getGeneratedFileStem,
  type LiteratureNoteFilenameFormat,
} from "./literature-note-filenames";

export async function ensureFolder(
  app: App,
  folderPath: string,
): Promise<void> {
  const normalizedFolder = normalizePath(folderPath).replace(/\/$/, "");
  if (!normalizedFolder) {
    return;
  }

  const segments = normalizedFolder.split("/");
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    if (app.vault.getAbstractFileByPath(currentPath)) {
      continue;
    }

    await app.vault.createFolder(currentPath);
  }
}

function buildPathFromStem(folder: string, stem: string): string {
  const filename = `${stem}.md`;
  return normalizePath(folder ? `${folder}/${filename}` : filename);
}

function toError(value: unknown, fallbackMessage: string): Error {
  return value instanceof Error ? value : new Error(fallbackMessage);
}

function getStemVariants(
  detail: ZoteroItemDetail,
  format: LiteratureNoteFilenameFormat,
  collisionIndex: number,
): string[] {
  const suffix = getCollisionSuffix(collisionIndex);
  const primary = getGeneratedFileStem(detail, format, suffix);
  const asciiFallback = getAsciiFallbackFileStem(primary);

  return asciiFallback === primary ? [primary] : [primary, asciiFallback];
}

export async function createLiteratureNoteFile(params: {
  app: App;
  notesFolder: string;
  detail: ZoteroItemDetail;
  filenameFormat: LiteratureNoteFilenameFormat;
  enrichment?: OpenAlexEnrichment | null;
}): Promise<{ file: TFile; filenameStem: string }> {
  let lastError: unknown = null;

  for (let collisionIndex = 0; collisionIndex < 512; collisionIndex += 1) {
    for (const filenameStem of getStemVariants(
      params.detail,
      params.filenameFormat,
      collisionIndex,
    )) {
      const path = buildPathFromStem(params.notesFolder, filenameStem);
      if (params.app.vault.getAbstractFileByPath(path)) {
        continue;
      }

      const initialContent = buildLiteratureNoteContent({
        detail: params.detail,
        filenameStem,
        parseYaml,
        stringifyYaml,
        htmlToMarkdown,
        enrichment: params.enrichment,
      });

      try {
        const file = await params.app.vault.create(path, initialContent);
        return { file, filenameStem };
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw toError(
    lastError,
    "Failed to create a unique literature note filename.",
  );
}

export async function renameLiteratureNoteFile(params: {
  app: App;
  file: TFile;
  notesFolder: string;
  detail: ZoteroItemDetail;
  filenameFormat: LiteratureNoteFilenameFormat;
}): Promise<{ file: TFile; filenameStem: string }> {
  const currentPath = normalizePath(params.file.path);
  let lastError: unknown = null;

  for (let collisionIndex = 0; collisionIndex < 512; collisionIndex += 1) {
    for (const filenameStem of getStemVariants(
      params.detail,
      params.filenameFormat,
      collisionIndex,
    )) {
      const path = buildPathFromStem(params.notesFolder, filenameStem);
      const existing = params.app.vault.getAbstractFileByPath(path);
      if (existing && existing.path !== params.file.path) {
        continue;
      }

      if (path === currentPath) {
        return { file: params.file, filenameStem };
      }

      try {
        await params.app.fileManager.renameFile(params.file, path);
        const renamedFile = params.app.vault.getAbstractFileByPath(path);
        return {
          file: renamedFile instanceof TFile ? renamedFile : params.file,
          filenameStem,
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw toError(lastError, "Failed to rename the literature note.");
}
