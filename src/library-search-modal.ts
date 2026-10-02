import {
  readCreators,
  primaryCreators,
  creatorName,
  type ZoteroCreator,
} from "./zotero-schema";
import {
  FuzzySuggestModal,
  type App,
  type FuzzyMatch,
  type TFile,
} from "obsidian";
import { extractPreferredLinkText } from "./literature-note-links";
import type StratumPlugin from "./plugin";

export interface LiteratureNoteEntry {
  file: TFile;
  title: string;
  displayTitle: string;
  preferredLinkText: string | null;
  authors: string[];
  year: string | null;
  citationKey: string | null;
  doi: string | null;
  publication: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  referenceType: string | null;
  itemType?: string | null;
  identity?: string | null;
  creatorDetails?: ZoteroCreator[];
  sourceFields?: Record<string, string>;
  url?: string | null;
}

function stripWikiLink(value: string): string {
  return value
    .replace(/^\[\[/, "")
    .replace(/]]$/, "")
    .replace(/\|.*$/, "")
    .trim();
}

function extractAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map(stripWikiLink)
    .filter(Boolean);
}

function extractTitle(fm: Record<string, unknown>, basename: string): string {
  if (typeof fm.zotero_title === "string" && fm.zotero_title.trim())
    return fm.zotero_title;
  const aliases: unknown[] = Array.isArray(fm.aliases) ? fm.aliases : [];
  // aliases[0] is "Author Year", aliases[1] is the main title
  for (let i = 1; i >= 0; i--) {
    const alias = aliases[i];
    if (typeof alias === "string" && alias.trim()) return alias;
  }
  return basename;
}

function extractDisplayTitle(
  fm: Record<string, unknown>,
  fallbackTitle: string,
): string {
  if (typeof fm.zotero_title === "string" && fm.zotero_title.trim())
    return fm.zotero_title;
  const managedAliases: unknown[] = Array.isArray(fm.stratum_managed_aliases)
    ? fm.stratum_managed_aliases
    : [];

  for (let i = 2; i >= 1; i--) {
    const alias = managedAliases[i];
    if (typeof alias === "string" && alias.trim() && !alias.startsWith("@")) {
      return alias;
    }
  }

  return fallbackTitle;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildLiteratureNoteEntries(
  plugin: StratumPlugin,
): LiteratureNoteEntry[] {
  const entries: LiteratureNoteEntry[] = [];

  for (const file of plugin.app.vault.getMarkdownFiles()) {
    const cache = plugin.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm || fm.stratum_note_type !== "literature-note") continue;
    entries.push(literatureNoteEntryFromFrontmatter(file, fm));
  }

  return entries;
}

export function literatureNoteEntryFromFrontmatter(
  file: TFile,
  fm: Record<string, unknown>,
): LiteratureNoteEntry {
  const title = extractTitle(fm, file.basename);
  const creatorDetails = Array.isArray(fm.zotero_creators)
    ? readCreators(fm.zotero_creators)
    : undefined;
  const itemType = str(fm.zotero_item_type);
  const sourceFields =
    fm.zotero_fields &&
    typeof fm.zotero_fields === "object" &&
    !Array.isArray(fm.zotero_fields)
      ? Object.fromEntries(
          Object.entries(fm.zotero_fields).filter(
            (pair): pair is [string, string] => typeof pair[1] === "string",
          ),
        )
      : {};
  const text = (key: string) => {
    const value = fm[key];
    return typeof value === "number" ? String(value) : str(value);
  };
  return {
    file,
    title,
    displayTitle: extractDisplayTitle(fm, title),
    preferredLinkText: extractPreferredLinkText(fm, file.basename),
    authors: creatorDetails
      ? primaryCreators(creatorDetails, itemType).map(creatorName)
      : extractAuthors(fm.authors),
    year: text("year"),
    citationKey: str(fm.citation_key),
    doi: str(fm.doi),
    publication: str(fm.publication)
      ? stripWikiLink(fm.publication as string)
      : null,
    volume: text("volume"),
    issue: text("issue"),
    pages: text("pages"),
    publisher: str(fm.publisher) ? stripWikiLink(fm.publisher as string) : null,
    referenceType: str(fm.reference_type),
    itemType,
    creatorDetails,
    sourceFields,
    identity: str(fm.zotero_item_identity),
    url: str(fm.source),
  };
}

export class LiteratureNoteSearchModal extends FuzzySuggestModal<LiteratureNoteEntry> {
  private entries: LiteratureNoteEntry[];
  private onSelect: (entry: LiteratureNoteEntry) => void;

  constructor(
    app: App,
    entries: LiteratureNoteEntry[],
    onSelect: (entry: LiteratureNoteEntry) => void,
  ) {
    super(app);
    this.entries = entries;
    this.onSelect = onSelect;
    this.setPlaceholder(
      "Search literature notes by title, author, year, or citation key",
    );
    this.limit = 30;
  }

  getItems(): LiteratureNoteEntry[] {
    return this.entries;
  }

  getItemText(entry: LiteratureNoteEntry): string {
    const parts = [
      entry.authors.length > 0 ? entry.authors.join(", ") : null,
      entry.year,
      entry.title,
      entry.citationKey ? `@${entry.citationKey}` : null,
    ].filter(Boolean);
    return parts.join(" ");
  }

  renderSuggestion(
    match: FuzzyMatch<LiteratureNoteEntry>,
    el: HTMLElement,
  ): void {
    const entry = match.item;
    el.createDiv({
      cls: "stratum-suggestion-title",
      text: entry.title,
    });
    const meta = [entry.authors.join(", "), entry.year]
      .filter(Boolean)
      .join(" \u00B7 ");
    if (meta) {
      el.createDiv({
        cls: "stratum-suggestion-meta",
        text: meta,
      });
    }
  }

  onChooseItem(entry: LiteratureNoteEntry): void {
    this.onSelect(entry);
  }
}
