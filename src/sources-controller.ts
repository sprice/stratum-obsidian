import {
  Component,
  MarkdownView,
  Notice,
  TFile,
  parseLinktext,
  type WorkspaceLeaf,
} from "obsidian";
import type StratumPlugin from "./plugin";
import {
  buildLiteratureNoteEntries,
  type LiteratureNoteEntry,
} from "./library-search-modal";
import {
  collectDocumentSources,
  readBibliographyBindings,
  type SourceRow,
  type BibliographyBinding,
} from "./document-sources";
import { shouldFollowSourceDocument } from "./sources-context";
import type { SourceOccurrence } from "./source-occurrences";

export class SourcesController extends Component {
  document: TFile | null = null;
  pinned = false;
  rows: SourceRow[] = [];
  error: string | null = null;
  private leaf: WorkspaceLeaf | null = null;
  private text = "";
  private timer: number | null = null;
  private revision = 0;
  private listeners = new Set<() => void>();
  private inspecting = false;
  private entries: LiteratureNoteEntry[] | null = null;
  private bibliography: string | null = null;
  private bindings: BibliographyBinding[] | null = null;
  constructor(private plugin: StratumPlugin) {
    super();
  }

  onload(): void {
    this.registerEvent(
      this.plugin.app.workspace.on("active-leaf-change", (leaf) =>
        this.follow(leaf),
      ),
    );
    this.registerEvent(
      this.plugin.app.workspace.on("editor-change", (_editor, info) => {
        if (info.file?.path === this.document?.path) this.schedule();
      }),
    );
    this.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file) => {
        if (file !== this.document) this.entries = null;
        this.schedule();
      }),
    );
    this.registerEvent(
      this.plugin.app.metadataCache.on("resolved", () => {
        this.entries = null;
        this.schedule();
      }),
    );
    this.registerEvent(
      this.plugin.app.vault.on("modify", (file) => {
        if (file.path === "stratum.bib") this.bibliography = null;
        if (file === this.document || file.path === "stratum.bib")
          this.schedule();
      }),
    );
    this.registerEvent(
      this.plugin.app.vault.on("rename", () => {
        this.entries = null;
        this.bibliography = null;
        this.schedule();
      }),
    );
    this.registerEvent(
      this.plugin.app.vault.on("delete", (file) => {
        this.entries = null;
        this.bibliography = null;
        if (file === this.document) {
          this.document = null;
          this.leaf = null;
          this.pinned = false;
          this.rows = [];
          this.emit();
        }
        this.schedule();
      }),
    );
    this.registerEvent(
      this.plugin.app.vault.on("create", () => {
        this.entries = null;
        this.bibliography = null;
        this.schedule();
      }),
    );
    this.follow(
      this.plugin.app.workspace.getMostRecentLeaf(
        this.plugin.app.workspace.rootSplit,
      ),
    );
  }
  onunload(): void {
    this.revision++;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.listeners.clear();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.schedule();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.revision++;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
      }
    };
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  private follow(leaf: WorkspaceLeaf | null): void {
    if (this.inspecting || !(leaf?.view instanceof MarkdownView)) return;
    let rootLeaf = false;
    this.plugin.app.workspace.iterateRootLeaves((candidate) => {
      if (candidate === leaf) rootLeaf = true;
    });
    if (!rootLeaf) return;
    const file = leaf.view.file;
    if (
      !file ||
      !shouldFollowSourceDocument({
        pinned: this.pinned,
        isMarkdown: file.extension === "md",
        isLiteratureNote:
          this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
            ?.stratum_note_type === "literature-note",
      })
    )
      return;
    if (this.document !== file) {
      this.rows = [];
      this.error = null;
    }
    this.document = file;
    this.leaf = leaf;
    this.schedule();
    this.emit();
  }
  showCurrent(): void {
    this.pinned = false;
    this.follow(
      this.plugin.app.workspace.getMostRecentLeaf(
        this.plugin.app.workspace.rootSplit,
      ),
    );
    this.schedule();
  }
  togglePin(): void {
    this.pinned = !this.pinned;
    if (!this.pinned)
      this.follow(
        this.plugin.app.workspace.getMostRecentLeaf(
          this.plugin.app.workspace.rootSplit,
        ),
      );
    this.emit();
  }
  schedule(): void {
    this.revision++;
    if (!this.listeners.size) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 200);
  }
  private editorText(): string | null {
    if (
      this.leaf?.view instanceof MarkdownView &&
      this.leaf.view.file === this.document
    )
      return this.leaf.view.editor.getValue();
    const view = this.plugin.app.workspace
      .getLeavesOfType("markdown")
      .find(
        (leaf) =>
          leaf.view instanceof MarkdownView && leaf.view.file === this.document,
      )?.view;
    return view instanceof MarkdownView ? view.editor.getValue() : null;
  }
  private async refresh(): Promise<void> {
    const revision = this.revision;
    const file = this.document;
    if (!file) {
      this.rows = [];
      this.emit();
      return;
    }
    try {
      const text =
        this.editorText() ?? (await this.plugin.app.vault.cachedRead(file));
      const bib = this.plugin.app.vault.getAbstractFileByPath("stratum.bib");
      const bibliography =
        this.bibliography ??
        (bib instanceof TFile
          ? await this.plugin.app.vault.cachedRead(bib)
          : "");
      if (revision !== this.revision) return;
      const bindings =
        this.bibliography === bibliography && this.bindings
          ? this.bindings
          : readBibliographyBindings(bibliography);
      this.bibliography = bibliography;
      this.bindings = bindings;
      const entries = this.entries ?? buildLiteratureNoteEntries(this.plugin);
      this.entries = entries;
      this.rows = collectDocumentSources(text, entries, bindings, (target) => {
        let decoded = target;
        try {
          decoded = decodeURIComponent(target);
        } catch {
          /* Keep literal path. */
        }
        if (/^[a-z][a-z\d+.-]*:/i.test(decoded)) return null;
        const path = parseLinktext(decoded).path;
        return (
          this.plugin.app.metadataCache.getFirstLinkpathDest(path, file.path)
            ?.path ?? null
        );
      });
      this.text = text;
      this.error = null;
      this.emit();
    } catch {
      if (revision !== this.revision) return;
      this.rows = [];
      this.error =
        "Could not read this note’s sources. Try opening the note again.";
      this.emit();
    }
  }
  async openSource(file: TFile): Promise<void> {
    this.inspecting = true;
    try {
      const workspace = this.plugin.app.workspace;
      let target: WorkspaceLeaf | null = null;
      workspace.iterateRootLeaves((leaf) => {
        if (leaf.view instanceof MarkdownView && leaf.view.file === file)
          target = leaf;
      });
      const leaf = target ?? workspace.getLeaf("tab");
      await leaf.openFile(file, { active: true });
      await workspace.revealLeaf(leaf);
    } catch {
      new Notice("Could not open the literature note.");
    } finally {
      this.inspecting = false;
    }
  }
  async returnToDocument(occurrence?: SourceOccurrence): Promise<void> {
    const file = this.document;
    if (!file) return;
    const snapshot = this.text;
    try {
      const workspace = this.plugin.app.workspace;
      let target: WorkspaceLeaf | null = null;
      workspace.iterateRootLeaves((leaf) => {
        if (leaf.view instanceof MarkdownView && leaf.view.file === file)
          target = leaf;
      });
      const leaf = target ?? workspace.getLeaf("tab");
      await leaf.openFile(file, { active: true });
      await workspace.revealLeaf(leaf);
      if (
        occurrence &&
        leaf.view instanceof MarkdownView &&
        leaf.view.getMode() === "preview"
      ) {
        await leaf.setViewState({
          type: "markdown",
          state: { file: file.path, mode: "source" },
          active: true,
        });
      }
      this.leaf = leaf;
      if (occurrence && leaf.view instanceof MarkdownView) {
        const editor = leaf.view.editor;
        if (editor.getValue() !== snapshot) {
          this.schedule();
          new Notice(
            "The note changed. Select the occurrence again after the list updates.",
          );
          return;
        }
        const from = editor.offsetToPos(occurrence.from);
        const to = editor.offsetToPos(occurrence.to);
        editor.setSelection(from, to);
        editor.scrollIntoView({ from, to }, true);
        editor.focus();
      }
    } catch {
      new Notice("Could not return to the source document.");
    }
  }
}
