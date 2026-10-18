import test from "node:test";
import assert from "node:assert/strict";
import { PublishStore, type PublishAdapter } from "../publish-store";
import type { PublishedDocument } from "../publish-model";
function memory() {
  const files = new Map<string, string | ArrayBuffer>();
  let failCatalog = false;
  const adapter: PublishAdapter = {
    exists: (path) => Promise.resolve(files.has(path)),
    mkdir: (path) => {
      files.set(path, "");
      return Promise.resolve();
    },
    read: (path) => Promise.resolve(files.get(path) as string),
    write: (path, data) => {
      files.set(path, data);
      return Promise.resolve();
    },
    readBinary: (path) => Promise.resolve(files.get(path) as ArrayBuffer),
    writeBinary: (path, data) => {
      files.set(path, data);
      return Promise.resolve();
    },
    rename: (from, to) => {
      if (files.has(to))
        return Promise.reject(new Error("Destination file already exists!"));
      if (!files.has(from))
        return Promise.reject(new Error("Source file missing"));
      if (failCatalog && from.endsWith(".tmp") && to.endsWith("catalog.json"))
        return Promise.reject(new Error("Disk full"));
      files.set(to, files.get(from)!);
      files.delete(from);
      return Promise.resolve();
    },
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
  };
  return {
    files,
    adapter,
    fail: () => {
      failCatalog = true;
    },
  };
}
const doc = (
  noteId: string,
  id = "doc",
): PublishedDocument & { format: "pdf" } => ({
  id,
  noteId,
  filename: `${id}.pdf`,
  format: "pdf",
  createdAt: new Date().toISOString(),
  citationStyle: "apa",
  citationLanguage: "en-US",
});

test("publication survives reload and follows a rename, then a new note gets a new identity", async () => {
  const { adapter, files } = memory();
  let store = new PublishStore(adapter, ".custom/plugins/stratum");
  const note = await store.note("Draft.md", "Draft", 1);
  await store.add(doc(note.id), new ArrayBuffer(5));
  await store.move("Draft.md", "Final.md");
  store = new PublishStore(adapter, ".custom/plugins/stratum");
  assert.equal((await store.note("Final.md", "Final", 1)).id, note.id);
  await store.move("Final.md", null);
  assert.notEqual((await store.note("Final.md", "Final", 2)).id, note.id);
  assert.equal((await store.list()).documents.length, 1);
  assert.ok(files.has(".custom/plugins/stratum/published/doc.pdf"));
});

test("failed catalog writes leave no final or partial document", async () => {
  const m = memory(),
    store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  m.fail();
  await assert.rejects(
    store.add(doc(note.id), new ArrayBuffer(5)),
    /Disk full/,
  );
  assert.equal((await store.list()).documents.length, 0);
  assert.ok(
    ![...m.files.keys()].some(
      (path) => path.endsWith(".pdf") || path.endsWith(".tmp"),
    ),
  );
});

test("failed deletion restores the document and catalog entry", async () => {
  const m = memory(),
    store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  await store.add(doc(note.id), new ArrayBuffer(5));
  m.fail();
  await assert.rejects(store.remove("doc"), /Disk full/);
  assert.ok(m.files.has(".config/plugins/stratum/published/doc.pdf"));
  assert.equal((await store.list()).documents.length, 1);
});

test("serial publishing preserves both exports and rejects collisions", async () => {
  const m = memory(),
    store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  await Promise.all([
    store.add(doc(note.id, "one"), new ArrayBuffer(1)),
    store.add(doc(note.id, "two"), new ArrayBuffer(2)),
  ]);
  assert.equal((await store.list()).documents.length, 2);
  await assert.rejects(
    store.add(doc(note.id, "one"), new ArrayBuffer(3)),
    /already exists/,
  );
  await store.remove("one");
  assert.equal((await store.list()).documents.length, 1);
  assert.ok(!m.files.has(".config/plugins/stratum/published/one.pdf"));
});

test("corrupt catalogs block mutation instead of losing history", async () => {
  const m = memory(),
    store = new PublishStore(m.adapter, ".config/plugins/stratum");
  m.files.set(".config/plugins/stratum/published/catalog.json", "broken");
  await assert.rejects(store.note("Example.md", "Example", 1));
  assert.equal(
    m.files.get(".config/plugins/stratum/published/catalog.json"),
    "broken",
  );
});

