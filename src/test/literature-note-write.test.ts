import assert from "node:assert/strict";
import test from "node:test";
import type { App, TFile } from "obsidian";
import type * as Note from "../literature-note";
import type * as Index from "../plugin-note-index";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";
import { findExistingLiteratureNoteMatch } from "../literature-note-matching";
import { loadRuntime } from "./runtime-harness";

const identity = { libraryType: "user", libraryId: "1", itemKey: "ABCD1234" };
const frontmatter = {
  zotero_item_identity: "user/1/ABCD1234",
  zotero_item_key: "ABCD1234",
  zotero_library_type: "user",
  zotero_library_id: "1",
};
const detail = normalizeZoteroItemDetail({
  zoteroUserId: "1",
  library: {
    type: "user",
    id: "1",
    identity: "user:1",
    zoteroUriSegment: "library",
  },
  parentItem: { key: "ABCD1234", version: 2, data: { title: "Paper" } },
  childItems: [],
  collections: [],
});
const content = (fm: Record<string, unknown>, body = "My original notes") =>
  `---\n${JSON.stringify(fm)}\n---\n\n${body}\n`;
class FakeFile {
  path = "Literature Notes/custom.md";
  name = "custom.md";
  basename = "custom";
}
const host = {
  TFile: FakeFile,
  normalizePath: (path: string) => path,
  parseYaml: JSON.parse,
  stringifyYaml: JSON.stringify,
  htmlToMarkdown: (html: string) => html,
};
const note = loadRuntime<typeof Note>("literature-note.ts", host);

for (const conflicting of [
  {
    zotero_item_key: "ABCD1234",
    zotero_library_type: "group",
    zotero_library_id: "2",
  },
  { ...frontmatter, zotero_item_identity: "group/2/ABCD1234" },
  { zotero_item_identity: "ABCD1234", zotero_library_id: "2" },
]) {
  test(`reject conflicting library identity ${JSON.stringify(conflicting)}`, () => {
    assert.equal(
      findExistingLiteratureNoteMatch(
        [{ path: "note.md", name: "note.md", frontmatter: conflicting }],
        identity,
      ),
      null,
    );
  });
}
test("unambiguous legacy item-key notes remain eligible", () => {
  assert.ok(
    findExistingLiteratureNoteMatch(
      [
        {
          path: "note.md",
          name: "note.md",
          frontmatter: { zotero_item_key: "ABCD1234" },
        },
      ],
      identity,
    ),
  );
});

function vaultFixture(initial = content(frontmatter)) {
  // The host stub intentionally implements only the file properties under test.
  const file: TFile = new FakeFile() as never;
  let current = initial;
  let beforeProcess = () => {};
  let writes = 0;
  const app = {
    vault: {
      read: () => Promise.resolve(current),
      process: (_file: TFile, transform: (value: string) => string) => {
        beforeProcess();
        current = transform(current);
        writes++;
        return Promise.resolve(current);
      },
    },
  } as unknown as App;
  return {
    app,
    file,
    get current() {
      return current;
    },
    get writes() {
      return writes;
    },
    set current(value: string) {
      current = value;
    },
    set beforeProcess(value: () => void) {
      beforeProcess = value;
    },
  };
}

test("sync preserves user edits made after the initial read", async () => {
  const fixture = vaultFixture();
  fixture.beforeProcess = () => {
    fixture.current += "New user edit\n";
  };
  await note.createOrUpdateLiteratureNote({
    app: fixture.app,
    existingFile: fixture.file,
    detail,
    filenameFormat: "readable",
    notesFolder: "Literature Notes",
  });
  assert.match(fixture.current, /My original notes/);
  assert.match(fixture.current, /New user edit/);
});

test("a stale file lookup cannot overwrite a different or ordinary note", async () => {
  for (const fm of [
    {},
    { ...frontmatter, zotero_item_identity: "group/2/ABCD1234" },
  ]) {
    const fixture = vaultFixture(content(fm));
    await assert.rejects(
      note.createOrUpdateLiteratureNote({
        app: fixture.app,
        existingFile: fixture.file,
        detail,
        filenameFormat: "readable",
        notesFolder: "Literature Notes",
      }),
      /no longer matches/,
    );
    assert.equal(fixture.writes, 0);
  }
});

