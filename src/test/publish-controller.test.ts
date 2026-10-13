import { aastexHeadingIssues } from "../publication-heading-preview";
import { readNotePreferences } from "../publish-options";
import { aastexManuscript, aastexPackage } from "../publication-package";
import { publicationYaml } from "../publication-metadata";
import {
  DEFAULT_AASTEX_PDF_OPTIONS,
  readAastexPdfOptions,
} from "../publication-options";
import { AASTEX_PACKAGE_REFERENCE } from "../publication-package";
import * as publicationPackage from "../publication-package";
import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import type { PublishReadiness } from "../publish-desktop";
import type { StratumSettings } from "../settings-data";
import { webcrypto } from "node:crypto";
import { loadRuntime } from "./runtime-harness";
import type * as Controller from "../publish-controller";
import type { PublishAdapter } from "../publish-store";
class File {
  stat = { ctime: 1 };
  extension = "md";
  constructor(public path: string) {}
  get basename() {
    return this.path.replace(/\.md$/, "");
  }
}
class View {
  leaf?: { view: View };
  editor = { getValue: () => this.text };
  constructor(
    public file: File,
    public text: string,
  ) {}
}
const readySupport: PublishReadiness = {
  pdf: true,
  pandoc: { path: "/synthetic/pandoc", version: "3" },
  tectonic: { path: "/synthetic/tectonic", version: "0.17" },
};
const cachedSupport = () => ({
  version: 1 as const,
  pandocPath: "",
  tectonicPath: "",
  readiness: structuredClone(readySupport),
});
class FontError extends Error {
  fonts = ["Missing body"];
}
function setup(settings: Partial<StratumSettings> = {}, selected = true) {
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const calls = {
    detect: 0,
    probe: [] as string[],
    check: 0,
    save: 0,
    format: 0,
    aastex: 0,
    parse: 0,
    settings: [] as string[],
    settingsClosed: 0,
  };
  const payloads: unknown[] = [];
  const behavior = {
    missing: "",
    conversionError: "",
    probeError: "",
    renderError: "",
    detection: Promise.resolve(),
    headingIssues: [] as string[],
  };

  const files = new Map<string, string | ArrayBuffer>();
  const events = new Map<string, (...args: never[]) => void>();
  const adapter: PublishAdapter = {
    exists: (path) => Promise.resolve(files.has(path)),
    mkdir: (path) => {
      files.set(path, "");
      return Promise.resolve();
    },
    read: (path) => Promise.resolve(files.get(path) as string),
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    readBinary: (path) => Promise.resolve(files.get(path) as ArrayBuffer),
    writeBinary: (path, bytes) => {
      files.set(path, bytes);
      return Promise.resolve();
    },
    rename: (from, to) => {
      if (files.has(to))
        return Promise.reject(new Error("Destination file already exists!"));
      if (!files.has(from))
        return Promise.reject(new Error("Source file missing"));
      files.set(to, files.get(from)!);
      files.delete(from);
      return Promise.resolve();
    },
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
  };
  let release!: () => void;
  const conversion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const conversionTools: {
    bibliographyCache?: { directory: string; adapter: unknown };
  }[] = [];
  const rendered: { text: string; path: string; title: string }[] = [];
  const { PublishController } = loadRuntime<typeof Controller>(
    "publish-controller.ts",
    {
      Component: class {
        registerEvent() {}
      },
      Platform: { isDesktopApp: true },
      FileSystemAdapter: class {},
      MarkdownView: View,
      TFile: File,
      Notice: class {},
      parseYaml: JSON.parse,
    },
    {
      AbortController,
      TextEncoder,
      Error,
      crypto: webcrypto,
      window: {
        setTimeout(callback: () => void, delay: number) {
          timers.set(++timerId, { callback, delay });
          return timerId;
        },
        clearTimeout(id: number) {
          timers.delete(id);
        },
      },
    },
    "browser",
    {
      // Count manuscript parses while keeping the shipped parser.
      "./publication-package": {
        ...publicationPackage,
        aastexManuscript: (
          ...args: Parameters<typeof publicationPackage.aastexManuscript>
        ) => {
          calls.parse++;
          return publicationPackage.aastexManuscript(...args);
        },
        aastexProblems: (
          ...args: Parameters<typeof publicationPackage.aastexProblems>
        ) => {
          calls.parse++;
          return publicationPackage.aastexProblems(...args);
        },
      },
      "./publication-options-modal": {
        PublishingSettingsModal: class {
          constructor(
            _app: unknown,
            private publish: {
              document: File;
              settingsClosed(modal: unknown): void;
            },
            public launcher: unknown,
          ) {}
          open() {
            calls.settings.push(this.publish.document.path);
          }
          close() {
            calls.settingsClosed++;
            this.publish.settingsClosed(this);
          }
          adoptLauncher(launcher: unknown) {
            this.launcher = launcher;
          }
        },
      },
      "./publication-heading-preview": { aastexHeadingIssues },
      "./publication-render": {
        renderAastexPublication: (
          _app: unknown,
          _service: unknown,
          text: string,
          _path: string,
          _title: string,
          publishing: ReturnType<typeof readNotePreferences>,
        ) => {
          calls.aastex++;
          return Promise.resolve({
            html: "packaged synthetic",
            assets: [],
            aastex: {
              manuscript: aastexManuscript(text, publishing.pdf.titleSource),
              abstractHtml: "<p>Synthetic abstract</p>",
              references: [],
              options: readAastexPdfOptions(publishing.aastex?.options),
              headingIssues: behavior.headingIssues,
            },
          });
        },
      },
      "./publish-render": {
        renderPublication: (
          _app: unknown,
          text: string,
          path: string,
          title: string,
        ) => {
          if (behavior.renderError) throw new Error(behavior.renderError);
          rendered.push({ text, path, title });
          return Promise.resolve({ html: "synthetic", assets: [] });
        },
      },
      "./publish-desktop": {
        PublishFontError: FontError,
        detectPublishTool: async (name: "pandoc" | "tectonic") => {
          calls.detect++;
          await behavior.detection;
          return behavior.missing === name
            ? { path: "", version: "", error: "Missing" }
            : readySupport[name];
        },
        probePublication: (format: string) => {
          calls.probe.push(format);
          return behavior.probeError
            ? Promise.reject(new Error(behavior.probeError))
            : Promise.resolve();
        },
        checkPublishing: () => {
          calls.check++;
          return Promise.resolve(structuredClone(readySupport));
        },
        convertPublication: async (
          _html: string,
          _assets: unknown,
          _format: string,
          tools: {
            bibliographyCache?: { directory: string; adapter: unknown };
          },
          signal: AbortSignal,
          _timeout: number,
          _layout: unknown,
          aastex: unknown,
        ) => {
          payloads.push(aastex);
          conversionTools.push(tools);
          await conversion;
          if (signal.aborted) throw new Error("Publishing cancelled.");
          if (behavior.conversionError)
            throw new Error(behavior.conversionError);
          return new ArrayBuffer(4);
        },
      },
    },
  );
  const first = new File("First.md"),
    second = new File("Second.md");
  const leaf = { view: new View(first, "Unsaved first note") },
    other = { view: new View(second, "Second note") };
  leaf.view.leaf = leaf;
  other.view.leaf = other;
  const roots = [leaf, other];
  const opened: File[] = [];
  const revealed: object[] = [];
  const plugin = {
    manifest: { id: "stratum" },
    settings: {
      citationStyle: "apa",
      citationLanguage: "en-US",
      pandocPath: "",
      tectonicPath: "",
      ...settings,
    },
    saveSettings: () => {
      calls.save++;
      return Promise.resolve();
    },
    citations: {
      preferences: () => ({ style: "apa", language: "en-US" }),
      formatForPublication: () => {
        calls.format++;
        return Promise.resolve(undefined);
      },
    },
    app: {
      metadataCache: {
        on: (event: string, callback: (...args: never[]) => void) => {
          events.set(`metadata:${event}`, callback);
          return {};
        },
      },
      fileManager: {
        processFrontMatter: (
          file: File,
          change: (properties: Record<string, unknown>) => void,
        ) => {
          const root = roots.find((root) => root.view.file === file)!;
          const match = /^---\n(.*?)\n---\n/s.exec(root.view.text);
          const properties = match
            ? (JSON.parse(match[1]) as Record<string, unknown>)
            : {};
          change(properties);
          root.view.text = `---\n${JSON.stringify(properties)}\n---\n${match ? root.view.text.slice(match[0].length) : root.view.text}`;
          return Promise.resolve();
        },
      },
      vault: {
        adapter,
        read: (file: File) =>
          Promise.resolve(
            roots.find((root) => root.view.file === file)?.view.text ?? "",
          ),
        configDir: ".config",
        getAbstractFileByPath: (path: string) =>
          [first, second].find((file) => file.path === path) ?? null,
        on: (event: string, callback: (...args: never[]) => void) => {
          events.set(event, callback);
          return {};
        },
      },
      workspace: {
        getLeaf: () => ({
          openFile: (file: File) => {
            opened.push(file);
            return Promise.resolve();
          },
        }),
        revealLeaf: (leaf: object) => {
          revealed.push(leaf);
          return Promise.resolve();
        },
        rootSplit: {},
        getMostRecentLeaf: () => roots[0] ?? null,
        iterateRootLeaves: (callback: (leaf: object) => void) => {
          roots.forEach(callback);
        },
        on: (event: string, callback: (...args: never[]) => void) => {
          events.set(event, callback);
          return {};
        },
      },
    },
  };
  const controller = new PublishController(plugin as never);
  controller.onload();
  const catalog = {
    version: 1 as const,
    notes: selected
      ? [
          {
            id: "synthetic-note",
            path: first.path,
            title: first.basename,
            ctime: first.stat.ctime,
            preferences: readNotePreferences({ templateId: "general" }),
          },
        ]
      : [],
    documents: [],
  };
  files.set(".config/stratum/published/catalog.json", JSON.stringify(catalog));
  controller.catalog = catalog;
  controller.readiness ??= {
    pdf: true,
    pandoc: { path: "pandoc", version: "3" },
    tectonic: { path: "tectonic", version: "0.17" },
  };
  return {
    opened,
    revealed,
    timers,
    controller,
    leaf,
    other,
    rendered,
    release,
    events,
    roots,
    plugin,
    calls,
    payloads,
    conversionTools,
    behavior,
  };
}

