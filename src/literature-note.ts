import { assertSupportedZoteroItem } from "./zotero-item-support";
import {
  NOTE_LAYOUT_KEY,
  NOTE_LAYOUT_VERSION,
  requireLiteratureNoteLayout,
} from "./literature-note-layout";
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
import { getLiteratureNoteMatchPriority } from "./literature-note-matching";
import type { LiteratureNoteIdentity } from "./literature-note-content-types";
import { type LiteratureNoteFilenameFormat } from "./literature-note-filenames";
import {
  createLiteratureNoteFile,
  ensureFolder,
} from "./literature-note-files";
import {
  findExistingLiteratureNote,
  getNormalizedNotesFolder,
  getStoredFilenameStem,
  toIdentity,
} from "./literature-note-helpers";

export type {
  LiteratureNoteIdentity,
  LiteratureNoteSummary,
} from "./literature-note-content";
export { getLiteratureNoteSummary };
export {
  findExistingLiteratureNote,
  isPathInsideFolder,
} from "./literature-note-helpers";

export interface LiteratureNoteWriteResult {
  created: boolean;
  changed: boolean;
  file: TFile;
  summary: LiteratureNoteSummary;
}

export interface LiteratureNoteDeleteMarkResult {
  file: TFile;
  changed: boolean;
}

export { ensureFolder };

function assertNoteIdentity(
  content: string,
  identity: LiteratureNoteIdentity,
): void {
  const { frontmatter } = splitFrontmatterContent(content, parseYaml);
  if (getLiteratureNoteMatchPriority(frontmatter, identity) === null) {
    throw new Error(
      "The note no longer matches this Zotero item. Sync again to rebuild its file lookup.",
    );
  }
}

export async function createOrUpdateLiteratureNote(params: {
  stratumVersion: string;
  notesTemplate?: string;
  app: App;
  notesFolder: string;
  detail: ZoteroItemDetail;
  filenameFormat: LiteratureNoteFilenameFormat;
  existingFile?: TFile | null;
  enrichment?: OpenAlexEnrichment | null;
  canWrite?: () => boolean;
}): Promise<LiteratureNoteWriteResult> {
  const assertActive = () => {
    if (params.canWrite && !params.canWrite())
      throw new Error("Note sync was cancelled.");
  };
  assertActive();
  const summary = getLiteratureNoteSummary(params.detail);
  assertSupportedZoteroItem(params.detail);
  const identity = toIdentity(params.detail);
  const existingFile =
    params.existingFile ??
    findExistingLiteratureNote(params.app, identity, params.notesFolder);
  const folder = getNormalizedNotesFolder(params.notesFolder);

  if (existingFile) {
    const existingContent = await params.app.vault.read(existingFile);
    assertActive();
    assertNoteIdentity(existingContent, identity);
    const { frontmatter } = splitFrontmatterContent(existingContent, parseYaml);
    const file = existingFile;
    const filenameStem =
      getStoredFilenameStem(frontmatter) ?? existingFile.basename;

    const candidate = buildLiteratureNoteContent({
      detail: params.detail,
      stratumVersion: params.stratumVersion,
      notesTemplate: params.notesTemplate,
      filenameStem,
      existingContent,
      parseYaml,
      stringifyYaml,
      htmlToMarkdown,
      ...("enrichment" in params ? { enrichment: params.enrichment } : {}),
    });
    if (candidate === existingContent)
      return { created: false, changed: false, file, summary };
    let changed = false;
    await params.app.vault.process(file, (currentContent) => {
      assertActive();
      assertNoteIdentity(currentContent, identity);
      const nextContent = buildLiteratureNoteContent({
        detail: params.detail,
        stratumVersion: params.stratumVersion,
        notesTemplate: params.notesTemplate,
        filenameStem,
        existingContent: currentContent,
        parseYaml,
        stringifyYaml,
        htmlToMarkdown,
        ...("enrichment" in params ? { enrichment: params.enrichment } : {}),
      });
      changed = nextContent !== currentContent;
      return nextContent;
    });
    return { created: false, changed, file, summary };
  }

  if (folder) {
    await ensureFolder(params.app, folder);
  }

  assertActive();
  const created = await createLiteratureNoteFile({
    app: params.app,
    notesFolder: folder,
    detail: params.detail,
    stratumVersion: params.stratumVersion,
    notesTemplate: params.notesTemplate,
    filenameFormat: params.filenameFormat,
    canWrite: params.canWrite,
    ...("enrichment" in params ? { enrichment: params.enrichment } : {}),
  });

  return {
    created: true,
    changed: true,
    file: created.file,
    summary,
  };
}

export async function markLiteratureNoteDeleted(params: {
  app: App;
  file: TFile;
  identity: LiteratureNoteIdentity;
  canWrite?: () => boolean;
}): Promise<LiteratureNoteDeleteMarkResult> {
  let changed = false;
  await params.app.vault.process(params.file, (existingContent) => {
    if (params.canWrite && !params.canWrite())
      throw new Error("Note sync was cancelled.");
    assertNoteIdentity(existingContent, params.identity);
    const { frontmatter, body } = splitFrontmatterContent(
      existingContent,
      parseYaml,
    );
    if (
      frontmatter.zotero_status === "deleted" &&
      frontmatter[NOTE_LAYOUT_KEY] === NOTE_LAYOUT_VERSION &&
      !requireLiteratureNoteLayout(body, frontmatter[NOTE_LAYOUT_KEY]).legacy
    )
      return existingContent;
    changed = true;
    return markLiteratureNoteAsDeletedContent({
      existingContent,
      parseYaml,
      stringifyYaml,
    });
  });
  return { file: params.file, changed };
}
