import { Modal, type App } from "obsidian";
import { createStratumButton } from "./ui-controls";

export interface ConfirmModalOptions {
  title: string;
  /** Each entry renders as its own paragraph. */
  message: readonly string[];
  confirmLabel: string;
  /** Style the confirm action as destructive. */
  warning?: boolean;
  /** Runs on confirm; the dialog closes once it resolves. */
  confirm: () => Promise<void> | void;
  /** Receives a failed confirm; the dialog stays open so it can be retried. */
  onError?: (error: unknown) => void;
}

/** Asks before an action, focusing Cancel so Enter never confirms by accident. */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private options: ConfirmModalOptions,
  ) {
    super(app);
    this.modalEl.addClass("stratum-modal");
  }
  onOpen(): void {
    const { title, message, confirmLabel, warning, confirm, onError } =
      this.options;
    this.setTitle(title);
    for (const text of message) this.contentEl.createEl("p", { text });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = createStratumButton(actions, { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const accept = createStratumButton(actions, {
      text: confirmLabel,
      primary: !warning,
      className: warning ? "mod-warning" : undefined,
    });
    accept.addEventListener("click", () => {
      if (accept.disabled) return;
      accept.disabled = true;
      void Promise.resolve()
        .then(confirm)
        .then(() => this.close())
        .catch((error: unknown) => {
          accept.disabled = false;
          accept.focus();
          onError?.(error);
        });
    });
    cancel.focus();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