test("switching notes during publication preserves the click-time document and ignores duplicate clicks", async () => {
  const { controller, leaf, other, rendered, release } = setup();
  const pending = controller.create();
  controller.document = other.view.file as never;
  controller.leaf = other as never;
  leaf.view.text = "Changed after click";
  await controller.create();
  release();
  await pending;
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].text, "Unsaved first note");
  assert.equal(rendered[0].path, "First.md");
  const catalog = await controller.store.list();
  assert.equal(catalog.documents.length, 1);
  assert.equal(catalog.notes[0].path, "First.md");
  assert.equal(controller.documents.length, 0);
  controller.document = leaf.view.file as never;
  assert.equal(controller.documents.length, 1);
});

test("all publication history is sorted without mutating the catalog and works without a note", () => {
  const { controller } = setup();
  const makeDocument = (id: string, noteId: string, createdAt: string) => ({
    id,
    noteId,
    filename: `${id}.pdf`,
    format: "pdf" as const,
    createdAt,
    citationStyle: "apa",
    citationLanguage: "en-US",
  });
  controller.catalog = {
    version: 1,
    notes: [
      { id: "first", path: "First.md", title: "First", ctime: 1 },
      { id: "second", path: "Second.md", title: "Second", ctime: 2 },
    ],
    documents: [
      makeDocument("older", "first", "2026-10-01T12:00:00Z"),
      makeDocument("newer", "second", "2026-10-05T12:00:00Z"),
    ],
  };
  assert.deepEqual(
    Array.from(controller.documents, (d) => d.id),
    ["older"],
  );
  assert.deepEqual(
    Array.from(controller.allDocuments, (d) => d.id),
    ["newer", "older"],
  );
  assert.deepEqual(
    controller.catalog.documents.map((d) => d.id),
    ["older", "newer"],
  );
  controller.document = null;
  assert.equal(controller.documents.length, 0);
  assert.equal(controller.allDocuments.length, 2);
});