test("catalog recovery preserves history after an interrupted replacement", async () => {
  const m = memory();
  let store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  await store.add(doc(note.id), new ArrayBuffer(5));
  const catalog = `${store.directory}/catalog.json`;
  const backup = `${store.directory}/catalog.backup.json`;
  await m.adapter.rename(catalog, backup);
  store = new PublishStore(m.adapter, ".config/plugins/stratum");
  assert.equal((await store.list()).documents.length, 1);
  assert.ok(m.files.has(catalog));
  assert.ok(!m.files.has(backup));
});

test("backup cleanup failures cannot roll back a committed publication", async () => {
  const m = memory();
  const store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  const remove = m.adapter.remove.bind(m.adapter);
  m.adapter.remove = (path) =>
    path.endsWith("catalog.backup.json")
      ? Promise.reject(new Error("Cleanup failed"))
      : remove(path);
  await store.add(doc(note.id), new ArrayBuffer(5));
  assert.equal((await store.list()).documents.length, 1);
  assert.ok(m.files.has(`${store.directory}/doc.pdf`));
  m.adapter.remove = remove;
  await store.add(doc(note.id, "second"), new ArrayBuffer(1));
  assert.equal((await store.list()).documents.length, 2);
});

test("interrupted deletion restores documents still referenced by the catalog", async () => {
  const m = memory();
  let store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  await store.add(doc(note.id), new ArrayBuffer(5));
  const path = `${store.directory}/doc.pdf`;
  await m.adapter.rename(path, `${path}.deleting`);
  store = new PublishStore(m.adapter, ".config/plugins/stratum");
  assert.equal((await store.list()).documents.length, 1);
  assert.ok(m.files.has(path));
  await store.remove("doc");
  assert.equal((await store.list()).documents.length, 0);
});

test("numbered names skip collisions in history and storage, including simultaneous publications", async () => {
  const m = memory();
  const store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  const first = await store.create(
    doc(note.id, "one"),
    "Example",
    new ArrayBuffer(1),
  );
  assert.equal(first.filename, "Example.pdf");
  // History still owns a name when its file goes missing.
  m.files.delete(store.path(first));
  m.files.set(`${store.directory}/Example(2).pdf`, new ArrayBuffer(8));
  m.files.set(`${store.directory}/Example(3).pdf.deleting`, new ArrayBuffer(9));
  const [second, third] = await Promise.all([
    store.create(doc(note.id, "two"), "Example", new ArrayBuffer(2)),
    store.create(doc(note.id, "three"), "Example", new ArrayBuffer(3)),
  ]);
  assert.equal(second.filename, "Example(4).pdf");
  assert.equal(third.filename, "Example(5).pdf");
  assert.equal(
    (m.files.get(`${store.directory}/Example(2).pdf`) as ArrayBuffer)
      .byteLength,
    8,
  );
  assert.equal((await store.list()).documents.length, 3);
});

test("a filename occupied during the final rename increments the number without overwriting", async () => {
  const m = memory();
  const store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  const rename = m.adapter.rename.bind(m.adapter);
  m.adapter.rename = async (from, to) => {
    if (to.endsWith("/Example.pdf")) m.files.set(to, new ArrayBuffer(9));
    await rename(from, to);
  };
  const result = await store.create(
    doc(note.id),
    "Example",
    new ArrayBuffer(1),
  );
  assert.equal(result.filename, "Example(2).pdf");
  assert.equal(
    (m.files.get(`${store.directory}/Example.pdf`) as ArrayBuffer).byteLength,
    9,
  );
  assert.ok(![...m.files.keys()].some((path) => path.endsWith(".tmp")));
});

test("numbering continues beyond 100 copies and is separate for each format", async () => {
  const m = memory();
  const store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  m.files.set(`${store.directory}/Example.pdf`, new ArrayBuffer(1));
  for (let number = 2; number <= 100; number++)
    m.files.set(
      `${store.directory}/Example(${number}).pdf`,
      new ArrayBuffer(1),
    );
  const pdf = await store.create(
    doc(note.id, "one"),
    "Example",
    new ArrayBuffer(2),
  );
  const second = await store.create(
    { ...doc(note.id, "two"), format: "pdf" },
    "Example",
    new ArrayBuffer(3),
  );
  assert.equal(pdf.filename, "Example(101).pdf");
  assert.equal(second.filename, "Example(102).pdf");
  assert.equal((await store.list()).documents.length, 2);
});

