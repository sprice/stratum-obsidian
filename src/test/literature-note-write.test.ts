import assert from "node:assert/strict";
import test from "node:test";
import type { App, TFile } from "obsidian";
import type * as Note from "../literature-note";
import type * as Index from "../plugin-note-index";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";
import { findExistingLiteratureNoteMatch } from "../literature-note-matching";
import { loadRuntime } from "./runtime-harness";
import { composeLiteratureNoteBody } from "../literature-note-layout";
import {
  MANAGED_START,
  MANAGED_END,
  SYNC_BOUNDARY,
  USER_BOUNDARY_CALLOUT,
} from "../literature-note-content-types";

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
  parentItem: {
    key: "ABCD1234",
    version: 2,
    data: { title: "Paper", itemType: "document" },
  },
  childItems: [],
  collections: [],
});
const content = (fm: Record<string, unknown>, body = "My original notes") =>
  `---\n${JSON.stringify(fm)}\n---\n\n> [!stratum]- My Notes\n> This block and everything above it is managed by Stratum. Write your notes below.\n\n${body}\n`;
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
    stratumVersion: "0.2.1",
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
        stratumVersion: "0.2.1",
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
      stratumVersion: "0.2.1",
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

test("already-deleted mixed layout still migrates and subsequent marking is unchanged", async () => {
  const fm = {
    ...frontmatter,
    stratum_note_layout: 2,
    zotero_status: "deleted",
  };
  const managed = `${MANAGED_START}\nSynthetic source\n${MANAGED_END}\n`;
  const fixture = vaultFixture(
    `---\n${JSON.stringify(fm)}\n---\n${composeLiteratureNoteBody("## My Notes\n\n", managed)}\n${USER_BOUNDARY_CALLOUT}\n\nRetain my research\n`,
  );
  const params = { app: fixture.app, file: fixture.file, identity };
  assert.equal((await note.markLiteratureNoteDeleted(params)).changed, true);
  assert.ok(fixture.current.includes("Retain my research"));
  assert.ok(
    fixture.current.indexOf("Retain my research") <
      fixture.current.indexOf(SYNC_BOUNDARY),
  );
  const migrated = fixture.current;
  assert.equal((await note.markLiteratureNoteDeleted(params)).changed, false);
  assert.equal(fixture.current, migrated);
});