test("opening a publication source reuses its main editor or opens a new main tab", async () => {
  const { controller, leaf, roots, opened, revealed } = setup();
  const document = {
    id: "publication",
    noteId: "source",
    filename: "Synthetic.pdf",
    format: "pdf" as const,
    createdAt: "2026-10-05T12:00:00Z",
    citationStyle: "apa",
    citationLanguage: "en-US",
  };
  controller.catalog = {
    version: 1,
    notes: [{ id: "source", path: "First.md", title: "First", ctime: 1 }],
    documents: [document],
  };
  await controller.openSource(document);
  assert.equal(revealed[0], leaf);
  assert.equal(opened.length, 0);
  roots.splice(0, 1);
  await controller.openSource(document);
  assert.equal(opened[0], leaf.view.file);
  assert.equal(revealed.length, 2);
  leaf.view.file.stat.ctime = 2;
  assert.equal(controller.sourceNote(document), null);
  await controller.openSource(document);
  assert.equal(
    opened.length,
    1,
    "a replacement file is not the published source",
  );
  controller.catalog.notes[0].path = null;
  assert.equal(controller.sourceNote(document), null);
});

test("sidebar focus preserves selected note and another root Markdown note replaces it", () => {
  const { controller, events, other } = setup();
  events.get("active-leaf-change")!({ view: {} } as never);
  assert.equal(controller.document?.path, "First.md");
  events.get("active-leaf-change")!(other as never);
  assert.equal(controller.document?.path, "Second.md");
});

test("editing publication details opens the source when its Markdown tab is closed", async () => {
  const { controller, plugin, leaf, roots, revealed, opened } = setup();
  const editing: View[] = [];
  Object.assign(plugin, {
    publicationEditor: {
      open: (view: View) => {
        editing.push(view);
        return Promise.resolve();
      },
    },
  });
  await controller.editPublicationDetails();
  assert.equal(editing[0], leaf.view);
  assert.equal(opened.length, 0);

  roots.splice(0, 1);
  controller.leaf = null;
  const replacement = { view: new View(leaf.view.file, "Saved source") };
  plugin.app.workspace.getLeaf = () => ({
    ...replacement,
    openFile: (file: File) => {
      opened.push(file);
      roots.push(replacement);
      return Promise.resolve();
    },
  });
  await controller.editPublicationDetails();
  assert.equal(opened[0], leaf.view.file);
  assert.equal(editing[1], replacement.view);
  assert.equal(revealed.length, 2);
});

test("a tab opened for editing keeps the note until the tab shows it", async () => {
  const { controller, plugin, leaf, roots, events, revealed } = setup();
  Object.assign(plugin, {
    publicationEditor: { open: () => Promise.resolve() },
  });
  const file = leaf.view.file;
  roots.splice(0, 1);
  controller.leaf = null;
  const activate = (target: object) =>
    (events.get("active-leaf-change") as (leaf: object) => void)(target);
  const layoutChange = events.get("layout-change") as () => void;
  const followed: unknown[] = [];
  const tab: { view: object; openFile(file: File): Promise<void> } = {
    view: { getViewType: () => "empty" },
    openFile(opened) {
      // Obsidian can add, activate and lay out a new tab before its note loads.
      roots.unshift(tab as never);
      layoutChange();
      followed.push(controller.document);
      activate(tab);
      followed.push(controller.document);
      tab.view = new View(opened, "Loaded source");
      layoutChange();
      activate(tab);
      followed.push(controller.document);
      return Promise.resolve();
    },
  };
  plugin.app.workspace.getLeaf = () => tab;
  const emitted: unknown[] = [];
  controller.subscribe(() => emitted.push(controller.document));
  await controller.editPublicationDetails();
  assert.deepEqual(followed, [file, file, file]);
  assert.ok(
    emitted.every((document) => document === file),
    "the settings window never sees another note",
  );
  assert.equal(controller.leaf, tab);
  assert.deepEqual(revealed, [tab]);
  tab.view = { getViewType: () => "empty" };
  activate(tab);
  assert.equal(controller.document, null, "later tab changes are followed");
});

test("unload cancels conversion before a document is added", async () => {
  const { controller, release } = setup();
  const pending = controller.create();
  controller.onunload();
  release();
  await pending;
  assert.equal((await controller.store.list()).documents.length, 0);
  assert.equal(controller.busy, false);
});

test("switching to a non-Markdown main pane clears the publication source", () => {
  const { controller, events, other } = setup();
  Object.assign(other, { view: {} });
  events.get("active-leaf-change")!(other as never);
  assert.equal(controller.document, null);
  assert.equal(controller.canCreate(), false);
});

test("closing the selected note clears stale editor state", () => {
  const { controller, events, roots } = setup();
  roots.splice(0);
  events.get("layout-change")!();
  assert.equal(controller.document, null);
  assert.equal(controller.leaf, null);
  assert.equal(controller.canCreate(), false);
});

test("a PDF preview follows its source note and keeps the open source editor", () => {
  const { controller, leaf, other, events, roots } = setup();
  controller.catalog = {
    version: 1,
    notes: [
      { id: "note", path: leaf.view.file.path, title: "First", ctime: 1 },
    ],
    documents: [
      {
        id: "pdf",
        noteId: "note",
        filename: "First.pdf",
        format: "pdf",
        createdAt: new Date().toISOString(),
        citationStyle: "apa",
        citationLanguage: "en-US",
      },
    ],
  };
  events.get("active-leaf-change")!(other as never);
  const preview = {
    view: {
      getViewType: () => "stratum-publish-preview",
      getState: () => ({ documentId: "pdf" }),
    },
  };
  roots.push(preview as never);
  events.get("active-leaf-change")!(preview as never);
  assert.equal(controller.document, leaf.view.file);
  assert.equal(controller.leaf, leaf);
  assert.equal(controller.documents.length, 1);
  roots.splice(0, 1);
  events.get("active-leaf-change")!(preview as never);
  assert.equal(
    controller.document,
    leaf.view.file,
    "preview works even when the source tab is closed",
  );
  assert.equal(controller.leaf, null);
});

