import { AbstractInputSuggest, SearchComponent } from "obsidian";
import type { ZoteroSearchResult } from "./backend-client";
import type { StratumView } from "./view";

export class LibraryPaperInputSuggest extends AbstractInputSuggest<ZoteroSearchResult> {
  private readonly view: StratumView;
  private readonly onStateChange: () => void;

  constructor(
    view: StratumView,
    component: SearchComponent,
    onStateChange: () => void
  ) {
    super(view.app, component.inputEl);
    this.view = view;
    this.onStateChange = onStateChange;
    this.limit = 24;
  }

  protected async getSuggestions(query: string): Promise<ZoteroSearchResult[]> {
    const results = await this.view.plugin.library.fetchSuggestions(query);
    this.onStateChange();
    return results;
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
