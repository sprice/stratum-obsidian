import { installedPublishingTemplate } from "./publication-installed-templates";
import { pluginStorageDirectory } from "./plugin-storage-paths";
import {
  journalProfile,
  journalProperties,
  journalProblems,
  journalReference,
} from "./journal-profiles";
import {
  addPublishingProperties,
  mappedPublishingProperties,
  publishingPropertyProblem,
  publicationProperties,
  type PublishingIssue,
} from "./publish-properties";
import {
  readPublishingTemplates,
  publishingTemplateEnabled,
  selectedPublishingTemplate,
  type PublishingTemplate,
} from "./publish-templates";
import {
  Component,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Platform,
  TFile,
  WorkspaceWindow,
  type WorkspaceLeaf,
} from "obsidian";
import type StratumPlugin from "./plugin";
import { PublishStore } from "./publish-store";
import {
  VIEW_TYPE_PUBLISH_PREVIEW,
  type PublishCatalog,
  type PublishedDocument,
  type PublishFormat,
} from "./publish-model";
import {
  checkPublishing,
  convertPublication,
  detectPublishTool,
  probePublication,
  PublishFontError,
  savePublishedCopy,
  type PublishReadiness,
} from "./publish-desktop";
import { renderPublication } from "./publish-render";
import { readPublishReadinessCache } from "./publish-readiness";
import {
  readPublishOptions,
  readNotePreferences,
  type NotePublishPreferences,
  type PublishOptions,
} from "./publish-options";
import { publicationFrontmatter, academicMetadata } from "./publish-academic";
import {
  aastexProblems,
  aastexPackage,
  AASTEX_PACKAGE_REFERENCE,
} from "./publication-package";
import {
  readAastexPdfOptions,
  samePublicationPackage,
  type AastexPdfOptions,
} from "./publication-options";
import { AASTEX_HEADING_WARNING } from "./publication-headings";
import { aastexHeadingIssues } from "./publication-heading-preview";
import type { renderAastexPublication } from "./publication-render";

type Checked<T> = { value: T } | { error: unknown };
interface NoteChecks {
  journal: Checked<ReturnType<typeof journalProblems>>;
  aastex: Checked<ReturnType<typeof aastexProblems>>;
  properties: Checked<PublishingIssue | undefined>;
  readinessNotices: { text: string; settings: boolean }[];
  academicProblem: string;
  publishingIssues: PublishingIssue[];
  aastexHeadingProblems: string[];
  duplicateTitleWarning: boolean;
}
const sameInputs = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);
function checked<T>(compute: () => T): Checked<T> {
  try {
    return { value: compute() };
  } catch (error) {
    return { error };
  }
}

export const PUBLISH_EDITOR_CHANGE_DELAY = 250;

