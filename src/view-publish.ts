import { Component, Modal, setIcon, type App } from "obsidian";
import type { PublishController } from "./publish-controller";
import {
  formatLabel,
  type PublishedDocument,
  type PublishFormat,
} from "./publish-model";
import { PublishSetupModal } from "./publish-setup";

class DeletePublicationModal extends Modal {
  constructor(
    app: App,
    private publish: PublishController,
    private document: PublishedDocument,
  ) {
    super(app);
  }
  onOpen(): void {
    this.setTitle("Delete published document?");
    this.contentEl.createEl("p", { text: this.document.filename });
    this.contentEl.createEl("p", {
      text: "This removes the stored document. Your source note and copies saved elsewhere are kept.",
    });
    const actions = this.contentEl.createDiv({
      cls: "stratum-publish-actions",
    });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const remove = actions.createEl("button", {
      text: "Delete document",
      cls: "mod-warning",
    });
    remove.addEventListener("click", () => {
      remove.disabled = true;
      void this.publish.remove(this.document).then(() => this.close());
    });
    cancel.focus();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
export class PublishPanel extends Component {
  private body!: HTMLElement;
  private title!: HTMLElement;
  private status!: HTMLElement;
  private list!: HTMLElement;
  private create!: HTMLButtonElement;
  private type!: HTMLSelectElement;
  private cancel!: HTMLButtonElement;
  constructor(
    private container: HTMLElement,
    private publish: PublishController,
  ) {
    super();
  }
  onload(): void {
    this.body = this.container.createDiv({ cls: "stratum-publish-panel" });
    this.body.createEl("h3", { text: "Publish your note" });
    this.title = this.body.createEl("p", { cls: "stratum-publish-note" });
    const controls = this.body.createDiv({ cls: "stratum-publish-controls" });
    this.type = controls.createEl("select", {
      attr: { "aria-label": "File type" },
    });
    for (const [value, text] of [
      ["", "Choose File Type"],
      ["pdf", "PDF"],
      ["docx", "Word"],
    ])
      this.type.createEl("option", { value, text });
    this.type.value = this.publish.selectedFormat;
    this.type.addEventListener("change", () => {
      this.publish.selectedFormat = this.type.value as PublishFormat | "";
      this.update();
    });
    this.create = controls.createEl("button", {
      text: "Create document",
      cls: "mod-cta",
    });
    this.create.addEventListener("click", () => {
      void this.publish.create();
    });
    this.status = this.body.createDiv({
      cls: "stratum-publish-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    const setup = this.body.createEl("button", { text: "Set up publishing" });
    setup.addEventListener("click", () =>
      new PublishSetupModal(this.publish.plugin).open(),
    );
    this.cancel = this.body.createEl("button", { text: "Cancel" });
    this.cancel.addEventListener("click", () => this.publish.cancel());
    const history = this.body.createDiv({ cls: "stratum-publish-history" });
    history.createEl("h4", { text: "Published documents" });
    const filter = history.createEl("select", {
      attr: { "aria-label": "Filter published documents" },
    });
    for (const [value, text] of [
      ["all", "All file types"],
      ["pdf", "PDF"],
      ["docx", "Word"],
    ])
      filter.createEl("option", { value, text });
    filter.value = this.publish.filter;
    filter.addEventListener("change", () => {
      this.publish.filter = filter.value as PublishFormat | "all";
      this.update();
    });
    this.list = this.body.createDiv({ cls: "stratum-publish-list" });
    this.register(this.publish.subscribe(() => this.update()));
    this.update();
    if (!this.publish.readiness && !this.publish.checking)
      void this.publish.check();
  }
  private update(): void {
    const publish = this.publish;
    this.title.setText(
      publish.document?.basename ?? "Open a Markdown note to publish it.",
    );
    this.create.setText(
      publish.selectedFormat
        ? `Create ${formatLabel(publish.selectedFormat)} Doc`
        : "Create document",
    );
    this.create.disabled = !publish.canCreate();
    this.type.disabled = publish.busy;
    this.cancel.hidden = !publish.busy && !publish.checking;
    this.status.empty();
    this.status.createEl("p", {
      text:
        publish.progress ||
        (publish.readiness?.word
          ? `Word ready · ${publish.readiness.pdf ? "PDF ready" : "PDF setup needed"}`
          : "Set up publishing to create Word and PDF documents."),
    });
    if (publish.error)
      this.status.createEl("p", {
        text: publish.error,
        cls: "stratum-publish-error",
      });
    this.list.empty();
    if (!publish.documents.length)
      this.list.createEl("p", {
        text: !publish.document
          ? "Published documents appear here when you select their source note."
          : publish.filter === "all"
            ? "No published documents for this note yet."
            : `No ${formatLabel(publish.filter)} documents for this note.`,
        cls: "stratum-publish-meta",
      });
    for (const doc of publish.documents) {
      const row = this.list.createDiv({ cls: "stratum-publish-row" });
      const details = row.createDiv({ cls: "stratum-publish-document" });
      details.createDiv({
        text: doc.filename,
        cls: "stratum-publish-filename",
      });
      details.createDiv({
        text: `${formatLabel(doc.format)} · ${new Date(doc.createdAt).toLocaleString()}`,
        cls: "stratum-publish-meta",
      });
      const actions = row.createDiv({ cls: "stratum-publish-row-actions" });
      this.icon(actions, "external-link", "Open", doc, () => publish.open(doc));
      this.icon(actions, "download", "Save as", doc, () =>
        publish.saveCopy(doc),
      );
      this.icon(actions, "trash-2", "Delete", doc, () =>
        new DeletePublicationModal(publish.plugin.app, publish, doc).open(),
      );
    }
  }
  private icon(
    container: HTMLElement,
    icon: string,
    label: string,
    document: PublishedDocument,
    action: () => void | Promise<void>,
  ): void {
    const button = container.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": `${label}: ${document.filename}`, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", () => {
      button.disabled = true;
      void Promise.resolve()
        .then(action)
        .catch((error) => this.publish.fail(error))
        .finally(() => {
          button.disabled = false;
        });
    });
  }
  onunload(): void {
    this.body?.remove();
  }
}
