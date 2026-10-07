import { createStratumTextarea, styleStratumComponent } from "./ui-controls";
import { Modal, Setting, Notice, type App } from "obsidian";
import { validateNotesTemplate } from "./literature-note-template";

let nextEditorId = 0;

export class NoteTemplateModal extends Modal {
  private active = false;
  constructor(
    app: App,
    private initial: string,
    private save: (template: string) => Promise<void>,
    private options?: {
      title: string;
      description: string[];
      variables: Record<string, string>;
      validate: (template: string) => string | null;
    },
  ) {
    super(app);
    this.modalEl.addClass("stratum-modal");
  }
  onOpen(): void {
    this.active = true;
    this.setTitle(this.options?.title ?? "Literature note template");
    this.titleEl.id ||= `stratum-note-template-title-${++nextEditorId}`;
    for (const text of this.options?.description ?? [
      "Default starting content for literature notes generated from Zotero.",
      "Template changes apply when notes are created or updated. Any personal edits to the existing content are preserved.",
    ])
      this.contentEl.createEl("p", { text });
    const input = createStratumTextarea(this.contentEl, {
      cls: "stratum-note-template-editor",
      attr: { "aria-labelledby": this.titleEl.id, spellcheck: "false" },
    });
    input.value = this.initial;
    const error = this.contentEl.createEl("p", {
      cls: "stratum-note-template-error",
      attr: { role: "alert" },
    });
    if (this.options) {
      this.contentEl.createEl("h3", {
        cls: "stratum-subheading",
        text: "Available variables",
      });
      this.contentEl.createEl("p", {
        cls: "stratum-note-template-variables",
        text: Object.keys(this.options.variables)
          .map((name) => `{{${name}}}`)
          .join(", "),
      });
    }
    let saving = false;
    new Setting(this.contentEl)
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Save")
          .setCta()
          .onClick(async () => {
            if (!this.active || saving) return;
            const message = (this.options?.validate ?? validateNotesTemplate)(
              input.value,
            );
            if (message) {
              error.setText(message);
              return;
            }
            saving = true;
            button.setDisabled(true);
            input.disabled = true;
            try {
              await this.save(input.value);
              if (this.active) this.close();
            } catch {
              if (this.active)
                error.setText("Could not save the template. Try again.");
              else new Notice("Could not save the template.");
            } finally {
              saving = false;
              button.setDisabled(false);
              input.disabled = false;
            }
          }),
      );
    input.focus();
  }
  onClose(): void {
    this.active = false;
    this.contentEl.empty();
  }
}
