import {
  Component,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Platform,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import type StratumPlugin from "./plugin";
import { PublishStore } from "./publish-store";
import {
  formatLabel,
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
  readAcademicDefaults,
  DEFAULT_ACADEMIC_OPTIONS,
  type NotePublishPreferences,
  type PublishOptions,
} from "./publish-options";
import {
  publicationFrontmatter,
  academicMetadata,
  addAcademicProperties,
} from "./publish-academic";

export class PublishController extends Component {
  document: TFile | null = null;
  leaf: WorkspaceLeaf | null = null;
  catalog: PublishCatalog | null = null;
  readiness: PublishReadiness | null = null;
  busy = false;
  checking = false;
  progress = "";
  error = "";
  errorMessage = "";
  private errorTimer: number | null = null;
  selectedFormat: PublishFormat | "" = "";
  historyScope: "note" | "all" = "note";
  readonly store: PublishStore;
  private listeners = new Set<() => void>();
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
  private sourceRevision = 0;
  private sourceText = "";
  private sourceTimer: number | null = null;
  preferencesSaving = false;
  constructor(readonly plugin: StratumPlugin) {
    super();
    this.store = new PublishStore(
      plugin.app.vault.adapter,
      plugin.app.vault.configDir,
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
        word: true,
        pdf: true,
        pandoc: { path: settings.pandocPath || "pandoc", version: "" },
        tectonic: { path: settings.tectonicPath || "tectonic", version: "" },
      };
  }
  onload(): void {
    if (!Platform.isDesktopApp) return;
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
        let selectedIsOpen = false;
        this.plugin.app.workspace.iterateRootLeaves((leaf) => {
          if (leaf === this.leaf) selectedIsOpen = true;
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
          if (file === this.document) this.emit();
        }),
      );
    this.registerEvent(
      this.plugin.app.workspace.on("editor-change", () => {
        if (this.sourceTimer !== null) window.clearTimeout(this.sourceTimer);
        this.sourceTimer = window.setTimeout(() => {
          this.sourceTimer = null;
          this.emit();
        }, 250);
      }),
    );
    if (this.readiness) void this.validateCachedSupport();
  }
  onunload(): void {
    this.alive = false;
    this.clearError();
    this.aborter?.abort();
    this.background?.abort();
    if (this.sourceTimer !== null) window.clearTimeout(this.sourceTimer);
    this.listeners.clear();
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
    this.plugin.app.workspace.iterateRootLeaves((candidate) => {
      if (candidate === leaf) root = true;
    });
    if (!root) return;
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
      this.plugin.app.workspace.iterateRootLeaves((candidate) => {
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
  private syncSelection(): void {
    const file = this.document;
    const key = file ? `${file.path}:${file.stat.ctime}` : "";
    if (key === this.selectionKey) return;
    this.selectionKey = key;
    this.selectedFormat = this.notePreferences.format;
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
  get notePreferences(): NotePublishPreferences {
    const note = this.catalog?.notes.find(
      (n) =>
        n.path === this.document?.path && n.ctime === this.document?.stat.ctime,
    );
    return readNotePreferences(
      note?.preferences,
      readPublishOptions(this.plugin.settings.publishingDefaults),
      readPublishOptions(
        this.plugin.settings.academicPublishingDefaults,
        DEFAULT_ACADEMIC_OPTIONS,
      ),
    );
  }
  get layout(): PublishOptions {
    return this.notePreferences[this.selectedFormat || "docx"];
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
    return academicMetadata(properties, body);
  }
  get academicProblem(): string {
    if (this.notePreferences.documentType !== "academic") return "";
    try {
      const metadata = this.academicInfo;
      if (!metadata.title)
        return "Add a nonempty title property to prepare this academic paper.";
      if (
        metadata.duplicateTitle &&
        this.notePreferences.opening === "properties"
      )
        return "The body repeats the title property. Use title from body, or remove the repeated opening yourself.";
      return "";
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Check this note's publishing properties.";
    }
  }
  updatePreferences(
    patch: Partial<NotePublishPreferences>,
    layoutPatch?: { format: "docx" | "pdf"; patch: Partial<PublishOptions> },
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
      const defaults = readPublishOptions(
        this.plugin.settings.publishingDefaults,
      );
      const academic = readPublishOptions(
        this.plugin.settings.academicPublishingDefaults,
        DEFAULT_ACADEMIC_OPTIONS,
      );
      const current = readNotePreferences(note.preferences, defaults, academic);
      if (layoutPatch)
        current[layoutPatch.format] = readPublishOptions({
          ...current[layoutPatch.format],
          ...layoutPatch.patch,
        });
      if (patch.documentType && patch.documentType !== current.documentType) {
        const oldDefaults =
          current.documentType === "academic" ? academic : defaults;
        const base = patch.documentType === "academic" ? academic : defaults;
        for (const format of ["pdf", "docx"] as const)
          if (
            !note.preferences ||
            JSON.stringify(current[format]) === JSON.stringify(oldDefaults)
          )
            current[format] = { ...base };
      }
      await this.store.setPreferences(
        note.id,
        readNotePreferences({ ...current, ...patch }, defaults, academic),
      );
      await this.reload();
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
  selectFormat(format: PublishFormat | ""): Promise<void> {
    this.selectedFormat = format;
    return this.updatePreferences({ format });
  }
  updateLayout(patch: Partial<PublishOptions>): Promise<void> {
    const format = this.selectedFormat || "docx";
    return this.updatePreferences({}, { format, patch });
  }
  async prepareAcademic(): Promise<void> {
    const file = this.document;
    if (!file || this.busy || this.preferencesSaving) return;
    this.preparing = this.preferencesSaving = true;
    this.emit();
    try {
      const defaults = readAcademicDefaults(
        this.plugin.settings.academicProperties,
      );
      await this.plugin.app.fileManager.processFrontMatter(
        file,
        (properties: Record<string, unknown>) =>
          addAcademicProperties(properties, file.basename, defaults),
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
    this.errorTimer = window.setTimeout(() => {
      this.errorTimer = null;
      this.error = "";
      this.errorMessage = "";
      this.emit();
    }, 5_000);
    this.emit();
  }
  private clearError(): void {
    if (this.errorTimer !== null) window.clearTimeout(this.errorTimer);
    this.errorTimer = null;
    this.error = "";
    this.errorMessage = "";
  }
  async reload(): Promise<void> {
    const revision = ++this.loadRevision;
    const catalog = await this.store.list();
    if (revision === this.loadRevision && this.alive) {
      const firstLoad = !this.catalog;
      this.catalog = catalog;
      if (firstLoad && this.notePreferences.format)
        this.selectedFormat = this.notePreferences.format;
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
      !!this.selectedFormat &&
      !!this.catalog &&
      !this.busy &&
      !this.checking &&
      !this.preferencesSaving &&
      !this.academicProblem &&
      (this.selectedFormat === "pdf"
        ? !!this.readiness?.pdf
        : !!this.readiness?.word)
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
      word: previous.word && !!pandoc.path,
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
  ): Promise<void> {
    const previous = this.readiness;
    if (!previous) return;
    this.supportRevision++;
    this.background?.abort();
    this.progress = "Checking why publishing failed…";
    this.emit();
    const ready = await this.detectedSupport(previous, signal);
    if (ready.pandoc.path && (format === "docx" || ready.tectonic.path)) {
      try {
        await probePublication(
          format,
          { pandoc: ready.pandoc.path, tectonic: ready.tectonic.path },
          signal,
        );
        if (format === "pdf") ready.pdf = true;
        else ready.word = true;
      } catch {
        if (signal.aborted) return;
        if (format === "pdf") ready.pdf = false;
        else ready.word = false;
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
      !this.canCreate() ||
      !this.document ||
      !this.selectedFormat ||
      !this.readiness
    )
      return;
    const file = this.document,
      path = file.path,
      title = file.basename,
      ctime = file.stat.ctime,
      format = this.selectedFormat;
    const publishing = this.notePreferences;
    const layout = { ...publishing[format] };
    const view = this.leaf?.view;
    // Reading and editing use the same source snapshot, including unsaved editor text.
    const source =
      view instanceof MarkdownView && view.file === file
        ? view.editor.getValue()
        : null;
    const tools = {
      pandoc: this.readiness.pandoc.path,
      tectonic: this.readiness.tectonic.path,
    };
    const aborter = (this.aborter = new AbortController());
    this.busy = true;
    this.clearError();
    this.progress = `Creating ${formatLabel(format)} document…`;
    this.emit();
    let converting = false;
    try {
      const text = source ?? (await this.plugin.app.vault.read(file));
      const preferences = this.plugin.citations.preferences(path, text);
      // Start formatting before awaiting storage so settings are captured at click time.
      const [formatted, note] = await Promise.all([
        this.plugin.citations.formatForPublication(text, path),
        this.store.note(file.path, title, ctime),
      ]);
      const rendered = await renderPublication(
        this.plugin.app,
        text,
        path,
        title,
        formatted,
        aborter.signal,
        publishing,
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
      );
      converting = false;
      if (aborter.signal.aborted || !this.alive) return;
      const id = crypto.randomUUID(),
        date = new Date();
      await this.store.create(
        {
          id,
          noteId: note.id,
          format,
          createdAt: date.toISOString(),
          citationStyle: preferences.style,
          citationLanguage: preferences.language,
          publishing: {
            documentType: publishing.documentType,
            opening: publishing.opening,
            layout,
            ...(publishing.documentType === "academic"
              ? {
                  metadata: academicMetadata(
                    publicationFrontmatter(text).properties,
                  ),
                }
              : {}),
          },
        },
        title,
        bytes,
      );
      await this.reload();
    } catch (error) {
      this.fail(
        error,
        `There was an error creating the ${formatLabel(format)} file`,
      );
      // A missing font is a layout choice, not a tool failure.
      if (
        converting &&
        !(error instanceof PublishFontError) &&
        !aborter.signal.aborted &&
        this.alive
      ) {
        try {
          await this.diagnoseFailure(format, aborter.signal);
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
    workspace.iterateRootLeaves((leaf) => {
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
      if (document.format !== "pdf") return;
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