test("AASTeX preview readiness reloads the source after its editor closes and metadata changes", async () => {
  const { controller, plugin, leaf, roots, events } = setup();
  let saved = aastexPackage.files["examples/manuscript.md"];
  leaf.view.text = saved;
  plugin.app.vault.read = () => Promise.resolve(saved);
  controller.catalog!.notes[0].preferences = readNotePreferences({
    templateId: "package:aastex",
    pdf: { titleSource: "properties" },
  });
  controller.catalog!.documents.push({
    id: "pdf",
    noteId: "synthetic-note",
    filename: "First.pdf",
    format: "pdf",
    createdAt: new Date().toISOString(),
    citationStyle: "aastex",
    citationLanguage: "en-US",
  });
  assert.equal(controller.academicProblem, "");
  const preview = {
    view: {
      getViewType: () => "stratum-publish-preview",
      getState: () => ({ documentId: "pdf" }),
    },
  };
  roots.push(preview as never);
  events.get("active-leaf-change")!(preview as never);
  roots.splice(0, 1);
  events.get("active-leaf-change")!(preview as never);
  await settle();
  assert.equal(controller.leaf, null);
  assert.equal(controller.academicProblem, "");
  assert.equal(controller.canCreate(), true);

  saved = saved.replace(/title: [^\n]+/, 'title: ""');
  events.get("metadata:changed")!(leaf.view.file as never);
  await settle();
  assert.match(controller.academicProblem, /manuscript title/);
  assert.equal(controller.canCreate(), false);
});

test("cancelled PDF publishing keeps the source for retry", async () => {
  const { controller, release } = setup();
  const pending = controller.create();
  controller.cancel();
  release();
  await pending;
  assert.equal((await controller.store.list()).documents.length, 0);
  assert.equal(controller.canCreate(), true);
});

test("cached support is available immediately and only silently detects tools once per launch", async () => {
  const { controller, calls, release, plugin } = setup({
    publishReadinessCache: cachedSupport(),
  });
  assert.equal(controller.readiness?.pdf, true);
  assert.equal(controller.checking, false);
  assert.equal(controller.progress, "");
  await settle();
  controller.subscribe(() => {})();
  controller.subscribe(() => {})();
  release();
  await controller.create();
  await controller.create();
  assert.equal(calls.detect, 2);
  assert.equal(calls.check, 0);
  assert.deepEqual(calls.probe, []);
  assert.equal(plugin.settings.publishReadinessCache?.readiness.pdf, true);
});

test("legacy successful PDF setup migrates silently without a conversion check", async () => {
  const { controller, calls, plugin } = setup({
    publishPdfSetupComplete: true,
  });
  assert.equal(controller.readiness?.pdf, true);
  await settle();
  assert.equal(calls.check, 0);
  assert.deepEqual(calls.probe, []);
  assert.equal(plugin.settings.publishReadinessCache?.readiness.pdf, true);
});

test("a tool removed before startup invalidates persisted support without checking text", async () => {
  const { controller, calls, behavior, plugin } = setup({
    publishReadinessCache: cachedSupport(),
  });
  behavior.missing = "tectonic";
  await settle();
  assert.equal(controller.readiness?.pdf, false);
  assert.equal(plugin.settings.publishPdfSetupComplete, false);
  assert.equal(plugin.settings.publishReadinessCache?.readiness.pdf, false);
  assert.equal(controller.progress, "");
  assert.equal(calls.check, 0);
});

test("failed conversion detects lost tools after launch and preserves the original error", async () => {
  const { controller, behavior, calls, release } = setup();
  behavior.conversionError = "Pandoc could not start";
  behavior.missing = "pandoc";
  release();
  await controller.create();
  assert.equal(controller.readiness?.pdf, false);
  assert.match(controller.error, /Pandoc could not start/);
  assert.equal(
    controller.errorMessage,
    "There was an error creating the PDF file",
  );
  assert.equal(calls.detect, 2);
  assert.deepEqual(calls.probe, []);
});

test("document-specific conversion failures keep support while failed synthetic probes invalidate only the affected format", async () => {
  for (const probeError of ["", "Synthetic PDF failure"]) {
    const { controller, behavior, calls, plugin, release } = setup();
    controller.readiness = structuredClone(readySupport);
    behavior.conversionError = "Invalid document content";
    behavior.probeError = probeError;
    release();
    await controller.create();
    assert.equal(controller.readiness?.pdf, !probeError);
    assert.equal(
      plugin.settings.publishReadinessCache?.readiness.pdf,
      !probeError,
    );
    assert.match(controller.error, /Invalid document content/);
    assert.equal(
      controller.errorMessage,
      "There was an error creating the PDF file",
    );
    assert.deepEqual(calls.probe, ["pdf"]);
  }
});

test("rendering failures and cancellation do not diagnose or invalidate tools", async () => {
  const { controller, behavior, calls, release } = setup();
  behavior.renderError = "Unsupported embedded note";
  release();
  await controller.create();
  assert.equal(calls.detect, 0);
  behavior.renderError = "";
  const pending = controller.create();
  controller.cancel();
  await pending;
  assert.equal(calls.detect, 0);
  assert.deepEqual(calls.probe, []);
});

test("changing executable paths prevents an in-flight startup check from restoring stale support", async () => {
  const { controller, plugin } = setup({
    publishReadinessCache: cachedSupport(),
  });
  plugin.settings.pandocPath = "/other/pandoc";
  controller.invalidateSupport();
  await settle();
  assert.equal(controller.readiness, null);
  assert.equal(plugin.settings.publishReadinessCache, null);
  assert.equal(plugin.settings.publishPdfSetupComplete, false);
});

test("explicit setup persists verified support for the next launch", async () => {
  const { controller, plugin } = setup();
  await controller.check(true);
  assert.equal(plugin.settings.publishReadinessCache?.readiness.pdf, true);
  assert.equal(plugin.settings.publishPdfSetupComplete, true);
});

test("publishing preferences serialize PDF edits and follow supported moves", async () => {
  const { controller } = setup();
  await controller.updatePreferences({ templateId: "academic" });
  await Promise.all([
    controller.updateLayout({ bodyFont: "Georgia" }),
    controller.updateLayout({ titleSize: 28 }),
  ]);
  assert.equal(controller.layout.bodyFont, "Georgia");
  assert.equal(controller.layout.titleSize, 28);
  await controller.updateLayout({ bodyFont: "Arial" });
  await controller.store.move("First.md", "Papers/Renamed.md");
  await controller.reload();
  const stored = (await controller.store.list()).notes[0].preferences!;
  assert.equal(stored.documentType, "academic");
  assert.equal(stored.pdf.titleSize, 28);
  assert.equal(stored.pdf.bodyFont, "Arial");
  assert.equal(controller.preferencesSaving, false);
});