export class PublishController extends Component {
  document: TFile | null = null;
  leaf: WorkspaceLeaf | null = null;
  catalog: PublishCatalog | null = null;
  readiness: PublishReadiness | null = null;
  busy = false;
  checking = false;
  progress = "";
  lastPublishedId?: string;
  error = "";
  errorMessage = "";
  fontError: PublishFontError | null = null;
  private exportedHeadingIssues?: {
    source: string;
    titleSource: "body" | "properties";
    enabled: boolean;
    issues: string[];
  };
  historyScope: "note" | "all" = "note";
  readonly store: PublishStore;
  private listeners = new Set<() => void>();
  private settingsModal?: import("./publication-options-modal").PublishingSettingsModal;
  private settingsRequest = 0;
  private settingsLauncher?: HTMLElement;
  private aborter: AbortController | null = null;
  private loaded = false;
  private alive = true;
  private loadRevision = 0;
  private supportRevision = 0;
  private background: AbortController | null = null;
  private preferenceQueue: Promise<void> = Promise.resolve();
  private preferencePending = 0;
  private preparing = false;
  private selectionKey = "";
  private sourceLeaf: WorkspaceLeaf | null = null;
  private openingLeaf: WorkspaceLeaf | null = null;
  private sourceRevision = 0;
  private sourceText = "";
  private sourceTimer: number | null = null;
  private preferenceCache?: {
    inputs: unknown[];
    preferences: NotePublishPreferences;
    template: PublishingTemplate | undefined;
  };
  private checkCache?: { inputs: unknown[]; checks: Partial<NoteChecks> };
  preferencesSaving = false;
  constructor(readonly plugin: StratumPlugin) {
    super();
    this.store = new PublishStore(
      plugin.app.vault.adapter,
      pluginStorageDirectory(plugin.app),
    );
    const settings = plugin.settings;
    const cache = readPublishReadinessCache(settings.publishReadinessCache);
    if (
      cache &&
      cache.pandocPath === settings.pandocPath &&
      cache.tectonicPath === settings.tectonicPath
    )
      this.readiness = cache.readiness;
    else if (!cache && settings.publishPdfSetupComplete)
      // Migrate the previous successful PDF setup without another typesetting run.
      this.readiness = {
        pdf: true,
        pandoc: { path: settings.pandocPath || "pandoc", version: "" },
        tectonic: { path: settings.tectonicPath || "tectonic", version: "" },
      };
  }
  onload(): void {
    this.registerEvent(
      this.plugin.app.workspace.on("active-leaf-change", (leaf) =>
        this.follow(leaf),
      ),
    );
    this.registerEvent(
      this.plugin.app.workspace.on("file-open", () => this.followRecent()),
    );
    this.registerEvent(
      this.plugin.app.workspace.on("layout-change", () => {
        if (this.openingLeaf) return;
        // A tab still opening the selected note counts as showing it.
        let selectedIsOpen = false;
        this.eachDocumentLeaf((leaf) => {
          if (leaf === this.leaf || leaf === this.openingLeaf)
            selectedIsOpen = true;
        });
        if (!selectedIsOpen) {
          this.document = null;
          this.leaf = null;
          this.followRecent();
          this.emit();
        }
      }),
    );
    this.registerEvent(
      this.plugin.app.vault.on("rename", (file, oldPath) => {
        void this.store
          .move(oldPath, file.path)
          .then(() => this.reload())
          .catch((error) => this.fail(error));
      }),
    );
    this.registerEvent(
      this.plugin.app.vault.on("delete", (file) => {
        if (
          this.document?.path === file.path ||
          this.document?.path.startsWith(`${file.path}/`)
        ) {
          this.document = null;
          this.leaf = null;
        }
        void this.store
          .move(file.path, null)
          .then(() => this.reload())
          .catch((error) => this.fail(error));
      }),
    );
    this.followRecent();
    if (this.plugin.app.metadataCache?.on)
      this.registerEvent(
        this.plugin.app.metadataCache.on("changed", (file) => {
          if (file === this.document) {
            this.syncSelection(true);
            this.emit();
          }
        }),
      );
    this.registerEvent(
      this.plugin.app.workspace.on("editor-change", () => {
        if (this.sourceTimer !== null) window.clearTimeout(this.sourceTimer);
        this.sourceTimer = window.setTimeout(() => {
          this.sourceTimer = null;
          this.emit();
        }, PUBLISH_EDITOR_CHANGE_DELAY);
      }),
    );
    if (this.readiness) void this.validateCachedSupport();
  }
  onunload(): void {
    this.closeSettings();
    this.alive = false;
    this.clearError();
    this.aborter?.abort();
    this.background?.abort();
    if (this.sourceTimer !== null) window.clearTimeout(this.sourceTimer);
    this.listeners.clear();
  }
  /** Main tabs and pop-outs can publish; sidebar focus keeps the current note. */
  private eachDocumentLeaf(callback: (leaf: WorkspaceLeaf) => void): void {
    const workspace = this.plugin.app.workspace;
    workspace.iterateRootLeaves(callback);
    workspace.iterateAllLeaves((leaf) => {
      if (leaf.getContainer() instanceof WorkspaceWindow) callback(leaf);
    });
  }
  private followRecent(): void {
    this.follow(
      this.plugin.app.workspace.getMostRecentLeaf(
        this.plugin.app.workspace.rootSplit,
      ),
    );
  }
  private follow(leaf: WorkspaceLeaf | null): void {
    let root = false;
    this.eachDocumentLeaf((candidate) => {
      if (candidate === leaf) root = true;
    });
    if (!root) return;
    // A tab opened for editing can become active before its note loads. Keep
    // the current note, and its settings window, until the tab shows it.
    if (
      leaf &&
      leaf === this.openingLeaf &&
      !(leaf.view instanceof MarkdownView && leaf.view.file === this.document)
    )
      return;
    if (leaf?.view.getViewType?.() === VIEW_TYPE_PUBLISH_PREVIEW) {
      const document = this.catalog?.documents.find(
        (entry) => entry.id === leaf.view.getState().documentId,
      );
      const note = this.catalog?.notes.find(
        (entry) => entry.id === document?.noteId,
      );
      const file = note?.path
        ? this.plugin.app.vault.getAbstractFileByPath(note.path)
        : null;
      this.document =
        file instanceof TFile && file.stat.ctime === note?.ctime ? file : null;
      // Keep an open source editor, including unsaved text, when available.
      let sourceLeaf: WorkspaceLeaf | null = null;
      this.eachDocumentLeaf((candidate) => {
        if (
          candidate.view instanceof MarkdownView &&
          candidate.view.file === this.document
        )
          sourceLeaf = candidate;
      });
      this.leaf = sourceLeaf;
      this.syncSelection();
      this.emit();
      return;
    }
    const file = leaf?.view instanceof MarkdownView ? leaf.view.file : null;
    this.document = file?.extension === "md" ? file : null;
    this.leaf = this.document ? leaf : null;
    this.syncSelection();
    this.emit();
  }
  private syncSelection(refresh = false): void {
    const file = this.document;
    const key = file ? `${file.path}:${file.stat.ctime}` : "";
    if (!refresh && key === this.selectionKey && this.leaf === this.sourceLeaf)
      return;
    this.selectionKey = key;
    this.sourceLeaf = this.leaf;
    this.sourceText = "";
    const revision = ++this.sourceRevision;
    if (
      file &&
      !(this.leaf?.view instanceof MarkdownView) &&
      this.plugin.app.vault.read
    )
      void this.plugin.app.vault
        .read(file)
        .then((text) => {
          if (revision === this.sourceRevision && this.document === file) {
            this.sourceText = text;
            this.emit();
          }
        })
        .catch((error) => this.fail(error));
  }
  private currentText(): string {
    const view = this.leaf?.view;
    return view instanceof MarkdownView && view.file === this.document
      ? view.editor.getValue()
      : this.sourceText;
  }
  /**
   * Panels read these on every render, so they are recomputed only when an input
   * changes. Saving or loading settings assigns a new `publishingTemplates`
   * object and nothing edits it in place, so its identity is a complete key.
   * The catalog and its notes are likewise replaced by `reload()`.
   */
  private get preferenceState() {
    const document = this.document;
    const note = this.catalog?.notes.find(
      (n) => n.path === document?.path && n.ctime === document?.stat.ctime,
    );
    const inputs = [
      document?.path,
      document?.stat.ctime,
      this.catalog,
      note,
      note?.preferences,
      this.plugin.settings.publishingTemplates,
    ];
    if (
      !this.preferenceCache ||
      !sameInputs(this.preferenceCache.inputs, inputs)
    ) {
      const preferences = this.preferencesFor(note?.preferences);
      this.preferenceCache = {
        inputs,
        preferences,
        template: selectedPublishingTemplate(
          this.publishingTemplates,
          preferences.templateId,
        ),
      };
    }
    return this.preferenceCache;
  }
  get notePreferences(): NotePublishPreferences {
    return this.preferenceState.preferences;
  }
  /** Problem checks parse the source once per text, preference or template change. */
  private noteCheck<K extends keyof NoteChecks>(
    name: K,
    compute: () => NoteChecks[K],
  ): NoteChecks[K] {
    const inputs = [
      this.notePreferences,
      this.currentText(),
      // Bumped by note switches and metadata changes, which the empty-text fallback reads.
      this.sourceRevision,
      this.exportedHeadingIssues,
    ];
    if (!this.checkCache || !sameInputs(this.checkCache.inputs, inputs))
      this.checkCache = { inputs, checks: {} };
    const checks = this.checkCache.checks;
    if (!Object.hasOwn(checks, name)) checks[name] = compute();
    return checks[name] as NoteChecks[K];
  }
  private get aastexCheck() {
    return this.noteCheck("aastex", () =>
      checked(() =>
        aastexProblems(this.currentText(), this.layout.titleSource, "pdf"),
      ),
    );
  }
  private get propertyCheck() {
    return this.noteCheck("properties", () =>
      checked(() =>
        publishingPropertyProblem(
          this.noteProperties,
          this.propertyDefinitions,
        ),
      ),
    );
  }
  get publishingTemplates() {
    const state = this.allPublishingTemplates;
    return {
      ...state,
      templates: state.templates.filter((template) =>
        publishingTemplateEnabled(state, template),
      ),
    };
  }
  get allPublishingTemplates() {
    const state = readPublishingTemplates(
      this.plugin.settings.publishingTemplates,
    );
    return {
      ...state,
      templates: [
        ...state.templates,
        ...(state.installations ?? []).map(installedPublishingTemplate),
      ],
    };
  }
  private preferencesFor(value: unknown): NotePublishPreferences {
    const previous = readNotePreferences(value);
    const template = selectedPublishingTemplate(
      this.publishingTemplates,
      previous.templateId,
    );
    return {
      ...readNotePreferences(value, template?.layout, template?.layout),
      ...(template ? { documentType: template.documentType } : {}),
    };
  }
  get selectedTemplate() {
    return this.preferenceState.template;
  }
  get journalProfile() {
    return journalProfile(
      this.selectedTemplate?.id,
      this.allPublishingTemplates.installations,
    );
  }
  private get journalCheck() {
    const profile = this.journalProfile;
    if (!profile) return undefined;
    const result = this.noteCheck("journal", () =>
      checked(() =>
        journalProblems(
          this.currentText(),
          this.layout.titleSource,
          profile,
          this.layout.showKeywords,
        ),
      ),
    );
    if ("error" in result) throw result.error;
    return result.value;
  }
  get journalPackageProblem(): string {
    const profile = this.journalProfile;
    const saved = profile && this.notePreferences.journalPackages?.[profile.id];
    return profile &&
      saved &&
      !samePublicationPackage(saved, journalReference(profile))
      ? "This journal package changed. Choose the profile again to review and accept the installed version before publishing."
      : "";
  }
  get aastexPdfOptions(): AastexPdfOptions {
    return readAastexPdfOptions(this.notePreferences.aastex?.options);
  }
  get aastexPackageProblem(): string {
    const saved = this.notePreferences.aastex?.package;
    return this.selectedTemplate?.renderer === "aastex" &&
      saved &&
      !samePublicationPackage(saved, AASTEX_PACKAGE_REFERENCE)
      ? `This note uses AASTeX ${saved.upstreamVersion}, Stratum adapter ${saved.version}. Installed: AASTeX ${AASTEX_PACKAGE_REFERENCE.upstreamVersion}, adapter ${AASTEX_PACKAGE_REFERENCE.version}. Review the update before creating another PDF. Cached files are retained; publishing uses the supported installed version.`
      : "";
  }
  get aastexHeadingProblems(): string[] {
    if (
      this.selectedTemplate?.renderer !== "aastex" ||
      !this.aastexPdfOptions.numberedHeadings
    )
      return [];
    return this.noteCheck("aastexHeadingProblems", () => {
      if (
        this.exportedHeadingIssues?.source === this.currentText() &&
        this.exportedHeadingIssues.titleSource === this.layout.titleSource &&
        this.exportedHeadingIssues.enabled
      )
        return this.exportedHeadingIssues.issues;
      const aastex = this.aastexCheck;
      if (!("value" in aastex)) return [];
      try {
        return aastexHeadingIssues(aastex.value.manuscript.body);
      } catch {
        return [];
      }
    });
  }
  updateAastexPdfOptions(patch: Partial<AastexPdfOptions>): Promise<void> {
    return this.updatePreferences({}, undefined, patch);
  }
  resetAastexPdfOptions(): Promise<void> {
    return this.updateAastexPdfOptions(readAastexPdfOptions(undefined));
  }
  acceptAastexPackage(): Promise<void> {
    return this.updatePreferences({
      aastex: {
        options: this.aastexPdfOptions,
        package: { ...AASTEX_PACKAGE_REFERENCE },
      },
    });
  }
  get propertyDefinitions() {
    const fields = publicationProperties(
      this.layout,
      this.selectedTemplate?.prefill,
    );
    return this.journalProfile
      ? [...fields, ...journalProperties(this.journalProfile)]
      : fields;
  }
  get noteProperties(): Record<string, unknown> {
    const text = this.currentText();
    return text
      ? publicationFrontmatter(text).properties
      : this.document
        ? (this.plugin.app.metadataCache?.getFileCache(this.document)
            ?.frontmatter ?? {})
        : {};
  }
  get propertiesMissing(): boolean {
    if (this.selectedTemplate?.renderer === "aastex") return false;
    try {
      return (
        this.propertyDefinitions.some(
          (field) => !Object.hasOwn(this.noteProperties, field.key),
        ) ?? false
      );
    } catch {
      return false;
    }
  }

