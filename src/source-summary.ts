import {
  Component,
  MarkdownView,
  Notice,
  TFile,
  editorInfoField,
  parseYaml,
  type Editor,
  type WorkspaceLeaf,
} from "obsidian";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { MapMode } from "@codemirror/state";
import {
  LiteratureNoteSearchModal,
  buildLiteratureNoteEntries,
  literatureNoteEntryFromFrontmatter,
  type LiteratureNoteEntry,
} from "./library-search-modal";
import { splitFrontmatterContent } from "./literature-note-frontmatter";
import {
  NOTE_LAYOUT_KEY,
  readLiteratureNoteLayout,
} from "./literature-note-layout";
import {
  DEFAULT_SOURCE_SUMMARY_TEMPLATE,
  escapeSummaryText,
  renderSourceSummary,
} from "./source-summary-template";
import { summaryInsertion } from "./source-summary-insertion";
import type StratumPlugin from "./plugin";

interface Destination {
  view: MarkdownView;
  file: TFile;
  from: number;
  to: number;
}

export function summaryPositionError(
  content: string,
  from: number,
  to: number,
): string | null {
  if (from < 0 || to < from || to > content.length)
    return "The saved insertion position is no longer valid. Place your cursor again.";
  const { frontmatter, body } = splitFrontmatterContent(content, parseYaml);
  // The shared splitter requires a YAML content line and misses an empty block.
  const emptyProperties = /^\uFEFF?---\r?\n---(?:\r?\n|$)/.exec(content);
  // The shared splitter returns the whole document when YAML cannot be parsed.
  // Do not mistake malformed properties for an ordinary writable note body.
  if (
    !emptyProperties &&
    body === content &&
    /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(content)
  )
    return "Fix the note's invalid properties before inserting a summary.";
  const bodyOffset =
    emptyProperties?.[0].length ?? content.length - body.length;
  if (from < bodyOffset)
    return "Place the cursor in the note body, below its properties.";
  if (frontmatter.stratum_note_type !== "literature-note") return null;
  const layout = readLiteratureNoteLayout(body, frontmatter[NOTE_LAYOUT_KEY]);
  if (!layout)
    return "Restore this literature note's Stratum boundary before inserting a summary.";
  const start = layout.legacy
    ? content.length - (layout.personal.length - "## My Notes\n".length)
    : bodyOffset;
  const end = layout.legacy
    ? content.length
    : bodyOffset + layout.personal.length;
  return from < start || (layout.legacy ? to > end : to >= end)
    ? "Place the cursor and any selection in the literature note's custom area, away from its sync boundary."
    : null;
}

export class SourceSummaries extends Component {
  private destination: Destination | null = null;
  private bookmarks = new Set<Destination>();
  private listeners = new Set<() => void>();
  constructor(private plugin: StratumPlugin) {
    super();
  }

