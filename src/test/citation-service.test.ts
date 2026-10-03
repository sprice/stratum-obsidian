import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./runtime-harness";
import type * as Service from "../citation-service";

class File {
  constructor(public path: string) {}
}
class View {
  refreshes = 0;
  previewMode = { rerender: () => this.refreshes++ };
  constructor(
    public file: File,
    private mode = "preview",
  ) {}
  getMode() {
    return this.mode;
  }
}

test("manuscript changes refresh reused Reading blocks and unload cancels pending work", () => {
  const events = new Map<string, (file: File) => void>();
  const timers = new Map<number, () => void>();
  let id = 0;
  const { CitationService } = loadRuntime<typeof Service>(
    "citation-service.ts",
    {
      Component: class {
        registerEvent() {}
      },
      MarkdownView: View,
      TFile: File,
    },
    {
      document: { createElement: () => ({}) },
      window: {
        setTimeout: (fn: () => void) => {
          timers.set(++id, fn);
          return id;
        },
        clearTimeout: (id: number) => timers.delete(id),
      },
    },
    "browser",
  );
  const file = new File("Papers/Example.md");
  const reading = new View(file);
  const editing = new View(file, "source");
  const other = new View(new File("Papers/Other.md"));
  const service = new CitationService({
    app: {
      metadataCache: { on: () => ({}), getFileCache: () => ({}) },
      vault: {
        on: (name: string, callback: (file: File) => void) => {
          events.set(name, callback);
          return {};
        },
      },
      workspace: {
        getLeavesOfType: () =>
          [reading, editing, other].map((view) => ({ view })),
      },
    },
  } as never);
  service.onload();
  events.get("modify")!(file);
  events.get("modify")!(file);
  assert.equal(timers.size, 1);
  const callbacks = [...timers.values()];
  timers.clear();
  callbacks.forEach((callback) => callback());
  assert.equal(reading.refreshes, 1);
  assert.equal(editing.refreshes, 0);
  assert.equal(other.refreshes, 0);
  events.get("modify")!(file);
  service.onunload();
  assert.equal(timers.size, 0);
});

test("renaming reference files away invalidates previously cached citations", () => {
  const events = new Map<string, (file: File, oldPath: string) => void>();
  const { CitationService } = loadRuntime<typeof Service>(
    "citation-service.ts",
    {
      Component: class {
        registerEvent() {}
      },
      MarkdownView: View,
      TFile: File,
    },
    { document: { createElement: () => ({}) } },
    "browser",
  );
  const service = new CitationService({
    app: {
      metadataCache: { on: () => ({}), getFileCache: () => ({}) },
      vault: {
        on: (name: string, callback: (file: File, oldPath: string) => void) => {
          events.set(name, callback);
          return {};
        },
      },
    },
  } as never);
  service.onload();
  let invalidations = 0;
  service.subscribe(() => invalidations++);
  events.get("rename")!(new File("archive.bib"), "stratum.bib");
  events.get("rename")!(new File("archive.json"), "stratum-references.json");
  assert.equal(invalidations, 2);
  service.onunload();
});