  get layout(): PublishOptions {
    return this.notePreferences.pdf;
  }
  get academicInfo() {
    const text = this.currentText();
    const { properties, body } = text
      ? publicationFrontmatter(text)
      : {
          properties: this.document
            ? (this.plugin.app.metadataCache?.getFileCache(this.document)
                ?.frontmatter ?? {})
            : {},
          body: "",
        };
    return academicMetadata(
      mappedPublishingProperties(properties, this.propertyDefinitions),
      body,
    );
  }
  /** A repeated title is a layout choice, not a conversion error. */
  get duplicateTitleWarning(): boolean {
    if (!this.selectedTemplate || this.layout.titleSource !== "properties")
      return false;
    return this.noteCheck("duplicateTitleWarning", () => {
      try {
        return this.academicInfo.duplicateTitle;
      } catch {
        return false;
      }
    });
  }
  get readinessNotices(): { text: string; settings: boolean }[] {
    if (!this.selectedTemplate) return [];
    return this.noteCheck("readinessNotices", () => {
      if (this.journalProfile)
        return this.publishingIssues
          .filter((i) => i.blocking)
          .map((i) => ({
            text: i.message,
            settings:
              i.target === "author" ||
              (i.target === "title" &&
                this.layout.titleSource === "properties"),
          }));
      if (this.selectedTemplate?.renderer === "aastex") {
        if (this.aastexPackageProblem)
          return [{ text: "Review the AASTeX package update", settings: true }];
        const aastex = this.aastexCheck;
        // Only the title property can be fixed in Settings; a body title cannot.
        return "value" in aastex
          ? aastex.value.issues
              .filter((issue) => issue.blocking)
              .map((issue) => ({
                text: issue.message,
                settings:
                  issue.target !== "title" ||
                  this.layout.titleSource === "properties",
              }))
          : [{ text: this.academicProblem, settings: false }];
      }
      if (!this.propertyDefinitions.length) return [];
      const properties = this.propertyCheck;
      if (!("value" in properties))
        return [{ text: this.academicProblem, settings: false }];
      return properties.value
        ? [{ text: properties.value.message, settings: true }]
        : [];
    });
  }
  get academicProblem(): string {
    if (!this.selectedTemplate) return this.templateAvailabilityProblem;
    return this.noteCheck("academicProblem", () => {
      if (this.journalProfile) {
        try {
          return (
            this.journalPackageProblem ||
            this.journalCheck?.issues
              .filter((i) => i.blocking)
              .map((i) => i.message)
              .join("\n") ||
            ""
          );
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Repair publication metadata.";
        }
      }
      if (this.selectedTemplate?.renderer === "aastex") {
        if (this.aastexPackageProblem) return this.aastexPackageProblem;
        const aastex = this.aastexCheck;
        if ("value" in aastex)
          return aastex.value.issues
            .filter((issue) => issue.blocking)
            .map((issue) => issue.message)
            .join("\n");
        return aastex.error instanceof Error
          ? aastex.error.message
          : "Repair the publication metadata.";
      }
      // Without published properties, the note's YAML does not affect the document.
      if (!this.propertyDefinitions.length) return "";
      // Reading the note's properties also reports unreadable YAML.
      const properties = this.propertyCheck;
      if ("value" in properties) return properties.value?.message ?? "";
      return properties.error instanceof Error
        ? properties.error.message
        : "Check this note's publishing properties.";
    });
  }
  get templateAvailabilityProblem(): string {
    const selected = selectedPublishingTemplate(
      this.allPublishingTemplates,
      this.notePreferences.templateId,
    );
    if (
      selected &&
      !publishingTemplateEnabled(this.allPublishingTemplates, selected)
    )
      return "This template is disabled. Enable it in Manage templates before publishing.";
    if (!selected && this.notePreferences.templateId?.startsWith("registry:"))
      return "This exact template version is not installed. Reinstall it in Manage templates; your document selection has been kept.";
    return this.publishingTemplates.templates.length
      ? "Choose a template before publishing."
      : "No templates enabled. Open Manage templates to enable one.";
  }
  /**
   * The note's metadata issues for the selected template, placed for the
   * Settings forms. A title issue belongs to the Title field only when that
   * property is the title source. The package update notice is separate.
   */
  get publishingIssues(): PublishingIssue[] {
    if (!this.selectedTemplate) return [];
    return this.noteCheck("publishingIssues", () => {
      const failure = (error: unknown, fallback: string): PublishingIssue[] => [
        {
          target: "general",
          message: error instanceof Error ? error.message : fallback,
          blocking: true,
        },
      ];
      let issues: PublishingIssue[];
      if (this.journalProfile) {
        try {
          issues = [...(this.journalCheck?.issues ?? [])];
          if (this.journalPackageProblem)
            issues.unshift({
              target: "general",
              message: this.journalPackageProblem,
              blocking: true,
            });
        } catch (error) {
          return failure(error, "Repair publication metadata.");
        }
      } else if (this.selectedTemplate?.renderer === "aastex") {
        const aastex = this.aastexCheck;
        if (!("value" in aastex))
          return failure(aastex.error, "Repair the publication metadata.");
        issues = aastex.value.issues;
      } else {
        if (!this.propertyDefinitions.length) return [];
        const properties = this.propertyCheck;
        if (!("value" in properties))
          return failure(
            properties.error,
            "Check this note's publishing properties.",
          );
        issues = properties.value ? [properties.value] : [];
      }
      return this.layout.titleSource === "properties"
        ? issues
        : issues.map((issue) =>
            issue.target === "title" ? { ...issue, target: "general" } : issue,
          );
    });
  }
  private templatePreferencePatch(
    id: string,
    current: NotePublishPreferences,
  ): Partial<NotePublishPreferences> {
    const template = this.publishingTemplates.templates.find(
      (t) => t.id === id,
    );
    if (!template)
      throw new Error("This publishing template is no longer available.");
    const layout =
      current.templateLayouts && Object.hasOwn(current.templateLayouts, id)
        ? current.templateLayouts[id]
        : template.layout;
    return {
      ...(template.renderer === "journal"
        ? {
            journalPackages: {
              ...current.journalPackages,
              [id]: journalReference(
                journalProfile(id, this.allPublishingTemplates.installations)!,
              ),
            },
          }
        : {}),
      templateId: id,
      documentType: template.documentType,
      opening: layout.titleSource,
      pdf: { ...layout },
      ...(template.renderer === "aastex"
        ? {
            aastex: current.aastex ?? {
              options: readAastexPdfOptions(undefined),
              package: { ...AASTEX_PACKAGE_REFERENCE },
            },
          }
        : {}),
    };
  }
  get settingsResetChanges(): boolean {
    if (!this.selectedTemplate) return false;
    if (this.selectedTemplate.renderer === "aastex")
      return (
        JSON.stringify(this.aastexPdfOptions) !==
        JSON.stringify(readAastexPdfOptions(undefined))
      );
    const current = this.notePreferences;
    return Object.entries(this.selectedTemplate.layout).some(
      ([key, value]) => current.pdf[key as keyof PublishOptions] !== value,
    );
  }
  resetSettings(): Promise<void> {
    return this.selectedTemplate?.renderer === "aastex"
      ? this.resetAastexPdfOptions()
      : this.selectedTemplate
        ? this.updateLayout({ ...this.selectedTemplate.layout })
        : Promise.resolve();
  }
  updatePreferences(
    patch: Partial<NotePublishPreferences>,
    layoutPatch?: { format: "pdf"; patch: Partial<PublishOptions> },
    aastexPatch?: Partial<AastexPdfOptions>,
  ): Promise<void> {
    const file = this.document;
    if (!file || this.busy) return Promise.resolve();
    this.preferencesSaving = true;
    this.preferencePending++;
    const next = this.preferenceQueue.then(async () => {
      const note = await this.store.note(
        file.path,
        file.basename,
        file.stat.ctime,
      );
      const current = this.preferencesFor(note.preferences);
      if (aastexPatch)
        current.aastex = {
          ...current.aastex,
          options: readAastexPdfOptions({
            ...current.aastex?.options,
            ...aastexPatch,
          }),
        };
      if (layoutPatch) {
        current[layoutPatch.format] = readPublishOptions({
          ...current[layoutPatch.format],
          ...layoutPatch.patch,
        });
        current.opening = current.pdf.titleSource;
      }
      if (current.templateId)
        current.templateLayouts = {
          ...current.templateLayouts,
          [current.templateId]: { ...current.pdf },
        };
      if (patch.templateId)
        patch = {
          ...patch,
          ...this.templatePreferencePatch(patch.templateId, current),
        };
      await this.store.setPreferences(
        note.id,
        this.preferencesFor({ ...current, ...patch }),
      );
      await this.reload();
      this.plugin.publicationEditor?.refresh();
    });
    this.preferenceQueue = next.catch(() => {});
    this.emit();
    return next
      .catch((error) => {
        this.fail(error);
        throw error;
      })
      .finally(() => {
        this.preferencesSaving = --this.preferencePending > 0 || this.preparing;
        this.emit();
      });
  }
  async openSettings(
    launcher: HTMLElement,
    view?: MarkdownView,
  ): Promise<
    import("./publication-options-modal").PublishingSettingsModal | undefined
  > {
    // A newer request or a close supersedes a window that is still loading.
    const request = ++this.settingsRequest;
    this.settingsLauncher = launcher;
    try {
      if (view) {
        this.follow(view.leaf);
        if (this.document !== view.file) return;
      }
      const file = this.document;
      if (!file) return;
      await this.reload();
      const { PublishingSettingsModal } =
        await import("./publication-options-modal");
      if (
        !this.alive ||
        this.document !== file ||
        request !== this.settingsRequest
      )
        return;
      const currentLauncher = this.settingsLauncher ?? launcher;
      this.closeSettings();
      const modal = new PublishingSettingsModal(
        this.plugin.app,
        this,
        currentLauncher,
      );
      this.settingsModal = modal;
      modal.open();
      return modal;
    } catch (error) {
      this.fail(error);
      return;
    }
  }
  closeSettings(): void {
    this.settingsRequest++;
    this.settingsLauncher = undefined;
    const modal = this.settingsModal;
    this.settingsModal = undefined;
    modal?.close();
  }
  settingsClosed(
    modal: import("./publication-options-modal").PublishingSettingsModal,
  ): void {
    if (this.settingsModal === modal) this.settingsModal = undefined;
  }
  /** Moves focus return to a re-rendered panel's button after its launcher is removed. */
  adoptSettingsLauncher(launcher: HTMLElement): void {
    if (this.settingsLauncher && !this.settingsLauncher.isConnected)
      this.settingsLauncher = launcher;
    this.settingsModal?.adoptLauncher(launcher);
  }

