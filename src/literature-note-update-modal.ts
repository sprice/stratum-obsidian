import { Modal } from "obsidian";
import type { App, TFile } from "obsidian";
import type { LiteratureNoteSummary } from "./literature-note";

export type ExistingNoteAction = "update" | "open" | "cancel";

export class LiteratureNoteUpdateModal extends Modal {
  private readonly file: TFile;
  private readonly title: string;
  private readonly summary: LiteratureNoteSummary;
  private readonly onResolve: (action: ExistingNoteAction) => void;

  constructor(params: {
    app: App;
    file: TFile;
    title: string;
    summary: LiteratureNoteSummary;
    onResolve: (action: ExistingNoteAction) => void;
  }) {
    super(params.app);
    this.file = params.file;
    this.title = params.title;
    this.summary = params.summary;
    this.onResolve = params.onResolve;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("stratum-update-modal");
    contentEl.empty();

    contentEl.createEl("h2", {
      text: "Update existing literature note?",
    });
    contentEl.createEl("p", {
      text: `A literature note already exists for “${this.title}”. Stratum will refresh the synced Zotero sections and preserve anything you’ve written outside those managed sections.`,
    });
    contentEl.createEl("p", {
      cls: "stratum-modal-meta",
      text: `Existing file: ${this.file.path}`,
    });

    const summaryList = contentEl.createEl("ul", {
      cls: "stratum-list",
    });
    summaryList.createEl("li", {
      text: `Refresh reference metadata, abstract, and links.`,
    });
    summaryList.createEl("li", {
      text: `Sync ${this.summary.zoteroNoteCount} Zotero note${this.summary.zoteroNoteCount === 1 ? "" : "s"} and ${this.summary.annotationCount} PDF annotation${this.summary.annotationCount === 1 ? "" : "s"}.`,
    });
    summaryList.createEl("li", {
      text: "Leave your own notes and any content outside managed sections untouched.",
    });

    const actions = contentEl.createDiv({ cls: "stratum-actions" });
    const updateButton = actions.createEl("button", {
      cls: "mod-cta",
      text: "Update existing note",
    });
    updateButton.addEventListener("click", () => {
      this.onResolve("update");
      this.close();
    });

    const openButton = actions.createEl("button", {
      text: "Open existing note",
    });
    openButton.addEventListener("click", () => {
      this.onResolve("open");
      this.close();
    });

    const cancelButton = actions.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => {
      this.onResolve("cancel");
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function promptExistingLiteratureNote(params: {
  app: App;
  file: TFile;
  title: string;
  summary: LiteratureNoteSummary;
}): Promise<ExistingNoteAction> {
  return new Promise((resolve) => {
    let resolved = false;
    const resolveOnce = (action: ExistingNoteAction) => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve(action);
    };

    const modal = new LiteratureNoteUpdateModal({
      ...params,
      onResolve: resolveOnce,
    });

    const originalOnClose = modal.onClose.bind(modal);

    modal.onClose = () => {
      originalOnClose();
      resolveOnce("cancel");
    };

    modal.open();
  });
}
