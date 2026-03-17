import type { ZoteroItemDetail } from "./backend-client";
import {
  getReadableAuthorLabel,
  getReadableTitleVariants,
  getReadableYearLabel,
} from "./literature-note-filenames";

export const MANAGED_START = "<!-- stratum:managed:start -->";
export const MANAGED_END = "<!-- stratum:managed:end -->";
export const USER_NOTES_HEADING = "## My Notes";
const LEGACY_USER_NOTES_HEADING = "## Notes";
export const LIBRARY_ID_FRONTMATTER_KEY = "zotero_library_id";
export const LIBRARY_TYPE_FRONTMATTER_KEY = "zotero_library_type";
export const IDENTITY_FRONTMATTER_KEY = "zotero_item_identity";
export const ITEM_KEY_FRONTMATTER_KEY = "zotero_item_key";
export const FILENAME_STEM_FRONTMATTER_KEY = "stratum_filename_stem";
export const ATTACHMENT_KEYS_FRONTMATTER_KEY = "zotero_attachment_keys";
export const NOTE_KEYS_FRONTMATTER_KEY = "zotero_note_keys";
export const ANNOTATION_KEYS_FRONTMATTER_KEY = "zotero_annotation_keys";
export const ZOTERO_STATUS_FRONTMATTER_KEY = "zotero_status";
export const ITEM_VERSION_FRONTMATTER_KEY = "zotero_item_version";

type ZoteroSyncStatus = "active" | "deleted";

const MANAGED_FRONTMATTER_KEYS = new Set([
  "aliases",
  "authors",
  "collections",
  "doi",
  "publication",
  "reference_type",
  "source",
  "tags",
  "year",
  "stratum_filename_stem",
  "stratum_note_type",
  "zotero_annotation_keys",
  "zotero_attachment_keys",
  "zotero_collection_keys",
  "zotero_creators",
  "zotero_date",
  "zotero_doi",
  "zotero_item_identity",
  "zotero_item_key",
  "zotero_item_version",
  "zotero_item_type",
  "zotero_library_id",
  "zotero_library_type",
  "zotero_note_keys",
  "zotero_publication_title",
  "zotero_select_uri",
  "zotero_source_url",
  "zotero_status",
  "zotero_synced_at",
  "zotero_tags",
  "zotero_title",
  "zotero_user_id",
  "zotero_version",
  "zotero_link",
]);

export interface LiteratureNoteSummary {
  zoteroNoteCount: number;
  annotationCount: number;
  attachmentCount: number;
}

export interface LiteratureNoteCandidate {
  path: string;
  name: string;
  frontmatter?: Record<string, unknown> | null;
}

export interface LiteratureNoteIdentity {
  libraryType: string;
  libraryId: string;
  itemKey: string;
}

export interface ExistingLiteratureNoteMatch {
  candidate: LiteratureNoteCandidate;
  duplicateCount: number;
}

export type YamlParser = (yaml: string) => unknown;
export type YamlStringifier = (value: Record<string, unknown>) => string;
export type HtmlToMarkdownTransformer = (html: string) => string;

function stripHtmlTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDatasetJson<T>(encoded: string): T | null {
  try {
    return JSON.parse(decodeURIComponent(encoded)) as T;
  } catch {
    return null;
  }
}

function buildLocalUri(
  ext: "select" | "open-pdf",
  uri: string,
  params?: Record<string, string>
): string {
  const itemId = uri.split("/").pop();
  if (!itemId) {
    return uri;
  }

  const base = /\/groups\//.test(uri)
    ? uri.replace("http://zotero.org", `zotero://${ext}`)
    : `zotero://${ext}/library/items/${itemId}`;

  if (!params || Object.keys(params).length === 0) {
    return base;
  }

  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
    }
  });

  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

