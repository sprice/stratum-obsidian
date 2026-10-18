import installation from "../fixtures/installation.json";
import { TFile, TFolder, MarkdownView, editorInfoField } from "obsidian";
import { EditorState, StateEffect, type ChangeSet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { PublicationEditor } from "../../publication-editor";
import { stringify } from "yaml";
import { publicationYaml } from "../../publication-metadata";
import type { Editor, EditorTransaction } from "obsidian";
import {
  PublishController,
  PUBLISH_EDITOR_CHANGE_DELAY,
} from "../../publish-controller";
import { PublishPanel, type PublishViewState } from "../../view-publish";
import { PublishFontError } from "../../publish-desktop";
import type { PublishAdapter } from "../../publish-store";
import type StratumPlugin from "../../plugin";
import { createStratumButton } from "../../ui-controls";

class MemoryVault implements PublishAdapter {
  private files = new Map<string, string>();
  private directories = new Set<string>();
  failSave = false;
  failSaveOnce = false;
  catalogWrites = 0;
  private saveGate?: Promise<void>;
  private releaseSave?: () => void;
  holdSaves(hold: boolean) {
    if (hold && !this.saveGate)
      this.saveGate = new Promise<void>((resolve) => {
        this.releaseSave = resolve;
      });
    if (!hold) {
      this.releaseSave?.();
      this.saveGate = undefined;
      this.releaseSave = undefined;
    }
  }
  exists(path: string) {
    return Promise.resolve(this.files.has(path) || this.directories.has(path));
  }
  mkdir(path: string) {
    this.directories.add(path);
    return Promise.resolve();
  }
  read(path: string) {
    return Promise.resolve(this.files.get(path) ?? "");
  }
  async write(path: string, value: string) {
    await this.saveGate;
    this.catalogWrites++;
    if (this.failSave || this.failSaveOnce) {
      this.failSaveOnce = false;
      return Promise.reject(new Error("Synthetic preference save failed"));
    }
    this.files.set(path, value);
    return Promise.resolve();
  }
  rename(from: string, to: string) {
    this.files.set(to, this.files.get(from) ?? "");
    this.files.delete(from);
    return Promise.resolve();
  }
  remove(path: string) {
    this.files.delete(path);
    return Promise.resolve();
  }
  readBinary() {
    return Promise.resolve(new ArrayBuffer(0));
  }
  writeBinary(path: string) {
    this.files.set(path, "");
    return Promise.resolve();
  }
}
let controller: PublishController;
let panel: PublishPanel | undefined;
let panelState: PublishViewState;
let adapter: MemoryVault;
let sourceEditor: EditorView | undefined;
let metadata: PublicationEditor;
let editorContainer: HTMLElement | undefined;
let sourceText = "";
let currentFile: TFile;
let historyChange: { forward: ChangeSet; inverse: ChangeSet } | undefined;
let editorChangeTimer: number | undefined;
let failOpen = false;
export interface FixtureOptions {
  bodyFont?: string;
  titleFont?: string;
  theme?: "light" | "dark";
  journal?: boolean;
  acm?: boolean;
  templateId?: "general" | "academic";
  source?: string;
  editable?: boolean;
}
const root = document.querySelector<HTMLElement>("#publish")!;
const source = `---
title: Synthetic paper
authors: [Example Author]
unrelated: retained # Keep this comment
---

A synthetic paper for publishing tests.`;
async function reset(options: FixtureOptions = {}) {
  panel?.unload();
  sourceEditor?.destroy();
  sourceEditor = undefined;
  metadata?.unload();
  editorContainer?.remove();
  historyChange = undefined;
  window.clearTimeout(editorChangeTimer);
  sourceText = options.source ?? source;
  controller?.onunload();
  root.empty();
  document.body.className = `theme-${options.theme ?? "dark"}`;
  adapter = new MemoryVault();
  const publishedFiles = new Map<string, TFile | TFolder>();
  const plugin = {
    settings: {
      publishingTemplates: {
        templates: [],
        installations: [
          options.acm
            ? {
                ...installation,
                adapter: { ...installation.adapter, frontMatter: "acmart" },
              }
            : installation,
        ],
        enabledIds: ["general", "academic", "registry:example:1.0-r1"],
      },
      publishPdfSetupComplete: true,
      pandocPath: "pandoc",
      tectonicPath: "tectonic",
      citationStyle: "apa",
      citationLanguage: "en-US",
      citationStyles: {},
      citationLocales: {},
      availableCitationStyles: ["apa", "ieee"],
    },
    manifest: { id: "stratum" },
    saveSettings: () => Promise.resolve(),
    refreshViews: () => controller.emit(),
    app: {
      vault: {
        adapter,
        configDir: ".synthetic",
        async createFolder(path: string) {
          publishedFiles.set(path, Object.assign(new TFolder(), { path }));
          await adapter.mkdir(path);
        },
        async createBinary(path: string) {
          if (await adapter.exists(path)) throw new Error("File exists");
          publishedFiles.set(
            path,
            Object.assign(new TFile(), {
              path,
              extension: "pdf",
              basename: path.split("/").at(-1)!.slice(0, -4),
            }),
          );
          await adapter.writeBinary(path);
        },
        async delete(file: TFile) {
          publishedFiles.delete(file.path);
          await adapter.remove(file.path);
        },
        read: () =>
          Promise.resolve(sourceEditor?.state.doc.toString() ?? sourceText),
        getAbstractFileByPath(path: string) {
          if (publishedFiles.has(path)) return publishedFiles.get(path);
          if (!path.startsWith("Papers/Synthetic")) return null;
          return path === currentFile?.path ? currentFile : null;
        },
      },
      fileManager: {
        async trashFile(file: TFile) {
          publishedFiles.delete(file.path);
          await adapter.remove(file.path);
        },
        processFrontMatter: (
          _file: TFile,
          change: (properties: Record<string, unknown>) => void,
        ) => {
          const text = sourceEditor!.state.doc.toString(),
            parsed = publicationYaml(text);
          change(parsed.properties);
          const next = `---\n${stringify(parsed.properties)}---\n${text.slice(parsed.end)}`;
          sourceEditor!.dispatch({
            changes: { from: 0, to: text.length, insert: next },
          });
          metadata.refresh();
          return Promise.resolve();
        },
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: publicationYaml(
            sourceEditor?.state.doc.toString() ?? sourceText,
          ).properties,
        }),
      },
      workspace: {
        getMostRecentLeaf: () => null,
        revealLeaf: () => Promise.resolve(),
      },
    },
    citations: {
      preferences: () => ({
        style:
          typeof publicationYaml(
            sourceEditor?.state.doc.toString() ?? sourceText,
          ).properties.stratum_citation_style === "string"
            ? publicationYaml(sourceEditor?.state.doc.toString() ?? sourceText)
                .properties.stratum_citation_style
            : "apa",
        language: "en-US",
      }),
      invalidate: () => {},
      formatForPublication: () => Promise.resolve(undefined),
    },
  } as unknown as StratumPlugin;
  controller = new PublishController(plugin);
  plugin.publish = controller;
  controller.document = currentFile = new TFile();
  metadata = new PublicationEditor(plugin);
  plugin.publicationEditor = metadata;
  metadata.load();
  const view = new MarkdownView(undefined as never) as MarkdownView & {
    editor: Editor;
    file: TFile;
    getState: () => object;
    setState: () => Promise<void>;
  };
  view.file = currentFile;
  const editor = {
    getValue: () => sourceEditor?.state.doc.toString() ?? sourceText,
    offsetToPos: (offset: number) => {
      const line = sourceEditor!.state.doc.lineAt(offset);
      return { line: line.number - 1, ch: offset - line.from };
    },
    transaction: (transaction: EditorTransaction) => {
      const doc = sourceEditor!.state.doc;
      const change = sourceEditor!.state.update({
        changes: transaction.changes?.map((change) => ({
          from: doc.line(change.from.line + 1).from + change.from.ch,
          to: change.to
            ? doc.line(change.to.line + 1).from + change.to.ch
            : doc.line(change.from.line + 1).from + change.from.ch,
          insert: change.text,
        })),
        userEvent: "input.publication",
      });
      historyChange = {
        forward: change.changes,
        inverse: change.changes.invert(change.startState.doc),
      };
      sourceEditor!.dispatch(change);
    },
  } as unknown as Editor;
  view.editor = editor;
  const installEditor = () => {
    if (sourceEditor) return;
    editorContainer = document.body.createDiv({
      cls: "synthetic-source-editor",
    });
    editorContainer.hidden = true;
    sourceEditor = new EditorView({
      parent: editorContainer,
      state: EditorState.create({
        doc: sourceText,
        extensions: [
          editorInfoField.init(() => ({ file: currentFile, editor }) as never),
          metadata.extension(),
          // Obsidian fires workspace `editor-change` for every document change;
          // PublishController debounces it into one Publish tab update.
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            window.clearTimeout(editorChangeTimer);
            editorChangeTimer = window.setTimeout(
              () => controller.emit(),
              PUBLISH_EDITOR_CHANGE_DELAY,
            );
          }),
        ],
      }),
    });
  };
  view.getState = () => ({});
  failOpen = false;
  view.setState = () => {
    if (failOpen) {
      failOpen = false;
      // Fail after a rendered frame, as loading a note would.
      return new Promise((_, reject) =>
        window.setTimeout(
          () => reject(new Error("Synthetic note opening error")),
          100,
        ),
      );
    }
    installEditor();
    return Promise.resolve();
  };
  controller.leaf = { view } as never;
  if (options.editable !== false) installEditor();
  // Citation style resources belong to Obsidian's host, not this recovery scenario.
  controller.citationStyleChoices = () => {
    const fields = publicationYaml(
      sourceEditor?.state.doc.toString() ?? sourceText,
    ).properties;
    return Promise.resolve({
      path: currentFile.path,
      inherited: !Object.hasOwn(fields, "stratum_citation_style"),
      selected:
        typeof fields.stratum_citation_style === "string"
          ? fields.stratum_citation_style
          : "apa",
      unavailable: false,
      options: [
        { id: "apa", title: "APA" },
        { id: "ieee", title: "IEEE" },
      ],
    });
  };
  const note = await controller.store.note(
    controller.document.path,
    "Synthetic paper",
    1,
  );
  await controller.updatePreferences({
    templateId: options.journal
      ? "registry:example:1.0-r1"
      : (options.templateId ?? "general"),
  });
  const preferences = {
    ...controller.notePreferences,
    pdf: { ...controller.layout },
  };
  preferences.pdf.bodyFont = options.bodyFont ?? "Missing Body Serif";
  preferences.pdf.titleFont = options.titleFont ?? "";
  await controller.store.setPreferences(note.id, preferences);
  await controller.reload();
  panelState = { section: "publish", documents: {} };
  panel = new PublishPanel(root, controller, panelState);
  panel.onload();
}
export const publicationFixture = {
  setEnabledTemplates(enabledIds: string[]) {
    controller.plugin.settings.publishingTemplates = {
      ...controller.plugin.settings.publishingTemplates!,
      enabledIds,
    };
    controller.emit();
  },
  setTitleSource(titleSource: "body" | "properties") {
    return controller.updateLayout({ titleSource });
  },
  remountPanel() {
    panel?.unload();
    root.empty();
    panel = new PublishPanel(root, controller, panelState);
    panel.onload();
  },
  async confirmPublished() {
    const id = crypto.randomUUID();
    const note = await controller.store.note(
      controller.document!.path,
      controller.document!.basename,
      controller.document!.stat.ctime,
    );
    await controller.store.create(
      {
        id,
        noteId: note.id,
        format: "pdf",
        createdAt: new Date().toISOString(),
        citationStyle: "apa",
        citationLanguage: "en-US",
      },
      "Synthetic paper",
      new ArrayBuffer(0),
    );
    await controller.reload();
    controller.lastPublishedId = id;
    controller.emit();
  },
  openCommandSettings() {
    return controller.openSettings(root);
  },
  reset,
  text() {
    return sourceEditor?.state.doc.toString() ?? sourceText;
  },
  replaceText(text: string) {
    sourceEditor!.dispatch({
      changes: { from: 0, to: sourceEditor!.state.doc.length, insert: text },
    });
    metadata.refresh();
  },
  makeEditorReadOnly() {
    sourceEditor!.dispatch({
      effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
    });
  },
  detachEditor() {
    sourceEditor!.destroy();
  },
  undoMetadataEdit() {
    if (historyChange)
      sourceEditor!.dispatch({
        changes: historyChange.inverse,
        userEvent: "undo",
      });
  },
  redoMetadataEdit() {
    if (historyChange)
      sourceEditor!.dispatch({
        changes: historyChange.forward,
        userEvent: "redo",
      });
  },
  selectTemplate(templateId: string) {
    return controller.updatePreferences({ templateId });
  },
  buttonReferences() {
    const actions = root.createDiv({ cls: "stratum-actions" });
    // Same factory, primary option and action container as the Sync all papers control.
    createStratumButton(actions, {
      text: "Sync all papers",
      primary: true,
      className: "synthetic-sync-reference",
    });
    createStratumButton(actions, {
      text: "Secondary action",
      className: "synthetic-secondary-reference",
    });
  },
  setBusy(busy: boolean) {
    controller.busy = busy;
    controller.emit();
  },
  resetSaveCount() {
    adapter.catalogWrites = 0;
  },
  switchNote() {
    const file = new TFile();
    file.path = "Papers/Synthetic second paper.md";
    file.basename = "Synthetic second paper";
    controller.document = file;
    controller.emit();
  },
  async addDocuments(count = 1) {
    const note = await controller.store.note(
      controller.document!.path,
      "Synthetic paper",
      1,
    );
    for (let index = 0; index < count; index++)
      await controller.store.create(
        {
          id: crypto.randomUUID(),
          noteId: note.id,
          format: "pdf",
          createdAt: "2026-10-11T12:00:00Z",
          citationStyle: "apa",
          citationLanguage: "en-US",
        },
        "Synthetic paper",
        new ArrayBuffer(0),
      );
    await controller.reload();
  },
  holdSaves(value: boolean) {
    adapter.holdSaves(value);
  },
  failNextSave() {
    adapter.failSaveOnce = true;
  },
  failSave(value: boolean) {
    adapter.failSave = value;
  },
  /** The next attempt to make the note editable fails. */
  failNextOpen() {
    failOpen = true;
  },
  unrelatedError() {
    controller.fail(new Error("Synthetic unrelated publishing error"));
  },
  state() {
    return {
      error: controller.error,
      editable:
        !!controller.document && !!metadata.editableView(controller.document),
      pending:
        !!controller.document && metadata.pending(controller.document.path),
      canCreate: controller.canCreate(),
      titleSource: controller.layout.titleSource,
      saving: controller.preferencesSaving,
      busy: controller.busy,
      bodyFont: controller.layout.bodyFont,
      titleFont: controller.layout.titleFont,
      fonts: controller.fontError?.fonts ?? [],
      saveCount: adapter.catalogWrites,
    };
  },
  injectEngineError(font: string) {
    controller.fail(new PublishFontError(font));
  },
};
declare global {
  interface Window {
    publicationFixture: typeof publicationFixture;
  }
}
window.publicationFixture = publicationFixture;
await reset();
document.body.dataset.ready = "true";