test("publishing errors expire after five seconds without refreshes extending them", () => {
  const { controller, timers } = setup();
  controller.fail(new Error("Synthetic failure"));
  assert.equal(controller.errorMessage, "There was an error with publishing");
  const [firstId, first] = [...timers.entries()][0];
  assert.equal(first.delay, 5_000);
  controller.emit();
  assert.equal(timers.get(firstId), first);
  first.callback();
  timers.delete(firstId);
  assert.equal(controller.error, "");
  assert.equal(controller.errorMessage, "");
  controller.fail(new Error("Another failure"));
  const secondId = [...timers.keys()][0];
  controller.fail(new Error("New failure"));
  assert.equal(timers.has(secondId), false);
  assert.equal(timers.size, 1);
  controller.onunload();
  assert.equal(timers.size, 0);
});

test("font errors persist and clear only after a successful font change", async () => {
  const { controller, timers } = setup();
  controller.fail(new FontError("Missing font"));
  assert.equal(timers.size, 0);
  assert.ok(controller.fontError);
  await controller.updateLayout({ bodySize: 11 });
  assert.equal(controller.error, "Missing font");
  await controller.updateLayout({ bodyFont: "Georgia" });
  assert.equal(controller.error, "");
  assert.equal(controller.fontError, null);
  controller.fail(new Error("Unrelated export error"));
  await controller.updateLayout({ bodyFont: "Arial" });
  assert.equal(controller.error, "Unrelated export error");
  controller.fail(new FontError("Missing font"));
  controller.store.setPreferences = () =>
    Promise.reject(new Error("Save failed"));
  await assert.rejects(
    controller.updateLayout({ bodyFont: "" }),
    /Save failed/,
  );
  assert.equal(controller.error, "Save failed");
  assert.equal(controller.layout.bodyFont, "Arial");
});

test("the packaged AASTeX choice preserves a custom template named aastex and its saved selection", async () => {
  const { readPublishingTemplates } = await import("../publish-templates");
  const state = readPublishingTemplates(undefined);
  const custom = { ...state.templates[0], id: "aastex", name: "My layout" };
  const { controller } = setup({
    publishingTemplates: readPublishingTemplates({ templates: [custom] }),
  });
  const choices = controller.publishingTemplates.templates;
  assert.equal(
    new Set(choices.map((template) => template.id)).size,
    choices.length,
  );
  assert.equal(
    choices.find((template) => template.id === "aastex")?.name,
    "My layout",
  );
  const packaged = choices.find((template) => template.renderer === "aastex");
  assert.ok(packaged);
  assert.equal(packaged.id, "package:aastex");
  await controller.updatePreferences({ templateId: custom.id });
  assert.equal(controller.selectedTemplate?.renderer, undefined);
  assert.equal(
    (await controller.store.list()).notes[0].preferences?.templateId,
    "aastex",
  );
  await controller.updatePreferences({ templateId: packaged.id });
  assert.equal(controller.selectedTemplate?.renderer, "aastex");
  assert.equal(
    (await controller.store.list()).notes[0].preferences?.templateId,
    packaged.id,
  );
});

for (const directory of [undefined, ".config/custom-plugins/stratum"])
  test(`AASTeX PDF bypasses CSL formatting and uses ${directory ? "manifest" : "fallback"} cache directory`, async () => {
    const {
      controller,
      leaf,
      plugin,
      calls,
      payloads,
      release,
      conversionTools,
    } = setup();
    if (directory) Object.assign(plugin.manifest, { dir: directory });
    const example = aastexPackage.files["examples/manuscript.md"];
    const parsed = publicationYaml(example);
    // The controller host uses JSON as its YAML subset; preserve the real example's data.
    leaf.view.text = `---\n${JSON.stringify(parsed.properties)}\n---\n${example.slice(parsed.end)}`;
    plugin.citations.formatForPublication = () => {
      calls.format++;
      return Promise.reject(new Error("CSL style is unavailable"));
    };
    await controller.updatePreferences({ templateId: "package:aastex" });
    controller.readiness = structuredClone(readySupport);
    release();
    await controller.create();
    assert.equal(
      conversionTools[0].bibliographyCache?.directory,
      `${directory ?? ".config/plugins/stratum"}/cache/bibliography`,
    );
    assert.equal(
      conversionTools[0].bibliographyCache?.adapter,
      plugin.app.vault.adapter,
    );
    assert.equal(controller.error, "");
    assert.equal(calls.format, 0);
    assert.equal(calls.aastex, 1);
    assert.equal(payloads.length, 1);
    assert.ok(payloads[0]);
    const documents = (await controller.store.list()).documents;
    assert.equal(documents.length, 1);
    assert.equal(
      documents[0].citationStyle,
      aastexPackage.manifest.bibliographyStyle,
    );
    assert.equal(documents[0].publishing?.template?.upstreamVersion, "7.0.2");
    assert.equal(
      documents[0].publishing?.template?.version,
      AASTEX_PACKAGE_REFERENCE.version,
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(documents[0].publishing?.aastexPdfOptions)),
      DEFAULT_AASTEX_PDF_OPTIONS,
    );
  });

test("AASTeX starts from defaults, serializes per-note changes and resets explicitly", async () => {
  const { controller } = setup();
  await controller.updatePreferences({ templateId: "package:aastex" });
  assert.deepEqual(
    JSON.parse(JSON.stringify(controller.aastexPdfOptions)),
    DEFAULT_AASTEX_PDF_OPTIONS,
  );
  await controller.reload();
  assert.equal(controller.aastexPdfOptions.showLineNumbers, true);
  await Promise.all([
    controller.updateAastexPdfOptions({ showLineNumbers: true }),
    controller.updateAastexPdfOptions({ numberedHeadings: false }),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.aastexPdfOptions)), {
    showLineNumbers: true,
    showDraftDateHeader: true,
    numberedHeadings: false,
  });
  await controller.updatePreferences({ templateId: "general" });
  await controller.updatePreferences({ templateId: "package:aastex" });
  assert.equal(controller.aastexPdfOptions.showDraftDateHeader, true);
  await controller.resetAastexPdfOptions();
  assert.deepEqual(
    JSON.parse(JSON.stringify(controller.aastexPdfOptions)),
    DEFAULT_AASTEX_PDF_OPTIONS,
  );
});

