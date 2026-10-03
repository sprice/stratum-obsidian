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

test("formatting and diagnostics share cached ownership even without literature notes", async () => {
  const { CitationService } = loadRuntime<typeof Service>(
    "citation-service.ts",
    {
      Component: class {},
      TFile: File,
      MarkdownView: View,
      FuzzySuggestModal: class {},
    },
    { document: { createElement: () => ({}) } },
    "browser",
  );
  let title = "Synthetic reference";
  let failRead = false;
  const service = new CitationService({
    isUnloaded: false,
    settings: {
      citationStyle: "ieee",
      citationLanguage: "en-US",
      citationStyles: {},
      citationLocales: {},
    },
    app: {
      metadataCache: { getFileCache: () => ({}) },
      vault: {
        getMarkdownFiles: () => [],
        getAbstractFileByPath: (path: string) => new File(path),
        read: (file: File) =>
          failRead
            ? Promise.reject(new Error("Temporary read failure"))
            : Promise.resolve(
                file.path === "stratum.bib"
                  ? "% stratum:begin user%2F1%2FA oldKey baseline\n@book{oldKey,\n title={Synthetic reference}\n}\n% stratum:end"
                  : JSON.stringify({
                      version: 1,
                      items: [
                        {
                          id: "user/1/A",
                          type: "book",
                          title,
                          author: [{ family: "Example" }],
                        },
                      ],
                    }),
              ),
      },
    },
  } as never);
  assert.equal(await service.hasCitationIntent("Contact @alice."), false);
  assert.equal(await service.hasCitationIntent("According to @oldKey."), true);
  const [health] = await service.diagnose(["oldKey"]);
  assert.equal(health.problem, undefined);
  assert.equal(health.notes.length, 0);
  const output = await service.format(
    "A claim [@oldKey].",
    "Papers/Example.md",
  );
  assert.equal(output.citations[0], "[1]");
  assert.match(output.bibliography, /Synthetic reference/);
  const unused = await service.format(
    "A claim [@oldKey].\n\n[^unused]: [@unknown]",
    "Papers/Example.md",
  );
  assert.equal(unused.citations.length, 1);
  title = "Updated reference";
  service.invalidate();
  const updated = await service.format(
    "A claim [@oldKey].",
    "Papers/Example.md",
  );
  assert.match(updated.bibliography, /Updated reference/);
  service.invalidate();
  failRead = true;
  await assert.rejects(
    service.format("[@oldKey]", "Papers/Retry.md"),
    /Temporary read failure/,
  );
  failRead = false;
  // No vault change or explicit invalidation: the unchanged paper can retry.
  const retried = await service.format("[@oldKey]", "Papers/Retry.md");
  assert.match(retried.bibliography, /Updated reference/);
  assert.equal((await service.diagnose(["oldKey"]))[0].problem, undefined);
  const missing = await service.format("[@unknown]", "Papers/Example.md");
  assert.match(missing.model.problems.join(" "), /Citation key not found/);
  assert.equal(missing.citations.length, 0);
});