test("a filename occupied during the final existence check uses the next number", async () => {
  const m = memory();
  const store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  const exists = m.adapter.exists.bind(m.adapter);
  const path = `${store.directory}/Example.pdf`;
  let checks = 0;
  m.adapter.exists = async (candidate) => {
    if (candidate === path && ++checks === 2)
      m.files.set(path, new ArrayBuffer(9));
    return exists(candidate);
  };
  const created = await store.create(
    doc(note.id),
    "Example",
    new ArrayBuffer(1),
  );
  assert.equal(created.filename, "Example(2).pdf");
  assert.equal((m.files.get(path) as ArrayBuffer).byteLength, 9);
  assert.equal((await store.list()).documents.length, 1);
});

test("duplicate document identities fail without retrying filename allocation", async () => {
  const m = memory();
  const store = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  await store.create(doc(note.id), "Example", new ArrayBuffer(1));
  await assert.rejects(
    store.create(doc(note.id), "Other title", new ArrayBuffer(2)),
    /already exists/,
  );
  assert.equal((await store.list()).documents.length, 1);
});

test("catalog saves drop non-PDF entries and leave their files in place", async () => {
  const { adapter, files } = memory();
  const store = new PublishStore(adapter, ".config/plugins/stratum");
  const note = await store.note("Example.md", "Example", 1);
  const pdf = doc(note.id);
  const legacy = [
    { ...doc(note.id, "legacy"), filename: "Legacy.docx", format: "docx" },
    { ...doc(note.id, "removing"), filename: "Removing.docx", format: "docx" },
  ];
  const pdfBytes = new ArrayBuffer(4);
  const legacyBytes = new ArrayBuffer(8);
  files.set(`${store.directory}/${pdf.filename}`, pdfBytes);
  files.set(`${store.directory}/Legacy.docx`, legacyBytes);
  files.set(`${store.directory}/Removing.docx.deleting`, legacyBytes);
  files.set(
    `${store.directory}/catalog.json`,
    JSON.stringify({
      version: 1,
      notes: [
        { ...note, preferences: { format: "docx", docx: { bodyFont: "" } } },
      ],
      documents: [legacy[0], pdf, legacy[1]],
    }),
  );
  const listed = await store.list();
  assert.deepEqual(listed.documents, [pdf]);
  const preferences = listed.notes[0].preferences!;
  await store.setPreferences(note.id, {
    ...preferences,
    pdf: { ...preferences.pdf, bodyFont: "Georgia" },
  });
  const saved = JSON.parse(
    files.get(`${store.directory}/catalog.json`) as string,
  ) as {
    documents: PublishedDocument[];
    notes: { preferences: Record<string, unknown> }[];
  };
  assert.deepEqual(saved.documents, [pdf]);
  assert.equal(Object.hasOwn(saved.notes[0].preferences, "format"), false);
  assert.equal(Object.hasOwn(saved.notes[0].preferences, "docx"), false);
  assert.equal(files.get(`${store.directory}/${pdf.filename}`), pdfBytes);
  assert.equal(files.get(`${store.directory}/Legacy.docx`), legacyBytes);
  assert.equal(
    files.get(`${store.directory}/Removing.docx.deleting`),
    legacyBytes,
  );
  assert.equal(files.has(`${store.directory}/Removing.docx`), false);
});

test("legacy bundled-template catalogs retain selections, options and accessible PDFs after reload", async () => {
  const { adapter, files } = memory();
  const directory = ".synthetic/plugins/stratum";
  const store = new PublishStore(adapter, directory);
  const { readNotePreferences, DEFAULT_ACADEMIC_OPTIONS } =
    await import("../publish-options");
  const note = await store.note("Papers/Synthetic.md", "Synthetic", 1);
  const options = {
    showLineNumbers: false,
    showDraftDateHeader: false,
    numberedHeadings: true,
  };
  const template = { id: "aastex", version: "1.1.0", upstreamVersion: "7.0.2" };
  await store.setPreferences(
    note.id,
    readNotePreferences({
      templateId: "package:aastex",
      aastex: { options, package: template },
    }),
  );
  const document = {
    ...doc(note.id),
    publishing: {
      documentType: "academic" as const,
      opening: "properties" as const,
      layout: DEFAULT_ACADEMIC_OPTIONS,
      template,
      aastexPdfOptions: options,
    },
  };
  const bytes = new TextEncoder().encode(
    "%PDF-Synthetic retained publication",
  ).buffer;
  await store.add(document, bytes);
  const before = files.get(`${directory}/published/catalog.json`);
  const reloaded = new PublishStore(adapter, directory);
  const catalog = await reloaded.list();
  assert.equal(catalog.notes[0].preferences?.templateId, "package:aastex");
  assert.deepEqual(catalog.notes[0].preferences?.aastex, {
    options,
    package: template,
  });
  assert.deepEqual(catalog.documents[0].publishing?.aastexPdfOptions, options);
  assert.deepEqual(
    await adapter.readBinary(reloaded.path(catalog.documents[0])),
    bytes,
  );
  assert.equal(files.get(`${directory}/published/catalog.json`), before);
});

