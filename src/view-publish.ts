import { publicationProperties } from "./publish-properties";
import {
  readPublishingTemplates,
  selectedPublishingTemplate,
} from "./publish-templates";
import {
  createStratumIconButton,
  createStratumDisclosure,
  createStratumSummary,
  createStratumSelect,
  createStratumButton,
} from "./ui-controls";
import { Component, Modal, type App } from "obsidian";
import type { PublishController } from "./publish-controller";
import {
  formatLabel,
  type PublishedDocument,
  type PublishFormat,
} from "./publish-model";
import { getSettingsManager } from "./view-helpers";
import { renderPublishCustomization } from "./publish-customize";

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
  private configuration!: HTMLElement;
  private template!: HTMLSelectElement;
  private templateGear!: HTMLButtonElement;
  private academic!: HTMLElement;
  private prepare!: HTMLButtonElement;
  private academicMessage!: HTMLElement;
  private opening!: HTMLSelectElement;
  private citations!: HTMLElement;
  private citationRevision = 0;
  private citationKey = "";
  private customize!: HTMLDetailsElement;
  private focusControl?: (key: "bodyFont" | "titleFont" | "opening") => void;
  private titleWarning!: HTMLElement;
  private customization!: HTMLElement;
  private customizationKey = "";
  private alive = true;
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
    this.configuration = this.body.createDiv({
      cls: "stratum-publish-configuration",
    });
    const templateRow = this.configuration.createDiv({
      cls: "stratum-publish-template-row",
    });
    this.template = createStratumSelect(templateRow, {
      label: "Template",
      ariaLabel: "Choose template",
      value: "",
      choices: [],
    });
    this.template.addEventListener("change", () => {
      void this.publish
        .updatePreferences({ templateId: this.template.value })
        .catch(() => {});
    });

    this.academic = this.configuration.createDiv({
      cls: "stratum-publish-academic",
    });
    const preparation = this.academic.createDiv({
      cls: "stratum-publish-actions",
    });
    this.prepare = createStratumButton(preparation, {
      text: "Add publishing properties",
      tooltip: "Add missing publishing properties to this note",
    });
    this.prepare.addEventListener("click", () => {
      void this.publish.prepareAcademic();
    });
    const gear = createStratumIconButton(templateRow, {
      icon: "settings",
      ariaLabel: "Configure publishing template",
    });
    this.templateGear = gear;
    gear.addEventListener("click", () => {
      const settings = getSettingsManager(this.publish.plugin.app);
      settings?.open();
      settings?.openTabById(this.publish.plugin.manifest.id);
      this.publish.plugin.settingTab?.focusAcademicDefaults();
    });
    this.academicMessage = this.academic.createEl("p", {
      cls: "stratum-publish-meta",
      attr: { role: "status" },
    });
    this.titleWarning = this.academic.createDiv({
      cls: "stratum-publish-actions",
      attr: { role: "status" },
    });
    this.titleWarning.createEl("p", {
      text: "Title may appear twice.",
      cls: "stratum-publish-meta",
    });
    const review = createStratumButton(this.titleWarning, {
      text: "Review opening",
      tooltip: "Show the title and opening choices",
    });
    review.addEventListener("click", () => this.reviewOpening());
    this.opening = createStratumSelect(this.academic, {
      label: "Title block",
      ariaLabel: "Academic title block",
      value: this.publish.notePreferences.opening,
      choices: [
        { value: "properties", label: "Generate from properties" },
        { value: "body", label: "Use title from body" },
      ],
    });
    this.opening.addEventListener("change", () => {
      void this.publish
        .updateLayout({
          titleSource: this.opening.value as "properties" | "body",
        })
        .catch(() => {});
    });
    this.citations = this.configuration.createDiv({
      cls: "stratum-publish-citations",
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
      void this.publish
        .selectFormat(this.type.value as PublishFormat | "")
        .catch(() => {});
      this.update();
    });
    this.create = createStratumButton(controls, {
      text: "Create document",
      primary: true,
    });
    this.create.addEventListener("click", () => {
      void this.publish.create();
    });
    this.customize = createStratumDisclosure(this.body, {
      cls: "stratum-publish-customization",
    });
    createStratumSummary(this.customize, { text: "Customize…" });
    this.customization = this.customize.createDiv();
    this.customize.addEventListener("toggle", () => this.updateCustomization());
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
    this.configuration.hidden = !hasNote;
    const preferences = publish.notePreferences;
    const templates = readPublishingTemplates(
      publish.plugin.settings?.publishingTemplates,
    );
    const template = selectedPublishingTemplate(
      templates,
      preferences.templateId,
    );
    const definitions = publicationProperties(
      publish.layout,
      template?.prefill,
    );
    const academic = !!definitions.some((field) => field.use === "title");
    this.academic.hidden = !template || !definitions.length;
    let title = "",
      duplicateTitle = false,
      bothAuthors = false;
    if (academic) {
      try {
        ({ title, duplicateTitle, bothAuthors } = publish.academicInfo);
      } catch {
        /* The actionable problem is displayed below. */
      }
    }
    this.prepare.hidden = !publish.propertiesMissing;
    this.prepare.disabled = publish.busy || publish.preferencesSaving;
    this.opening.value = publish.layout.titleSource;
    this.opening.hidden = !academic || !title;
    this.opening.disabled = publish.busy || publish.preferencesSaving;
    this.titleWarning.hidden = !publish.duplicateTitleWarning;
    const academicMessage =
      publish.academicProblem ||
      (!academic
        ? "Only properties with a published use appear in the document."
        : publish.layout.titleSource === "body"
          ? "The body supplies the opening. No title block will be generated."
          : "The title block comes from the template’s mapped properties. Begin the body with an optional Abstract section or your introduction.") +
        (bothAuthors
          ? " Both author and authors exist; authors takes precedence."
          : "") +
        (duplicateTitle && publish.layout.titleSource === "body"
          ? " The existing body title is retained."
          : "");
    this.academicMessage.setText(academicMessage);
    this.academicMessage.hidden = !academicMessage;
    this.templateGear.disabled =
      !template || publish.busy || publish.preferencesSaving;
    this.template.empty();
    this.template.createEl("option", { value: "", text: "Choose template" });
    for (const choice of templates.templates)
      this.template.createEl("option", { value: choice.id, text: choice.name });
    this.template.value = template?.id ?? "";
    this.template.disabled = publish.busy || publish.preferencesSaving;
    const prepared = !!template;
    this.controls.hidden = !hasNote;
    this.type.hidden = !prepared;
    this.create.hidden = !prepared;
    this.customize.hidden = !hasNote || !prepared || !publish.selectedFormat;
    this.updateCustomization();
    void this.updateCitationStyle();
    const showAll = publish.historyScope === "all";
    this.scope.value = publish.historyScope;
    this.list.hidden = !hasNote && !showAll;
    this.type.value = publish.selectedFormat;
    this.create.setText(
      publish.selectedFormat
        ? `Create ${formatLabel(publish.selectedFormat)} document`
        : "Create document",
    );
    this.create.disabled = !publish.canCreate();
    this.type.disabled = publish.busy || publish.preferencesSaving;
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
        text: publish.fontError
          ? publish.error
          : `${publish.errorMessage}: ${publish.error}`,
        cls: "stratum-publish-error",
      });
    if (publish.fontError && !this.customize.hidden) {
      const choose = createStratumButton(this.status, { text: "Choose font" });
      choose.disabled = publish.busy || publish.preferencesSaving;
      choose.addEventListener("click", () => {
        this.customize.open = true;
        this.updateCustomization();
        const bodyMissing = publish.fontError?.fonts.some(
          (font) =>
            font.toLowerCase() === publish.layout.bodyFont.toLowerCase(),
        );
        this.focusControl?.(bodyMissing ? "bodyFont" : "titleFont");
      });
    }
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
  /** Repeated titles are allowed; this shows where to change the opening. */
  private reviewOpening(): void {
    if (!this.customize.hidden) {
      this.customize.open = true;
      this.updateCustomization();
      this.focusControl?.("opening");
      return;
    }
    this.opening.scrollIntoView({ block: "center" });
    this.opening.focus();
  }
  private updateCustomization(): void {
    if (!this.customize?.open || this.customize.hidden) return;
    const key = JSON.stringify({
      path: this.publish.document?.path,
      format: this.publish.selectedFormat,
      layout: this.publish.layout,
    });
    if (key !== this.customizationKey) {
      this.customizationKey = key;
      this.customization.empty();
      this.focusControl = renderPublishCustomization(
        this.customization,
        this.publish.layout,
        (patch) => this.publish.updateLayout(patch),
        (error) => this.publish.fail(error),
        this.publish.selectedFormat || undefined,
      );
    }
    for (const input of Array.from(
      this.customization.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLButtonElement
      >("input, select, button"),
    ))
      input.disabled = this.publish.busy || this.publish.preferencesSaving;
  }
  private async updateCitationStyle(): Promise<void> {
    const revision = ++this.citationRevision;
    if (!this.publish.document || this.publish.busy) return;
    try {
      const choices = await this.publish.citationStyleChoices();
      if (!this.alive || revision !== this.citationRevision) return;
      const key = JSON.stringify(choices);
      if (key === this.citationKey) return;
      this.citationKey = key;
      this.citations.empty();
      if (!choices) return;
      const select = createStratumSelect(this.citations, {
        label: "Citation style",
        ariaLabel: "Citation style for this note",
        value: choices.selected,
        choices: choices.options.map((option) => ({
          value: option.id,
          label: option.title,
        })),
      });
      select.addEventListener("change", () => {
        select.disabled = true;
        void this.publish
          .changeCitationStyle(select.value)
          .catch((error) => this.publish.fail(error))
          .finally(() => {
            select.disabled = false;
            this.citationKey = "";
            void this.updateCitationStyle();
          });
      });
    } catch {
      if (this.alive && revision === this.citationRevision) {
        // Rebuild the selector once the note's properties can be read again.
        this.citationKey = "";
        this.citations.setText(
          "Citation style could not be read. Check the note's properties.",
        );
      }
    }
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
  onunload(): void {
    this.alive = false;
    this.citationRevision++;
    this.body?.remove();
  }
}
