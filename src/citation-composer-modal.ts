import {
  styleStratumComponent,
  createStratumDisclosure,
  createStratumSummary,
} from "./ui-controls";
import { Modal, Notice, Setting } from "obsidian";
import type StratumPlugin from "./plugin";
import {
  LiteratureNoteSearchModal,
  type LiteratureNoteEntry,
} from "./library-search-modal";
import {
  citationItem,
  locatorLabels,
  serializeCitation,
  type CitationDraft,
  type LocatorLabel,
} from "./citation-model";

export class CitationComposer extends Modal {
  private preview!: HTMLElement;
  private error!: HTMLElement;
  private busy = false;
  private picker: LiteratureNoteSearchModal | null = null;
  isActive = false;
  onDismiss: (() => void) | undefined;
  constructor(
    private plugin: StratumPlugin,
    private entries: LiteratureNoteEntry[],
    private draft: CitationDraft,
    private selected: Map<string, LiteratureNoteEntry>,
    private resolveKey: (entry: LiteratureNoteEntry) => string,
    private save: () => Promise<void>,
    private keyLabel: (entry: LiteratureNoteEntry) => string,
  ) {
    super(plugin.app);
  }
  onOpen(): void {
    this.isActive = true;
    this.render();
  }
  private updatePreview(): void {
    try {
      this.preview.setText(serializeCitation(this.draft));
      this.error.setText("");
    } catch (error) {
      this.preview.setText("");
      this.error.setText(
        error instanceof Error ? error.message : "Check citation details.",
      );
    }
  }
  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass("stratum-citation-composer");
    this.setTitle("Insert or edit citation");
    new Setting(el).setName("Citation form").addDropdown((input) =>
      styleStratumComponent(input)
        .addOptions({
          parenthetical: "Parenthetical",
          narrative: "Narrative (author in sentence)",
        })
        .setValue(this.draft.narrative ? "narrative" : "parenthetical")
        .onChange((value) => {
          this.draft.narrative = value === "narrative";
          this.updatePreview();
        }),
    );
    this.draft.items.forEach((item, index) => {
      const card = el.createDiv({ cls: "stratum-citation-source" });
      card.createEl("h3", {
        text: this.selected.get(item.key)?.title ?? item.key,
      });
      card.createEl("code", { text: `@${item.key}` });
      new Setting(card)
        .setName("Locator")
        .setDesc("Use the published page number, not the PDF page count.")
        .addDropdown((input) =>
          styleStratumComponent(input)
            .addOptions(locatorLabels)
            .setValue(item.label)
            .onChange((value) => {
              item.label = value as LocatorLabel;
              this.updatePreview();
            }),
        )
        .addText((input) =>
          styleStratumComponent(input)
            .setPlaceholder("E.g. 42–44 or xiv")
            .setValue(item.locator)
            .onChange((value) => {
              item.locator = value;
              this.updatePreview();
            }),
        );
      const details = createStratumDisclosure(card, {
        cls: "stratum-citation-details",
      });
      details.open = Boolean(item.prefix || item.suffix || item.suppressAuthor);
      createStratumSummary(details, { text: "More options" });
      for (const field of ["prefix", "suffix"] as const)
        new Setting(details)
          .setName(field === "prefix" ? "Prefix" : "Suffix")
          .addText((input) =>
            styleStratumComponent(input)
              .setValue(item[field])
              .setPlaceholder(
                field === "prefix" ? "e.g. see also" : "e.g. for discussion",
              )
              .onChange((value) => {
                item[field] = value;
                this.updatePreview();
              }),
          );
      new Setting(details)
        .setName("Suppress author")
        .setDesc("For when you have already written the author’s name.")
        .addToggle((input) =>
          styleStratumComponent(input)
            .setValue(item.suppressAuthor)
            .onChange((value) => {
              item.suppressAuthor = value;
              this.updatePreview();
            }),
        );
      new Setting(card)
        .addButton((button) =>
          styleStratumComponent(button)
            .setButtonText("Move up")
            .setDisabled(index === 0)
            .onClick(() => {
              [this.draft.items[index - 1], this.draft.items[index]] = [
                item,
                this.draft.items[index - 1],
              ];
              this.render();
            }),
        )
        .addButton((button) =>
          styleStratumComponent(button)
            .setButtonText("Remove")
            .onClick(() => {
              this.draft.items.splice(index, 1);
              if (
                !this.draft.items.some(
                  (candidate) => candidate.key === item.key,
                )
              )
                this.selected.delete(item.key);
              this.render();
            }),
        );
    });
    new Setting(el).addButton((button) =>
      styleStratumComponent(button)
        .setButtonText("Add source")
        .onClick(() => {
          this.picker = new LiteratureNoteSearchModal(
            this.app,
            this.entries,
            (entry) => {
              if (!this.isActive || this.busy) return;
              if (
                this.draft.items.some(
                  (item) =>
                    this.selected.get(item.key)?.file.path === entry.file.path,
                )
              ) {
                new Notice("This source is already in the citation.");
                return;
              }
              let key: string;
              try {
                key = this.resolveKey(entry);
              } catch (error) {
                new Notice(
                  error instanceof Error
                    ? error.message
                    : "Cannot safely resolve this citation key.",
                );
                return;
              }
              if (
                this.selected.has(key) &&
                this.selected.get(key)?.file.path !== entry.file.path
              ) {
                new Notice(
                  "These sources share a citation key. Give them unique keys in Zotero first.",
                );
                return;
              }
              this.selected.set(key, entry);
              this.draft.items.push(citationItem(key));
              this.render();
            },
            this.keyLabel,
          );
          this.picker.open();
        }),
    );
    el.createEl("h3", { text: "Markdown preview" });
    this.preview = el.createEl("pre", { cls: "stratum-citation-preview" });
    this.error = el.createDiv({
      cls: "stratum-citation-error",
      attr: { role: "status", "aria-live": "polite" },
    });
    new Setting(el)
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Save citation")
          .setCta()
          .onClick(() => {
            if (this.busy) return;
            this.busy = true;
            this.contentEl
              .querySelectorAll<
                HTMLInputElement | HTMLButtonElement | HTMLSelectElement
              >("input, button, select")
              .forEach((control) => (control.disabled = true));
            button.setDisabled(true);
            void this.save()
              .then(() => this.close())
              .catch((error: unknown) =>
                this.error.setText(
                  error instanceof Error
                    ? error.message
                    : "Could not save citation.",
                ),
              )
              .finally(() => {
                this.busy = false;
                if (this.isActive) {
                  const message = this.error.textContent ?? "";
                  this.render();
                  this.error.setText(message);
                }
                button.setDisabled(false);
              });
          }),
      );
    this.updatePreview();
  }
  onClose(): void {
    this.isActive = false;
    this.picker?.close();
    this.picker = null;
    this.onDismiss?.();
    this.contentEl.empty();
  }
}
