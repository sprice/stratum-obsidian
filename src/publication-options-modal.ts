import { Modal, type App, type ToggleComponent } from "obsidian";
import type { PublishController } from "./publish-controller";
import type { AastexPdfOptions } from "./publication-options";
import {
  AASTEX_OPTION_LABELS,
  aastexOptionToggle,
} from "./publication-option-controls";
import { createStratumButton } from "./ui-controls";
import { AASTEX_PACKAGE_REFERENCE } from "./publication-package";

/** Auto-save options for one captured note; queued controller saves capture it too. */
export class AastexOptionsModal extends Modal {
  private noteKey: string;
  private toggles = new Map<keyof AastexPdfOptions, ToggleComponent>();
  private reset!: HTMLButtonElement;
  private message!: HTMLElement;
  private error!: HTMLElement;
  private unsubscribe?: () => void;
  private alive = false;
  constructor(
    app: App,
    private publish: PublishController,
    private launcher: HTMLElement,
  ) {
    super(app);
    this.noteKey = this.currentNoteKey();
    this.modalEl.addClass("stratum-modal", "stratum-document-options-modal");
  }
  private currentNoteKey(): string {
    const file = this.publish.document;
    return file ? `${file.path}:${file.stat.ctime}` : "";
  }
  onOpen(): void {
    this.alive = true;
    this.setTitle(
      `${this.publish.selectedTemplate?.name ?? "Template"} document options — this note`,
    );
    this.contentEl.createEl("p", {
      text: this.publish.document?.basename ?? "",
      cls: "stratum-publish-meta",
    });
    this.contentEl.createEl("p", {
      text: `AASTeX ${AASTEX_PACKAGE_REFERENCE.upstreamVersion} · Stratum adapter ${AASTEX_PACKAGE_REFERENCE.version}`,
      cls: "stratum-publish-meta",
    });
    this.message = this.contentEl.createEl("p", {
      cls: "stratum-publish-meta",
      attr: { role: "status" },
    });
    for (const key of Object.keys(
      AASTEX_OPTION_LABELS,
    ) as (keyof AastexPdfOptions)[])
      this.toggles.set(
        key,
        aastexOptionToggle(this.contentEl, key, (value) =>
          this.save(() =>
            this.publish.updateAastexPdfOptions({ [key]: value }),
          ),
        ),
      );
    this.contentEl.createEl("p", {
      text: "Changes save automatically for this note’s next PDF. Heading normalization leaves your note unchanged. Turning off the draft date keeps the class’s typesetting credit.",
      cls: "stratum-publish-meta",
    });
    this.error = this.contentEl.createEl("p", {
      cls: "stratum-publish-error",
      attr: { role: "alert" },
    });
    const actions = this.contentEl.createDiv({
      cls: "stratum-publish-actions",
    });
    this.reset = createStratumButton(actions, {
      text: "Reset document options",
      tooltip: "Apply the current vault defaults to this note",
    });
    this.reset.addEventListener("click", () =>
      this.save(() => this.publish.resetAastexPdfOptions()),
    );
    const done = createStratumButton(actions, { text: "Done", primary: true });
    done.addEventListener("click", () => this.close());
    this.unsubscribe = this.publish.subscribe(() => this.update());
    this.update();
  }
  private save(operation: () => Promise<void>): void {
    if (
      !this.alive ||
      this.currentNoteKey() !== this.noteKey ||
      this.publish.selectedFormat !== "pdf"
    )
      return;
    this.error.setText("");
    // Invoke synchronously so the controller captures this note before queueing.
    void operation().catch((error) => {
      if (this.alive)
        this.error.setText(
          error instanceof Error
            ? error.message
            : "Could not save document options. Try again.",
        );
    });
  }
  private update(): void {
    if (!this.alive) return;
    if (
      !this.noteKey ||
      this.currentNoteKey() !== this.noteKey ||
      this.publish.selectedTemplate?.renderer !== "aastex"
    ) {
      this.close();
      return;
    }
    const pdf = this.publish.selectedFormat === "pdf";
    this.message.setText(
      pdf
        ? this.publish.preferencesSaving
          ? "Saving document options…"
          : "PDF options for this note. Reset applies the current vault defaults."
        : "These options apply to PDF exports. Word uses the selected citation style. Select PDF on Create to change these options.",
    );
    for (const [key, toggle] of this.toggles) {
      toggle.setValue(this.publish.aastexPdfOptions[key]);
      toggle.setDisabled(
        !pdf ||
          this.publish.busy ||
          (this.publish.preferencesSaving &&
            toggle.toggleEl.ownerDocument.activeElement !== toggle.toggleEl),
      );
    }
    this.reset.disabled =
      !pdf || this.publish.busy || this.publish.preferencesSaving;
  }
  onClose(): void {
    this.alive = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.contentEl.empty();
    if (this.launcher.isConnected) this.launcher.focus();
  }
}
