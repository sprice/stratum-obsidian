import { Modal, Setting, Notice, type App } from "obsidian";
import { validateNotesTemplate } from "./literature-note-template";

let nextEditorId = 0;

export class NoteTemplateModal extends Modal {
  private active = false;
  constructor(
    app: App,
    private initial: string,
    private save: (template: string) => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    this.active = true;
    this.setTitle("Literature note template");
    this.titleEl.id ||= `stratum-note-template-title-${++nextEditorId}`;
    this.contentEl.createEl("p", {
      text: "Default starting content for literature notes generated from Zotero.",
    });
    this.contentEl.createEl("p", {
      text: "Template changes apply when notes are created or updated. Any personal edits to the existing content are preserved.",
    });
    const input = this.contentEl.createEl("textarea", {
      cls: "stratum-note-template-editor",
      attr: { "aria-labelledby": this.titleEl.id, spellcheck: "false" },
    });
    input.value = this.initial;
    const error = this.contentEl.createEl("p", { attr: { role: "status" } });
    let saving = false;
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText("Save")
          .setCta()
          .onClick(async () => {
            if (!this.active || saving) return;
            const message = validateNotesTemplate(input.value);
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
              else new Notice("Could not save the literature note template.");
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
