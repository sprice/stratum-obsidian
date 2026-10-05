import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./runtime-harness";
import type * as Controller from "../sources-controller";

class File {
  extension = "md";
  constructor(
    public path: string,
    public basename = path,
  ) {}
}
class View {
  mode = "source";
  text = "[@example2024]";
  selected: unknown = null;
  focused = false;
  editor = {
    getValue: () => this.text,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    setSelection: (from: unknown, to: unknown) => {
      this.selected = [from, to];
    },
    scrollIntoView: () => {},
    focus: () => {
      this.focused = true;
    },
  };
  constructor(public file: File) {}
  getMode() {
    return this.mode;
  }
}
class HostComponent {
  register() {}
  registerEvent() {}
}

test("managing styles opens the plugin settings and global style dialog without a note override", async () => {
  const calls: string[] = [];
  const { SourcesController } = loadRuntime<typeof Controller>(
    "sources-controller.ts",
    {
      Component: HostComponent,
      MarkdownView: View,
      FuzzySuggestModal: class {},
    },
    {},
    "node",
    {
      "./citation-controls": {
        CitationPreferences: class {
          constructor(_plugin: unknown, file?: unknown) {
            assert.equal(file, undefined);
            calls.push("dialog");
          }
          open() {
            calls.push("open dialog");
          }
        },
      },
    },
  );
  const plugin = {
    isUnloaded: false,
    manifest: { id: "stratum" },
    app: {
      setting: {
        open: () => {
          calls.push("settings");
        },
        openTabById: (id: string) => {
          calls.push(id);
        },
      },
    },
  };
  const controller = new SourcesController(plugin as never);
  await controller.manageCitationStyles();
  assert.deepEqual(calls, ["settings", "stratum", "dialog", "open dialog"]);
  calls.length = 0;
  plugin.isUnloaded = true;
  await controller.manageCitationStyles();
  assert.deepEqual(calls, []);
});
class Emitter {
  events = new Map<string, ((...args: unknown[]) => void)[]>();
  on(name: string, fn: (...args: unknown[]) => void) {
    this.events.set(name, [...(this.events.get(name) ?? []), fn]);
    return {};
  }
  emit(name: string, ...args: unknown[]) {
    for (const fn of this.events.get(name) ?? []) fn(...args);
  }
}
function fixture() {
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const notices: string[] = [];
  const module = loadRuntime<typeof Controller>(
    "sources-controller.ts",
    {
      Component: HostComponent,
      MarkdownView: View,
      TFile: File,
      FuzzySuggestModal: class {},
      Notice: class {
        constructor(message: string) {
          notices.push(message);
        }
      },
      parseLinktext: (text: string) => ({ path: text.split("#")[0] }),
    },
    {
      window: {
        setTimeout: (fn: () => void) => {
          timers.set(++nextTimer, fn);
          return nextTimer;
        },
        clearTimeout: (id: number) => timers.delete(id),
      },
    },
  );
  const manuscript = new File("Draft.md");
  const literature = new File("Sources/Example.md");
  const other = new File("Other draft.md");
  const emitter = new Emitter();
  function makeLeaf(file: File) {
    return {
      view: new View(file),
      openFile(file: File) {
        this.view.file = file;
        workspace.active = this;
        emitter.emit("active-leaf-change", this);
        return Promise.resolve();
      },
      setViewState(state: { state: { mode: string } }) {
        this.view.mode = state.state.mode;
        return Promise.resolve();
      },
    };
  }
  const draftLeaf = makeLeaf(manuscript);
  const sourceLeaf = makeLeaf(literature);
  const otherLeaf = makeLeaf(other);
  const leaves = [draftLeaf, sourceLeaf, otherLeaf];
  const workspace = {
    active: draftLeaf,
    rootSplit: {},
    on: emitter.on.bind(emitter),
    getMostRecentLeaf: () => workspace.active,
    iterateRootLeaves: (fn: (leaf: typeof draftLeaf) => void) =>
      leaves.forEach(fn),
    getLeavesOfType: () => leaves,
    getLeaf: () => {
      throw new Error("Should reuse existing main-area tabs");
    },
    async revealLeaf() {},
  };
  const metadata = new Emitter();
  const resolvedPaths: string[] = [];
  let scans = 0;
  let reads = 0;
  const vaultEvents = new Emitter();
  let delayedRead: Promise<string> | null = null;
  const bib = new File("stratum.bib");
  const app = {
    workspace,
    metadataCache: {
      on: metadata.on.bind(metadata),
      getFileCache: (file: File) => ({
        frontmatter:
          file === literature ? { stratum_note_type: "literature-note" } : {},
      }),
      getFirstLinkpathDest: (path: string) => {
        resolvedPaths.push(path);
        return null;
      },
    },
    vault: {
      on: vaultEvents.on.bind(vaultEvents),
      getAbstractFileByPath: () => bib,
      getMarkdownFiles: () => {
        scans++;
        return [];
      },
      cachedRead: async (file: File) => {
        reads++;
        return file === manuscript ? "[@saved2025]" : (delayedRead ?? "");
      },
    },
  };
  const controller = new module.SourcesController({ app } as never);
  controller.onload();
  const unsubscribe = controller.subscribe(() => {});
  async function flush() {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach((fn) => fn());
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return {
    controller,
    resolvedPaths,
    leaves,
    draftLeaf,
    sourceLeaf,
    otherLeaf,
    manuscript,
    literature,
    workspace,
    emitter,
    vaultEvents,
    timers,
    notices,
    flush,
    unsubscribe,
    get scans() {
      return scans;
    },
    get reads() {
      return reads;
    },
    setDelayedRead(promise: Promise<string>) {
      delayedRead = promise;
    },
  };
}

test("Sources uses unsaved text, debounces changes and reuses the metadata index", async () => {
  const f = fixture();
  await f.flush();
  assert.equal(f.controller.rows[0].keys[0], "example2024");
  f.draftLeaf.view.text = "[@new2025]";
  for (let i = 0; i < 5; i++)
    f.emitter.emit("editor-change", {}, { file: f.manuscript });
  assert.equal(f.timers.size, 1);
  await f.flush();
  assert.equal(f.controller.rows[0].keys[0], "new2025");
  assert.equal(f.scans, 1);
  assert.equal(f.reads, 1);
});

test("inspecting a literature note retains the manuscript; pinning blocks other drafts", async () => {
  const f = fixture();
  await f.flush();
  await f.controller.openSource(f.literature as never);
  assert.equal(f.workspace.active, f.sourceLeaf);
  assert.equal(f.controller.document, f.manuscript);
  f.controller.togglePin();
  f.workspace.active = f.otherLeaf;
  f.emitter.emit("active-leaf-change", f.otherLeaf);
  assert.equal(f.controller.document, f.manuscript);
  f.controller.togglePin();
  await f.flush();
  assert.equal(f.controller.document, f.otherLeaf.view.file);
});

test("occurrence navigation returns to the main editor and selects the citation", async () => {
  const f = fixture();
  await f.flush();
  const occurrence = f.controller.rows[0].occurrences[0];
  await f.controller.openSource(f.literature as never);
  f.draftLeaf.view.mode = "preview";
  await f.controller.returnToDocument(occurrence);
  assert.equal(f.workspace.active, f.draftLeaf);
  assert.equal(f.draftLeaf.view.mode, "source");
  assert.equal(f.draftLeaf.view.focused, true);
  assert.ok(f.draftLeaf.view.selected);
});

test("stale occurrence offsets never select unrelated text", async () => {
  const f = fixture();
  await f.flush();
  const occurrence = f.controller.rows[0].occurrences[0];
  f.draftLeaf.view.text = "Completely different prose.";
  await f.controller.returnToDocument(occurrence);
  assert.equal(f.draftLeaf.view.selected, null);
  assert.match(f.notices[0], /note changed/i);
});

test("async results from a previous manuscript cannot replace the new document", async () => {
  const f = fixture();
  let finish!: (value: string) => void;
  f.setDelayedRead(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  await f.flush();
  f.workspace.active = f.otherLeaf;
  f.otherLeaf.view.text = "[@other2020]";
  f.emitter.emit("active-leaf-change", f.otherLeaf);
  finish("");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.controller.rows.length, 0);
  await f.flush();
  assert.equal(f.controller.rows[0].keys[0], "other2020");
});

test("closing the panel cancels pending work and deleting a manuscript clears its scope", async () => {
  const f = fixture();
  await f.flush();
  f.controller.togglePin();
  f.vaultEvents.emit("delete", f.manuscript);
  assert.equal(f.controller.document, null);
  assert.equal(f.controller.pinned, false);
  assert.equal(f.controller.rows.length, 0);
  f.unsubscribe();
  assert.equal(f.timers.size, 0);
  f.controller.onunload();
});

test("opening a different file in the same active tab updates Sources", async () => {
  const f = fixture();
  await f.flush();
  f.draftLeaf.view.file = f.otherLeaf.view.file;
  f.draftLeaf.view.text = "[@replacement2026]";
  f.emitter.emit("file-open", f.draftLeaf.view.file);
  await f.flush();
  assert.equal(f.controller.document, f.draftLeaf.view.file);
  assert.equal(f.controller.rows[0].keys[0], "replacement2026");
});

test("a closed editor cannot override subsequent changes to a pinned document", async () => {
  const f = fixture();
  await f.flush();
  f.controller.togglePin();
  f.leaves.splice(f.leaves.indexOf(f.draftLeaf), 1);
  f.workspace.active = f.otherLeaf;
  f.vaultEvents.emit("modify", f.manuscript);
  await f.flush();
  assert.equal(f.controller.rows[0].keys[0], "saved2025");
});

test("wikilinks retain literal percent sequences while Markdown links decode URL paths", async () => {
  const f = fixture();
  f.draftLeaf.view.text =
    "[[Study%20One]] [Study](Study%20One.md) [Hash](Study%23One.md#Section)";
  await f.flush();
  assert.deepEqual(f.resolvedPaths, [
    "Study%20One",
    "Study One.md",
    "Study#One.md",
  ]);
});

test("Document context follows navigation and remains visible when pinned", async () => {
  const f = fixture();
  assert.equal(f.controller.showDocumentLink, false);
  const changes: boolean[] = [];
  f.controller.subscribe(() => changes.push(f.controller.showDocumentLink));
  await f.controller.openSource(f.literature as never);
  assert.equal(f.controller.document, f.manuscript);
  assert.equal(changes.at(-1), true);
  await f.controller.returnToDocument();
  assert.equal(changes.at(-1), false);
  f.controller.togglePin();
  assert.equal(changes.at(-1), true);
  f.controller.togglePin();
  assert.equal(changes.at(-1), false);
  f.controller.document = null;
  assert.equal(f.controller.showDocumentLink, false);
});

test("Reading view uses saved content instead of its stale editor buffer", async () => {
  const f = fixture();
  await f.flush();
  f.draftLeaf.view.mode = "preview";
  f.vaultEvents.emit("modify", f.manuscript);
  await f.flush();
  assert.equal(f.controller.rows[0].keys[0], "saved2025");
});

test("style selection uses the current editor rather than the previous source refresh", async () => {
  const file = new File("Synthetic draft.md");
  const view = new View(file);
  view.text = "current style and language";
  const calls: unknown[] = [];
  const { SourcesController } = loadRuntime<typeof Controller>(
    "sources-controller.ts",
    {
      Component: HostComponent,
      MarkdownView: View,
      FuzzySuggestModal: class {},
    },
    {},
    "node",
    {
      "./citation-style-choice": {
        noteCitationStyleChoices: (
          _plugin: unknown,
          target: File,
          text: string,
        ) => {
          calls.push([target.path, text]);
          return { selected: text };
        },
        setNoteCitationStyle: (
          _plugin: unknown,
          target: File,
          style: string,
          language: string,
        ) => {
          calls.push([target.path, style, language]);
        },
      },
    },
  );
  const controller = new SourcesController({
    citations: {
      preferences: (_path: string, text: string) => ({ language: text }),
    },
    app: { workspace: { getLeavesOfType: () => [{ view }] } },
  } as never);
  Object.assign(controller, { document: file, text: "previous note" });
  await controller.citationStyleChoices();
  await controller.changeCitationStyle("ieee", file.path);
  assert.deepEqual(calls, [
    [file.path, view.text],
    [file.path, "ieee", view.text],
  ]);
});

test("a delayed style read is discarded after switching notes", async () => {
  let finishRead!: (text: string) => void;
  const read = new Promise<string>((resolve) => {
    finishRead = resolve;
  });
  const { SourcesController } = loadRuntime<typeof Controller>(
    "sources-controller.ts",
    {
      Component: HostComponent,
      MarkdownView: View,
      FuzzySuggestModal: class {},
    },
    {},
    "node",
    { "./citation-style-choice": {} },
  );
  const controller = new SourcesController({
    citations: {},
    app: {
      workspace: { getLeavesOfType: () => [] },
      vault: { cachedRead: () => read },
    },
  } as never);
  controller.document = new File("First.md") as never;
  const pending = controller.citationStyleChoices();
  controller.document = new File("Second.md") as never;
  finishRead("first note preferences");
  assert.equal(await pending, null);
});
