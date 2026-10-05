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
  savePublishedCopy,
  type PublishReadiness,
} from "./publish-desktop";
import { renderPublication } from "./publish-render";

export class PublishController extends Component {
  document: TFile | null = null;
  leaf: WorkspaceLeaf | null = null;
  catalog: PublishCatalog | null = null;
  readiness: PublishReadiness | null = null;
  busy = false;
  checking = false;
  progress = "";
  error = "";
  selectedFormat: PublishFormat | "" = "";
  readonly store: PublishStore;
  private listeners = new Set<() => void>();
  private aborter: AbortController | null = null;
  private loaded = false;
  private alive = true;
  private loadRevision = 0;
  constructor(readonly plugin: StratumPlugin) {
    super();
    this.store = new PublishStore(
      plugin.app.vault.adapter,
      plugin.app.vault.configDir,
    );
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
  }
  onunload(): void {
    this.alive = false;
    this.aborter?.abort();
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
      this.emit();
      return;
    }
    const file = leaf?.view instanceof MarkdownView ? leaf.view.file : null;
    this.document = file?.extension === "md" ? file : null;
    this.leaf = this.document ? leaf : null;
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
  fail(error: unknown): void {
    this.error =
      error instanceof Error
        ? error.message
        : "Publishing failed. Please try again.";
    this.emit();
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
    return (this.catalog?.documents ?? [])
      .filter((d) => d.noteId === note?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  canCreate(): boolean {
    return (
      !!this.document &&
      !!this.selectedFormat &&
      !!this.catalog &&
      !this.busy &&
      !this.checking &&
      (this.selectedFormat === "pdf"
        ? !!this.readiness?.pdf
        : !!this.readiness?.word)
    );
  }
  async check(preparePdf = false): Promise<void> {
    if (this.checking || this.busy || !Platform.isDesktopApp) return;
    this.checking = true;
    this.readiness = null;
    this.error = "";
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
      if (this.readiness.pdf && !this.plugin.settings.publishPdfSetupComplete) {
        this.plugin.settings.publishPdfSetupComplete = true;
        await this.plugin.saveSettings();
      }
    } catch (error) {
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
    this.error = "";
    this.progress = `Creating ${formatLabel(format)} document…`;
    this.emit();
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
      );
      const bytes = await convertPublication(
        rendered.html,
        rendered.assets,
        format,
        tools,
        aborter.signal,
      );
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
        },
        title,
        bytes,
      );
      this.selectedFormat = "";
      await this.reload();
      new Notice(`${formatLabel(format)} document created for ${title}.`);
    } catch (error) {
      this.fail(error);
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
