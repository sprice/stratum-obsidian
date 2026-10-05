import test from "node:test";
import assert from "node:assert/strict";
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
function setup() {
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
    { AbortController, TextEncoder, crypto: webcrypto },
    "browser",
    {
      "./publish-render": {
        renderPublication: (
          _app: unknown,
          text: string,
          path: string,
          title: string,
        ) => {
          rendered.push({ text, path, title });
          return Promise.resolve({ html: "synthetic", assets: [] });
        },
      },
      "./publish-desktop": {
        convertPublication: async (
          _html: string,
          _assets: unknown,
          _format: string,
          _tools: unknown,
          signal: AbortSignal,
        ) => {
          await conversion;
          if (signal.aborted) throw new Error("Publishing cancelled.");
          return new ArrayBuffer(4);
        },
      },
    },
  );
  const first = new File("First.md"),
    second = new File("Second.md");
  const leaf = { view: new View(first, "Unsaved first note") },
    other = { view: new View(second, "Second note") };
  const plugin = {
    settings: { citationStyle: "apa", citationLanguage: "en-US" },
    citations: {
      preferences: () => ({ style: "apa", language: "en-US" }),
      formatForPublication: () => Promise.resolve(undefined),
    },
    app: {
      vault: {
        adapter,
        configDir: ".config",
        on: (event: string, callback: (...args: never[]) => void) => {
          events.set(event, callback);
          return {};
        },
      },
      workspace: {
        rootSplit: {},
        getMostRecentLeaf: () => leaf,
        iterateRootLeaves: (callback: (leaf: object) => void) => {
          callback(leaf);
          callback(other);
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
  controller.readiness = {
    word: true,
    pdf: false,
    pandoc: { path: "pandoc", version: "3" },
    tectonic: { path: "", version: "" },
  };
  return { controller, leaf, other, rendered, release, events };
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