test("version changes require explicit acceptance while heading mismatch warnings allow export", async () => {
  const { controller, leaf, release } = setup();
  const example = aastexPackage.files["examples/manuscript.md"];
  const parsed = publicationYaml(example);
  leaf.view.text = `---\n${JSON.stringify(parsed.properties)}\n---\n## 1. First\n\nText.\n\n## 3. Next\n\nText.`;
  const source = leaf.view.text;
  await controller.updatePreferences({ templateId: "package:aastex" });
  controller.readiness = structuredClone(readySupport);
  await controller.updatePreferences({
    aastex: {
      options: { ...DEFAULT_AASTEX_PDF_OPTIONS, numberedHeadings: true },
      package: { ...AASTEX_PACKAGE_REFERENCE, version: "1.0.0" },
    },
  });
  assert.match(controller.aastexPackageProblem, /Review the update/);
  assert.equal(controller.canCreate(), false);
  await controller.acceptAastexPackage();
  assert.equal(controller.aastexPackageProblem, "");
  assert.ok(controller.aastexHeadingProblems.length);
  assert.equal(controller.canCreate(), true);
  release();
  await controller.create();
  assert.equal(controller.error, "");
  assert.equal((await controller.store.list()).documents.length, 1);
  assert.equal(leaf.view.text, source);
});

test("AASTeX conversion failures detect missing shared tools without probing generic PDF support", async () => {
  for (const missing of ["", "pandoc", "tectonic"]) {
    const { controller, leaf, plugin, behavior, calls, release } = setup();
    const example = aastexPackage.files["examples/manuscript.md"];
    const parsed = publicationYaml(example);
    leaf.view.text = `---\n${JSON.stringify(parsed.properties)}\n---\n${example.slice(parsed.end)}`;
    await controller.updatePreferences({ templateId: "package:aastex" });
    controller.readiness = structuredClone(readySupport);
    behavior.missing = missing;
    behavior.conversionError = missing
      ? `${missing} could not start`
      : "AASTeX dependency is unavailable";
    release();
    await controller.create();
    assert.equal(calls.detect, 2);
    assert.deepEqual(calls.probe, []);
    assert.equal(controller.readiness?.pdf, !missing);
    assert.equal(
      plugin.settings.publishReadinessCache?.readiness.pdf,
      !missing,
    );
    assert.equal(controller.error, behavior.conversionError);
    assert.equal((await controller.store.list()).documents.length, 0);
    assert.equal(controller.busy, false);
    assert.equal(controller.selectedTemplate?.renderer, "aastex");
    assert.equal(leaf.view.text.includes("stratum_publish"), true);
  }
});

test("template selection copies layouts and retains them after template edits or deletion", async () => {
  const { readPublishingTemplates } = await import("../publish-templates");
  const state = readPublishingTemplates(undefined);
  const custom = {
    ...state.templates[0],
    id: "draft-template",
    name: "Draft",
    layout: { ...state.templates[0].layout, bodyFont: "Georgia", bodySize: 11 },
  };
  const { controller, plugin } = setup(
    {
      publishingTemplates: readPublishingTemplates({
        templates: [...state.templates, custom],
      }),
    },
    false,
  );
  assert.equal(controller.notePreferences.templateId, undefined);
  assert.equal(controller.canCreate(), false);
  await controller.updatePreferences({ templateId: custom.id });
  assert.equal(
    (await controller.store.list()).notes[0].preferences?.templateId,
    custom.id,
  );
  const updated = readPublishingTemplates({
    templates: [
      ...state.templates,
      { ...custom, layout: { ...custom.layout, bodyFont: "Arial" } },
    ],
  });
  Object.assign(plugin.settings, { publishingTemplates: updated });
  assert.equal(
    controller.layout.bodyFont,
    "Georgia",
    "template edits do not rewrite a note's saved layout",
  );
  Object.assign(plugin.settings, { publishingTemplates: state });
  assert.equal(
    controller.layout.bodyFont,
    "Georgia",
    "deleting a template leaves the saved layout intact",
  );
  assert.equal(
    controller.canCreate(),
    false,
    "Deleted templates need a new selection",
  );
  await controller.updatePreferences({ templateId: "academic" });
  assert.equal(controller.notePreferences.documentType, "academic");
  assert.equal(controller.notePreferences.pdf.lineSpacing, 1);
  assert.equal(controller.notePreferences.pdf.lineSpacing, 1);
});

test("preparation and required fields follow a general template without changing body content", async () => {
  const { readPublishingTemplates } = await import("../publish-templates");
  const state = readPublishingTemplates({
    templates: [
      {
        id: "general",
        layout: { titleSource: "properties", showAuthors: true },
        prefill: { authors: ["Synthetic reviewer"] },
      },
    ],
  });
  const { controller, leaf } = setup({ publishingTemplates: state });
  await controller.updatePreferences({ templateId: "general" });
  assert.match(controller.academicProblem, /title/);
  assert.equal(controller.canCreate(), false);
  assert.equal(controller.propertiesMissing, true);
  await controller.prepareAcademic();
  assert.equal(controller.academicProblem, "");
  assert.equal(controller.canCreate(), true);
  assert.equal(controller.propertiesMissing, false);
  assert.match(leaf.view.text, /Synthetic reviewer/);
  assert.ok(leaf.view.text.endsWith("Unsaved first note"));
  leaf.view.text = leaf.view.text.replace(
    "Synthetic reviewer",
    "Existing reviewer",
  );
  await controller.prepareAcademic();
  assert.match(leaf.view.text, /Existing reviewer/);
});

test("templates without published properties ignore unreadable note YAML", async () => {
  const { controller, leaf } = setup();
  await controller.updatePreferences({ templateId: "general" });
  leaf.view.text = "---\n{unreadable\n---\n\nSynthetic body.";
  assert.equal(controller.academicProblem, "");
  assert.equal(controller.canCreate(), true);
});

test("a repeated title warns but does not block creation", async () => {
  const { controller, leaf } = setup();
  await controller.updatePreferences({ templateId: "academic" });
  leaf.view.text =
    '---\n{"title":"Synthetic title"}\n---\n\n# Synthetic title\n\nSynthetic body.';
  assert.equal(controller.academicProblem, "");
  assert.equal(controller.duplicateTitleWarning, true);
  assert.equal(controller.canCreate(), true);
  await controller.updateLayout({ titleSource: "body" });
  assert.equal(controller.duplicateTitleWarning, false);
});

