import type { ZoteroItemDetail, OpenAlexEnrichment } from "./backend-client";
import { normalizeDoi } from "./doi";
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
import {
  type PreservedManagedSections,
  renderManagedBlock,
} from "./literature-note-sections";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertManagedBlock(body: string, managedBlock: string): string {
  const managedPattern = new RegExp(
    `${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp("<!-- stratum:managed:end -->")}\\n*`,
    "m",
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

function normalizeLegacyEnrichmentSection(section: string): string {
  return section
    .replace(/^> \[!globe]([+-]) OpenAlex$/m, "> [!globe]$1 Enrichment")
    .replace(/\*\*OpenAlex\*\*:/g, "**Enrichment**:");
}

function extractPreservedManagedSections(
  existingContent: string,
): PreservedManagedSections {
  const managedMatch = existingContent.match(
    /<!-- stratum:managed:start -->\n([\s\S]*?)\n<!-- stratum:managed:end -->/,
  );
  if (!managedMatch) {
    return {};
  }

  const preserved: PreservedManagedSections = {};
  const sections = managedMatch[1]
    .split(/\n\n+/)
    .map((section) => section.trim())
    .filter(Boolean)
    .filter((section) => !section.startsWith("> [!warning]"));

  for (const section of sections) {
    const firstLine = section.split("\n", 1)[0] ?? "";
    if (/^> \[!bar-chart][+-] Impact$/.test(firstLine)) {
      preserved.impact = normalizeLegacyEnrichmentSection(section);
    } else if (/^> \[!globe][+-] (?:OpenAlex|Enrichment)$/.test(firstLine)) {
      preserved.openAlex = normalizeLegacyEnrichmentSection(section);
    } else if (/^> \[!abstract][+-] Abstract$/.test(firstLine)) {
      preserved.abstract = section;
    }
  }

  return preserved;
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
  const enrichmentWasProvided = Object.prototype.hasOwnProperty.call(
    params,
    "enrichment",
  );

  if (params.existingContent) {
    const { frontmatter, body } = splitFrontmatterContent(
      params.existingContent,
      params.parseYaml,
    );
    const preserveManagedEnrichment =
      enrichmentWasProvided &&
      params.enrichment === undefined &&
      normalizeDoi(
        typeof frontmatter.doi === "string" ? frontmatter.doi : null,
      ) === normalizeDoi(params.detail.item.doi);
    const managedBlock = renderManagedBlock(
      params.detail,
      params.htmlToMarkdown,
      zoteroStatus,
      params.enrichment,
      preserveManagedEnrichment
        ? extractPreservedManagedSections(params.existingContent)
        : undefined,
    );
    const nextFrontmatter = renderFrontmatterContent(
      params.detail,
      frontmatter,
      params.filenameStem,
      zoteroStatus,
      params.stringifyYaml,
      params.enrichment,
    );
    const nextBody = ensureUserBoundary(upsertManagedBlock(body, managedBlock));
    return `${nextFrontmatter}\n${nextBody.trimStart()}`.trimEnd() + "\n";
  }

  const managedBlock = renderManagedBlock(
    params.detail,
    params.htmlToMarkdown,
    zoteroStatus,
    params.enrichment,
  );

  return [
    renderFrontmatterContent(
      params.detail,
      {},
      params.filenameStem,
      zoteroStatus,
      params.stringifyYaml,
      params.enrichment,
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
    params.parseYaml,
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
export {
  preprocessZoteroNoteHtml,
  slugify,
} from "./literature-note-content-html";
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
export {
  getLiteratureNoteSummary,
  renderManagedBlock,
} from "./literature-note-sections";
