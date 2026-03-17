import type { ZoteroItemDetail } from "./backend-client";
import {
  MANAGED_START,
  USER_NOTES_HEADING,
  ZOTERO_STATUS_FRONTMATTER_KEY,
  type HtmlToMarkdownTransformer,
  type YamlParser,
  type YamlStringifier,
  type ZoteroSyncStatus,
} from "./literature-note-content-types";
import {
  renderFrontmatterContent,
  splitFrontmatterContent,
} from "./literature-note-frontmatter";
import { renderManagedBlock } from "./literature-note-sections";

const LEGACY_USER_NOTES_HEADING = "## Notes";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertManagedBlock(body: string, managedBlock: string): string {
  const managedPattern = new RegExp(
    `${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp("<!-- stratum:managed:end -->")}\\n*`,
    "m"
  );

  if (managedPattern.test(body)) {
    return body.replace(managedPattern, `${managedBlock}\n\n`);
  }

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return `${managedBlock}\n\n${USER_NOTES_HEADING}\n\n`;
  }

  return `${managedBlock}\n\n${trimmedBody}\n`;
}

function hasSectionHeading(body: string, heading: string): boolean {
  const pattern = new RegExp(`^${escapeRegExp(heading)}$`, "m");
  return pattern.test(body);
}

function ensureUserNotesSection(body: string): string {
  if (hasSectionHeading(body, USER_NOTES_HEADING)) {
    return body;
  }

  if (hasSectionHeading(body, LEGACY_USER_NOTES_HEADING)) {
    return body.replace(
      new RegExp(`^${escapeRegExp(LEGACY_USER_NOTES_HEADING)}$`, "m"),
      USER_NOTES_HEADING
    );
  }

  return `${body.trimEnd()}\n\n${USER_NOTES_HEADING}\n\n`;
}

export function buildLiteratureNoteContent(params: {
  detail: ZoteroItemDetail;
  filenameStem: string | null;
  zoteroStatus?: ZoteroSyncStatus;
  existingContent?: string | null;
  parseYaml: YamlParser;
  stringifyYaml: YamlStringifier;
  htmlToMarkdown: HtmlToMarkdownTransformer;
}): string {
  const zoteroStatus = params.zoteroStatus ?? "active";
  const managedBlock = renderManagedBlock(
    params.detail,
    params.htmlToMarkdown,
    zoteroStatus
  );

  if (params.existingContent) {
    const { frontmatter, body } = splitFrontmatterContent(
      params.existingContent,
      params.parseYaml
    );
    const nextFrontmatter = renderFrontmatterContent(
      params.detail,
      frontmatter,
      params.filenameStem,
      zoteroStatus,
      params.stringifyYaml
    );
    const nextBody = ensureUserNotesSection(upsertManagedBlock(body, managedBlock));
    return `${nextFrontmatter}\n${nextBody.trimStart()}`.trimEnd() + "\n";
  }

  return [
    renderFrontmatterContent(
      params.detail,
      {},
      params.filenameStem,
      zoteroStatus,
      params.stringifyYaml
    ),
    managedBlock,
    "",
    USER_NOTES_HEADING,
    "",
  ].join("\n");
}

export function markLiteratureNoteAsDeletedContent(params: {
  existingContent: string;
  parseYaml: YamlParser;
  stringifyYaml: YamlStringifier;
}): string {
  const { frontmatter, body } = splitFrontmatterContent(
    params.existingContent,
    params.parseYaml
  );
  const nextFrontmatter = {
    ...frontmatter,
    [ZOTERO_STATUS_FRONTMATTER_KEY]: "deleted",
    zotero_synced_at: new Date().toISOString(),
  } satisfies Record<string, unknown>;
  const deletedNotice = [
    "> [!warning] This item was removed from Zotero",
    "> The source item is no longer in your Zotero library. This note is preserved but will no longer receive updates.",
  ].join("\n");
  const warningPattern = new RegExp(`${escapeRegExp(deletedNotice)}\\n*`, "m");
  const nextBody = body.includes(MANAGED_START)
    ? body
        .replace(warningPattern, "")
        .replace(`${MANAGED_START}\n`, `${MANAGED_START}\n${deletedNotice}\n\n`)
    : `${deletedNotice}\n\n${body}`.trimEnd();

  return `---\n${params.stringifyYaml(nextFrontmatter).trim()}\n---\n\n${nextBody.trimStart()}`
    .trimEnd()
    .concat("\n");
}

export {
  ANNOTATION_KEYS_FRONTMATTER_KEY,
  ATTACHMENT_KEYS_FRONTMATTER_KEY,
  FILENAME_STEM_FRONTMATTER_KEY,
  IDENTITY_FRONTMATTER_KEY,
  ITEM_KEY_FRONTMATTER_KEY,
  ITEM_VERSION_FRONTMATTER_KEY,
  LIBRARY_ID_FRONTMATTER_KEY,
  LIBRARY_TYPE_FRONTMATTER_KEY,
  MANAGED_END,
  MANAGED_START,
  NOTE_KEYS_FRONTMATTER_KEY,
  USER_NOTES_HEADING,
  ZOTERO_STATUS_FRONTMATTER_KEY,
  type ExistingLiteratureNoteMatch,
  type HtmlToMarkdownTransformer,
  type LiteratureNoteCandidate,
  type LiteratureNoteIdentity,
  type LiteratureNoteSummary,
  type YamlParser,
  type YamlStringifier,
  type ZoteroSyncStatus,
} from "./literature-note-content-types";
export { preprocessZoteroNoteHtml, slugify } from "./literature-note-content-html";
export {
  buildInlineTopicTags,
  buildSourceUrl,
  getItemIdentity,
  getTrackedChildItemKeysFromFrontmatter,
  humanizeItemType,
  renderFrontmatterContent,
  renderWikiList,
  splitFrontmatterContent,
  toStringList,
} from "./literature-note-frontmatter";
export { findExistingLiteratureNoteMatch } from "./literature-note-matching";
export { getLiteratureNoteSummary, renderManagedBlock } from "./literature-note-sections";