test("Settings command loads preferences for its captured note and cancels after a note switch", async () => {
  const f = setup();
  f.controller.catalog = null;
  await f.controller.openSettings({} as never, f.other.view as never);
  assert.deepEqual(f.calls.settings, [f.other.view.file.path]);
  const pending = f.controller.openSettings({} as never, f.leaf.view as never);
  f.events.get("active-leaf-change")!(f.other as never);
  await pending;
  assert.equal(f.calls.settings.length, 1);
  assert.equal(f.calls.detect, 0);
  f.controller.onunload();
  assert.equal(f.calls.settingsClosed, 1);
});

test("the controller keeps at most one settings window across repeated opens and closes", async () => {
  const f = setup();
  const launcher = {} as never;
  const first = f.controller.openSettings(launcher);
  const second = f.controller.openSettings(launcher);
  assert.equal(
    await first,
    undefined,
    "a newer request supersedes a loading one",
  );
  const opened = await second;
  assert.ok(opened);
  assert.equal(f.calls.settings.length, 1);
  assert.equal(f.calls.settingsClosed, 0);
  const replacement = {} as never;
  f.controller.adoptSettingsLauncher(replacement);
  assert.equal(
    (opened as unknown as { launcher: unknown }).launcher,
    replacement,
  );
  await f.controller.openSettings(launcher);
  assert.equal(f.calls.settings.length, 2);
  assert.equal(f.calls.settingsClosed, 1, "reopening replaces the window");
  const pending = f.controller.openSettings(launcher);
  f.controller.closeSettings();
  assert.equal(await pending, undefined, "closing cancels a loading window");
  assert.equal(f.calls.settings.length, 2);
  assert.equal(f.calls.settingsClosed, 2);
  const last = await f.controller.openSettings(launcher);
  last!.close();
  assert.equal(f.calls.settingsClosed, 3);
  f.controller.closeSettings();
  f.controller.onunload();
  assert.equal(
    f.calls.settingsClosed,
    3,
    "a closed window is not closed again",
  );
});

test("reset availability follows the exact selected template target and AASTeX option scope", async () => {
  const f = setup();
  await f.controller.updatePreferences({ templateId: "academic" });
  assert.equal(f.controller.settingsResetChanges, false);
  await f.controller.updateLayout({ margin: 1.4 });
  assert.equal(f.controller.settingsResetChanges, true);
  await f.controller.resetSettings();
  assert.equal(f.controller.settingsResetChanges, false);
  await f.controller.updatePreferences({ templateId: "package:aastex" });
  await f.controller.updateLayout({ titleSource: "body" });
  assert.equal(f.controller.settingsResetChanges, false);
  await f.controller.updateAastexPdfOptions({ showLineNumbers: false });
  assert.equal(f.controller.settingsResetChanges, true);
  await f.controller.resetSettings();
  assert.equal(f.controller.settingsResetChanges, false);
  assert.equal(f.controller.layout.titleSource, "body");
});

test("reset prediction and execution follow edited reusable template defaults", async () => {
  const { readPublishingTemplates } = await import("../publish-templates");
  const state = readPublishingTemplates(undefined);
  const custom = {
    ...state.templates[0],
    id: "custom-layout",
    name: "Custom",
    layout: { ...state.templates[0].layout, bodySize: 11 },
  };
  const f = setup({
    publishingTemplates: readPublishingTemplates({
      templates: [...state.templates, custom],
    }),
  });
  await f.controller.updatePreferences({ templateId: custom.id });
  assert.equal(f.controller.settingsResetChanges, false);
  f.plugin.settings.publishingTemplates = readPublishingTemplates({
    templates: [
      ...state.templates,
      { ...custom, layout: { ...custom.layout, bodySize: 13 } },
    ],
  });
  assert.equal(f.controller.settingsResetChanges, true);
  await f.controller.resetSettings();
  assert.equal(f.controller.layout.bodySize, 13);
  assert.equal(f.controller.settingsResetChanges, false);
});

test("publish success IDs are emitted only after persistence, never for failed or cancelled creation", async () => {
  for (const outcome of ["success", "failure", "cancel"] as const) {
    const f = setup();
    if (outcome === "failure")
      f.behavior.conversionError = "Synthetic conversion failure";
    const pending = f.controller.create();
    assert.equal(f.controller.lastPublishedId, undefined);
    if (outcome === "cancel") f.controller.cancel();
    f.release();
    await pending;
    const catalog = await f.controller.store.list();
    if (outcome === "success") {
      assert.equal(f.controller.lastPublishedId, catalog.documents[0].id);
      const previous = f.controller.lastPublishedId;
      await f.controller.create();
      assert.notEqual(f.controller.lastPublishedId, previous);
    } else {
      assert.equal(f.controller.lastPublishedId, undefined);
      assert.equal(catalog.documents.length, 0);
    }
  }
});
test("readiness notices direct author fields to Settings and body title repair to the note", async () => {
  const f = setup();
  await f.controller.updatePreferences({ templateId: "package:aastex" });
  f.leaf.view.text = "---\ntitle: Paper\n---\nBody";
  assert.equal(f.controller.readinessNotices.length, 1);
  assert.equal(
    f.controller.readinessNotices[0].text,
    "Add at least one author.",
  );
  assert.equal(f.controller.readinessNotices[0].settings, true);
  await f.controller.updateLayout({ titleSource: "body" });
  assert.equal(f.controller.readinessNotices[0].settings, false);
  f.leaf.view.text = "---\ntitle: [\n---\nBody";
  assert.equal(f.controller.readinessNotices[0].settings, false);
});
test("Settings issues keep their messages and target the field that resolves them", async () => {
  const f = setup();
  await f.controller.updatePreferences({ templateId: "package:aastex" });
  await f.controller.updateLayout({ titleSource: "properties" });
  f.leaf.view.text =
    "---\nstratum_publish:\n  authors:\n    - name: Alex\n      affiliations: [Example University]\n---\nBody";
  // Issues may come from the controller's module realm.
  const issues = () =>
    JSON.parse(
      JSON.stringify(f.controller.publishingIssues),
    ) as typeof f.controller.publishingIssues;
  const placed = () =>
    issues().map((issue) => [
      issue.target === "author" ? issue.author : issue.target,
      issue.blocking,
      issue.message,
    ]);
  assert.deepEqual(placed(), [
    ["title", true, "Add a manuscript title using the selected title source."],
    [0, true, "Author 1 needs an email address."],
    [
      "general",
      false,
      "No Abstract section was found. Check the journal's submission requirements.",
    ],
  ]);
  assert.equal(
    f.controller.academicProblem,
    "Add a manuscript title using the selected title source.\nAuthor 1 needs an email address.",
  );
  // A missing body title cannot be fixed in the Title field.
  await f.controller.updateLayout({ titleSource: "body" });
  assert.deepEqual(placed()[0], [
    "general",
    true,
    "Add a manuscript title using the selected title source.",
  ]);
  f.leaf.view.text = "---\ntitle: [\n---\nBody";
  assert.deepEqual(
    issues().map((issue) => [issue.target, issue.blocking]),
    [["general", true]],
  );
  assert.equal(
    f.controller.publishingIssues[0].message,
    f.controller.academicProblem,
  );

  await f.controller.updatePreferences({ templateId: "general" });
  await f.controller.updateLayout({ titleSource: "properties" });
  // General templates read properties with this harness's JSON parseYaml.
  f.leaf.view.text = '---\n{"tags":["synthetic"]}\n---\nBody';
  assert.deepEqual(issues(), [
    {
      target: "title",
      message: "Add a value for the required “title” property.",
      blocking: true,
    },
  ]);
  assert.equal(
    f.controller.academicProblem,
    "Add a value for the required “title” property.",
  );
  f.leaf.view.text = '---\n{"title":"Synthetic"}\n---\nBody';
  assert.deepEqual(issues(), []);
});

