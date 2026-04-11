import { AbstractInputSuggest, SearchComponent } from "obsidian";
import type { LiteratureNoteEntry } from "./library-search-modal";
import type { StratumView } from "./view";
import { renderSearchSuggestionTitle } from "./view-search-suggestion";

const READER_SUGGESTION_LIMIT = 24;

export function filterReaderLiteratureNoteEntries(
  entries: LiteratureNoteEntry[],
  query: string,
  limit = READER_SUGGESTION_LIMIT,
): LiteratureNoteEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return entries
    .filter((entry) => {
      return [
        entry.title,
        entry.displayTitle,
        entry.authors.join(" "),
        entry.year ?? "",
        entry.citationKey ?? "",
        entry.publication ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .slice(0, limit);
}

export class ReaderLiteratureNoteInputSuggest extends AbstractInputSuggest<LiteratureNoteEntry> {
  private readonly entries: LiteratureNoteEntry[];
  private readonly onChooseEntry: (entry: LiteratureNoteEntry) => void;

  constructor(
    view: StratumView,
    component: SearchComponent,
    entries: LiteratureNoteEntry[],
    onChooseEntry: (entry: LiteratureNoteEntry) => void,
  ) {
    super(view.app, component.inputEl);
    this.entries = entries;
    this.onChooseEntry = onChooseEntry;
    this.limit = READER_SUGGESTION_LIMIT;
  }

  protected getSuggestions(query: string): LiteratureNoteEntry[] {
    return filterReaderLiteratureNoteEntries(this.entries, query, this.limit);
  }

  renderSuggestion(entry: LiteratureNoteEntry, el: HTMLElement): void {
    renderSearchSuggestionTitle(entry.displayTitle, el);
  }

  selectSuggestion(entry: LiteratureNoteEntry): void {
    this.setValue(entry.displayTitle);
    this.close();
    this.onChooseEntry(entry);
  }
}
