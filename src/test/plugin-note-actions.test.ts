import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

function setup(
  options: {
    connection?: () => Promise<boolean>;
    fail?: boolean;
    existing?: boolean;
  } = {},
) {
  const library = { type: "group", id: "7", identity: "group:7" };
  const result = { key: "SYNTHKEY", title: "Synthetic source" };
  let writes = 0;
  let fetches = 0;
  const plugin = {
    isBulkLibrarySyncRunning: () => false,
    activeNoteActionKey: null as string | null,
    libraryNoteActionError: null as {
      key: string;
      libraryIdentity: string;
      message: string;
    } | null,
    backend: { hasSession: () => true },
    refreshViews() {},
    findExistingLiteratureNoteFile: () => (options.existing ? {} : null),
    library: {
      clearSelection() {
        throw new Error("Should not clear on failure or cancellation");
      },
    },
  };
  const runtime = loadRuntime<typeof import("../plugin-note-actions")>(
    "plugin-note-actions.ts",
    { Notice: class {} },
    { console: { error() {} } },
    "node",
    {
      "./plugin-libraries": { getSelectedSearchLibrary: () => library },
      "./plugin-sync-helpers": {
        ensureZoteroConnection:
          options.connection ?? (() => Promise.resolve(true)),
      },
      "./plugin-note-sync": {
        requireZoteroItemDetailForNoteSync: () => {
          fetches++;
          return options.fail
            ? Promise.reject(new Error("Synthetic backend failure"))
            : Promise.resolve({ library, item: { title: result.title } });
        },
        writeLiteratureNoteFromDetail: () => {
          writes++;
          return Promise.resolve({});
        },
      },
      "./literature-note-update-modal": {
        promptExistingLiteratureNote: () => Promise.resolve("cancel"),
      },
      "./literature-note": { getLiteratureNoteSummary: () => ({}) },
      "./plugin-tabs": {},
      "./library-search-modal": {},
      "./citation-composer": {},
      "./literature-note-links": {},
    },
  );
  return {
    runtime,
    plugin,
    result,
    writes: () => writes,
    fetches: () => fetches,
  };
}
test("note action becomes busy before connection checking to prevent duplicate imports", async () => {
  let finish!: (connected: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const fixture = setup({ connection: () => pending, fail: true });
  const first = fixture.runtime.createLiteratureNote(
    fixture.plugin as never,
    fixture.result as never,
  );
  assert.equal(fixture.plugin.activeNoteActionKey, "SYNTHKEY");
  await fixture.runtime.createLiteratureNote(
    fixture.plugin as never,
    fixture.result as never,
  );
  finish(true);
  await first;
  assert.equal(fixture.fetches(), 1);
  assert.equal(fixture.plugin.activeNoteActionKey, null);
});
test("failed import retains selection and exposes a generic library-scoped error", async () => {
  const fixture = setup({ fail: true });
  await fixture.runtime.createLiteratureNote(
    fixture.plugin as never,
    fixture.result as never,
  );
  assert.equal(fixture.writes(), 0);
  assert.equal(
    fixture.plugin.libraryNoteActionError?.libraryIdentity,
    "group:7",
  );
  assert.equal(fixture.plugin.libraryNoteActionError?.key, "SYNTHKEY");
  assert.equal(
    fixture.plugin.libraryNoteActionError?.message,
    "Could not create or update the literature note. Please try again.",
  );
});
test("existing note still requires confirmation and cancellation does not write", async () => {
  const fixture = setup({ existing: true });
  await fixture.runtime.createLiteratureNote(
    fixture.plugin as never,
    fixture.result as never,
  );
  assert.equal(fixture.fetches(), 1);
  assert.equal(fixture.writes(), 0);
  assert.equal(fixture.plugin.libraryNoteActionError, null);
});

for (const format of ["wiki", "markdown"] as const) {
  test(`literature-note insertion uses Obsidian's ${format} link output and the writing note's path`, () => {
    const sourceFile = {
      path: "Papers/Synthetic source.md",
      basename: "Synthetic source",
    };
    const draft = { path: "Drafts/Paper.md" };
    const entry = { file: sourceFile, preferredLinkText: "Smith 2024" };
    const output =
      format === "wiki"
        ? "[[Papers/Synthetic source|Smith 2024]]"
        : "[Smith 2024](../Papers/Synthetic%20source.md)";
    let choose!: (selected: typeof entry) => void;
    let inserted = "";
    const editor = {
      replaceSelection: (text: string) => {
        inserted = text;
      },
    };
    const plugin = {
      app: {
        workspace: {
          activeEditor: { editor, file: draft } as {
            editor: typeof editor;
            file: typeof draft;
          } | null,
        },
        fileManager: {
          generateMarkdownLink: (
            file: typeof sourceFile,
            sourcePath: string,
            subpath: string,
            alias: string,
          ) => {
            assert.equal(file, sourceFile);
            assert.equal(sourcePath, draft.path);
            assert.equal(subpath, "");
            assert.equal(alias, entry.preferredLinkText);
            return output;
          },
        },
      },
    };
    const runtime = loadRuntime<typeof import("../plugin-note-actions")>(
      "plugin-note-actions.ts",
      { Notice: class {} },
      {},
      "node",
      {
        "./plugin-note-sync": {},
        "./plugin-sync-helpers": {},
        "./plugin-libraries": {},
        "./literature-note-update-modal": {},
        "./literature-note": {},
        "./plugin-tabs": {},
        "./citation-composer": {},
        "./library-search-modal": {
          buildLiteratureNoteEntries: () => [entry],
          LiteratureNoteSearchModal: class {
            constructor(
              _app: unknown,
              _entries: unknown,
              onSelect: typeof choose,
            ) {
              choose = onSelect;
            }
            open() {}
          },
        },
      },
    );
    runtime.insertLiteratureNoteLink(plugin as never, editor as never);
    // Opening a modal can temporarily clear activeEditor. Retain the origin
    // rather than generating a relative link as though it were at vault root.
    plugin.app.workspace.activeEditor = null;
    choose(entry);
    assert.equal(inserted, output);
  });
}
