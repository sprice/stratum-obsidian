import { publicationProperties } from "./publish-properties";
import { selectedPublishingTemplate } from "./publish-templates";
import {
  createStratumIconButton,
  createStratumDisclosure,
  createStratumSummary,
  createStratumSelect,
  createStratumButton,
} from "./ui-controls";
import { Component } from "obsidian";
import type { PublishController } from "./publish-controller";
import { formatLabel, type PublishFormat } from "./publish-model";
import { getSettingsManager } from "./view-helpers";
import { renderPublishCustomization } from "./publish-customize";
import { aastexProblems } from "./publication-package";
import { AASTEX_PACKAGE_REFERENCE } from "./publication-package";
import { AastexOptionsModal } from "./publication-options-modal";
import {
  PublishedDocumentsPanel,
  type PublishedDocumentsState,
} from "./view-publish-documents";
import { AASTEX_HEADING_WARNING } from "./publication-headings";

export interface PublishViewState {
  section: "publish" | "documents";
  documents: PublishedDocumentsState;
}

export class PublishPanel extends Component {
  private body!: HTMLElement;
  private shell!: HTMLElement;
  private documentsContainer!: HTMLElement;
  private documentsPanel!: PublishedDocumentsPanel;
  private tabs = new Map<"publish" | "documents", HTMLButtonElement>();
  private optionsModal?: AastexOptionsModal;
  private controls!: HTMLElement;
  private setup!: HTMLButtonElement;
  private status!: HTMLElement;
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
  private customizeRow!: HTMLElement;
  private resetLayout!: HTMLButtonElement;
  private focusControl?: (key: "bodyFont" | "titleFont" | "opening") => void;
  private titleWarning!: HTMLElement;
  private customization!: HTMLElement;
  private customizationKey = "";
  private alive = true;
  private aastexWarning!: HTMLDetailsElement;
  private aastexWarningList!: HTMLElement;
  private aastexVersion!: HTMLElement;
  private aastexVersionProblem!: HTMLElement;
  private aastexUseVersion!: HTMLButtonElement;
  constructor(
    private container: HTMLElement,
    private publish: PublishController,
    private state: PublishViewState = { section: "publish", documents: {} },
  ) {
    super();
  }
  onload(): void {
    this.shell = this.container.createDiv({ cls: "stratum-publish-shell" });
    const tabBar = this.shell.createDiv({
      cls: "stratum-publish-tabs",
      attr: { role: "tablist", "aria-label": "Publishing" },
    });
    const prefix = `stratum-publish-${crypto.randomUUID()}`;
    for (const section of ["publish", "documents"] as const) {
      const tab = createStratumButton(tabBar, {
        text: section === "publish" ? "Publish" : "Documents",
      });
      tab.id = `${prefix}-${section}-tab`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `${prefix}-${section}-panel`);
      this.tabs.set(section, tab);
      tab.addEventListener("click", () => this.selectSection(section));
      tab.addEventListener("keydown", (event) => {
        let next: "publish" | "documents" | undefined;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight")
          next = section === "publish" ? "documents" : "publish";
        if (event.key === "Home") next = "publish";
        if (event.key === "End") next = "documents";
        if (next) {
          event.preventDefault();
          this.selectSection(next);
          this.tabs.get(next)?.focus();
        }
      });
    }
    this.body = this.shell.createDiv({
      cls: "stratum-publish-panel",
      attr: { role: "tabpanel", "aria-labelledby": `${prefix}-publish-tab` },
    });
    this.body.id = `${prefix}-publish-panel`;
    this.documentsContainer = this.shell.createDiv({
      attr: { role: "tabpanel", "aria-labelledby": `${prefix}-documents-tab` },
    });
    this.documentsContainer.id = `${prefix}-documents-panel`;
    this.documentsPanel = this.addChild(
      new PublishedDocumentsPanel(
        this.documentsContainer,
        this.publish,
        this.state.documents,
      ),
    );
    this.selectSection(this.state.section);
    this.body.createEl("h3", {
      cls: "stratum-section-heading",
      text: "Publish note",
    });
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
      if (this.publish.selectedTemplate?.renderer === "aastex")
        void this.publish.editPublicationDetails();
      else void this.publish.prepareAcademic();
    });
    const gear = createStratumIconButton(templateRow, {
      icon: "settings",
      ariaLabel: "Configure publishing template",
    });
    this.templateGear = gear;
    gear.addEventListener("click", () => {
      if (this.publish.selectedTemplate?.renderer === "aastex") {
        this.optionsModal = new AastexOptionsModal(
          this.publish.plugin.app,
          this.publish,
          gear,
        );
        this.optionsModal.open();
        return;
      }
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
    this.customizeRow = this.body.createDiv({
      cls: "stratum-publish-customize-row",
    });
    this.aastexVersion = this.body.createDiv({ cls: "stratum-publish-meta" });
    this.aastexVersion.setText(
      `AASTeX ${AASTEX_PACKAGE_REFERENCE.upstreamVersion} · Stratum adapter ${AASTEX_PACKAGE_REFERENCE.version}`,
    );
    this.aastexVersionProblem = this.body.createDiv({
      cls: "stratum-publish-meta",
      attr: { role: "status" },
    });
    this.aastexUseVersion = createStratumButton(this.body, {
      text: "Use installed version",
    });
    this.aastexUseVersion.addEventListener("click", () => {
      void this.publish.acceptAastexPackage().catch(() => {});
    });
    this.aastexWarning = createStratumDisclosure(this.body);
    createStratumSummary(this.aastexWarning, {
      text: "Review heading numbers",
    });
    this.aastexWarning.createEl("p", {
      text: AASTEX_HEADING_WARNING,
      attr: { role: "status" },
    });
    this.aastexWarningList = this.aastexWarning.createEl("ul");
    this.customize = createStratumDisclosure(this.customizeRow, {
      cls: "stratum-publish-customization",
    });
    createStratumSummary(this.customize, { text: "Customize…" });
    this.customization = this.customize.createDiv();
    this.customize.addEventListener("toggle", () => this.updateCustomization());
    this.resetLayout = createStratumButton(this.customizeRow, {
      text: "Reset defaults",
      tooltip: "Restore template settings",
      className: "stratum-publish-reset",
    });
    this.resetLayout.addEventListener("click", () => {
      // Re-selecting the template copies its current layout into this note.
      const templateId = this.publish.notePreferences.templateId;
      if (templateId)
        void this.publish.updatePreferences({ templateId }).catch(() => {});
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
    const templates = publish.publishingTemplates;
    const template = selectedPublishingTemplate(
      templates,
      preferences.templateId,
    );
    const aastex = template?.renderer === "aastex";
    const aastexPdf = aastex && publish.selectedFormat === "pdf";
    this.aastexVersion.hidden = !aastex;
    this.aastexVersionProblem.hidden =
      !aastexPdf || !publish.aastexPackageProblem;
    this.aastexVersionProblem.setText(publish.aastexPackageProblem || "");
    this.aastexUseVersion.hidden = this.aastexVersionProblem.hidden;
    this.aastexUseVersion.disabled = publish.busy || publish.preferencesSaving;
    const headingIssues = aastexPdf
      ? (publish.aastexHeadingProblems ?? [])
      : [];
    this.aastexWarning.hidden = !headingIssues.length;
    this.aastexWarningList.empty();
    for (const issue of headingIssues.slice(0, 20))
      this.aastexWarningList.createEl("li", { text: issue });
    if (headingIssues.length > 20)
      this.aastexWarningList.createEl("li", {
        text: `${headingIssues.length - 20} more heading issues.`,
      });
    const definitions = publicationProperties(
      publish.layout,
      template?.prefill,
    );
    const academic = !!definitions.some((field) => field.use === "title");
    this.academic.hidden = !template || (!aastex && !definitions.length);
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
    this.prepare.hidden = !aastex && !publish.propertiesMissing;
    this.prepare.setText(
      aastex ? "Edit publication details" : "Add publishing properties",
    );
    this.prepare.setAttribute(
      "aria-label",
      aastex
        ? "Edit publication details"
        : "Add missing publishing properties to this note",
    );
    this.prepare.disabled = publish.busy || publish.preferencesSaving;
    this.opening.value = publish.layout.titleSource;
    this.opening.hidden = !aastex && (!academic || !title);
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
    let packagedMessage = "";
    if (aastex) {
      packagedMessage =
        publish.selectedFormat === "pdf"
          ? "AASTeX controls PDF typography and bibliography. Cited PDFs download a verified bibliography style directly from AAS for each export; the temporary file is removed afterward."
          : "Word output is an editable review manuscript. AASTeX typography applies to PDF.";
      try {
        const view = publish.leaf?.view;
        const text =
          view && "editor" in view
            ? (view as import("obsidian").MarkdownView).editor.getValue()
            : "";
        const warnings = aastexProblems(
          text,
          publish.layout.titleSource,
          publish.selectedFormat || "docx",
        ).warnings;
        packagedMessage += " " + warnings.join(" ");
      } catch {
        /* The blocking problem is displayed above. */
      }
    }
    this.academicMessage.setText(
      aastex
        ? [publish.academicProblem, packagedMessage].filter(Boolean).join(" ")
        : academicMessage,
    );
    this.academicMessage.hidden = !academicMessage;
    this.templateGear.disabled =
      !template || publish.busy || publish.preferencesSaving;
    this.templateGear.hidden = !template;
    this.templateGear.setAttribute(
      "aria-label",
      aastex ? "Document options for this note" : "Configure template defaults",
    );
    this.templateGear.setAttribute(
      "title",
      aastex
        ? "Document options for this note"
        : "Configure reusable template defaults",
    );
    this.template.empty();
    this.template.createEl("option", { value: "", text: "Choose template" });
    for (const choice of templates.templates)
      this.template.createEl("option", {
        value: choice.id,
        text:
          choice.renderer === "aastex"
            ? `${choice.name} · ${AASTEX_PACKAGE_REFERENCE.upstreamVersion}`
            : choice.name,
      });
    this.template.value = template?.id ?? "";
    this.template.disabled = publish.busy || publish.preferencesSaving;
    const prepared = !!template;
    this.controls.hidden = !hasNote;
    this.type.hidden = !prepared;
    this.create.hidden = !prepared;
    this.customize.hidden = !hasNote || !prepared || !publish.selectedFormat;
    if (aastex && publish.selectedFormat === "pdf")
      this.customize.hidden = true;
    // Hide the row too, so an empty row does not add a gap to the panel.
    this.customizeRow.hidden = this.resetLayout.hidden = this.customize.hidden;
    this.resetLayout.disabled = publish.busy || publish.preferencesSaving;
    this.updateCustomization();
    void this.updateCitationStyle();
    this.citations.hidden = !!aastex && publish.selectedFormat === "pdf";
    this.type.value = publish.selectedFormat;
    this.create.setText(
      aastex && publish.selectedFormat === "docx"
        ? "Create Word review manuscript"
        : publish.selectedFormat
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
  private selectSection(section: "publish" | "documents"): void {
    this.state.section = section;
    this.body.hidden = section !== "publish";
    this.documentsPanel.setVisible(section === "documents");
    for (const [key, tab] of this.tabs) {
      tab.setAttribute("aria-selected", String(key === section));
      tab.tabIndex = key === section ? 0 : -1;
    }
  }
  onunload(): void {
    this.optionsModal?.close();
    this.alive = false;
    this.citationRevision++;
    this.shell?.remove();
  }
}