function visibleStore(m = memory()) {
  let folder = "Stratum Docs";
  const trashed: string[] = [];
  const files = {
    folder: () => folder,
    create: async (path: string, bytes: ArrayBuffer) => {
      if (await m.adapter.exists(path)) throw new Error("File exists");
      await m.adapter.writeBinary(path, bytes);
    },
    trash: async (path: string) => {
      trashed.push(path);
      await m.adapter.remove(path);
    },
  };
  return {
    ...m,
    visible: files,
    trashed,
    store: new PublishStore(m.adapter, ".config/plugins/stratum", files),
    setFolder: (value: string) => {
      folder = value;
    },
  };
}

test("vault PDFs use the chosen folder, preserve prior exports, and follow moves independently of source notes", async () => {
  const m = visibleStore();
  const note = await m.store.note("Synthetic.md", "Synthetic", 1);
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const first = await m.store.create(doc(note.id, "first"), "Synthetic", bytes);
  assert.equal(first.path, "Stratum Docs/Synthetic.pdf");
  const second = await m.store.create(
    doc(note.id, "second"),
    "Synthetic",
    bytes,
  );
  assert.equal(second.path, "Stratum Docs/Synthetic(2).pdf");
  m.setFolder("Exports/Papers");
  const third = await m.store.create(doc(note.id, "third"), "Synthetic", bytes);
  assert.equal(third.path, "Exports/Papers/Synthetic.pdf");
  await m.adapter.rename(third.path, "Exports/Edited.pdf");
  await m.store.move(third.path, "Exports/Edited.pdf");
  assert.equal((await m.store.list()).documents[2].filename, "Edited.pdf");
  await m.adapter.rename("Exports/Edited.pdf", "Archive/Edited.pdf");
  await m.store.move("Exports", "Archive");
  assert.equal((await m.store.list()).documents[2].path, "Archive/Edited.pdf");
  await m.store.move("Synthetic.md", null);
  assert.equal((await m.store.list()).documents.length, 3);
  await m.store.remove(first.id);
  assert.deepEqual(m.trashed, [first.path]);
  assert.ok(m.files.has(second.path));
  await m.store.move("Archive", null);
  assert.equal((await m.store.list()).documents.length, 1);
});

test("migration verifies copies, avoids unrelated files, and retains metadata", async () => {
  const m = visibleStore();
  const old = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await old.note("Synthetic.md", "Synthetic", 1);
  const bytes = new Uint8Array([1, 2]).buffer;
  await old.add(doc(note.id), bytes);
  const other = new Uint8Array([9]).buffer;
  m.files.set("Stratum Docs/doc.pdf", other);
  const migrated = (await m.store.list()).documents[0];
  assert.equal(migrated.path, "Stratum Docs/doc(2).pdf");
  assert.equal(migrated.id, "doc");
  assert.equal(migrated.noteId, note.id);
  assert.deepEqual(m.files.get(migrated.path), bytes);
  assert.equal(m.files.get("Stratum Docs/doc.pdf"), other);
  assert.equal(m.files.has(old.path(doc(note.id))), false);
  assert.equal(migrated.migrationPath, undefined);
  assert.equal(migrated.legacyFilename, undefined);
  assert.deepEqual((await m.store.list()).documents, [migrated]);
});

