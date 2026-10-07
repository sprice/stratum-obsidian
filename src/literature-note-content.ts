import {
  DEFAULT_NOTES_TEMPLATE,
  NOTES_TEMPLATE_KEY,
  renderNotesTemplate,
  canReplaceNotesTemplate,
} from "./literature-note-template";
import {
  composeLiteratureNoteBody,
  requireLiteratureNoteLayout,
  NOTE_LAYOUT_KEY,
  NOTE_LAYOUT_VERSION,
} from "./literature-note-layout";
import { withPreservedAnnotationImages } from "./annotation-image-paths";
import type { ZoteroItemDetail, OpenAlexEnrichment } from "./backend-client";
import { getNormalizedDoiLookupKey as normalizeDoi } from "./doi";
import {
  MANAGED_START,
  MANAGED_END,
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

function normalizeLegacyEnrichmentSection(section: string): string {
  return section
    .replace(/^> \[!globe]([+-]) OpenAlex$/m, "> [!globe]$1 Enrichment")
    .replace(/\*\*OpenAlex\*\*:/g, "**Enrichment**:");
}

function extractPreservedManagedSections(
  existingContent: string,
): PreservedManagedSections {
  const managedMatch = existingContent
    .replace(/\r\n/g, "\n")
    .match(
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
  stratumVersion: string;
  notesTemplate?: string;
  detail: ZoteroItemDetail;
  filenameStem: string | null;
  zoteroStatus?: ZoteroSyncStatus;
  existingContent?: string | null;
  parseYaml: YamlParser;
  stringifyYaml: YamlStringifier;
  htmlToMarkdown: HtmlToMarkdownTransformer;
  enrichment?: OpenAlexEnrichment | null;
}): string {
  const starter = renderNotesTemplate(
    params.notesTemplate ?? DEFAULT_NOTES_TEMPLATE,
  );
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
    const layout = requireLiteratureNoteLayout(
      body,
      frontmatter[NOTE_LAYOUT_KEY],
    );
    const replaceStarter = canReplaceNotesTemplate(
      layout.personal,
      frontmatter[NOTES_TEMPLATE_KEY],
    );
    const personal = replaceStarter ? starter : layout.personal;
    const preserveManagedEnrichment =
      enrichmentWasProvided &&
      params.enrichment === undefined &&
      normalizeDoi(
        typeof frontmatter.doi === "string" ? frontmatter.doi : null,
      ) === normalizeDoi(params.detail.item.doi);
    const detail = withPreservedAnnotationImages(params.detail, frontmatter);
    const managedBlock = renderManagedBlock(
      detail,
      params.htmlToMarkdown,
      zoteroStatus,
      params.enrichment,
      preserveManagedEnrichment
        ? extractPreservedManagedSections(layout.managed)
        : undefined,
    );
    const nextFrontmatter = renderFrontmatterContent(
      detail,
      {
        ...frontmatter,
        [NOTE_LAYOUT_KEY]: NOTE_LAYOUT_VERSION,
        ...(replaceStarter ? { [NOTES_TEMPLATE_KEY]: starter } : {}),
      },
      params.filenameStem,
      zoteroStatus,
      params.stringifyYaml,
      params.stratumVersion,
      params.enrichment,
    );
    const nextBody = composeLiteratureNoteBody(personal, managedBlock);
    const result = `${nextFrontmatter}${nextBody}`;
    const withoutTimestamp = (content: string) =>
      content.replace(/^zotero_synced_at:.*\r?$/gm, "");
    return withoutTimestamp(result) === withoutTimestamp(params.existingContent)
      ? params.existingContent
      : result;
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
      { [NOTE_LAYOUT_KEY]: NOTE_LAYOUT_VERSION, [NOTES_TEMPLATE_KEY]: starter },
      params.filenameStem,
      zoteroStatus,
      params.stringifyYaml,
      params.stratumVersion,
      params.enrichment,
    ),
    composeLiteratureNoteBody(starter, managedBlock),
  ].join("");
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
  const layout = requireLiteratureNoteLayout(
    body,
    frontmatter[NOTE_LAYOUT_KEY],
  );
  const nextFrontmatter = {
    ...frontmatter,
    [NOTE_LAYOUT_KEY]: NOTE_LAYOUT_VERSION,
    [ZOTERO_STATUS_FRONTMATTER_KEY]: "deleted",
    zotero_synced_at: new Date().toISOString(),
  } satisfies Record<string, unknown>;
  const deletedNotice = [
    "> [!warning] This item was removed from Zotero",
    "> The source item is no longer in your Zotero library. This note is preserved but will no longer receive updates.",
  ].join("\n");
  const managed = layout.managed;
  const warningPattern = new RegExp(`${escapeRegExp(deletedNotice)}\\n*`, "m");
  const startPattern = new RegExp(`^${escapeRegExp(MANAGED_START)}\\r?$`, "m");
  const nextManaged = startPattern.test(managed)
    ? managed
        .replace(warningPattern, "")
        .replace(startPattern, () => `${MANAGED_START}\n${deletedNotice}\n`)
    : `${MANAGED_START}\n${deletedNotice}\n\n${managed.trimEnd()}\n${MANAGED_END}`;
  const nextBody = composeLiteratureNoteBody(layout.personal, nextManaged);

  return `---\n${params.stringifyYaml(nextFrontmatter).trim()}\n---\n${nextBody}`;
}

export {
  ANNOTATION_KEYS_FRONTMATTER_KEY,
  ATTACHMENT_KEYS_FRONTMATTER_KEY,
  FILENAME_STEM_FRONTMATTER_KEY,
  IDENTITY_FRONTMATTER_KEY,
  ITEM_KEY_FRONTMATTER_KEY,
  MANAGED_END,
  MANAGED_START,
  NOTE_KEYS_FRONTMATTER_KEY,
  USER_BOUNDARY_CALLOUT,
  type ExistingLiteratureNoteMatch,
  type HtmlToMarkdownTransformer,
  type LiteratureNoteCandidate,
  type LiteratureNoteIdentity,
  type LiteratureNoteSummary,
  type YamlParser,
  type YamlStringifier,
  type ZoteroSyncStatus,
} from "./literature-note-content-types";
export { preprocessZoteroNoteHtml } from "./literature-note-content-html";
export {
  splitFrontmatterContent,
  toStringList,
} from "./literature-note-frontmatter";
export { findExistingLiteratureNoteMatch } from "./literature-note-matching";
export { getLiteratureNoteSummary } from "./literature-note-sections";