  onload(): void {
    this.registerEvent(
      this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
        // Capture the outgoing editor before Browse takes focus.
        if (this.destination && this.valid(this.destination)) {
          const editor = this.destination.view.editor;
          this.destination.from = editor.posToOffset(editor.getCursor("from"));
          this.destination.to = editor.posToOffset(editor.getCursor("to"));
        }
        if (
          leaf?.view instanceof MarkdownView &&
          leaf.view.getMode() === "source"
        )
          this.capture(leaf.view);
        this.notify();
      }),
    );
    this.registerEvent(
      this.plugin.app.workspace.on("layout-change", () => this.notify()),
    );
    this.registerEvent(this.plugin.app.vault.on("delete", () => this.notify()));
    this.registerEvent(this.plugin.app.vault.on("rename", () => this.notify()));
    const active = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) this.capture(active);
    this.register(() => {
      this.destination = null;
      this.bookmarks.clear();
      this.listeners.clear();
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private valid(target: Destination): boolean {
    return (
      !this.plugin.isUnloaded &&
      target.view.file === target.file &&
      target.view.getMode() === "source" &&
      this.plugin.app.vault.getAbstractFileByPath(target.file.path) ===
        target.file &&
      this.plugin.app.workspace
        .getLeavesOfType("markdown")
        .some((leaf) => leaf.view === target.view)
    );
  }
  capture(view: MarkdownView): Destination | null {
    if (!view.file || view.getMode() !== "source") return null;
    const changed =
      this.destination?.view !== view || this.destination?.file !== view.file;
    const editor = view.editor;
    this.destination = {
      view,
      file: view.file,
      from: editor.posToOffset(editor.getCursor("from")),
      to: editor.posToOffset(editor.getCursor("to")),
    };
    if (changed) this.notify();
    return this.destination;
  }
  destinationStatus(): { name: string | null; error: string | null } {
    const target = this.destination;
    if (!target || !this.valid(target))
      return {
        name: null,
        error:
          "Open a working note in editing view to insert a source summary.",
      };
    return {
      name: target.file.basename,
      error: summaryPositionError(
        target.view.editor.getValue(),
        target.from,
        target.to,
      ),
    };
  }
  editorExtension() {
    // Capture the component for callbacks on the editor plugin/modal instance.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- callbacks belong to another component instance
    const controller = this;
    return ViewPlugin.fromClass(
      class {
        update(update: ViewUpdate) {
          const info = update.state.field(editorInfoField, false);
          if (!info?.editor) return;
          if (update.docChanged) {
            for (const target of new Set([
              controller.destination,
              ...controller.bookmarks,
            ])) {
              if (!target || target.view.editor !== info.editor) continue;
              if (target.view.file !== target.file) {
                // Reopening the same file later must not resurrect a stale bookmark.
                target.from = target.to = -1;
                continue;
              }
              if (target.from < 0 || target.to < 0) continue;
              const from = update.changes.mapPos(
                target.from,
                -1,
                MapMode.TrackDel,
              );
              const to = update.changes.mapPos(target.to, 1, MapMode.TrackDel);
              // A deleted anchor cannot identify the user's intended location.
              target.from = from ?? -1;
              target.to = to ?? -1;
            }
          }
          if (
            update.view.hasFocus &&
            (update.selectionSet || update.focusChanged)
          ) {
            const leaf = controller.plugin.app.workspace
              .getLeavesOfType("markdown")
              .find(
                (leaf) =>
                  leaf.view instanceof MarkdownView &&
                  leaf.view.editor === info.editor,
              );
            if (leaf?.view instanceof MarkdownView)
              controller.capture(leaf.view);
          }
        }
      },
    );
  }
  openPicker(editor: Editor): void {
    const view = this.plugin.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .find(
        (view): view is MarkdownView =>
          view instanceof MarkdownView && view.editor === editor,
      );
    const target = view && this.capture(view);
    if (!target) return;
    const error = this.destinationStatus().error;
    if (error) {
      new Notice(error);
      return;
    }
    const entries = buildLiteratureNoteEntries(this.plugin);
    if (!entries.length) {
      new Notice("Import literature notes using the search or sync tab first.");
      return;
    }
    const bookmark = { ...target };
    this.bookmarks.add(bookmark);
    // Capture the component for callbacks on the editor plugin/modal instance.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- callbacks belong to another component instance
    const controller = this;
    class Picker extends LiteratureNoteSearchModal {
      onClose() {
        controller.bookmarks.delete(bookmark);
        super.onClose();
      }
    }
    new Picker(this.plugin.app, entries, (entry) =>
      this.insert(entry.file, bookmark),
    ).open();
  }
  insert(file: TFile, target = this.destination): void {
    try {
      if (!target || !this.valid(target))
        throw new Error(
          "The destination is no longer open in editing view. Open your working note and try again.",
        );
      const app = this.plugin.app;
      if (app.vault.getAbstractFileByPath(file.path) !== file)
        throw new Error(
          "This source no longer exists. Refresh Browse and try again.",
        );
      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.stratum_note_type !== "literature-note")
        throw new Error("This source is no longer a literature note.");
      const entry: LiteratureNoteEntry = literatureNoteEntryFromFrontmatter(
        file,
        fm,
      );
      const editor = target.view.editor;
      const text = editor.getValue();
      const error = summaryPositionError(text, target.from, target.to);
      if (error) throw new Error(error);
      const link = app.fileManager.generateMarkdownLink(
        file,
        target.file.path,
        "",
        escapeSummaryText(entry.title),
      );
      const summary = renderSourceSummary(
        this.plugin.settings.sourceSummaryTemplate ??
          DEFAULT_SOURCE_SUMMARY_TEMPLATE,
        entry,
        link,
      );
      const { insert, cursor } = summaryInsertion(text, target.to, summary);
      const nextText =
        text.slice(0, target.to) + insert + text.slice(target.to);
      const current = splitFrontmatterContent(text, parseYaml);
      if (current.frontmatter.stratum_note_type === "literature-note") {
        const next = splitFrontmatterContent(nextText, parseYaml);
        const beforeLayout = readLiteratureNoteLayout(
          current.body,
          current.frontmatter[NOTE_LAYOUT_KEY],
        );
        const afterLayout = readLiteratureNoteLayout(
          next.body,
          next.frontmatter[NOTE_LAYOUT_KEY],
        );
        const personalStart = beforeLayout?.legacy
          ? text.length - beforeLayout.personal.length
          : text.length - current.body.length;
        const personalOffset = target.to - personalStart;
        // A recognizable layout is insufficient: inserted code fences can
        // expose an example marker and hide the original boundary.
        if (
          !beforeLayout ||
          !afterLayout ||
          afterLayout.legacy !== beforeLayout.legacy ||
          afterLayout.managed !== beforeLayout.managed ||
          afterLayout.personal !==
            beforeLayout.personal.slice(0, personalOffset) +
              insert +
              beforeLayout.personal.slice(personalOffset)
        )
          throw new Error(
            "This insertion would damage the Stratum boundary. Choose another position or change the template.",
          );
      }
      editor.replaceRange(insert, editor.offsetToPos(target.to));
      editor.setCursor(editor.offsetToPos(cursor));
      this.capture(target.view);
      this.notify();
      const leaf: WorkspaceLeaf = target.view.leaf;
      void app.workspace
        .revealLeaf(leaf)
        .then(() => {
          if (this.valid(target)) editor.focus();
        })
        .catch(
          () =>
            new Notice(
              "Summary inserted. Return to your working note to continue.",
            ),
        );
    } catch (error) {
      new Notice(
        error instanceof Error
          ? error.message
          : "Could not insert the source summary.",
      );
    }
  }
}
