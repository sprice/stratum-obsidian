import type { ZoteroItemDetail, OpenAlexEnrichment } from "./backend-client";
import {
  MANAGED_START,
  USER_BOUNDARY_CALLOUT,
  USER_BOUNDARY_PATTERN,
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
    return `${managedBlock}\n\n${USER_BOUNDARY_CALLOUT}\n\n`;
  }

  return `${managedBlock}\n\n${trimmedBody}\n`;
}

function ensureUserBoundary(body: string): string {
  if (USER_BOUNDARY_PATTERN.test(body)) {
    return body;
  }

  return `${body.trimEnd()}\n\n${USER_BOUNDARY_CALLOUT}\n\n`;
}

export function buildLiteratureNoteContent(params: {
  detail: ZoteroItemDetail;
  filenameStem: string | null;
  zoteroStatus?: ZoteroSyncStatus;
  existingContent?: string | null;
  parseYaml: YamlParser;
  stringifyYaml: YamlStringifier;
  htmlToMarkdown: HtmlToMarkdownTransformer;
  enrichment?: OpenAlexEnrichment | null;
}): string {
  const zoteroStatus = params.zoteroStatus ?? "active";

  if (params.existingContent) {
    const { frontmatter, body } = splitFrontmatterContent(
      params.existingContent,
      params.parseYaml
    );
    const managedBlock = renderManagedBlock(
      params.detail,
      params.htmlToMarkdown,
      zoteroStatus,
      params.enrichment
    );
    const nextFrontmatter = renderFrontmatterContent(
      params.detail,
      frontmatter,
      params.filenameStem,
      zoteroStatus,
      params.stringifyYaml,
      params.enrichment
    );
    const nextBody = ensureUserBoundary(upsertManagedBlock(body, managedBlock));
    return `${nextFrontmatter}\n${nextBody.trimStart()}`.trimEnd() + "\n";
  }

  const managedBlock = renderManagedBlock(
    params.detail,
    params.htmlToMarkdown,
    zoteroStatus,
    params.enrichment
  );

  return [
    renderFrontmatterContent(
      params.detail,
      {},
      params.filenameStem,
      zoteroStatus,
      params.stringifyYaml,
      params.enrichment
    ),
    managedBlock,
    "",
    USER_BOUNDARY_CALLOUT,
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
  USER_BOUNDARY_CALLOUT,
  USER_BOUNDARY_CALLOUT_TITLE,
  USER_BOUNDARY_CALLOUT_TYPE,
  USER_BOUNDARY_PATTERN,
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
