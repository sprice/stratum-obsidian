import { createStratumSelect, createStratumButton } from "./ui-controls";
import { Component, Modal, setIcon, type App } from "obsidian";
import type { PublishController } from "./publish-controller";
import {
  formatLabel,
  type PublishedDocument,
  type PublishFormat,
} from "./publish-model";
import { getSettingsManager } from "./view-helpers";

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
    const cancel = createStratumButton(actions, { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const remove = createStratumButton(actions, {
      text: "Delete document",
      className: "mod-warning",
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
  private controls!: HTMLElement;
  private scope!: HTMLSelectElement;
  private setup!: HTMLButtonElement;
  private status!: HTMLElement;
  private list!: HTMLElement;
  private listContext = "";
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
    this.body.createEl("h3", { text: "Publish note" });
    this.body.createEl("p", {
      cls: "stratum-placeholder",
      text: "Word or PDF documents created from your note",
    });
    const controls = this.body.createDiv({ cls: "stratum-publish-controls" });
    this.controls = controls;
    this.type = createStratumSelect(controls, {
      ariaLabel: "Choose file type to publish",
      value: this.publish.selectedFormat,
      choices: [
        { value: "", label: "Choose file type" },
        { value: "pdf", label: "PDF" },
        { value: "docx", label: "Word" },
      ],
    });
    this.type.addEventListener("change", () => {
      this.publish.selectedFormat = this.type.value as PublishFormat | "";
      this.update();
    });
    this.create = createStratumButton(controls, {
      text: "Create document",
      primary: true,
    });
    this.create.addEventListener("click", () => {
      void this.publish.create();
    });
    this.status = this.body.createDiv({
      cls: "stratum-publish-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.setup = createStratumButton(this.body, { text: "Set up in settings" });
    this.setup.addEventListener("click", () => {
      const settings = getSettingsManager(this.publish.plugin.app);
      settings?.open();
      settings?.openTabById(this.publish.plugin.manifest.id);
    });
    this.cancel = createStratumButton(this.body, { text: "Cancel" });
    this.cancel.addEventListener("click", () => this.publish.cancel());
    const history = this.body.createDiv({ cls: "stratum-publish-history" });
    history.createEl("h4", { text: "Published documents" });
    this.scope = createStratumSelect(history, {
      label: "Show",
      ariaLabel: "Choose which documents to view",
      value: this.publish.historyScope,
      choices: [
        { value: "note", label: "Documents for this note" },
        { value: "all", label: "All published documents" },
      ],
    });
    this.scope.addEventListener("change", () => {
      this.publish.historyScope = this.scope.value === "all" ? "all" : "note";
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
    const hasNote = publish.document?.extension === "md";
    this.controls.hidden = !hasNote;
    const showAll = publish.historyScope === "all";
    this.scope.value = publish.historyScope;
    this.list.hidden = !hasNote && !showAll;
    this.type.value = publish.selectedFormat;
    this.create.setText(
      publish.selectedFormat
        ? `Create ${formatLabel(publish.selectedFormat)} Doc`
        : "Create document",
    );
    this.create.disabled = !publish.canCreate();
    this.type.disabled = publish.busy;
    this.cancel.hidden = !publish.busy && !publish.checking;
    const needsSetup = !publish.readiness?.word || !publish.readiness.pdf;
    this.setup.hidden = !needsSetup || publish.checking || publish.busy;
    this.status.empty();
    const message =
      publish.progress ||
      (publish.checking
        ? "Checking publishing tools…"
        : needsSetup
          ? publish.readiness?.word
            ? "Finish PDF setup in Settings."
            : "Set up publishing in Settings."
          : !publish.document
            ? "Open a Markdown note to publish it."
            : "");
    this.status.hidden = !message && !publish.error;
    if (message) this.status.createEl("p", { text: message });
    if (publish.error)
      this.status.createEl("p", {
        text: publish.errorMessage,
        cls: "stratum-publish-error",
      });
    const listContext = showAll
      ? "all"
      : `note:${publish.document?.path ?? ""}`;
    const scrollTop =
      this.listContext === listContext ? this.list.scrollTop : 0;
    this.listContext = listContext;
    this.list.empty();
    const documents = showAll ? publish.allDocuments : publish.documents;
    if (!documents.length)
      this.list.createEl("p", {
        text: showAll
          ? "No published documents"
          : "No published documents for this note",
        cls: "stratum-publish-meta",
      });
    for (const doc of documents) {
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
      if (doc.format === "pdf")
        this.icon(actions, "eye", "Preview PDF", doc, () => publish.open(doc));
      const sourceAvailable = !!publish.sourceNote(doc);
      this.icon(
        actions,
        "file-text",
        sourceAvailable ? "Open source note" : "Source note unavailable",
        doc,
        () => publish.openSource(doc),
        !sourceAvailable,
      );
      this.icon(actions, "download", "Save as", doc, () =>
        publish.saveCopy(doc),
      );
      this.icon(actions, "trash-2", "Delete", doc, () =>
        new DeletePublicationModal(publish.plugin.app, publish, doc).open(),
      );
    }
    this.list.scrollTop = scrollTop;
  }
  private icon(
    container: HTMLElement,
    icon: string,
    label: string,
    document: PublishedDocument,
    action: () => void | Promise<void>,
    disabled = false,
  ): void {
    const button = container.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": `${label}: ${document.filename}`, title: label },
    });
    setIcon(button, icon);
    button.disabled = disabled;
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