test("problem checks parse the manuscript once per text revision", async () => {
  const { controller, leaf, calls } = setup();
  await controller.updatePreferences({ templateId: "package:aastex" });
  await controller.updateAastexPdfOptions({ numberedHeadings: true });
  leaf.view.text = aastexPackage.files["examples/manuscript.md"];
  const read = () => {
    for (let i = 0; i < 3; i++) {
      void controller.academicProblem;
      void controller.readinessNotices;
      void controller.publishingIssues;
      void controller.aastexHeadingProblems;
      void controller.duplicateTitleWarning;
      controller.canCreate();
    }
  };
  calls.parse = 0;
  read();
  assert.equal(calls.parse, 1);
  assert.equal(controller.academicProblem, "");
  read();
  assert.equal(calls.parse, 1, "unchanged text reuses the parse");
  leaf.view.text += "\n\n## 3. Synthetic section\n\nSynthetic text.";
  read();
  assert.equal(calls.parse, 2);
  assert.ok(controller.aastexHeadingProblems.length);
});

test("problem checks follow text, preference and template changes", async () => {
  const { readPublishingTemplates } = await import("../publish-templates");
  const state = readPublishingTemplates(undefined);
  const custom = {
    ...state.templates[0],
    id: "custom-titled",
    name: "Titled",
    layout: { ...state.templates[0].layout, titleSource: "properties" },
  };
  const { controller, leaf, plugin } = setup({
    publishingTemplates: readPublishingTemplates({
      templates: [...state.templates, custom],
    }),
  });
  await controller.updatePreferences({ templateId: custom.id });
  assert.match(controller.academicProblem, /title/);
  assert.equal(controller.readinessNotices.length, 1);
  assert.equal(controller.canCreate(), false);

  leaf.view.text =
    '---\n{"title":"Synthetic title"}\n---\n\n# Synthetic title\n\nSynthetic body.';
  assert.equal(controller.academicProblem, "");
  assert.equal(controller.readinessNotices.length, 0);
  assert.equal(controller.duplicateTitleWarning, true);
  assert.equal(controller.canCreate(), true);

  await controller.updateLayout({ titleSource: "body" });
  assert.equal(controller.layout.titleSource, "body");
  assert.equal(controller.duplicateTitleWarning, false);
  await controller.updatePreferences({ templateId: "package:aastex" });
  assert.equal(controller.selectedTemplate?.renderer, "aastex");
  assert.match(controller.academicProblem, /author/);
  await controller.updatePreferences({ templateId: custom.id });

  plugin.settings.publishingTemplates = readPublishingTemplates({
    templates: [...state.templates, { ...custom, name: "Renamed" }],
  });
  assert.equal(controller.selectedTemplate?.name, "Renamed");
  plugin.settings.publishingTemplates = readPublishingTemplates({
    templates: state.templates,
  });
  assert.equal(controller.selectedTemplate, undefined);
  assert.equal(
    controller.academicProblem,
    "Choose a template before publishing.",
  );
  assert.equal(controller.readinessNotices.length, 0);
});

test("empty editor checks refresh after metadataCache frontmatter changes", async () => {
  const f = setup();
  await f.controller.updateLayout({ titleSource: "properties" });
  f.leaf.view.text = "";
  let frontmatter: Record<string, unknown> = {};
  Object.assign(f.plugin.app.metadataCache, {
    getFileCache: () => ({ frontmatter }),
  });
  assert.match(f.controller.academicProblem, /required.*title/);
  assert.equal(f.controller.readinessNotices.length, 1);
  frontmatter = { title: "Synthetic title" };
  (f.events.get("metadata:changed") as (file: File) => void)(f.leaf.view.file);
  assert.equal(f.controller.academicProblem, "");
  assert.equal(f.controller.readinessNotices.length, 0);
  frontmatter = {};
  (f.events.get("metadata:changed") as (file: File) => void)(f.leaf.view.file);
  assert.match(f.controller.academicProblem, /required.*title/);
  assert.equal(f.controller.readinessNotices.length, 1);
});

test("exported heading issues invalidate the cached source preview", async () => {
  const f = setup();
  await f.controller.updatePreferences({ templateId: "package:aastex" });
  await f.controller.updateAastexPdfOptions({ numberedHeadings: true });
  const example = aastexPackage.files["examples/manuscript.md"];
  const parsed = publicationYaml(example);
  f.leaf.view.text = `---\n${JSON.stringify(parsed.properties)}\n---\n${example.slice(parsed.end)}`;
  assert.equal(f.controller.aastexHeadingProblems.length, 0);
  f.behavior.headingIssues = ["Synthetic rendered heading warning"];
  f.release();
  await f.controller.create();
  assert.equal(f.controller.error, "");
  assert.deepEqual(
    Array.from(f.controller.aastexHeadingProblems),
    f.behavior.headingIssues,
  );
  f.leaf.view.text += "\n\n## New section\n\nSynthetic body.";
  assert.equal(
    f.controller.aastexHeadingProblems.length,
    0,
    "changed source drops exported issues",
  );
});
