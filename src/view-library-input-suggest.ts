import { AbstractInputSuggest, SearchComponent } from "obsidian";
import type { ZoteroSearchResult } from "./backend-client";
import type { StratumView } from "./view";

export class LibraryPaperInputSuggest extends AbstractInputSuggest<ZoteroSearchResult> {
  private readonly view: StratumView;
  private readonly inputEl: HTMLInputElement;
  private readonly onStateChange: () => void;
  private watchedPendingSearch: Promise<ZoteroSearchResult[]> | null = null;

  constructor(
    view: StratumView,
    component: SearchComponent,
    onStateChange: () => void,
  ) {
    super(view.app, component.inputEl);
    this.view = view;
    this.inputEl = component.inputEl;
    this.onStateChange = onStateChange;
    this.limit = 24;
  }

  protected getSuggestions(query: string): ZoteroSearchResult[] {
    const snapshot = this.view.plugin.library.fetchSuggestions(query);
    if (snapshot.pending && snapshot.pending !== this.watchedPendingSearch) {
      this.watchedPendingSearch = snapshot.pending;
      void snapshot.pending.then(() => {
        if (this.watchedPendingSearch !== snapshot.pending) {
          return;
        }

        this.watchedPendingSearch = null;
        this.onStateChange();
        if (this.inputEl.value !== query) {
          return;
        }

        this.inputEl.dispatchEvent(new Event("input"));
      });
    }

    this.onStateChange();
    return snapshot.results;
  }

  renderSuggestion(value: ZoteroSearchResult, el: HTMLElement): void {
    el.addClass("stratum-native-suggestion");
    el.createDiv({
      cls: "stratum-native-suggestion-label",
      text: value.title,
    });
  }

  selectSuggestion(value: ZoteroSearchResult): void {
    this.setValue(value.title);
    this.close();
    this.onStateChange();
    void this.view.plugin.library.selectResult(value);
  }
}
