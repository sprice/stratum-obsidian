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
  editor = { getValue: () => this.text };
  constructor(
    public file: File,
    public text: string,
  ) {}
}
const readySupport: PublishReadiness = {
  word: true,
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
function setup(settings: Partial<StratumSettings> = {}) {
  const calls = { detect: 0, probe: [] as string[], check: 0, save: 0 };
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
    },
    { AbortController, TextEncoder, Error, crypto: webcrypto },
    "browser",
    {
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
          _tools: unknown,
          signal: AbortSignal,
        ) => {
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
  const roots = [leaf, other];
  const plugin = {
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
      formatForPublication: () => Promise.resolve(undefined),
    },
    app: {
      vault: {
        adapter,
        configDir: ".config",
        getAbstractFileByPath: (path: string) =>
          [first, second].find((file) => file.path === path) ?? null,
        on: (event: string, callback: (...args: never[]) => void) => {
          events.set(event, callback);
          return {};
        },
      },
      workspace: {
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
  controller.catalog = { version: 1, notes: [], documents: [] };
  controller.selectedFormat = "docx";
  controller.readiness ??= {
    word: true,
    pdf: false,
    pandoc: { path: "pandoc", version: "3" },
    tectonic: { path: "", version: "" },
  };
  return {
    controller,
    leaf,
    other,
    rendered,
    release,
    events,
    roots,
    plugin,
    calls,
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
  assert.equal(controller.selectedFormat, "");
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

test("cancelled publishing keeps the file type selected for retry", async () => {
  const { controller, release } = setup();
  const pending = controller.create();
  controller.cancel();
  release();
  await pending;
  assert.equal(controller.selectedFormat, "docx");
  assert.equal((await controller.store.list()).documents.length, 0);
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
  controller.selectedFormat = "pdf";
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
  assert.equal(controller.readiness?.word, true);
  assert.equal(controller.readiness?.pdf, false);
  assert.equal(plugin.settings.publishPdfSetupComplete, false);
  assert.equal(plugin.settings.publishReadinessCache?.readiness.pdf, false);
  assert.equal(controller.progress, "");
  assert.equal(calls.check, 0);
});

test("failed conversion detects lost tools after launch and preserves the original error", async () => {
  const { controller, behavior, calls, plugin, release } = setup();
  behavior.conversionError = "Pandoc could not start";
  behavior.missing = "pandoc";
  release();
  await controller.create();
  assert.equal(controller.readiness?.word, false);
  assert.equal(controller.readiness?.pdf, false);
  assert.equal(plugin.settings.publishReadinessCache?.readiness.word, false);
  assert.match(controller.error, /Pandoc could not start/);
  assert.equal(calls.detect, 2);
  assert.deepEqual(calls.probe, []);
});

test("document-specific conversion failures keep support while failed synthetic probes invalidate only the affected format", async () => {
  for (const probeError of ["", "Synthetic PDF failure"]) {
    const { controller, behavior, calls, plugin, release } = setup();
    controller.readiness = structuredClone(readySupport);
    controller.selectedFormat = "pdf";
    behavior.conversionError = "Invalid document content";
    behavior.probeError = probeError;
    release();
    await controller.create();
    assert.equal(controller.readiness?.word, true);
    assert.equal(controller.readiness?.pdf, !probeError);
    assert.equal(
      plugin.settings.publishReadinessCache?.readiness.pdf,
      !probeError,
    );
    assert.match(controller.error, /Invalid document content/);
    assert.deepEqual(calls.probe, ["pdf"]);
  }
});

test("rendering failures and cancellation do not diagnose or invalidate tools", async () => {
  const { controller, behavior, calls, release } = setup();
  behavior.renderError = "Unsupported embedded note";
  release();
  await controller.create();
  assert.equal(calls.detect, 0);
  assert.equal(controller.readiness?.word, true);
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