test("a stale cached file path is discarded and repaired by identity", () => {
  const index = loadRuntime<typeof Index>("plugin-note-index.ts", host);
  const stale = new FakeFile();
  const correct = new FakeFile();
  correct.path = "Literature Notes/correct.md";
  const plugin = {
    manifest: { version: "0.2.1" },
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
      stratumVersion: "0.2.1",
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
    stratumVersion: "0.2.1",
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
    manifest: { version: "0.2.1" },
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

test("metadata corrections preserve existing managed paths, aliases and personal content", async () => {
  const fixture = vaultFixture(
    content(
      {
        ...frontmatter,
        stratum_filename_stem: "custom",
        aliases: ["Canada n.d.", "Personal alias"],
        stratum_managed_aliases: ["Canada n.d."],
        custom_property: "keep me",
      },
      "My original notes\n[[Another note]] ^my-block",
    ),
  );
  const corrected = {
    ...detail,
    item: { ...detail.item, title: "Correct title", year: "1997" },
  };
  const result = await note.createOrUpdateLiteratureNote({
    stratumVersion: "0.2.1",
    app: fixture.app,
    existingFile: fixture.file,
    detail: corrected,
    filenameFormat: "readable",
    notesFolder: "Literature Notes",
  });
  assert.equal(result.file.path, "Literature Notes/custom.md");
  assert.match(fixture.current, /Canada n.d./);
  assert.match(fixture.current, /Personal alias/);
  assert.match(fixture.current, /"custom_property":"keep me"/);
  assert.match(fixture.current, /"zotero_title":"Correct title"/);
  assert.ok(
    fixture.current.includes("My original notes\n[[Another note]] ^my-block"),
  );
});

for (const itemType of [
  "futureType",
  null,
  "attachment",
  "note",
  "annotation",
]) {
  test(`unsupported ${itemType} cannot create or change an existing note`, async () => {
    const unsupported = { ...detail, item: { ...detail.item, itemType } };
    for (const existing of [true, false]) {
      const fixture = vaultFixture();
      const original = fixture.current;
      await assert.rejects(
        note.createOrUpdateLiteratureNote({
          stratumVersion: "0.2.1",
          app: fixture.app,
          existingFile: existing ? fixture.file : null,
          detail: unsupported,
          filenameFormat: "readable",
          notesFolder: "Literature Notes",
        }),
        /not supported/,
      );
      assert.equal(fixture.writes, 0);
      assert.equal(fixture.current, original);
    }
    const sync = loadRuntime<typeof import("../plugin-note-sync")>(
      "plugin-note-sync.ts",
      host,
    );
    // Empty plugin deliberately fails if anything is accessed before the guard.
    await assert.rejects(
      sync.writeLiteratureNoteFromDetail({} as never, {
        detail: unsupported,
        existingFile: null,
        enrichmentMode: "load",
      }),
      /not supported/,
    );
  });
}

test("concurrent folder creation tolerates another sync creating the folder", async () => {
  class Folder {}
  const { ensureFolder } = loadRuntime<typeof Note>("literature-note.ts", {
    ...host,
    TFolder: Folder,
  });
  let folder: Folder | null = null;
  const app = {
    vault: {
      getAbstractFileByPath: () => folder,
      createFolder: async () => {
        await Promise.resolve();
        if (folder) throw new Error("Folder already exists");
        folder = new Folder();
      },
    },
  } as unknown as App;
  await Promise.all([
    ensureFolder(app, "Sources"),
    ensureFolder(app, "Sources"),
  ]);
});

test("managed-note refresh preserves paper style overrides and a BOM-prefixed frontmatter block", async () => {
  const f = vaultFixture(
    "\uFEFF" +
      content({
        ...frontmatter,
        stratum_citation_style: "ieee",
        stratum_citation_language: "fr-FR",
      }),
  );
  await note.createOrUpdateLiteratureNote({
    app: f.app,
    existingFile: f.file,
    detail,
    notesFolder: "Literature Notes",
    filenameFormat: "readable",
    stratumVersion: "0.2.2",
  });
  assert.match(f.current, /stratum_citation_style.*ieee/);
  assert.match(f.current, /stratum_citation_language.*fr-FR/);
  assert.match(f.current, /My original notes/);
});
test("identity lookup keeps a manually moved managed note outside the configured folder", async () => {
  const f = vaultFixture();
  f.file.path = "Papers/Moved source.md";
  const runtime = loadRuntime<typeof Index>("plugin-note-index.ts", host);
  const fm = { ...frontmatter, stratum_note_type: "literature-note" };
  const plugin = {
    settings: { notesFolder: "Literature Notes", itemFileMap: {} },
    app: {
      vault: {
        getMarkdownFiles: () => [f.file],
        getAbstractFileByPath: () => f.file,
      },
      metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
    },
    itemFileMapPersistTimer: null,
    saveSettings: () => Promise.resolve(),
  };
  assert.equal(
    runtime.findExistingLiteratureNoteFile(plugin as never, identity),
    f.file,
  );
  await runtime.rebuildItemFileMap(plugin as never);
  assert.equal(
    (plugin.settings.itemFileMap as Record<string, { filePath: string }>)[
      "user/1/ABCD1234"
    ].filePath,
    f.file.path,
  );
});

test("a corrupt citation cache cannot fail a completed literature-note sync", async () => {
  const fixture = vaultFixture();
  const cache = new FakeFile();
  cache.path = "stratum-references.json";
  const app = {
    ...fixture.app,
    vault: {
      ...fixture.app.vault,
      getAbstractFileByPath: (path: string) =>
        path === cache.path ? cache : null,
      read: (file: TFile) =>
        file === (cache as unknown)
          ? Promise.resolve("{")
          : fixture.app.vault.read(file),
    },
  };
  let remembered = false;
  const plugin = {
    app,
    manifest: { version: "0.2.2" },
    settings: {
      notesFolder: "Literature Notes",
      filenameFormat: "readable",
      enabledLibraries: [{ type: "user", id: "1" }],
      collectionCatalogs: {
        "user:1": { updatedAt: Date.now(), collections: [] },
      },
    },
    backend: { hasSession: () => true },
    rememberLiteratureNoteFile: () => {
      remembered = true;
    },
  };
  const sync = loadRuntime<typeof import("../plugin-note-sync")>(
    "plugin-note-sync.ts",
    host,
  );
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const result = await sync.writeLiteratureNoteFromDetail(plugin as never, {
      detail: {
        ...detail,
        item: {
          ...detail.item,
          csl: {
            id: "user/1/ABCD1234",
            type: "book",
            title: "Synthetic reference",
          },
        },
      },
      existingFile: fixture.file,
      enrichmentMode: "skip",
    });
    assert.equal(result.file, fixture.file);
    assert.equal(remembered, true);
    assert.equal(fixture.writes, 1);
    assert.ok(
      errors.some((args) =>
        String(args[0]).includes("literature note sync succeeded"),
      ),
    );
  } finally {
    console.error = originalError;
  }
});

test("image sync resolves an existing note before deciding whether its embed is missing", async () => {
  const image = new FakeFile();
  image.path = "Literature Notes/Attachments/paper-area-imgd1234.png";
  const fm = {
    ...frontmatter,
    stratum_annotation_images: { IMGD1234: image.path },
  };
  const fixture = vaultFixture(content(fm));
  const app = {
    ...fixture.app,
    vault: {
      ...fixture.app.vault,
      getMarkdownFiles: () => [fixture.file],
      getAbstractFileByPath: (path: string) =>
        path === fixture.file.path
          ? fixture.file
          : path === image.path
            ? image
            : null,
    },
    metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
  };
  const plugin = {
    app,
    manifest: { version: "0.3.1" },
    settings: {
      notesFolder: "Literature Notes",
      filenameFormat: "readable",
      enabledLibraries: [{ type: "user", id: "1" }],
      collectionCatalogs: {
        "user:1": { updatedAt: Date.now(), collections: [] },
      },
    },
    backend: { hasSession: () => true },
    bulkLibrarySyncRunPromise: {},
    rememberLiteratureNoteFile: () => {},
  };
  const sync = loadRuntime<typeof import("../plugin-note-sync")>(
    "plugin-note-sync.ts",
    { ...host, Platform: { isDesktopApp: false } },
  );
  const result = await sync.writeLiteratureNoteFromDetail(plugin as never, {
    detail: {
      ...detail,
      annotations: [
        {
          key: "IMGD1234",
          attachmentKey: "PDFD1234",
          type: "image",
          color: null,
          pageLabel: "1",
          text: null,
          comment: "Synthetic annotation",
          dateModified: null,
          zoteroOpenPdfUri:
            "zotero://open-pdf/library/items/PDFD1234?annotation=IMGD1234",
        },
      ],
    },
    existingFile: null,
    enrichmentMode: "skip",
  });
  assert.equal(result.file, fixture.file);
  assert.match(fixture.current, /!\[Selected area\]/);
  assert.doesNotMatch(fixture.current, /Area image unavailable/);
  assert.match(fixture.current, /My original notes/);
});

test("later syncs preserve edits made above the new boundary during the atomic write", async () => {
  const fixture = vaultFixture();
  const params = {
    stratumVersion: "0.2.1",
    app: fixture.app,
    existingFile: fixture.file,
    detail,
    filenameFormat: "readable" as const,
    notesFolder: "Literature Notes",
  };
  await note.createOrUpdateLiteratureNote(params);
  fixture.beforeProcess = () => {
    fixture.current = fixture.current.replace(
      "## My Notes\n",
      "## My Notes\nConcurrent personal edit  \n",
    );
  };
  await note.createOrUpdateLiteratureNote({
    ...params,
    detail: {
      ...detail,
      item: { ...detail.item, version: detail.item.version + 1 },
    },
  });
  assert.ok(fixture.current.includes("Concurrent personal edit  \n"));
  assert.ok(
    fixture.current.indexOf("Concurrent personal edit  \n") <
      fixture.current.indexOf("<!-- stratum:sync-boundary -->"),
  );
  assert.match(fixture.current, /My original notes/);
});

test("missing required boundary never writes the note", async () => {
  const original = `---\n${JSON.stringify(frontmatter)}\n---\nPersonal writing`;
  const fixture = vaultFixture(original);
  await assert.rejects(
    note.createOrUpdateLiteratureNote({
      stratumVersion: "0.2.1",
      app: fixture.app,
      existingFile: fixture.file,
      detail,
      filenameFormat: "readable",
      notesFolder: "Literature Notes",
    }),
    /boundary is missing or damaged/,
  );
  assert.equal(fixture.writes, 0);
  assert.equal(fixture.current, original);
});

test("template replacement rechecks personal writing inside the atomic update", async () => {
  const starter = "## My Notes\n\n";
  const initial = `---\n${JSON.stringify({ ...frontmatter, stratum_note_layout: 2, stratum_notes_template: starter })}\n---\n${composeLiteratureNoteBody(starter, `${MANAGED_START}\nSource\n${MANAGED_END}\n`)}`;
  const fixture = vaultFixture(initial);
  fixture.beforeProcess = () => {
    fixture.current = initial.replace(
      SYNC_BOUNDARY,
      `My concurrent research\n\n${SYNC_BOUNDARY}`,
    );
  };
  await note.createOrUpdateLiteratureNote({
    stratumVersion: "0.2.1",
    app: fixture.app,
    existingFile: fixture.file,
    detail,
    filenameFormat: "readable",
    notesFolder: "Literature Notes",
    notesTemplate: "## Summary",
  });
  assert.match(fixture.current, /My concurrent research/);
  assert.doesNotMatch(fixture.current, /## Summary/);
  assert.match(fixture.current, /stratum_notes_template/);
});
