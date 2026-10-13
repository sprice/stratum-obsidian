import { Component } from "obsidian";
import { createStratumSelect, createStratumIconButton } from "./ui-controls";
import { ConfirmModal } from "./ui-modal";
import type { PublishController } from "./publish-controller";
import type { PublishedDocument } from "./publish-model";
export interface PublishedDocumentsState {
  scope?: "note" | "all";
  context?: string;
  scroll?: number;
}
export class PublishedDocumentsPanel extends Component {
  private body!: HTMLElement;
  private scope!: HTMLSelectElement;
  private list!: HTMLElement;
  private rendered = false;
  private listSignature?: string;
  constructor(
    private container: HTMLElement,
    private publish: PublishController,
    private state: PublishedDocumentsState = {},
  ) {
    super();
  }
  onload(): void {
    this.body = this.container.createDiv({ cls: "stratum-publish-documents" });
    const history = this.body.createDiv({ cls: "stratum-publish-history" });
    history.createEl("h4", {
      cls: "stratum-subheading",
      text: "Published documents",
    });
    this.scope = createStratumSelect(history, {
      label: "Show",
      ariaLabel: "Choose which documents to view",
      value: this.state.scope ?? this.publish.historyScope,
      choices: [
        { value: "note", label: "PDF documents for this note" },
        { value: "all", label: "All published PDF documents" },
      ],
    });
    this.scope.addEventListener("change", () => {
      this.state.scope = this.scope.value === "all" ? "all" : "note";
      this.publish.historyScope = this.state.scope;
      this.update();
    });
    this.list = this.body.createDiv({ cls: "stratum-publish-list" });
    this.list.addEventListener("scroll", () => {
      if (!this.container.hidden) this.state.scroll = this.list.scrollTop;
    });
    this.register(this.publish.subscribe(() => this.update()));
    this.update();
  }
  private update(): void {
    const publish = this.publish;
    const showAll = (this.state.scope ?? publish.historyScope) === "all";
    this.scope.value = showAll ? "all" : "note";
    this.list.hidden = publish.document?.extension !== "md" && !showAll;
    const listContext = showAll
      ? "all"
      : `note:${publish.document?.path ?? ""}`;
    const documents = (showAll ? publish.allDocuments : publish.documents).map(
      (doc) => ({ doc, sourceAvailable: !!publish.sourceNote(doc) }),
    );
    // Rebuilding unchanged rows would reset scrolling and in-progress actions.
    const listSignature = JSON.stringify([
      listContext,
      documents.map(({ doc, sourceAvailable }) => [
        doc.id,
        doc.filename,
        doc.createdAt,
        sourceAvailable,
      ]),
    ]);
    if (listSignature === this.listSignature) return;
    this.listSignature = listSignature;
    const visible = !this.container.hidden;
    const scrollTop =
      this.state.context === listContext
        ? this.rendered && visible
          ? this.list.scrollTop
          : (this.state.scroll ?? 0)
        : 0;
    this.state.context = listContext;
    this.list.empty();
    if (!documents.length)
      this.list.createEl("p", {
        text: showAll
          ? "No published PDF documents"
          : "No published PDF documents for this note",
        cls: "stratum-publish-meta",
      });
    for (const { doc, sourceAvailable } of documents) {
      const row = this.list.createDiv({ cls: "stratum-publish-row" });
      const details = row.createDiv({ cls: "stratum-publish-document" });
      details.createDiv({
        text: doc.filename,
        cls: "stratum-publish-filename",
      });
      details.createDiv({
        text: `PDF · ${new Date(doc.createdAt).toLocaleString()}`,
        cls: "stratum-publish-meta",
      });
      const actions = row.createDiv({ cls: "stratum-publish-row-actions" });
      this.icon(actions, "eye", "Preview PDF", doc, () => publish.open(doc));
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
        new ConfirmModal(publish.plugin.app, {
          title: "Delete published document?",
          message: [
            doc.filename,
            "This removes the stored document. Your source note and copies saved elsewhere are kept.",
          ],
          confirmLabel: "Delete document",
          warning: true,
          confirm: () => publish.remove(doc),
          onError: (error) => publish.fail(error),
        }).open(),
      );
    }
    this.state.scroll = scrollTop;
    if (visible) this.list.scrollTop = scrollTop;
    this.rendered = true;
  }
  private icon(
    container: HTMLElement,
    icon: string,
    label: string,
    document: PublishedDocument,
    action: () => void | Promise<void>,
    disabled = false,
  ): void {
    const button = createStratumIconButton(container, {
      icon,
      ariaLabel: `${label}: ${document.filename}`,
      tooltip: label,
    });
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
  setVisible(visible: boolean): void {
    if (!this.container.hidden) this.state.scroll = this.list.scrollTop;
    this.container.hidden = !visible;
    if (visible) this.list.scrollTop = this.state.scroll ?? 0;
  }
  onunload(): void {
    if (!this.container.hidden) this.state.scroll = this.list?.scrollTop ?? 0;
    this.body?.remove();
  }
}