function buildAnnotationUriFromDataset(encoded: string): string | null {
  const json = decodeDatasetJson<{
    attachmentURI?: string;
    pageLabel?: string;
    annotationKey?: string;
  }>(encoded);

  if (!json?.attachmentURI) {
    return null;
  }

  return buildLocalUri("open-pdf", json.attachmentURI, {
    page: json.pageLabel ?? "",
    annotation: json.annotationKey ?? "",
  });
}

function buildCitationUriFromDataset(encoded: string): string | null {
  const json = decodeDatasetJson<{
    citationItems?: Array<{
      uris?: string[];
    }>;
  }>(encoded);

  const uri = json?.citationItems?.[0]?.uris?.[0];
  if (!uri) {
    return null;
  }

  return buildLocalUri("select", uri);
}

function replaceAnnotationBlocks(html: string): string {
  const imagePattern = /<img\b([^>]*\sdata-annotation="([^"]+)"[^>]*)>/gi;
  const nextWithImages = html.replace(
    imagePattern,
    (full: string, _attrs: string, encoded: string): string => {
      const href = buildAnnotationUriFromDataset(encoded);
      if (!href) {
        return full;
      }

      return `${full} <a href="${href}">Go to annotation</a>`;
    }
  );

  const blockPattern =
    /<(?!img\b)([a-z0-9]+)\b([^>]*\sdata-annotation="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
  return nextWithImages.replace(
    blockPattern,
    (
      full: string,
      _tag: string,
      _attrs: string,
      encoded: string
    ): string => {
      const href = buildAnnotationUriFromDataset(encoded);
      if (!href) {
        return full;
      }

      return `${full} <a href="${href}">Go to annotation</a>`;
    }
  );
}

function replaceCitationBlocks(html: string): string {
  const citationPattern =
    /<([a-z0-9]+)\b([^>]*\sdata-citation="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
  return html.replace(
    citationPattern,
    (
      full: string,
      _tag: string,
      _attrs: string,
      encoded: string,
      inner: string
    ): string => {
      const href = buildCitationUriFromDataset(encoded);
      if (!href) {
        return full;
      }

      const text = stripHtmlTags(inner) || "Open citation in Zotero";
      return `<a href="${href}">${text}</a>`;
    }
  );
}

export function preprocessZoteroNoteHtml(html: string): string {
  return replaceCitationBlocks(replaceAnnotationBlocks(html));
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function getItemIdentity(detail: ZoteroItemDetail): string {
  return `${detail.library.type}:${detail.library.id}:${detail.item.key}`;
}

function getLegacyItemIdentity(itemKey: string): string {
  return itemKey;
}

function escapeWikiTarget(value: string): string {
  return value.replace(/[|\]]/g, "\\$&");
}

function toWikiLink(value: string): string {
  return `[[${escapeWikiTarget(value)}]]`;
}

function renderWikiList(values: string[]): string {
  return values.map((value) => toWikiLink(value)).join(", ");
}

function toSentenceCase(value: string): string {
  if (!value) {
    return value;
  }

  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function humanizeItemType(itemType: string | null): string | null {
  if (!itemType) {
    return null;
  }

  const withSpaces = itemType.replace(/([a-z])([A-Z])/g, "$1 $2");
  return toSentenceCase(withSpaces);
}

function toTagSlug(value: string): string | null {
  const slug = slugify(value);
  return slug.length > 0 ? slug : null;
}

function buildSourceUrl(detail: ZoteroItemDetail): string | null {
  if (detail.item.url) {
    return detail.item.url;
  }

  if (detail.item.doi) {
    return `https://doi.org/${detail.item.doi}`;
  }

  return null;
}

function buildAliases(detail: ZoteroItemDetail): string[] {
  const aliases = new Set<string>();
  const { mainTitle, fileTitle, fullTitle } = getReadableTitleVariants(detail.item.title);

  aliases.add(
    `${getReadableAuthorLabel(detail.item.creators)} ${getReadableYearLabel(detail.item.year)}`
  );
  aliases.add(mainTitle);

  if (fullTitle !== mainTitle || fileTitle !== mainTitle) {
    aliases.add(fullTitle);
  }

  return Array.from(aliases);
}

function buildNativeTags(detail: ZoteroItemDetail): string[] {
  const tags = new Set<string>();
  tags.add("literature-note");
  tags.add("source/zotero");

  const itemType = toTagSlug(humanizeItemType(detail.item.itemType) ?? "");
  if (itemType) {
    tags.add(`reference/${itemType}`);
  }

  detail.item.tags
    .map((tag) => toTagSlug(tag))
    .filter((tag): tag is string => Boolean(tag))
    .forEach((tag) => {
      tags.add(`zotero/${tag}`);
    });

  return Array.from(tags);
}

function buildInlineTopicTags(tags: string[]): string[] {
  return tags
    .map((tag) => toTagSlug(tag))
    .filter((tag): tag is string => Boolean(tag))
    .map((tag) => `#zotero/${tag}`);
}

function filterExistingFrontmatter(
  frontmatter: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => !MANAGED_FRONTMATTER_KEYS.has(key))
  );
}

function toStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toCalloutBlock(type: string, title: string, bodyLines: string[]): string {
  return [`> [!${type}] ${title}`, ...bodyLines.map((line) => `> ${line}`)].join("\n");
}

function toFoldableCalloutBlock(
  type: string,
  title: string,
  bodyLines: string[],
  collapsed = true
): string {
  const marker = collapsed ? "-" : "+";
  return [`> [!${type}]${marker} ${title}`, ...bodyLines.map((line) => `> ${line}`)].join("\n");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function stripMarkdownFormatting(value: string): string {
  return value
    .replace(/^\s{0,3}>+\s*/, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .trim();
}

function getNoteSnippet(markdown: string): string | null {
  for (const rawLine of markdown.split("\n")) {
    const line = stripMarkdownFormatting(rawLine);
    if (line.length > 0) {
      return truncateText(line, 72);
    }
  }

  return null;
}

function getZoteroNoteCalloutTitle(markdown: string, index: number): string {
  const snippet = getNoteSnippet(markdown);
  if (!snippet) {
    return `Zotero note ${index + 1}`;
  }

  return `Zotero note ${index + 1} · ${snippet}`;
}

function getHighlightGroupCalloutTitle(
  label: string,
  annotations: ZoteroItemDetail["annotations"]
): string {
  const suffix = annotations.length === 1 ? "highlight" : "highlights";
  return `${label} · ${annotations.length} ${suffix}`;
}

export function splitFrontmatterContent(
  content: string,
  parseYaml: YamlParser
): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n*/);
  if (!match) {
    return {
      frontmatter: {},
      body: content,
    };
  }

  try {
    const parsed = parseYaml(match[1]);
    return {
      frontmatter:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
      body: content.slice(match[0].length),
    };
  } catch {
    return {
      frontmatter: {},
      body: content,
    };
  }
}

