import {
  selectedPublishingTemplate,
  publishingTemplateFamilies,
} from "./publish-templates";
import { createStratumSelect, createStratumButton } from "./ui-controls";
import { Component } from "obsidian";
import type { PublishController } from "./publish-controller";
import { PublishingSettingsModal } from "./publication-options-modal";
import {
  PublishedDocumentsPanel,
  type PublishedDocumentsState,
} from "./view-publish-documents";
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
  private optionsModal?: PublishingSettingsModal;
  private controls!: HTMLElement;
  private status!: HTMLElement;
  private create!: HTMLButtonElement;
  private settings!: HTMLButtonElement;
  private cancel!: HTMLButtonElement;
  private template!: HTMLSelectElement;
  private version!: HTMLSelectElement;
  private versionField!: HTMLElement;
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
    const sections: ("publish" | "documents")[] = this.publish.canPublishPdf
      ? ["publish", "documents"]
      : ["publish"];
    for (const section of sections) {
      const tab = createStratumButton(tabBar, {
        text: section === "publish" ? "Create" : "Documents",
      });
      tab.id = `${prefix}-${section}-tab`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `${prefix}-${section}-panel`);
      this.tabs.set(section, tab);
      tab.addEventListener("click", () => this.selectSection(section));
      tab.addEventListener("keydown", (event) => {
        if (!this.publish.canPublishPdf) return;
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
    if (!this.publish.canPublishPdf) this.state.section = "publish";
    this.selectSection(this.state.section);
    this.body.createEl("h3", {
      cls: "stratum-section-heading",
      text: "Publish note",
    });
    this.body.createEl("p", {
      cls: "stratum-placeholder",
      text: "PDF documents created for your note",
    });
    const selectors = this.body.createDiv({
      cls: "stratum-publish-template-selectors",
    });
    this.template = createStratumSelect(selectors, {
      label: "Template",
      ariaLabel: "Choose template",
      value: "",
      choices: [],
    });
    this.template.addEventListener("change", () => {
      this.optionsModal?.close();
      const family = publishingTemplateFamilies(
        this.publish.publishingTemplates,
      ).find((family) => family.id === this.template.value);
      void this.publish
        .updatePreferences({ templateId: family?.choices[0]?.id ?? "" })
        .catch(() => {});
    });
    this.versionField = selectors.createDiv();
    this.version = createStratumSelect(this.versionField, {
      label: "Version",
      ariaLabel: "Choose template version",
      value: "",
      choices: [],
    });
    this.version.addEventListener("change", () => {
      if (this.version.value === this.publish.notePreferences.templateId)
        return;
      this.optionsModal?.close();
      void this.publish
        .updatePreferences({ templateId: this.version.value })
        .catch(() => {});
    });
    this.controls = this.body.createDiv({ cls: "stratum-publish-controls" });
    this.settings = createStratumButton(this.controls, {
      text: "Settings",
      wrap: true,
      tooltip: "Publishing settings for this note",
    });
    this.settings.addEventListener("click", () => {
      this.optionsModal?.close();
      this.optionsModal = new PublishingSettingsModal(
        this.publish.plugin.app,
        this.publish,
        this.settings,
      );
      this.optionsModal.open();
    });
    this.create = createStratumButton(this.controls, {
      text: "Create PDF document",
      primary: true,
      wrap: true,
      className: "stratum-publish-create",
    });
    this.create.addEventListener("click", () => {
      void this.publish.create();
    });
    this.status = this.body.createDiv({
      cls: "stratum-publish-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.cancel = createStratumButton(this.body, { text: "Cancel" });
    this.cancel.addEventListener("click", () => this.publish.cancel());
    this.register(this.publish.subscribe(() => this.update()));
    this.update();
    if (
      this.publish.canPublishPdf &&
      !this.publish.readiness &&
      !this.publish.checking
    )
      void this.publish.check();
  }
  private update(): void {
    const publish = this.publish;
    const hasNote = !!publish.document && publish.document.extension === "md";
    const templates = publish.publishingTemplates;
    const template = selectedPublishingTemplate(
      templates,
      publish.notePreferences.templateId,
    );
    this.template.empty();
    this.template.createEl("option", { value: "", text: "Choose template" });
    const families = publishingTemplateFamilies(templates);
    for (const family of families)
      this.template.createEl("option", { value: family.id, text: family.name });
    const selectedFamily = families.find((family) =>
      family.choices.some((choice) => choice.id === template?.id),
    );
    this.template.value = selectedFamily?.id ?? "";
    this.versionField.hidden = !selectedFamily?.versioned;
    this.version.empty();
    for (const choice of selectedFamily?.choices ?? [])
      this.version.createEl("option", { value: choice.id, text: choice.label });
    this.version.value = template?.id ?? "";
    this.version.disabled =
      !hasNote || publish.busy || publish.preferencesSaving;
    this.template.disabled =
      !hasNote || publish.busy || publish.preferencesSaving;
    this.controls.hidden = !hasNote;
    this.create.hidden = !template;
    this.settings.disabled =
      !template || publish.busy || publish.preferencesSaving;
    this.create.disabled = !publish.canCreate();
    this.cancel.hidden = !publish.busy && !publish.checking;
    this.status.empty();
    const problem = publish.error
      ? publish.fontError
        ? publish.error
        : `${publish.errorMessage}: ${publish.error}`
      : publish.progress ||
        (publish.checking
          ? "Checking publishing tools…"
          : !hasNote
            ? "Open a Markdown note to publish it."
            : !template
              ? "Choose a template before publishing."
              : publish.academicProblem ||
                (publish.document &&
                publish.plugin.publicationEditor?.pending?.(
                  publish.document.path,
                )
                  ? "Finish or resolve the pending publication edit in Settings."
                  : "") ||
                (!publish.canPublishPdf
                  ? "Create PDF documents in desktop Obsidian. Edit this note’s metadata and settings here."
                  : !publish.readiness?.pdf
                    ? "PDF tools need setup. Open Settings for details."
                    : ""));
    this.status.hidden = !problem;
    if (problem)
      this.status.createEl("p", {
        text: problem,
        cls:
          publish.error || publish.academicProblem
            ? "stratum-publish-error"
            : "",
      });
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
    this.shell?.remove();
  }
}
