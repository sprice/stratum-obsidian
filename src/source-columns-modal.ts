import { styleStratumComponent } from "./ui-controls";
import { Modal, Setting, type App } from "obsidian";
import {
  MAX_SOURCE_COLUMNS,
  SOURCE_COLUMNS,
  readSourceColumns,
} from "./source-table";

export class SourceColumnsModal extends Modal {
  private selected: Set<string>;
  private active = false;
  constructor(
    app: App,
    columns: string[],
    private save: (columns: string[]) => void,
  ) {
    super(app);
    this.selected = new Set(columns);
  }
  onOpen(): void {
    this.active = true;
    this.setTitle("Table columns");
    const el = this.contentEl;
    el.createEl("p", {
      text: "Choose up to eight columns. Source titles and navigation are always included.",
    });
    const error = el.createEl("p", { attr: { role: "status" } });
    for (const [key, label] of Object.entries(SOURCE_COLUMNS))
      new Setting(el).setName(label).addToggle((toggle) =>
        styleStratumComponent(toggle)
          .setValue(this.selected.has(key))
          .onChange((enabled) => {
            if (enabled) this.selected.add(key);
            else this.selected.delete(key);
          }),
      );
    let custom = [...this.selected]
      .filter((key) => !Object.hasOwn(SOURCE_COLUMNS, key))
      .join(", ");
    new Setting(el)
      .setName("Other properties")
      .setDesc(
        "Comma-separated property names from your literature notes. Values come from properties; inline fields in the note body are not included.",
      )
      .addText((input) =>
        styleStratumComponent(input)
          .setValue(custom)
          .setPlaceholder("Property names")
          .onChange((value) => {
            custom = value;
          }),
      );
    new Setting(el).addButton((button) =>
      styleStratumComponent(button)
        .setButtonText("Apply columns")
        .setCta()
        .onClick(() => {
          if (!this.active) return;
          const keys = [...this.selected].filter((key) =>
            Object.hasOwn(SOURCE_COLUMNS, key),
          );
          keys.push(
            ...custom
              .split(",")
              .map((key) => key.trim())
              .filter(Boolean),
          );
          if (new Set(keys).size > MAX_SOURCE_COLUMNS) {
            error.setText("Choose up to eight columns.");
            return;
          }
          const columns = readSourceColumns(keys);
          if (columns.length !== new Set(keys).size) {
            error.setText(
              "Use property names up to 80 characters without tabs or line breaks.",
            );
            return;
          }
          this.save(columns);
          this.close();
        }),
    );
  }
  onClose(): void {
    this.active = false;
    this.contentEl.empty();
  }
}
