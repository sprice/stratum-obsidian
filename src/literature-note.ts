import { TFile, htmlToMarkdown, parseYaml, stringifyYaml } from "obsidian";
import type { App } from "obsidian";
import type { ZoteroItemDetail, OpenAlexEnrichment } from "./backend-client";
import {
  buildLiteratureNoteContent,
  getLiteratureNoteSummary,
  markLiteratureNoteAsDeletedContent,
  splitFrontmatterContent,
  type LiteratureNoteSummary,
} from "./literature-note-content";
import {
  getGeneratedFileStem,
  isLegacyManagedFileStem,
  resolveExistingFilenameStemState,
  type LiteratureNoteFilenameFormat,
} from "./literature-note-filenames";
import {
  createLiteratureNoteFile,
  ensureFolder,
  renameLiteratureNoteFile,
} from "./literature-note-files";
import {
  findExistingLiteratureNote,
  getNormalizedNotesFolder,
  getStoredFilenameStem,
  getStoredZoteroVersion,
  toIdentity,
} from "./literature-note-helpers";

export type { LiteratureNoteIdentity, LiteratureNoteSummary } from "./literature-note-content";
export { getLiteratureNoteSummary };
export { findExistingLiteratureNote, isPathInsideFolder } from "./literature-note-helpers";

export interface LiteratureNoteWriteResult {
  created: boolean;
  file: TFile;
  summary: LiteratureNoteSummary;
}

export interface LiteratureNoteDeleteMarkResult {
  file: TFile;
  changed: boolean;
}

export { ensureFolder };

export async function createOrUpdateLiteratureNote(params: {
  app: App;
  notesFolder: string;
  detail: ZoteroItemDetail;
  filenameFormat: LiteratureNoteFilenameFormat;
  existingFile?: TFile | null;
  enrichment?: OpenAlexEnrichment | null;
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
      enrichment: params.enrichment,
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
    enrichment: params.enrichment,
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