test("a failed migration commit resumes the verified destination without duplicate copies", async () => {
  const m = visibleStore();
  const old = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await old.note("Synthetic.md", "Synthetic", 1);
  await old.add(doc(note.id), new Uint8Array([3, 4]).buffer);
  const rename = m.adapter.rename.bind(m.adapter);
  let commits = 0;
  m.adapter.rename = async (from, to) => {
    if (from.endsWith(".tmp") && to.endsWith("catalog.json") && ++commits === 2)
      throw new Error("Disk full");
    await rename(from, to);
  };
  await assert.rejects(m.store.list(), /Disk full/);
  assert.ok(m.files.has(old.path(doc(note.id))));
  assert.ok(m.files.has("Stratum Docs/doc.pdf"));
  m.adapter.rename = rename;
  const restarted = new PublishStore(
    m.adapter,
    ".config/plugins/stratum",
    m.visible,
  );
  const result = (await restarted.list()).documents[0];
  assert.equal(result.path, "Stratum Docs/doc.pdf");
  assert.equal([...m.files.keys()].filter((p) => p.endsWith(".pdf")).length, 1);
});

test("failed copy verification retains the original and resumes without overwriting a different destination", async () => {
  const m = visibleStore();
  const old = new PublishStore(m.adapter, ".config/plugins/stratum");
  const note = await old.note("Synthetic.md", "Synthetic", 1);
  const bytes = new Uint8Array([3, 4]).buffer;
  await old.add(doc(note.id), bytes);
  const create = m.visible.create;
  m.visible.create = (path) => create(path, new ArrayBuffer(1));
  await assert.rejects(m.store.list(), /verified/);
  assert.deepEqual(m.files.get(old.path(doc(note.id))), bytes);
  m.visible.create = create;
  assert.equal(
    (await m.store.list()).documents[0].path,
    "Stratum Docs/doc(2).pdf",
  );
  assert.ok(m.files.has("Stratum Docs/doc.pdf"));
});

test("failed trash preserves the catalog and PDF; failed creation metadata removes only its new PDF", async () => {
  const m = visibleStore();
  const note = await m.store.note("Synthetic.md", "Synthetic", 1);
  const entry = await m.store.create(
    doc(note.id),
    "Synthetic",
    new ArrayBuffer(2),
  );
  m.visible.trash = () => Promise.reject(new Error("Trash unavailable"));
  await assert.rejects(m.store.remove(entry.id), /Trash unavailable/);
  assert.equal((await m.store.list()).documents.length, 1);
  assert.ok(m.files.has(entry.path!));
  m.visible.trash = (path) => m.adapter.remove(path);
  m.fail();
  await assert.rejects(
    m.store.create(doc(note.id, "new"), "Other", new ArrayBuffer(3)),
    /Disk full/,
  );
  assert.equal(m.files.has("Stratum Docs/Other.pdf"), false);
  assert.ok(m.files.has(entry.path!));
});

test("renaming a PDF to a different extension removes tracking without deleting the file", async () => {
  const m = visibleStore();
  const note = await m.store.note("Synthetic.md", "Synthetic", 1);
  const entry = await m.store.create(
    doc(note.id),
    "Synthetic",
    new ArrayBuffer(2),
  );
  await m.adapter.rename(entry.path!, "Stratum Docs/Synthetic.txt");
  await m.store.move(entry.path!, "Stratum Docs/Synthetic.txt");
  assert.equal((await m.store.list()).documents.length, 0);
  assert.ok(m.files.has("Stratum Docs/Synthetic.txt"));
});

test("vault moves and deletions remain tracked when an unrelated legacy migration fails", async () => {
  const m = visibleStore();
  const note = await m.store.note("Synthetic.md", "Synthetic", 1);
  const entry = await m.store.create(
    doc(note.id),
    "Synthetic",
    new ArrayBuffer(2),
  );
  const old = new PublishStore(m.adapter, ".config/plugins/stratum");
  await old.add(doc(note.id, "legacy"), new ArrayBuffer(3));
  m.visible.create = () => Promise.reject(new Error("Migration unavailable"));
  await assert.rejects(m.store.list(), /Migration unavailable/);

  await m.adapter.rename(entry.path!, "Archive/Synthetic.pdf");
  await m.store.move(entry.path!, "Archive/Synthetic.pdf");
  await m.store.move("Synthetic.md", "Renamed.md");
  const catalog = await old.list();
  assert.equal(
    catalog.documents.find((d) => d.id === entry.id)?.path,
    "Archive/Synthetic.pdf",
  );
  assert.equal(catalog.notes[0].path, "Renamed.md");

  await m.store.move("Archive/Synthetic.pdf", null);
  assert.deepEqual(
    (await old.list()).documents.map((d) => d.id),
    ["legacy"],
  );
});
