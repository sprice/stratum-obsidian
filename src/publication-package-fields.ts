import { Modal, Setting, type TFile } from "obsidian";
import type { PublishController } from "./publish-controller";
import { publicationYaml } from "./publication-metadata";
import { packageVariant } from "./publication-package";

/** Additional controls are generated exclusively from the selected package contract. */
export class PackageFieldsModal extends Modal {
  private closed = false;
  constructor(
    private publish: PublishController,
    private file: TFile,
  ) {
    super(publish.plugin.app);
  }
  onOpen(): void {
    this.closed = false;
    void this.draw().catch((error) => {
      if (this.closed) return;
      this.contentEl.createEl("p", {
        text: error instanceof Error ? error.message : "Could not load fields.",
      });
    });
  }
  private async draw(): Promise<void> {
    const choice = this.publish.selectedTemplate?.package;
    if (
      !choice ||
      !this.publish.plugin.publicationEditor?.flush(this.file.path)
    )
      return;
    this.setTitle("Template fields");
    const original = publicationYaml(
      await this.app.vault.read(this.file),
    ).properties;
    if (this.closed) return;
    const fields = packageVariant(choice.manifest, choice.variant).fields;
    const values = new Map<string, string>();
    const initial = new Map<string, string>();
    for (const f of fields) {
      const raw = original[f.key],
        value = Array.isArray(raw)
          ? raw.join("\n")
          : typeof raw === "string"
            ? raw
            : f.default;
      values.set(f.key, value);
      initial.set(f.key, value);
      const setting = new Setting(this.contentEl)
        .setName(f.label)
        .setDesc(
          `${f.required ? "Required. " : ""}${f.type === "date" ? "YYYY-MM-DD." : f.type === "list" ? "One value per line." : ""}`,
        );
      if (f.type === "list")
        setting.addTextArea((t) => {
          t.setValue(value).onChange((v) => {
            values.set(f.key, v);
          });
        });
      else
        setting.addText((t) => {
          t.setValue(value).onChange((v) => {
            values.set(f.key, v);
          });
        });
    }
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
    new Setting(this.contentEl).addButton((b) => {
      b.setButtonText("Save fields")
        .setCta()
        .onClick(() => {
          if (this.closed) return;
          const changed = fields.filter(
            (f) =>
              original[f.key] === undefined ||
              values.get(f.key) !== initial.get(f.key),
          );
          b.setDisabled(true);
          void this.app.fileManager
            .processFrontMatter(
              this.file,
              (properties: Record<string, unknown>) => {
                for (const f of changed)
                  if (
                    JSON.stringify(properties[f.key]) !==
                    JSON.stringify(original[f.key])
                  )
                    throw new Error(
                      "A field changed while this window was open. Close and reopen it before saving.",
                    );
                for (const f of changed) {
                  const value = values.get(f.key) ?? "";
                  properties[f.key] =
                    f.type === "list"
                      ? value
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : value;
                }
              },
            )
            .then(() => {
              this.publish.plugin.refreshViews();
              this.close();
            })
            .catch((error) => {
              if (this.closed) return;
              status.setText(
                error instanceof Error
                  ? error.message
                  : "Could not save fields.",
              );
            })
            .finally(() => {
              b.setDisabled(false);
            });
        });
    });
  }
  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }
}
