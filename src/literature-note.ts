import {
  TFile,
  htmlToMarkdown,
  normalizePath,
  parseYaml,
  stringifyYaml,
} from "obsidian";
import type { App } from "obsidian";
import type { ZoteroItemDetail } from "./backend-client";
import {
  buildLiteratureNoteContent,
  FILENAME_STEM_FRONTMATTER_KEY,
  findExistingLiteratureNoteMatch,
  getLiteratureNoteSummary,
  markLiteratureNoteAsDeletedContent,
  type LiteratureNoteCandidate,
  type LiteratureNoteIdentity,
  type LiteratureNoteSummary,
  splitFrontmatterContent,
} from "./literature-note-content";
import {
  getAsciiFallbackFileStem,
  getCollisionSuffix,
  getGeneratedFileStem,
  isLegacyManagedFileStem,
  resolveExistingFilenameStemState,
  type LiteratureNoteFilenameFormat,
} from "./literature-note-filenames";

export type { LiteratureNoteSummary } from "./literature-note-content";

export interface LiteratureNoteWriteResult {
  created: boolean;
  file: TFile;
  summary: LiteratureNoteSummary;
}

export interface LiteratureNoteDeleteMarkResult {
  file: TFile;
  changed: boolean;
}

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalizedFolder = normalizePath(folderPath).replace(/\/$/, "");
  if (!normalizedFolder) {
    return;
  }

  const segments = normalizedFolder.split("/");
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    if (await app.vault.adapter.exists(currentPath)) {
      continue;
    }

    await app.vault.createFolder(currentPath);
  }
}

function toIdentity(detail: ZoteroItemDetail): LiteratureNoteIdentity {
  return {
    libraryType: detail.library.type,
    libraryId: detail.library.id,
    itemKey: detail.item.key,
  };
}

function getNormalizedNotesFolder(notesFolder?: string): string {
  return normalizePath(notesFolder?.trim() ?? "").replace(/\/+$/, "");
}

export function isPathInsideFolder(path: string, folder: string): boolean {
  if (!folder) {
    return !normalizePath(path).includes("/");
  }

  const normalizedPath = normalizePath(path);
  return normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
}

function getLiteratureNoteCandidates(
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

function getStoredFilenameStem(frontmatter: Record<string, unknown>): string | null {
  const value = frontmatter[FILENAME_STEM_FRONTMATTER_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getStoredZoteroVersion(frontmatter: Record<string, unknown>): number | null {
  const values = [
    frontmatter.zotero_item_version,
    frontmatter.zotero_version,
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

  return null;
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
  collisionIndex: number
): string[] {
  const suffix = getCollisionSuffix(collisionIndex);
  const primary = getGeneratedFileStem(detail, format, suffix);
  const asciiFallback = getAsciiFallbackFileStem(primary);

  return asciiFallback === primary ? [primary] : [primary, asciiFallback];
}

async function createLiteratureNoteFile(params: {
  app: App;
  notesFolder: string;
  detail: ZoteroItemDetail;
  filenameFormat: LiteratureNoteFilenameFormat;
}): Promise<{ file: TFile; filenameStem: string }> {
  let lastError: unknown = null;

  for (let collisionIndex = 0; collisionIndex < 512; collisionIndex += 1) {
    for (const filenameStem of getStemVariants(
      params.detail,
      params.filenameFormat,
      collisionIndex
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
      });

      try {
        const file = await params.app.vault.create(path, initialContent);
        return { file, filenameStem };
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw toError(lastError, "Failed to create a unique literature note filename.");
}

async function renameLiteratureNoteFile(params: {
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
      collisionIndex
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

export { getLiteratureNoteSummary };

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

export async function createOrUpdateLiteratureNote(params: {
  app: App;
  notesFolder: string;
  detail: ZoteroItemDetail;
  filenameFormat: LiteratureNoteFilenameFormat;
  existingFile?: TFile | null;
}): Promise<LiteratureNoteWriteResult> {
  const summary = getLiteratureNoteSummary(params.detail);
  const identity = toIdentity(params.detail);
  const existingFile =
    params.existingFile ??
    findExistingLiteratureNote(params.app, identity, params.notesFolder);
  const folder = getNormalizedNotesFolder(params.notesFolder);

  if (existingFile) {
    const existingContent = await params.app.vault.cachedRead(existingFile);
    const { frontmatter } = splitFrontmatterContent(existingContent, parseYaml);
    const desiredStem = getGeneratedFileStem(params.detail, params.filenameFormat);
    const currentStem = existingFile.basename;
    const storedStem = getStoredFilenameStem(frontmatter);
    const previousVersion = getStoredZoteroVersion(frontmatter);
    const filenameState = resolveExistingFilenameStemState({
      currentStem,
      storedStem,
      desiredStem,
      previousVersion,
      currentVersion: params.detail.item.version,
    });

    let file = existingFile;
    let filenameStem = filenameState.nextStoredStem;

    if (
      !storedStem &&
      filenameState.nextStoredStem === null &&
      isLegacyManagedFileStem(currentStem)
    ) {
      filenameStem = currentStem;
    }

    if (filenameState.shouldRename) {
      const renamed = await renameLiteratureNoteFile({
        app: params.app,
        file,
        notesFolder: folder,
        detail: params.detail,
        filenameFormat: params.filenameFormat,
      });
      file = renamed.file;
      filenameStem = renamed.filenameStem;
    }

    const nextContent = buildLiteratureNoteContent({
      detail: params.detail,
      filenameStem,
      existingContent,
      parseYaml,
      stringifyYaml,
      htmlToMarkdown,
    });

    await params.app.vault.modify(file, nextContent);
    return {
      created: false,
      file,
      summary,
    };
  }

  if (folder) {
    await ensureFolder(params.app, folder);
  }

  const created = await createLiteratureNoteFile({
    app: params.app,
    notesFolder: folder,
    detail: params.detail,
    filenameFormat: params.filenameFormat,
  });

  return {
    created: true,
    file: created.file,
    summary,
  };
}

export async function markLiteratureNoteDeleted(params: {
  app: App;
  file: TFile;
}): Promise<LiteratureNoteDeleteMarkResult> {
  const existingContent = await params.app.vault.cachedRead(params.file);
  const { frontmatter } = splitFrontmatterContent(existingContent, parseYaml);
  if (frontmatter.zotero_status === "deleted") {
    return {
      file: params.file,
      changed: false,
    };
  }

  const nextContent = markLiteratureNoteAsDeletedContent({
    existingContent,
    parseYaml,
    stringifyYaml,
  });
  await params.app.vault.modify(params.file, nextContent);

  return {
    file: params.file,
    changed: true,
  };
}
