import {
  EditorSuggest,
  Notice,
  type Editor,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type TFile,
} from "obsidian";
import type StratumPlugin from "./plugin";
import {
  buildLiteratureNoteEntries,
  type LiteratureNoteEntry,
} from "./library-search-modal";
import {
  citationKeyIndex,
  preferCitedSources,
  readCitationBibliography,
} from "./citation-keys";
import { citationAt } from "./citation-model";
import { openCitationComposer } from "./citation-composer";

export class CitationSuggest extends EditorSuggest<LiteratureNoteEntry> {
  private suggestions: Promise<{
    index: ReturnType<typeof citationKeyIndex>;
    ordered: LiteratureNoteEntry[];
  }> | null = null;
  private entries: LiteratureNoteEntry[] = [];
  private labels = new Map<LiteratureNoteEntry, string>();
  constructor(private plugin: StratumPlugin) {
    super(plugin.app);
    this.limit = 20;
    this.setInstructions([
      { command: "↑↓", purpose: "Choose source" },
      { command: "↵", purpose: "Add citation details" },
      { command: "esc", purpose: "Dismiss" },
    ]);
  }
  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (!file) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    // Avoid email addresses and existing bracket groups: those use the edit command.
    const match = /(?:^|[\s(])@([\p{L}\p{N}_.:-]*)$/u.exec(before);
    if (!match) return null;
    const start = { line: cursor.line, ch: cursor.ch - match[1].length - 1 };
    if (
      this.context?.file === file &&
      this.context.start.line === start.line &&
      this.context.start.ch === start.ch
    )
      return { start, end: cursor, query: match[1] };
    const offset = editor.posToOffset(start);
    const text = editor.getValue();
    const probe =
      text.slice(0, offset) +
      "@stratumProbe" +
      text.slice(editor.posToOffset(cursor));
    const candidate = citationAt(probe, offset);
    // Only complete standalone tokens are safe to replace with a new citation.
    // Groups (including unfinished ones) and narrative locators use the editor.
    if (
      !candidate?.draft?.narrative ||
      candidate.from !== offset ||
      candidate.to !== offset + "@stratumProbe".length ||
      candidate.draft.items[0]?.key !== "stratumProbe"
    )
      return null;
    this.entries = buildLiteratureNoteEntries(this.plugin);
    this.labels.clear();
    this.suggestions = null;
    return { start, end: cursor, query: match[1] };
  }
  async getSuggestions(
    context: EditorSuggestContext,
  ): Promise<LiteratureNoteEntry[]> {
    const entries = this.entries;
    let index: ReturnType<typeof citationKeyIndex>,
      ordered: LiteratureNoteEntry[];
    try {
      this.suggestions ??= readCitationBibliography(this.plugin.app).then(
        (bibliography) => ({
          index: citationKeyIndex(entries, bibliography),
          ordered: preferCitedSources(
            entries,
            context.editor.getValue(),
            bibliography,
          ),
        }),
      );
      ({ index, ordered } = await this.suggestions);
    } catch {
      this.suggestions = null;
      return [];
    }
    for (const entry of entries) this.labels.set(entry, index.label(entry));
    const terms = context.query
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return ordered
      .filter((entry) => {
        const text = [
          entry.title,
          ...entry.authors,
          entry.year,
          index.label(entry),
        ]
          .join(" ")
          .toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
      })
      .slice(0, this.limit);
  }
  renderSuggestion(entry: LiteratureNoteEntry, el: HTMLElement): void {
    el.createDiv({ text: entry.title, cls: "stratum-suggestion-title" });
    el.createDiv({
      text: this.labels.get(entry) ?? "Citation key unavailable",
      cls: "stratum-suggestion-citekey",
    });
    el.createDiv({
      text: [entry.authors.join(", "), entry.year].filter(Boolean).join(" · "),
      cls: "stratum-suggestion-meta",
    });
  }
  selectSuggestion(entry: LiteratureNoteEntry): void {
    const context = this.context;
    if (!context) return;
    const from = context.editor.posToOffset(context.start),
      to = context.editor.posToOffset(context.end);
    this.close();
    void openCitationComposer(this.plugin, context.editor, {
      entry,
      from,
      to,
    }).catch(
      (error: unknown) =>
        new Notice(
          error instanceof Error
            ? error.message
            : "Could not open citation composer.",
        ),
    );
  }
}
