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
const doc = (noteId: string, id = "doc"): PublishedDocument => ({
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
  let store = new PublishStore(adapter, ".custom");
  const note = await store.note("Draft.md", "Draft", 1);
  await store.add(doc(note.id), new ArrayBuffer(5));
  await store.move("Draft.md", "Final.md");
  store = new PublishStore(adapter, ".custom");
  assert.equal((await store.note("Final.md", "Final", 1)).id, note.id);
  await store.move("Final.md", null);
  assert.notEqual((await store.note("Final.md", "Final", 2)).id, note.id);
  assert.equal((await store.list()).documents.length, 1);
  assert.ok(files.has(".custom/stratum/published/doc.pdf"));
});

test("failed catalog writes leave no final or partial document", async () => {
  const m = memory(),
    store = new PublishStore(m.adapter, ".config");
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
    store = new PublishStore(m.adapter, ".config");
  const note = await store.note("Example.md", "Example", 1);
  await store.add(doc(note.id), new ArrayBuffer(5));
  m.fail();
  await assert.rejects(store.remove("doc"), /Disk full/);
  assert.ok(m.files.has(".config/stratum/published/doc.pdf"));
  assert.equal((await store.list()).documents.length, 1);
});

test("serial publishing preserves both exports and rejects collisions", async () => {
  const m = memory(),
    store = new PublishStore(m.adapter, ".config");
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
  assert.ok(!m.files.has(".config/stratum/published/one.pdf"));
});

test("corrupt catalogs block mutation instead of losing history", async () => {
  const m = memory(),
    store = new PublishStore(m.adapter, ".config");
  m.files.set(".config/stratum/published/catalog.json", "broken");
  await assert.rejects(store.note("Example.md", "Example", 1));
  assert.equal(m.files.get(".config/stratum/published/catalog.json"), "broken");
});

test("catalog recovery preserves history after an interrupted replacement", async () => {
  const m = memory();
  let store = new PublishStore(m.adapter, ".config");
  const note = await store.note("Example.md", "Example", 1);
  await store.add(doc(note.id), new ArrayBuffer(5));
  const catalog = `${store.directory}/catalog.json`;
  const backup = `${store.directory}/catalog.backup.json`;
  await m.adapter.rename(catalog, backup);
  store = new PublishStore(m.adapter, ".config");
  assert.equal((await store.list()).documents.length, 1);
  assert.ok(m.files.has(catalog));
  assert.ok(!m.files.has(backup));
});

test("backup cleanup failures cannot roll back a committed publication", async () => {
  const m = memory();
  const store = new PublishStore(m.adapter, ".config");
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
  let store = new PublishStore(m.adapter, ".config");
  const note = await store.note("Example.md", "Example", 1);
  await store.add(doc(note.id), new ArrayBuffer(5));
  const path = `${store.directory}/doc.pdf`;
  await m.adapter.rename(path, `${path}.deleting`);
  store = new PublishStore(m.adapter, ".config");
  assert.equal((await store.list()).documents.length, 1);
  assert.ok(m.files.has(path));
  await store.remove("doc");
  assert.equal((await store.list()).documents.length, 0);
});

test("numbered names skip collisions in history and storage, including simultaneous publications", async () => {
  const m = memory();
  const store = new PublishStore(m.adapter, ".config");
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
  const store = new PublishStore(m.adapter, ".config");
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
  const store = new PublishStore(m.adapter, ".config");
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
  const word = await store.create(
    { ...doc(note.id, "two"), format: "docx" },
    "Example",
    new ArrayBuffer(3),
  );
  assert.equal(pdf.filename, "Example(101).pdf");
  assert.equal(word.filename, "Example.docx");
  assert.equal((await store.list()).documents.length, 2);
});
