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
import { buildCitekey } from "./bibtex-format";
import { parseSourceOccurrences } from "./source-occurrences";
import { openCitationComposer } from "./citation-composer";

export class CitationSuggest extends EditorSuggest<LiteratureNoteEntry> {
  private entries: LiteratureNoteEntry[] = [];
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
    const offset = editor.posToOffset(start);
    const text = editor.getValue();
    const probe =
      text.slice(0, offset) +
      "@stratumProbe" +
      text.slice(editor.posToOffset(cursor));
    if (
      !parseSourceOccurrences(probe).some(
        (o) =>
          o.kind === "citation" &&
          o.from === offset &&
          o.target === "stratumProbe",
      )
    )
      return null;
    if (!this.context) this.entries = buildLiteratureNoteEntries(this.plugin);
    return { start, end: cursor, query: match[1] };
  }
  getSuggestions(context: EditorSuggestContext): LiteratureNoteEntry[] {
    const terms = context.query
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return this.entries
      .filter((entry) => {
        const text = [
          entry.title,
          ...entry.authors,
          entry.year,
          buildCitekey(entry),
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
      text: `@${buildCitekey(entry)}`,
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
