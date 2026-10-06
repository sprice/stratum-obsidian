import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

test("selection preserves the query and resolves notes by library and item identity", () => {
  const library = { type: "group", id: "7", identity: "group:7" };
  const identities: unknown[] = [];
  const file = { path: "Papers/Synthetic.md" };
  const runtime = loadRuntime<typeof import("../plugin-library-selection")>(
    "plugin-library-selection.ts",
    {},
    {},
    "node",
    { "./plugin-libraries": { getSelectedSearchLibrary: () => library } },
  );
  const plugin = {
    librarySearchQuery: "author",
    libraryPickerCloseTimer: null,
    selectedLibraryResult: null as unknown,
    selectedLibraryNoteFile: null as unknown,
    libraryNoteActionError: { message: "old error" } as unknown,
    isSelectedLibraryAbstractExpanded: true,
    findExistingLiteratureNoteFile(identity: unknown) {
      identities.push(identity);
      return file;
    },
    refreshViews() {},
  };
  const result = { key: "SYNTHKEY", title: "Synthetic source" };
  runtime.selectLibrarySearchResult(plugin as never, result as never);
  assert.equal(plugin.librarySearchQuery, "author");
  assert.equal(plugin.selectedLibraryNoteFile, file);
  assert.equal(plugin.libraryNoteActionError, null);
  assert.equal(plugin.isSelectedLibraryAbstractExpanded, false);
  assert.deepEqual(JSON.parse(JSON.stringify(identities)), [
    { libraryType: "group", libraryId: "7", itemKey: "SYNTHKEY" },
  ]);
  runtime.clearSelectedLibraryResult(plugin as never);
  assert.equal(plugin.librarySearchQuery, "author");
  assert.equal(plugin.selectedLibraryNoteFile, null);
});
test("reopening unchanged search retains selection; editing the query clears it", () => {
  const runtime = loadRuntime<typeof import("../plugin-library-search")>(
    "plugin-library-search.ts",
    {},
  );
  const selected = { key: "SYNTHKEY", title: "Synthetic title" };
  const plugin = {
    librarySearchQuery: "author",
    selectedLibraryResult: selected as typeof selected | null,
    selectedLibraryNoteFile: {} as unknown,
    libraryNoteActionError: {} as unknown,
    isSelectedLibraryAbstractExpanded: true,
  };
  runtime.setLibrarySearchQuery(plugin as never, "author");
  assert.equal(plugin.selectedLibraryResult, selected);
  runtime.setLibrarySearchQuery(plugin as never, "other author");
  assert.equal(plugin.selectedLibraryResult, null);
  assert.equal(plugin.selectedLibraryNoteFile, null);
  assert.equal(plugin.libraryNoteActionError, null);
  assert.equal(plugin.isSelectedLibraryAbstractExpanded, false);
});

test("selected note availability follows matching metadata and deletion without scanning unrelated edits", () => {
  const library = { type: "group", id: "7", identity: "group:7" };
  const { refreshSelectedLibraryNoteForFile } = loadRuntime<
    typeof import("../plugin-library-selection")
  >("plugin-library-selection.ts", {}, {}, "node", {
    "./plugin-libraries": { getSelectedSearchLibrary: () => library },
  });
  const file = { path: "Papers/Synthetic.md" };
  let available: typeof file | null = file;
  let lookups = 0;
  const plugin = {
    selectedLibraryResult: { key: "SYNTHKEY" },
    selectedLibraryNoteFile: null as typeof file | null,
    app: { metadataCache: { getFileCache: () => null } },
    findExistingLiteratureNoteFile() {
      lookups++;
      return available;
    },
  };
  assert.equal(
    refreshSelectedLibraryNoteForFile(plugin as never, file as never, {
      frontmatter: { zotero_item_identity: "user/7/SYNTHKEY" },
    }),
    false,
  );
  assert.equal(lookups, 0, "Same item key in another library is unrelated");
  assert.equal(
    refreshSelectedLibraryNoteForFile(plugin as never, file as never, {
      frontmatter: { zotero_item_identity: "group/7/SYNTHKEY" },
    }),
    true,
  );
  assert.equal(plugin.selectedLibraryNoteFile, file);
  assert.equal(
    refreshSelectedLibraryNoteForFile(plugin as never, file as never, {
      frontmatter: { zotero_item_identity: "group/7/SYNTHKEY" },
    }),
    false,
    "Unchanged availability does not rebuild the UI",
  );
  available = null;
  assert.equal(
    refreshSelectedLibraryNoteForFile(plugin as never, file as never),
    true,
  );
  assert.equal(plugin.selectedLibraryNoteFile, null);
});

test("moving a legacy matching note across the notes folder updates selection availability", () => {
  class File {
    path = "Other/Synthetic.md";
    name = "Synthetic.md";
  }
  const host = { TFile: File, normalizePath: (path: string) => path };
  const index = loadRuntime<typeof import("../plugin-note-index")>(
    "plugin-note-index.ts",
    host,
  );
  const { refreshSelectedLibraryNoteForFile } = loadRuntime<
    typeof import("../plugin-library-selection")
  >("plugin-library-selection.ts", host, {}, "node", {
    "./plugin-libraries": {
      getSelectedSearchLibrary: () => ({
        type: "group",
        id: "7",
        identity: "group:7",
      }),
    },
  });
  const file = new File();
  const plugin = {
    settings: { notesFolder: "Papers", itemFileMap: {} },
    selectedLibraryResult: { key: "SYNTHKEY" },
    selectedLibraryNoteFile: null as File | null,
    app: {
      vault: {
        getMarkdownFiles: () => [file],
        getAbstractFileByPath: (path: string) =>
          path === file.path ? file : null,
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { zotero_item_key: "SYNTHKEY" } }),
      },
    },
    findExistingLiteratureNoteFile(
      identity: Parameters<typeof index.findExistingLiteratureNoteFile>[1],
    ) {
      return index.findExistingLiteratureNoteFile(plugin as never, identity);
    },
  };
  assert.equal(
    refreshSelectedLibraryNoteForFile(plugin as never, file as never),
    false,
  );
  file.path = "Papers/Synthetic.md";
  index.handleItemFileRename(
    plugin as never,
    file as never,
    "Other/Synthetic.md",
  );
  assert.equal(
    refreshSelectedLibraryNoteForFile(plugin as never, file as never),
    true,
  );
  assert.equal(plugin.selectedLibraryNoteFile, file);
  file.path = "Other/Synthetic.md";
  index.handleItemFileRename(
    plugin as never,
    file as never,
    "Papers/Synthetic.md",
  );
  assert.equal(
    refreshSelectedLibraryNoteForFile(plugin as never, file as never),
    true,
  );
  assert.equal(plugin.selectedLibraryNoteFile, null);
});
