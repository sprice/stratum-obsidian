import { selectedPublishingTemplate } from "./publish-templates";
import { createStratumSelect, createStratumButton } from "./ui-controls";
import { Component } from "obsidian";
import type { PublishController } from "./publish-controller";
import { PublishingSettingsModal } from "./publication-options-modal";
import {
  PublishedDocumentsPanel,
  type PublishedDocumentsState,
} from "./view-publish-documents";
import { AASTEX_PACKAGE_REFERENCE } from "./publication-package";
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
        text: section === "publish" ? "Create" : "Documents",
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
      text: "PDF documents created for your note",
    });
    this.template = createStratumSelect(this.body, {
      label: "Template",
      ariaLabel: "Choose template",
      value: "",
      choices: [],
    });
    this.template.addEventListener("change", () => {
      this.optionsModal?.close();
      void this.publish
        .updatePreferences({ templateId: this.template.value })
        .catch(() => {});
    });
    this.controls = this.body.createDiv({ cls: "stratum-publish-controls" });
    this.settings = createStratumButton(this.controls, {
      text: "Settings",
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
    if (!this.publish.readiness && !this.publish.checking)
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
    for (const choice of templates.templates)
      this.template.createEl("option", {
        value: choice.id,
        text:
          choice.renderer === "aastex"
            ? `${choice.name} · ${AASTEX_PACKAGE_REFERENCE.upstreamVersion}`
            : choice.name,
      });
    this.template.value = template?.id ?? "";
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
                  ? "Finish or resolve the pending publication edit in Settings or Publication details."
                  : "") ||
                (!publish.readiness?.pdf
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
