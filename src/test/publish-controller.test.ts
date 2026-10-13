import { aastexHeadingIssues } from "../publication-heading-preview";
import { readNotePreferences } from "../publish-options";
import { aastexManuscript, aastexPackage } from "../publication-package";
import { publicationYaml } from "../publication-metadata";
import {
  DEFAULT_AASTEX_PDF_OPTIONS,
  readAastexPdfOptions,
} from "../publication-options";
import { AASTEX_PACKAGE_REFERENCE } from "../publication-package";
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
function setup(
  settings: Partial<StratumSettings> = {},
  selected = true,
  desktop = true,
) {
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const calls = {
    detect: 0,
    probe: [] as string[],
    check: 0,
    save: 0,
    format: 0,
    aastex: 0,
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
      Platform: { isDesktopApp: desktop },
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
      "./publication-options-modal": {
        PublishingSettingsModal: class {
          constructor(
            _app: unknown,
            private publish: { document: File },
            _launcher: unknown,
          ) {}
          open() {
            calls.settings.push(this.publish.document.path);
          }
          close() {
            calls.settingsClosed++;
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
              headingIssues: [],
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
  if (desktop)
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

test("AASTeX PDF bypasses CSL formatting, passes its class payload and records its actual bibliography style", async () => {
  const {
    controller,
    leaf,
    plugin,
    calls,
    payloads,
    release,
    conversionTools,
  } = setup();
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
    ".config/plugins/stratum/cache/bibliography",
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

test("AASTeX ignores legacy vault defaults, serializes per-note changes and resets explicitly", async () => {
  const { controller, plugin } = setup({
    aastexPdfDefaults: {
      showLineNumbers: false,
      showDraftDateHeader: false,
      numberedHeadings: true,
    },
  });
  await controller.updatePreferences({ templateId: "package:aastex" });
  assert.deepEqual(
    JSON.parse(JSON.stringify(controller.aastexPdfOptions)),
    DEFAULT_AASTEX_PDF_OPTIONS,
  );
  plugin.settings.aastexPdfDefaults = { ...DEFAULT_AASTEX_PDF_OPTIONS };
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

test("mobile tracks notes and stores settings without tools or cached desktop readiness enabling creation", async () => {
  const f = setup(
    { publishReadinessCache: cachedSupport(), publishPdfSetupComplete: true },
    true,
    false,
  );
  await f.controller.reload();
  assert.equal(f.controller.canPublishPdf, false);
  assert.equal(f.controller.readiness, null);
  assert.equal(f.controller.document, f.leaf.view.file);
  await f.controller.updatePreferences({ templateId: "academic" });
  assert.equal(f.controller.notePreferences.templateId, "academic");
  f.controller.readiness = structuredClone(readySupport);
  assert.equal(f.controller.canCreate(), false);
  await f.controller.check(true);
  await f.controller.create();
  assert.equal(f.calls.detect, 0);
  assert.equal(f.calls.check, 0);
  assert.equal(f.calls.probe.length, 0);
  assert.equal(f.calls.format, 0);
  assert.equal(f.payloads.length, 0);
});

test("Settings command loads preferences for its captured note and cancels after a note switch", async () => {
  const f = setup({}, true, true);
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

test("mobile Settings entry points cannot open a publishing modal", async () => {
  const f = setup({}, true, false);
  await f.controller.openSettings({} as never, f.other.view as never);
  await f.controller.editPublicationDetails();
  assert.deepEqual(f.calls.settings, []);
  assert.equal(f.calls.settingsClosed, 0);
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
