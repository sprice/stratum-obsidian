import { AbstractInputSuggest, type App, type TFolder } from "obsidian";
import { pdfFolder } from "./publish-vault";

export class PublishFolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private select: (path: string) => void,
  ) {
    super(app, input);
  }
  getSuggestions(query: string): TFolder[] {
    return this.app.vault
      .getAllFolders()
      .filter((folder) => {
        try {
          pdfFolder(this.app, folder.path);
        } catch {
          return false;
        }
        return folder.path.toLowerCase().includes(query.toLowerCase());
      })
      .slice(0, 30);
  }
  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }
  selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    this.select(folder.path);
    this.close();
  }
}
