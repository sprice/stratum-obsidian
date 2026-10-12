import { Modal, type App, type ToggleComponent } from "obsidian";
import type { PublishController } from "./publish-controller";
import {
  readAastexPdfOptions,
  type AastexPdfOptions,
} from "./publication-options";
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
  private refreshing = false;
  private changeRevision = 0;
  private pending = new Map<
    keyof AastexPdfOptions,
    { value: boolean; revision: number }
  >();
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
          this.save(
            () => this.publish.updateAastexPdfOptions({ [key]: value }),
            { [key]: value },
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
      tooltip: "Restore the built-in defaults for this note",
      wrap: true,
    });
    this.reset.addEventListener("click", () =>
      this.save(
        () => this.publish.resetAastexPdfOptions(),
        readAastexPdfOptions(undefined),
      ),
    );
    const done = createStratumButton(actions, { text: "Done", primary: true });
    done.addEventListener("click", () => this.close());
    this.unsubscribe = this.publish.subscribe(() => this.update());
    this.update();
  }
  private save(
    operation: () => Promise<void>,
    patch: Partial<AastexPdfOptions>,
  ): void {
    if (
      !this.alive ||
      this.refreshing ||
      this.currentNoteKey() !== this.noteKey
    )
      return;
    this.error.setText("");
    const revision = ++this.changeRevision;
    for (const key of Object.keys(patch) as (keyof AastexPdfOptions)[])
      this.pending.set(key, { value: patch[key]!, revision });
    // Invoke synchronously so the controller captures this note before queueing.
    void operation()
      .catch((error) => {
        if (
          this.alive &&
          [...this.pending.values()].some(
            (pending) => pending.revision === revision,
          )
        )
          this.error.setText(
            error instanceof Error
              ? error.message
              : "Could not save document options. Try again.",
          );
      })
      .finally(() => {
        for (const [key, pending] of this.pending)
          if (pending.revision === revision) this.pending.delete(key);
        this.update();
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
    this.message.setText(
      this.publish.preferencesSaving
        ? "Saving document options…"
        : "PDF options for this note. Reset restores the built-in defaults.",
    );
    // Native setValue invokes onChange; rendering must never queue a user save.
    this.refreshing = true;
    try {
      for (const [key, toggle] of this.toggles) {
        toggle.setValue(
          this.pending.get(key)?.value ?? this.publish.aastexPdfOptions[key],
        );
        toggle.setDisabled(
          this.publish.busy ||
            (this.publish.preferencesSaving &&
              !toggle.toggleEl.contains(
                toggle.toggleEl.ownerDocument.activeElement,
              )),
        );
      }
    } finally {
      this.refreshing = false;
    }
    this.reset.disabled = this.publish.busy || this.publish.preferencesSaving;
  }
  onClose(): void {
    this.alive = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.contentEl.empty();
    this.pending.clear();
    this.toggles.clear();
    if (this.launcher.isConnected) this.launcher.focus();
  }
}
