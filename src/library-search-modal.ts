import { FuzzySuggestModal, type App, type FuzzyMatch, type TFile } from "obsidian";
import type StratumPlugin from "./plugin";
import { isPathInsideNotesFolder } from "./plugin-note-index";

export interface LiteratureNoteEntry {
  file: TFile;
  title: string;
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
}

function stripWikiLink(value: string): string {
  return value.replace(/^\[\[/, "").replace(/]]$/, "").replace(/\|.*$/, "").trim();
}

function extractAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map(stripWikiLink)
    .filter(Boolean);
}

function extractTitle(fm: Record<string, unknown>, basename: string): string {
  const aliases: unknown[] = Array.isArray(fm.aliases) ? fm.aliases : [];
  // aliases[0] is "Author Year", aliases[1] is the main title
  for (let i = 1; i >= 0; i--) {
    const alias = aliases[i];
    if (typeof alias === "string" && alias.trim()) return alias;
  }
  return basename;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildLiteratureNoteEntries(
  plugin: StratumPlugin
): LiteratureNoteEntry[] {
  const entries: LiteratureNoteEntry[] = [];

  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (!isPathInsideNotesFolder(plugin, file.path)) continue;

    const cache = plugin.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!fm || fm.stratum_note_type !== "literature-note") continue;

    entries.push({
      file,
      title: extractTitle(fm, file.basename),
      authors: extractAuthors(fm.authors),
      year: typeof fm.year === "string" || typeof fm.year === "number"
        ? String(fm.year)
        : null,
      citationKey: str(fm.citation_key),
      doi: str(fm.doi),
      publication: typeof fm.publication === "string" ? stripWikiLink(fm.publication) : null,
      volume: str(fm.volume),
      issue: str(fm.issue),
      pages: str(fm.pages),
      publisher: str(fm.publisher),
      referenceType: str(fm.reference_type),
    });
  }

  return entries;
}

export class LiteratureNoteSearchModal extends FuzzySuggestModal<LiteratureNoteEntry> {
  private entries: LiteratureNoteEntry[];
  private onSelect: (entry: LiteratureNoteEntry) => void;

  constructor(
    app: App,
    entries: LiteratureNoteEntry[],
    onSelect: (entry: LiteratureNoteEntry) => void
  ) {
    super(app);
    this.entries = entries;
    this.onSelect = onSelect;
    this.setPlaceholder("Search literature notes by title, author, year, or citation key");
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

  renderSuggestion(match: FuzzyMatch<LiteratureNoteEntry>, el: HTMLElement): void {
    const entry = match.item;
    el.createDiv({
      cls: "stratum-suggestion-title",
      text: entry.title,
    });
    const meta = [
      entry.authors.join(", "),
      entry.year,
    ].filter(Boolean).join(" \u00B7 ");
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