  async editPublicationDetails(): Promise<void> {
    const file = this.document;
    if (!file) return;
    try {
      const workspace = this.plugin.app.workspace;
      let leaf = this.leaf;
      if (!(leaf?.view instanceof MarkdownView) || leaf.view.file !== file) {
        leaf = null;
        this.eachDocumentLeaf((candidate) => {
          if (
            candidate.view instanceof MarkdownView &&
            candidate.view.file === file
          )
            leaf = candidate;
        });
        if (!leaf) {
          leaf = this.openingLeaf = workspace.getLeaf("tab");
          try {
            await leaf.openFile(file);
          } finally {
            if (this.openingLeaf === leaf) this.openingLeaf = null;
          }
        }
      }
      if (
        !this.alive ||
        this.plugin.app.vault.getAbstractFileByPath(file.path) !== file
      )
        return;
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file !== file) return;
      await this.plugin.publicationEditor?.open(view);
      await workspace.revealLeaf(leaf);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  async updateLayout(patch: Partial<PublishOptions>): Promise<void> {
    if (!this.document || this.busy) return;
    const format = "pdf" as const;
    const error = this.fontError;
    const previous = this.layout;
    await this.updatePreferences({}, { format, patch });
    if (
      error &&
      this.fontError === error &&
      ((patch.bodyFont !== undefined && patch.bodyFont !== previous.bodyFont) ||
        (patch.titleFont !== undefined &&
          patch.titleFont !== previous.titleFont))
    ) {
      this.clearError();
      this.emit();
    }
  }
  async prepareAcademic(): Promise<void> {
    const file = this.document;
    if (!file || this.busy || this.preferencesSaving) return;
    this.preparing = this.preferencesSaving = true;
    this.emit();
    try {
      const template = this.selectedTemplate;
      if (!template)
        throw new Error("Choose a template before adding properties.");
      await this.plugin.app.fileManager.processFrontMatter(
        file,
        (properties: Record<string, unknown>) =>
          addPublishingProperties(
            properties,
            file.basename,
            this.propertyDefinitions,
          ),
      );
      this.sourceText = await this.plugin.app.vault.read(file);
    } catch (error) {
      this.fail(error);
    } finally {
      this.preparing = false;
      this.preferencesSaving = this.preferencePending > 0;
      this.emit();
    }
  }
  async citationStyleChoices() {
    const file = this.document;
    if (!file) return null;
    const text = this.currentText() || (await this.plugin.app.vault.read(file));
    const { noteCitationStyleChoices } =
      await import("./citation-style-choice");
    return noteCitationStyleChoices(this.plugin, file, text);
  }
  async changeCitationStyle(style: string): Promise<void> {
    const file = this.document;
    if (!file || this.busy) return;
    const text = this.currentText() || (await this.plugin.app.vault.read(file));
    const { setNoteCitationStyle } = await import("./citation-style-choice");
    await setNoteCitationStyle(
      this.plugin,
      file,
      style,
      this.plugin.citations.preferences(file.path, text).language,
    );
    this.emit();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.loaded) {
      this.loaded = true;
      void this.reload().catch((error) => this.fail(error));
    }
    return () => this.listeners.delete(listener);
  }
  emit(): void {
    if (this.alive) for (const listener of this.listeners) listener();
  }
  fail(error: unknown, message = "There was an error with publishing"): void {
    if (!this.alive) return;
    this.clearError();
    this.error =
      error instanceof Error
        ? error.message
        : "Publishing failed. Please try again.";
    this.errorMessage = message;
    if (error instanceof PublishFontError) {
      this.fontError = error;
      this.emit();
      return;
    }
    // Keep conversion diagnostics available for inspection until the next attempt.
    this.emit();
  }
  private clearError(): void {
    this.error = "";
    this.errorMessage = "";
    this.fontError = null;
  }
  async reload(): Promise<void> {
    const revision = ++this.loadRevision;
    const catalog = await this.store.list();
    if (revision === this.loadRevision && this.alive) {
      this.catalog = catalog;
      const recent = this.plugin.app.workspace.getMostRecentLeaf(
        this.plugin.app.workspace.rootSplit,
      );
      if (recent?.view.getViewType?.() === VIEW_TYPE_PUBLISH_PREVIEW)
        this.follow(recent);
      this.emit();
    }
  }
  get documents(): PublishedDocument[] {
    const note = this.catalog?.notes.find(
      (n) =>
        n.path === this.document?.path && n.ctime === this.document.stat.ctime,
    );
    return this.allDocuments.filter((d) => d.noteId === note?.id);
  }
  get allDocuments(): PublishedDocument[] {
    return [...(this.catalog?.documents ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
  canCreate(): boolean {
    return (
      !!this.document &&
      !!this.catalog &&
      !this.busy &&
      !this.checking &&
      !this.preferencesSaving &&
      !this.academicProblem &&
      !this.plugin.publicationEditor?.pending?.(this.document.path) &&
      !!this.readiness?.pdf
    );
  }
  invalidateSupport(): void {
    this.supportRevision++;
    this.background?.abort();
    this.readiness = null;
    this.plugin.settings.publishReadinessCache = null;
    this.plugin.settings.publishPdfSetupComplete = false;
    this.emit();
  }
  private async persistSupport(): Promise<void> {
    if (!this.alive || !this.readiness) return;
    const settings = this.plugin.settings;
    settings.publishPdfSetupComplete = this.readiness.pdf;
    settings.publishReadinessCache = readPublishReadinessCache({
      version: 1,
      pandocPath: settings.pandocPath,
      tectonicPath: settings.tectonicPath,
      readiness: this.readiness,
    });
    await this.plugin.saveSettings();
  }
  private async detectedSupport(
    previous: PublishReadiness,
    signal: AbortSignal,
  ): Promise<PublishReadiness> {
    const [pandoc, tectonic] = await Promise.all([
      detectPublishTool("pandoc", this.plugin.settings.pandocPath, signal),
      detectPublishTool("tectonic", this.plugin.settings.tectonicPath, signal),
    ]);
    return {
      pandoc,
      tectonic,
      pdf: previous.pdf && !!pandoc.path && !!tectonic.path,
    };
  }
  private async validateCachedSupport(): Promise<void> {
    const revision = ++this.supportRevision;
    const aborter = (this.background = new AbortController());
    try {
      const ready = await this.detectedSupport(this.readiness!, aborter.signal);
      if (
        !this.alive ||
        aborter.signal.aborted ||
        revision !== this.supportRevision
      )
        return;
      this.readiness = ready;
      this.emit();
      await this.persistSupport();
    } catch (error) {
      if (
        this.alive &&
        !aborter.signal.aborted &&
        revision === this.supportRevision
      )
        this.fail(error);
    } finally {
      if (this.background === aborter) this.background = null;
    }
  }
  private async diagnoseFailure(
    format: PublishFormat,
    signal: AbortSignal,
    probeGenericConversion = true,
  ): Promise<void> {
    const previous = this.readiness;
    if (!previous) return;
    this.supportRevision++;
    this.background?.abort();
    this.progress = "Checking why publishing failed…";
    this.emit();
    const ready = await this.detectedSupport(previous, signal);
    if (probeGenericConversion && ready.pandoc.path && ready.tectonic.path) {
      try {
        await probePublication(
          format,
          { pandoc: ready.pandoc.path, tectonic: ready.tectonic.path },
          signal,
        );
        ready.pdf = true;
      } catch {
        if (signal.aborted) return;
        ready.pdf = false;
      }
    }
    if (signal.aborted || !this.alive) return;
    this.readiness = ready;
    await this.persistSupport();
  }
  async check(preparePdf = false): Promise<void> {
    if (this.checking || this.busy || !Platform.isDesktopApp) return;
    this.supportRevision++;
    this.background?.abort();
    const previous = this.readiness;
    this.checking = true;
    this.readiness = null;
    this.clearError();
    this.aborter = new AbortController();
    this.emit();
    try {
      this.readiness = await checkPublishing(
        this.plugin.settings.pandocPath,
        this.plugin.settings.tectonicPath,
        preparePdf || this.plugin.settings.publishPdfSetupComplete,
        this.aborter.signal,
        (text) => {
          this.progress = text;
          this.emit();
        },
        (readiness) => {
          if (!this.alive || this.aborter?.signal.aborted) return;
          this.readiness = readiness;
          this.emit();
        },
      );
      if (!this.aborter.signal.aborted && this.alive)
        await this.persistSupport();
    } catch (error) {
      if (this.aborter?.signal.aborted) this.readiness = previous;
      this.fail(error);
    } finally {
      this.checking = false;
      this.progress = "";
      this.aborter = null;
      this.emit();
    }
  }
  cancel(): void {
    this.aborter?.abort();
  }
  async create(): Promise<void> {
    if (
      this.document &&
      this.plugin.publicationEditor &&
      !this.plugin.publicationEditor.flush(this.document.path)
    ) {
      this.fail(
        new Error(
          "Resolve or discard the pending publication edit before publishing.",
        ),
      );
      return;
    }
    if (!this.canCreate() || !this.document || !this.readiness) return;
    const file = this.document,
      path = file.path,
      title = file.basename,
      ctime = file.stat.ctime,
      format = "pdf" as const;
    // Rendering and conversion must use the same PDF layout.
    const publishing = {
      ...this.notePreferences,
      opening: this.layout.titleSource,
    };
    const layout = { ...publishing[format] };
    const journal = this.journalProfile;
    const packaged = this.selectedTemplate?.renderer === "aastex" || !!journal;
    const propertyDefinitions = this.propertyDefinitions.map((field) => ({
      ...field,
    }));
    const view = this.leaf?.view;
    // Reading and editing use the same source snapshot, including unsaved editor text.
    const source =
      view instanceof MarkdownView && view.file === file
        ? view.editor.getValue()
        : null;
    const tools = {
      pandoc: this.readiness.pandoc.path,
      tectonic: this.readiness.tectonic.path,
      bibliographyCache: {
        adapter: this.plugin.app.vault.adapter,
        directory: `${this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`}/cache/bibliography`,
      },
    };
    const aborter = (this.aborter = new AbortController());
    this.busy = true;
    this.clearError();
    this.progress = "Creating PDF document…";
    this.emit();
    let converting = false;
    try {
      const text = source ?? (await this.plugin.app.vault.read(file));
      const preferences = this.plugin.citations.preferences(path, text);
      // Start formatting before awaiting storage so settings are captured at click time.
      const [formatted, note] = await Promise.all([
        packaged
          ? Promise.resolve(undefined)
          : this.plugin.citations.formatForPublication(text, path),
        this.store.note(file.path, title, ctime),
      ]);
      if (journal) {
        publishing.journalPackages = {
          ...publishing.journalPackages,
          [journal.id]: journalReference(journal),
        };
        await this.store.setPreferences(note.id, publishing);
      } else if (packaged) {
        publishing.aastex = {
          options: readAastexPdfOptions(publishing.aastex?.options),
          package: { ...AASTEX_PACKAGE_REFERENCE },
        };
        await this.store.setPreferences(note.id, publishing);
      }
      const rendered: {
        html: string;
        assets: import("./publish-desktop").PublishAsset[];
        aastex?: Awaited<ReturnType<typeof renderAastexPublication>>["aastex"];
      } = packaged
        ? await (
            await import("./publication-render")
          ).renderAastexPublication(
            this.plugin.app,
            this.plugin.citations,
            text,
            path,
            title,
            publishing,
            aborter.signal,
            journal,
          )
        : await renderPublication(
            this.plugin.app,
            text,
            path,
            title,
            formatted,
            aborter.signal,
            publishing,
            propertyDefinitions,
          );
      if (packaged && !rendered.aastex)
        throw new Error(
          "The AASTeX manuscript could not be prepared. Try publishing again after reopening the note.",
        );
      converting = true;
      const bytes = await convertPublication(
        rendered.html,
        rendered.assets,
        format,
        tools,
        aborter.signal,
        120_000,
        layout,
        rendered.aastex,
      );
      converting = false;
      if (rendered.aastex) {
        this.exportedHeadingIssues = {
          source: text,
          titleSource: layout.titleSource,
          enabled: rendered.aastex.options.numberedHeadings,
          issues: rendered.aastex.headingIssues,
        };
        if (rendered.aastex.headingIssues.length)
          new Notice(AASTEX_HEADING_WARNING);
      }
      if (aborter.signal.aborted || !this.alive) return;
      const id = crypto.randomUUID(),
        date = new Date();
      await this.store.create(
        {
          id,
          noteId: note.id,
          format,
          createdAt: date.toISOString(),
          citationStyle: rendered.aastex
            ? (journal?.bibliography ??
              aastexPackage.manifest.bibliographyStyle)
            : preferences.style,
          citationLanguage: preferences.language,
          publishing: {
            ...(packaged
              ? {
                  template: {
                    ...(journal
                      ? journalReference(journal)
                      : {
                          id: aastexPackage.manifest.id,
                          version: aastexPackage.manifest.version,
                          upstreamVersion:
                            aastexPackage.manifest.upstreamVersion,
                        }),
                  },
                }
              : {}),
            ...(rendered.aastex && !journal
              ? { aastexPdfOptions: { ...rendered.aastex.options } }
              : {}),
            documentType: publishing.documentType,
            opening: publishing.opening,
            layout,
            ...(propertyDefinitions?.some((field) => field.use !== "metadata")
              ? {
                  metadata: academicMetadata(
                    mappedPublishingProperties(
                      publicationFrontmatter(text).properties,
                      propertyDefinitions ?? [],
                    ),
                  ),
                }
              : {}),
          },
        },
        title,
        bytes,
      );
      await this.reload();
      if (!aborter.signal.aborted && this.alive) this.lastPublishedId = id;
    } catch (error) {
      this.fail(error, "There was an error creating the PDF file");
      // A missing font is a layout choice, not a tool failure.
      if (
        converting &&
        !(error instanceof PublishFontError) &&
        !aborter.signal.aborted &&
        this.alive
      ) {
        try {
          // Class-specific failures must not invalidate generic PDF conversion;
          // missing shared executables still invalidate their affected formats.
          await this.diagnoseFailure(format, aborter.signal, !packaged);
        } catch {
          // Preserve the original failure if diagnosis itself cannot finish.
        }
      }
    } finally {
      this.busy = false;
      this.progress = "";
      this.aborter = null;
      this.emit();
    }
  }
  private absolute(document: PublishedDocument): string {
    const adapter = this.plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter))
      throw new Error("Desktop filesystem access is unavailable.");
    return `${adapter.getBasePath()}/${this.store.path(document)}`;
  }
  sourceNote(document: PublishedDocument): TFile | null {
    const note = this.catalog?.notes.find(
      (entry) => entry.id === document.noteId,
    );
    const file = note?.path
      ? this.plugin.app.vault.getAbstractFileByPath(note.path)
      : null;
    return file instanceof TFile &&
      file.extension === "md" &&
      file.stat.ctime === note?.ctime
      ? file
      : null;
  }
  async openSource(document: PublishedDocument): Promise<void> {
    const file = this.sourceNote(document);
    if (!file) return;
    const workspace = this.plugin.app.workspace;
    let existing: WorkspaceLeaf | null = null;
    this.eachDocumentLeaf((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file === file)
        existing = leaf;
    });
    const leaf = existing ?? workspace.getLeaf("tab");
    if (!existing) await leaf.openFile(file);
    await workspace.revealLeaf(leaf);
  }
  async open(document: PublishedDocument): Promise<void> {
    try {
      if (
        !(await this.plugin.app.vault.adapter.exists(this.store.path(document)))
      )
        throw new Error(
          "This published file is missing. Save another publication or remove this entry.",
        );
      const workspace = this.plugin.app.workspace;
      const existing = workspace
        .getLeavesOfType(VIEW_TYPE_PUBLISH_PREVIEW)
        .find((leaf) => leaf.view.getState().documentId === document.id);
      const leaf = existing ?? workspace.getLeaf("tab");
      if (!existing)
        await leaf.setViewState({
          type: VIEW_TYPE_PUBLISH_PREVIEW,
          state: { documentId: document.id },
          active: true,
        });
      await workspace.revealLeaf(leaf);
    } catch (error) {
      this.fail(error);
    }
  }
  async saveCopy(document: PublishedDocument): Promise<void> {
    try {
      const bytes = await this.plugin.app.vault.adapter.readBinary(
        this.store.path(document),
      );
      const directory = this.absolute(document).slice(
        0,
        -(document.filename.length + 1),
      );
      if (
        await savePublishedCopy(
          bytes,
          document.filename,
          document.format,
          directory,
        )
      )
        new Notice("Document copy saved.");
    } catch (error) {
      this.fail(error);
    }
  }
  async remove(document: PublishedDocument): Promise<void> {
    try {
      await this.store.remove(document.id);
      await this.reload();
    } catch (error) {
      this.fail(error);
    }
  }
}
