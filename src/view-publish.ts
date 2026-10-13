import {
  selectedPublishingTemplate,
  publishingTemplateFamilies,
} from "./publish-templates";
import {
  createStratumSelect,
  createStratumButton,
  createStratumTabs,
  type StratumTabs,
} from "./ui-controls";
import { Component, setIcon } from "obsidian";
import type { PublishController } from "./publish-controller";
import {
  PublishedDocumentsPanel,
  type PublishedDocumentsState,
} from "./view-publish-documents";
const settingsNotice = (message: string): string =>
  `Settings: ${message.replace(/[.!]$/, "")}`;

export interface PublishViewState {
  section: "publish" | "documents";
  documents: PublishedDocumentsState;
  lastPublishedId?: string;
  pendingPublishedId?: string;
}
export class PublishPanel extends Component {
  private body!: HTMLElement;
  private successIcon!: HTMLElement;
  private successAnnouncement!: HTMLElement;
  private shell!: HTMLElement;
  private documentsContainer!: HTMLElement;
  private documentsPanel!: PublishedDocumentsPanel;
  private tabs!: StratumTabs<"publish" | "documents">;
  private controls!: HTMLElement;
  private status!: HTMLElement;
  private statusMessage!: HTMLElement;
  private chooseFont!: HTMLButtonElement;
  private create!: HTMLButtonElement;
  private settings!: HTMLButtonElement;
  private cancel!: HTMLButtonElement;
  private template!: HTMLSelectElement;
  private version!: HTMLSelectElement;
  private versionField!: HTMLElement;
  private templateOptions?: string;
  private versionOptions?: string;
  constructor(
    private container: HTMLElement,
    private publish: PublishController,
    private state: PublishViewState = { section: "publish", documents: {} },
  ) {
    super();
  }
  onload(): void {
    this.state.lastPublishedId ??= this.publish.lastPublishedId;
    this.shell = this.container.createDiv({ cls: "stratum-publish-shell" });
    this.tabs = createStratumTabs(this.shell, {
      idPrefix: `stratum-publish-${crypto.randomUUID()}`,
      label: "Publishing",
      tabs: [
        { id: "publish", label: "Create" },
        {
          id: "documents",
          label: "Documents",
          className: "stratum-publish-documents-tab",
        },
      ],
      selected: this.state.section,
      onSelect: (section) => this.selectSection(section),
    });
    this.successIcon = this.tabs.tab("documents")!.createSpan({
      cls: "stratum-publish-success-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(this.successIcon, "file-text");
    this.successIcon.hidden = !this.state.pendingPublishedId;
    this.successAnnouncement = this.shell.createDiv({
      cls: "stratum-sr-only",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.body = this.shell.createDiv({
      cls: "stratum-publish-panel",
      attr: {
        role: "tabpanel",
        "aria-labelledby": this.tabs.tabId("publish"),
      },
    });
    this.body.id = this.tabs.panelId("publish");
    this.documentsContainer = this.shell.createDiv({
      attr: {
        role: "tabpanel",
        "aria-labelledby": this.tabs.tabId("documents"),
      },
    });
    this.documentsContainer.id = this.tabs.panelId("documents");
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
      this.publish.closeSettings();
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
      this.publish.closeSettings();
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
      void this.publish.openSettings(this.settings);
    });
    // Sidebar re-renders recreate this panel; an open window stays with the
    // controller and returns focus to the new Settings button.
    this.publish.adoptSettingsLauncher(this.settings);
    this.create = createStratumButton(this.controls, {
      text: "Create PDF document",
      primary: true,
      wrap: true,
      className: "stratum-publish-create",
    });
    this.create.addEventListener("click", () => {
      void this.publish.create();
    });
    this.status = this.body.createDiv({ cls: "stratum-publish-status" });
    this.statusMessage = this.status.createDiv({
      attr: { role: "status", "aria-live": "polite" },
    });
    // The settings window opens Advanced layout and focuses the missing font.
    // Return to Choose font while the error remains, or Settings after repair.
    this.chooseFont = createStratumButton(this.status, { text: "Choose font" });
    this.chooseFont.hidden = true;
    this.chooseFont.addEventListener("click", () => {
      void this.publish.openSettings(this.chooseFont);
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
    if (
      publish.lastPublishedId &&
      publish.lastPublishedId !== this.state.lastPublishedId
    ) {
      this.state.lastPublishedId = publish.lastPublishedId;
      if (this.state.section === "publish") {
        this.state.pendingPublishedId = publish.lastPublishedId;
        this.successIcon.hidden = false;
        this.successIcon
          .getAnimations()
          .forEach((animation) => animation.cancel());
        if (
          !this.container.win.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
        )
          this.successIcon.animate(
            [
              { opacity: 0, transform: "translateY(4px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 180 },
          );
        this.successAnnouncement.setText(
          "PDF created. Available in documents.",
        );
      }
    }
    const hasNote = !!publish.document && publish.document.extension === "md";
    const templates = publish.publishingTemplates;
    const template = selectedPublishingTemplate(
      templates,
      publish.notePreferences.templateId,
    );
    const families = publishingTemplateFamilies(templates);
    // Rebuilding options on every update would reset an open dropdown.
    const templateOptions = JSON.stringify(
      families.map((family) => [family.id, family.name]),
    );
    if (templateOptions !== this.templateOptions) {
      this.templateOptions = templateOptions;
      this.template.empty();
      this.template.createEl("option", { value: "", text: "Choose template" });
      for (const family of families)
        this.template.createEl("option", {
          value: family.id,
          text: family.name,
        });
    }
    const selectedFamily = families.find((family) =>
      family.choices.some((choice) => choice.id === template?.id),
    );
    this.template.value = selectedFamily?.id ?? "";
    this.versionField.hidden = !selectedFamily?.versioned;
    const choices = selectedFamily?.choices ?? [];
    const versionOptions = JSON.stringify(
      choices.map((choice) => [choice.id, choice.label]),
    );
    if (versionOptions !== this.versionOptions) {
      this.versionOptions = versionOptions;
      this.version.empty();
      for (const choice of choices)
        this.version.createEl("option", {
          value: choice.id,
          text: choice.label,
        });
    }
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
    const fontResolved = !this.chooseFont.hidden && !publish.fontError;
    this.chooseFont.hidden = !publish.fontError;
    if (fontResolved) this.publish.adoptSettingsLauncher(this.settings);
    this.chooseFont.disabled = this.settings.disabled;
    this.statusMessage.empty();
    const notices = publish.readinessNotices;
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
              : (notices?.length
                  ? notices
                      .map((notice) =>
                        notice.settings
                          ? settingsNotice(notice.text)
                          : notice.text,
                      )
                      .join("\n")
                  : publish.academicProblem) ||
                (publish.document &&
                publish.plugin.publicationEditor?.pending?.(
                  publish.document.path,
                )
                  ? settingsNotice(
                      "Finish or resolve the pending publication edit",
                    )
                  : "") ||
                (!publish.readiness?.pdf
                  ? settingsNotice("Review PDF tool setup")
                  : ""));
    this.status.hidden = !problem;
    if (problem)
      this.statusMessage.createEl("p", {
        text: problem,
        cls: publish.error
          ? "stratum-publish-error"
          : publish.progress || publish.checking
            ? ""
            : "stratum-publish-notice",
      });
  }
  private acknowledgePublication(): void {
    this.state.pendingPublishedId = undefined;
    this.successIcon.hidden = true;
    this.successAnnouncement?.setText("");
  }
  private selectSection(section: "publish" | "documents"): void {
    this.state.section = section;
    if (section === "documents") this.acknowledgePublication();
    this.body.hidden = section !== "publish";
    this.documentsPanel.setVisible(section === "documents");
    this.tabs.select(section);
  }
  onunload(): void {
    this.shell?.remove();
  }
}