test("identity is checked again inside the atomic update", async () => {
  const fixture = vaultFixture();
  fixture.beforeProcess = () => {
    fixture.current = content({}, "Replacement user note");
  };
  await assert.rejects(
    note.createOrUpdateLiteratureNote({
      app: fixture.app,
      existingFile: fixture.file,
      detail,
      filenameFormat: "readable",
      notesFolder: "Literature Notes",
    }),
    /no longer matches/,
  );
  assert.equal(fixture.writes, 0);
  assert.match(fixture.current, /Replacement user note/);
});

test("deleted-item marking preserves edits and rejects a replaced note", async () => {
  const fixture = vaultFixture();
  fixture.beforeProcess = () => {
    fixture.current += "Concurrent edit\n";
  };
  await note.markLiteratureNoteDeleted({
    app: fixture.app,
    file: fixture.file,
    identity,
  });
  assert.match(fixture.current, /Concurrent edit/);
  assert.match(fixture.current, /"zotero_status":"deleted"/);
  fixture.beforeProcess = () => {
    fixture.current = content({});
  };
  await assert.rejects(
    note.markLiteratureNoteDeleted({
      app: fixture.app,
      file: fixture.file,
      identity,
    }),
    /no longer matches/,
  );
});

test("a stale cached file path is discarded and repaired by identity", () => {
  const index = loadRuntime<typeof Index>("plugin-note-index.ts", host);
  const stale = new FakeFile();
  const correct = new FakeFile();
  correct.path = "Literature Notes/correct.md";
  const plugin = {
    settings: {
      notesFolder: "Literature Notes",
      itemFileMap: { "user/1/ABCD1234": { filePath: stale.path } },
    },
    itemFileMapPersistTimer: null,
    app: {
      vault: {
        getAbstractFileByPath: (path: string) =>
          path === stale.path ? stale : correct,
        getMarkdownFiles: () => [stale, correct],
      },
      metadataCache: {
        getFileCache: (file: FakeFile) => ({
          frontmatter:
            file === correct
              ? frontmatter
              : { ...frontmatter, zotero_item_identity: "group/2/ABCD1234" },
        }),
      },
    },
  };
  assert.equal(
    index.findExistingLiteratureNoteFile(plugin as never, identity),
    correct,
  );
});

test("an unloaded plugin cannot write while its atomic update is queued", async () => {
  const fixture = vaultFixture();
  let active = true;
  fixture.beforeProcess = () => {
    active = false;
  };
  await assert.rejects(
    note.createOrUpdateLiteratureNote({
      app: fixture.app,
      existingFile: fixture.file,
      detail,
      filenameFormat: "readable",
      notesFolder: "Literature Notes",
      canWrite: () => active,
    }),
    /cancelled/,
  );
  assert.equal(fixture.writes, 0);
});

test("CRLF frontmatter remains recognized and user content survives updates", async () => {
  const fixture = vaultFixture(content(frontmatter).replace(/\n/g, "\r\n"));
  await note.createOrUpdateLiteratureNote({
    app: fixture.app,
    existingFile: fixture.file,
    detail,
    filenameFormat: "readable",
    notesFolder: "Literature Notes",
  });
  assert.match(fixture.current, /My original notes/);
  assert.equal(fixture.writes, 1);
});

test("renaming a note during refresh does not leave sync permanently marked as running", async () => {
  const refresh = loadRuntime<typeof import("../plugin-note-refresh")>(
    "plugin-note-refresh.ts",
    { ...host, Platform: { isDesktopApp: false } },
  );
  const fixture = vaultFixture();
  const app = Object.assign(fixture.app, {
    metadataCache: {
      getFileCache: () => ({
        frontmatter: { ...frontmatter, stratum_note_type: "literature-note" },
      }),
    },
  });
  const plugin = {
    settings: {
      notesFolder: "Literature Notes",
      filenameFormat: "readable",
      enabledLibraries: [{ type: "user", id: "1" }],
      libraryAutoSync: {},
      libraryBulkSync: {},
    },
    app,
    noteRefreshPromises: new Map(),
    backend: {
      hasSession: () => true,
      getZoteroItemDetail: () => {
        fixture.file.path = "Literature Notes/renamed.md";
        return Promise.resolve(detail);
      },
    },
    isBulkLibrarySyncRunning: () => false,
    refreshAutoSyncUi: () => {},
    rememberLiteratureNoteFile: () => {},
  };
  await refresh.refreshOpenedLiteratureNote(plugin as never, fixture.file);
  assert.equal(plugin.noteRefreshPromises.size, 0);
  assert.equal(fixture.writes, 1);
});