export function renderFrontmatterContent(
  detail: ZoteroItemDetail,
  existingFrontmatter: Record<string, unknown>,
  filenameStem: string | null,
  zoteroStatus: ZoteroSyncStatus,
  stringifyYaml: YamlStringifier
): string {
  const preservedAliases = toStringList(existingFrontmatter.aliases);
  const preservedTags = toStringList(existingFrontmatter.tags);
  const nextFrontmatter = filterExistingFrontmatter(existingFrontmatter);
  const sourceUrl = buildSourceUrl(detail);
  const nativeFrontmatter: Record<string, unknown> = {
    aliases: Array.from(new Set([...buildAliases(detail), ...preservedAliases])),
    tags: Array.from(new Set([...buildNativeTags(detail), ...preservedTags])),
    zotero_link: detail.item.zoteroSelectUri,
  };

  if (detail.item.creators.length > 0) {
    nativeFrontmatter.authors = detail.item.creators;
  }
  if (detail.item.year) {
    nativeFrontmatter.year = detail.item.year;
  }
  if (detail.item.itemType) {
    nativeFrontmatter.reference_type = humanizeItemType(detail.item.itemType);
  }
  if (detail.item.publicationTitle) {
    nativeFrontmatter.publication = detail.item.publicationTitle;
  }
  if (detail.item.doi) {
    nativeFrontmatter.doi = detail.item.doi;
  }
  if (sourceUrl) {
    nativeFrontmatter.source = sourceUrl;
  }
  if (detail.item.collections.length > 0) {
    nativeFrontmatter.collections = detail.item.collections.map(
      (collection) => collection.name
    );
  }

  const merged = {
    ...nextFrontmatter,
    ...nativeFrontmatter,
    ...(filenameStem ? { stratum_filename_stem: filenameStem } : {}),
    stratum_note_type: "literature-note",
    zotero_status: zoteroStatus,
    zotero_item_identity: getItemIdentity(detail),
    zotero_item_key: detail.item.key,
    zotero_attachment_keys: detail.attachments.map((attachment) => attachment.key),
    zotero_note_keys: detail.zoteroNotes.map((note) => note.key),
    zotero_annotation_keys: detail.annotations.map((annotation) => annotation.key),
    zotero_item_version: detail.item.version,
    zotero_synced_at: new Date().toISOString(),
  } satisfies Record<string, unknown>;

  return `---\n${stringifyYaml(merged).trim()}\n---\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertManagedBlock(body: string, managedBlock: string): string {
  const managedPattern = new RegExp(
    `${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n*`,
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

function renderReferenceSection(detail: ZoteroItemDetail): string {
  const sourceUrl = buildSourceUrl(detail);
  const referenceLines = [
    `**Authors**: ${detail.item.creators.length > 0 ? renderWikiList(detail.item.creators) : "_Unknown_"}`,
    `**Year**: ${detail.item.year ?? "_Unknown_"}`,
    `**Type**: ${humanizeItemType(detail.item.itemType) ?? "_Unknown_"}`,
    detail.item.publicationTitle
      ? `**Publication**: ${toWikiLink(detail.item.publicationTitle)}`
      : null,
    detail.item.collections.length > 0
      ? `**Collections**: ${renderWikiList(
          detail.item.collections.map((collection) => collection.name)
        )}`
      : null,
    detail.item.tags.length > 0
      ? `**Topics**: ${buildInlineTopicTags(detail.item.tags).join(" ")}`
      : null,
    detail.item.doi
      ? `**DOI**: [${detail.item.doi}](https://doi.org/${detail.item.doi})`
      : null,
  ].filter((line): line is string => Boolean(line));

  const openLinks = [
    `[Open in Zotero](${detail.item.zoteroSelectUri})`,
    sourceUrl ? `[Open source](${sourceUrl})` : null,
    ...detail.attachments.map((attachment) => {
      const href = attachment.zoteroOpenPdfUri ?? attachment.zoteroSelectUri;
      const label = attachment.zoteroOpenPdfUri ? attachment.title : `Zotero: ${attachment.title}`;
      return `[${label}](${href})`;
    }),
  ].filter((link): link is string => Boolean(link));

  referenceLines.push(`**Open**: ${openLinks.join(" · ")}`);

  return toCalloutBlock("cite", "Reference", referenceLines);
}

function renderAbstractSection(detail: ZoteroItemDetail): string | null {
  const abstract = detail.item.abstract?.trim();
  if (!abstract) {
    return null;
  }

  return toFoldableCalloutBlock("abstract", "Abstract", abstract.split("\n"), false);
}

function renderZoteroNotesSection(
  detail: ZoteroItemDetail,
  htmlToMarkdown: HtmlToMarkdownTransformer
): string | null {
  if (detail.zoteroNotes.length === 0) {
    return null;
  }

  const notes = detail.zoteroNotes.map((note, index) => {
    const markdown =
      htmlToMarkdown(preprocessZoteroNoteHtml(note.html)).trim() ||
      "_Empty Zotero note._";
    const metadataLine = [
      `[Open in Zotero](${note.zoteroSelectUri})`,
      note.dateModified ? `Last modified: ${note.dateModified}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" · ");

    return toFoldableCalloutBlock(
      "note",
      getZoteroNoteCalloutTitle(markdown, index),
      [
        metadataLine,
        "",
        ...markdown.split("\n"),
      ],
      false
    );
  });

  return ["## Zotero Notes", ...notes].join("\n\n");
}

function getColorCategory(hex: string | null): string {
  if (!hex) {
    return "Uncolored";
  }

  let r = 0;
  let g = 0;
  let b = 0;

  if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16) / 255;
    g = parseInt(hex.slice(3, 5), 16) / 255;
    b = parseInt(hex.slice(5, 7), 16) / 255;
  }

  const cmin = Math.min(r, g, b);
  const cmax = Math.max(r, g, b);
  const delta = cmax - cmin;
  let hue = 0;
  let saturation = 0;
  let lightness = 0;

  if (delta !== 0) {
    if (cmax === r) {
      hue = ((g - b) / delta) % 6;
    } else if (cmax === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
  }

  hue = Math.round(hue * 60);
  if (hue < 0) {
    hue += 360;
  }

  lightness = (cmax + cmin) / 2;
  saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const saturationPercent = +(saturation * 100).toFixed(1);
  const lightnessPercent = +(lightness * 100).toFixed(1);

  if (lightnessPercent < 12) {
    return "Black";
  }
  if (lightnessPercent > 98) {
    return "White";
  }
  if (saturationPercent < 2) {
    return "Gray";
  }
  if (hue < 15) {
    return "Red";
  }
  if (hue < 45) {
    return "Orange";
  }
  if (hue < 65) {
    return "Yellow";
  }
  if (hue < 170) {
    return "Green";
  }
  if (hue < 190) {
    return "Cyan";
  }
  if (hue < 255) {
    return "Blue";
  }
  if (hue < 280) {
    return "Purple";
  }
  if (hue < 335) {
    return "Magenta";
  }

  return "Red";
}

function renderAnnotationsSection(detail: ZoteroItemDetail): string | null {
  if (detail.annotations.length === 0) {
    return null;
  }

  const groups = new Map<string, ZoteroItemDetail["annotations"]>();
  detail.annotations.forEach((annotation) => {
    const key = getColorCategory(annotation.color);
    const existing = groups.get(key) ?? [];
    existing.push(annotation);
    groups.set(key, existing);
  });

  const sections = Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, annotations]) => {
      const bodyLines = annotations.flatMap((annotation, index) => {
        const itemLines = [
          `**${annotation.pageLabel ? `Page ${annotation.pageLabel}` : "Page unknown"}**${annotation.type ? ` · ${annotation.type}` : ""}`,
          annotation.text ? annotation.text.replace(/\n+/g, " ").trim() : null,
          annotation.comment ? `Comment: ${annotation.comment}` : null,
          annotation.zoteroOpenPdfUri
            ? `[Open annotation in Zotero](${annotation.zoteroOpenPdfUri})`
            : null,
        ].filter((line): line is string => Boolean(line));

        return index === annotations.length - 1 ? itemLines : [...itemLines, ""];
      });

      return toFoldableCalloutBlock(
        "quote",
        getHighlightGroupCalloutTitle(label, annotations),
        bodyLines,
        false
      );
    });

  return ["## Highlights", ...sections].join("\n\n");
}

function renderManagedBlock(
  detail: ZoteroItemDetail,
  htmlToMarkdown: HtmlToMarkdownTransformer,
  zoteroStatus: ZoteroSyncStatus
): string {
  const sections = [
    renderReferenceSection(detail),
    renderAbstractSection(detail),
    renderZoteroNotesSection(detail, htmlToMarkdown),
    renderAnnotationsSection(detail),
  ].filter((section): section is string => Boolean(section));
  const deletedWarning =
    zoteroStatus === "deleted"
      ? [
          "> [!warning] This item was removed from Zotero",
          "> The source item is no longer in your Zotero library. This note is preserved but will no longer receive updates.",
          "",
        ]
      : [];

  return [
    MANAGED_START,
    `# ${detail.item.title}`,
    "",
    ...deletedWarning,
    "> [!info] Stratum managed content",
    "> Stratum refreshes this reference block, Zotero notes, and PDF highlights.",
    "> Write your own thoughts anywhere else in the note. The `## My Notes` section is never rewritten.",
    "",
    ...sections.flatMap((section, index) =>
      index === sections.length - 1 ? [section] : [section, ""]
    ),
    MANAGED_END,
  ].join("\n");
}

export function getLiteratureNoteSummary(
  detail: ZoteroItemDetail
): LiteratureNoteSummary {
  return {
    zoteroNoteCount: detail.zoteroNotes.length,
    annotationCount: detail.annotations.length,
    attachmentCount: detail.attachments.length,
  };
}

function prioritizeCandidates(
  entries: LiteratureNoteCandidate[],
  preferredFolder?: string
): LiteratureNoteCandidate[] {
  const normalizedPreferredFolder = preferredFolder?.replace(/\/+$/, "");

  return [...entries].sort((left, right) => {
    const leftPreferred =
      normalizedPreferredFolder && left.path.startsWith(`${normalizedPreferredFolder}/`)
        ? 1
        : 0;
    const rightPreferred =
      normalizedPreferredFolder && right.path.startsWith(`${normalizedPreferredFolder}/`)
        ? 1
        : 0;

    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }

    return left.path.localeCompare(right.path);
  });
}

export function findExistingLiteratureNoteMatch(
  entries: LiteratureNoteCandidate[],
  identity: LiteratureNoteIdentity,
  preferredFolder?: string
): ExistingLiteratureNoteMatch | null {
  const itemIdentity = `${identity.libraryType}:${identity.libraryId}:${identity.itemKey}`;
  const legacyIdentity = getLegacyItemIdentity(identity.itemKey);
  const buckets: LiteratureNoteCandidate[][] = [[], [], []];

  for (const entry of entries) {
    const frontmatter = entry.frontmatter ?? {};

    if (frontmatter[IDENTITY_FRONTMATTER_KEY] === itemIdentity) {
      buckets[0].push(entry);
      continue;
    }

    if (
      frontmatter[LIBRARY_ID_FRONTMATTER_KEY] === identity.libraryId &&
      frontmatter[LIBRARY_TYPE_FRONTMATTER_KEY] === identity.libraryType &&
      frontmatter[ITEM_KEY_FRONTMATTER_KEY] === identity.itemKey
    ) {
      buckets[1].push(entry);
      continue;
    }

    if (
      frontmatter[IDENTITY_FRONTMATTER_KEY] === legacyIdentity ||
      frontmatter[ITEM_KEY_FRONTMATTER_KEY] === identity.itemKey
    ) {
      buckets[2].push(entry);
    }
  }

  for (const bucket of buckets) {
    if (bucket.length === 0) {
      continue;
    }

    const prioritized = prioritizeCandidates(bucket, preferredFolder);
    return {
      candidate: prioritized[0],
      duplicateCount: prioritized.length,
    };
  }

  return null;
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

export function getTrackedChildItemKeysFromFrontmatter(
  frontmatter?: Record<string, unknown> | null
): string[] {
  const keyArrays = [
    frontmatter?.[ATTACHMENT_KEYS_FRONTMATTER_KEY],
    frontmatter?.[NOTE_KEYS_FRONTMATTER_KEY],
    frontmatter?.[ANNOTATION_KEYS_FRONTMATTER_KEY],
  ];

  return keyArrays.flatMap((value) => toStringList(value));
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
        .replace(
          `${MANAGED_START}\n`,
          `${MANAGED_START}\n${deletedNotice}\n\n`
        )
    : `${deletedNotice}\n\n${body}`.trimEnd();

  return `---\n${params.stringifyYaml(nextFrontmatter).trim()}\n---\n\n${nextBody.trimStart()}`
    .trimEnd()
    .concat("\n");
}
