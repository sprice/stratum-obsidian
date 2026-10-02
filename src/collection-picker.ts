import { FuzzySuggestModal, type App, type FuzzyMatch } from "obsidian";
import type { CollectionChoice } from "./collection-browser-model";

export class CollectionPicker extends FuzzySuggestModal<CollectionChoice> {
  constructor(
    app: App,
    private choices: CollectionChoice[],
    private choose: (choice: CollectionChoice) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a collection…");
    this.setInstructions([
      { command: "↑↓", purpose: "Navigate" },
      { command: "↵", purpose: "Browse papers" },
      { command: "esc", purpose: "Cancel" },
    ]);
  }
  getItems(): CollectionChoice[] {
    return this.choices;
  }
  getItemText(choice: CollectionChoice): string {
    return `${choice.name} ${choice.context}`;
  }
  renderSuggestion(match: FuzzyMatch<CollectionChoice>, el: HTMLElement): void {
    el.createDiv({ cls: "stratum-suggestion-title", text: match.item.name });
    el.createDiv({ cls: "stratum-suggestion-meta", text: match.item.context });
  }
  onChooseItem(choice: CollectionChoice): void {
    this.choose(choice);
  }
}
