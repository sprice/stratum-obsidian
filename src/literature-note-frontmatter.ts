import type { ZoteroItemDetail } from "./backend-client";
import {
  getReadableAuthorLabel,
  getReadableTitleVariants,
  getReadableYearLabel,
} from "./literature-note-filenames";
import { slugify } from "./literature-note-content-html";
import {
  ANNOTATION_KEYS_FRONTMATTER_KEY,
  ATTACHMENT_KEYS_FRONTMATTER_KEY,
  MANAGED_FRONTMATTER_KEYS,
  NOTE_KEYS_FRONTMATTER_KEY,
  type YamlParser,
  type YamlStringifier,
  type ZoteroSyncStatus,
} from "./literature-note-content-types";

export function getItemIdentity(detail: ZoteroItemDetail): string {
  return `${detail.library.type}:${detail.library.id}:${detail.item.key}`;
}

function escapeWikiTarget(value: string): string {
  return value.replace(/[|\]]/g, "\\$&");
}

function toWikiLink(value: string): string {
  return `[[${escapeWikiTarget(value)}]]`;
}

export function renderWikiList(values: string[]): string {
  return values.map((value) => toWikiLink(value)).join(", ");
}

function toSentenceCase(value: string): string {
  if (!value) {
    return value;
  }

  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

export function humanizeItemType(itemType: string | null): string | null {
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

export function buildSourceUrl(detail: ZoteroItemDetail): string | null {
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

export function buildInlineTopicTags(tags: string[]): string[] {
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

export function toStringList(value: unknown): string[] {
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
