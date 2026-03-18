export const MANAGED_START = "<!-- stratum:managed:start -->";
export const MANAGED_END = "<!-- stratum:managed:end -->";
export const USER_NOTES_HEADING = "## My Notes";
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

export type ZoteroSyncStatus = "active" | "deleted";

export const MANAGED_FRONTMATTER_KEYS = new Set([
  "aliases",
  "arxiv",
  "authors",
  "citation_key",
  "collections",
  "date_added",
  "doi",
  "isbn",
  "issn",
  "language",
  "pages",
  "pmcid",
  "pmid",
  "publication",
  "publisher",
  "reference_type",
  "short_title",
  "source",
  "tags",
  "volume",
  "issue",
  "year",
  "stratum_filename_stem",
  "stratum_managed_aliases",
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
