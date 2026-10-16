import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { migratePluginStorage } from "../plugin-storage-migration";
import { loadReferenceStore } from "../citation-reference-store";
import { PublishStore } from "../publish-store";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "stratum-storage-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = (name: string) => join(root, name);
  const put = async (name: string, text: string | Uint8Array) => {
    await fs.mkdir(dirname(path(name)), { recursive: true });
    await fs.writeFile(path(name), text);
  };
  const exists = (name: string) =>
    fs.access(path(name)).then(
      () => true,
      () => false,
    );
  const adapter = {
    exists,
    mkdir: (name: string) => fs.mkdir(path(name)).then(() => {}),
    read: (name: string) => fs.readFile(path(name), "utf8"),
    readBinary: async (name: string) =>
      Uint8Array.from(await fs.readFile(path(name))).buffer,
    writeBinary: (name: string, bytes: ArrayBuffer) =>
      fs.writeFile(path(name), new Uint8Array(bytes)),
    rename: async (from: string, to: string) => {
      assert.equal(await exists(to), false);
      await fs.rename(path(from), path(to));
    },
    remove: (name: string) => fs.unlink(path(name)),
    rmdir: (name: string, recursive: boolean) => {
      assert.equal(recursive, false);
      return fs.rmdir(path(name));
    },
    list: async (name: string) => {
      const entries = await fs.readdir(path(name), { withFileTypes: true });
      return {
        files: entries
          .filter((e) => e.isFile())
          .map((e) => `${name}/${e.name}`),
        folders: entries
          .filter((e) => e.isDirectory())
          .map((e) => `${name}/${e.name}`),
      };
    },
  };
  const app = { vault: { configDir: ".custom", adapter } } as never;
  const refs = JSON.stringify({
    version: 1,
    items: [{ id: "user/1/A", type: "book", title: "Synthetic reference" }],
  });
  const catalog = JSON.stringify({
    version: 1,
    notes: [
      {
        id: "note",
        path: "Papers/Draft.md",
        title: "Draft",
        ctime: 1,
        preferences: { templateId: "academic" },
      },
    ],
    documents: [
      {
        id: "pdf",
        noteId: "note",
        filename: "Example.pdf",
        format: "pdf",
        createdAt: "2026-01-01T00:00:00Z",
        citationStyle: "apa",
        citationLanguage: "en-US",
      },
    ],
  });
  await put("stratum-references.json", refs);
  await put(".custom/stratum/published/catalog.json", catalog);
  await put(
    ".custom/stratum/published/Example.pdf",
    new Uint8Array([37, 80, 68, 70, 0, 255]),
  );
  await put(
    "Papers/Draft.md",
    "User writing with [[Literature Notes/Example]]",
  );
  await put("Literature Notes/Example.md", "User notes and source metadata");
  return { app, adapter, put, exists, refs, catalog, path };
}

test("migration preserves exact references, PDFs, history and note choices under a custom config directory", async (t) => {
  const f = await fixture(t);
  await f.put(".custom/stratum/keep.txt", "Unrelated existing file");
  await f.put(
    ".custom/stratum/published/catalog.backup.json",
    "Unused stale backup",
  );
  await migratePluginStorage(f.app);
  assert.equal(
    await f.adapter.read(".custom/plugins/stratum/stratum-references.json"),
    f.refs,
  );
  assert.equal(
    await f.adapter.read(".custom/plugins/stratum/published/catalog.json"),
    f.catalog,
  );
  assert.deepEqual(
    new Uint8Array(
      await f.adapter.readBinary(
        ".custom/plugins/stratum/published/Example.pdf",
      ),
    ),
    new Uint8Array([37, 80, 68, 70, 0, 255]),
  );
  assert.equal((await loadReferenceStore(f.app))[0].id, "user/1/A");
  const store = new PublishStore(f.adapter as never, ".custom/plugins/stratum");
  assert.equal(
    (await store.list()).notes[0].preferences?.templateId,
    "academic",
  );
  assert.equal(await f.exists("stratum-references.json"), false);
  assert.equal(await f.exists(".custom/stratum/published"), false);
  assert.equal(
    await f.adapter.read(".custom/stratum/keep.txt"),
    "Unrelated existing file",
  );
  assert.equal(
    await f.adapter.read("Papers/Draft.md"),
    "User writing with [[Literature Notes/Example]]",
  );
  assert.equal(
    await f.adapter.read("Literature Notes/Example.md"),
    "User notes and source metadata",
  );
  await migratePluginStorage(f.app);
  assert.equal((await loadReferenceStore(f.app)).length, 1);
});

test("a conflicting destination blocks all migration before either store is changed", async (t) => {
  const f = await fixture(t);
  await f.put(
    ".custom/plugins/stratum/published/Example.pdf",
    "Different saved PDF",
  );
  await assert.rejects(migratePluginStorage(f.app), /conflicting/);
  assert.equal(await f.adapter.read("stratum-references.json"), f.refs);
  assert.equal(
    await f.exists(".custom/plugins/stratum/stratum-references.json"),
    false,
  );
  assert.equal(
    await f.adapter.read(".custom/plugins/stratum/published/Example.pdf"),
    "Different saved PDF",
  );
});

test("desktop adapter empty-directory removal failures do not block migration or subsequent startup", async (t) => {
  const f = await fixture(t);
  // Match Obsidian's desktop adapter, which uses fs.rm rather than fs.rmdir.
  f.adapter.rmdir = (name, recursive) => {
    assert.equal(recursive, false);
    return fs.rm(f.path(name), { recursive, maxRetries: 5 });
  };
  await migratePluginStorage(f.app);
  assert.equal((await loadReferenceStore(f.app))[0].id, "user/1/A");
  assert.equal(
    (
      await new PublishStore(
        f.adapter as never,
        ".custom/plugins/stratum",
      ).list()
    ).documents[0].id,
    "pdf",
  );
  assert.equal(await f.exists("stratum-references.json"), false);
  const legacy = await f.adapter.list(".custom/stratum/published");
  assert.deepEqual(legacy, { files: [], folders: [] });
  await migratePluginStorage(f.app);
  assert.equal(
    await f.adapter.read("Literature Notes/Example.md"),
    "User notes and source metadata",
  );
});

test("a fresh installation needs no legacy files or migration-created storage", async (t) => {
  const f = await fixture(t);
  await f.adapter.remove("stratum-references.json");
  await f.adapter.remove(".custom/stratum/published/catalog.json");
  await f.adapter.remove(".custom/stratum/published/Example.pdf");
  await f.adapter.rmdir(".custom/stratum/published", false);
  await f.adapter.rmdir(".custom/stratum", false);
  await migratePluginStorage(f.app);
  assert.deepEqual(await loadReferenceStore(f.app), []);
  const catalog = await new PublishStore(
    f.adapter as never,
    ".custom/plugins/stratum",
  ).list();
  assert.deepEqual(catalog.notes, []);
  assert.deepEqual(catalog.documents, []);
  assert.equal(await f.exists("stratum-references.json"), false);
  assert.equal(await f.exists(".custom/plugins/stratum"), false);
  assert.equal(
    await f.adapter.read("Literature Notes/Example.md"),
    "User notes and source metadata",
  );
});

test("an interrupted copy keeps originals and a retry accepts previously verified copies", async (t) => {
  const f = await fixture(t);
  await f.put(
    ".custom/plugins/stratum/stratum-references.json.migration.tmp",
    "Incomplete prior copy",
  );
  const write = f.adapter.writeBinary;
  f.adapter.writeBinary = (name, bytes) =>
    name.includes("Example.pdf")
      ? Promise.reject(new Error("Disk full"))
      : write(name, bytes);
  await assert.rejects(migratePluginStorage(f.app), /Disk full/);
  assert.equal(await f.exists("stratum-references.json"), true);
  assert.equal(await f.exists(".custom/stratum/published/Example.pdf"), true);
  f.adapter.writeBinary = write;
  await migratePluginStorage(f.app);
  assert.equal(await f.exists(".custom/stratum"), false);
  assert.equal((await loadReferenceStore(f.app))[0].id, "user/1/A");
});

test("cleanup interrupted after verification resumes without losing migrated data", async (t) => {
  const f = await fixture(t);
  const remove = f.adapter.remove;
  f.adapter.remove = (path) =>
    path.endsWith("Example.pdf")
      ? Promise.reject(new Error("Cleanup interrupted"))
      : remove(path);
  await assert.rejects(migratePluginStorage(f.app), /Cleanup interrupted/);
  assert.equal((await loadReferenceStore(f.app))[0].id, "user/1/A");
  assert.equal(
    await f.exists(".custom/plugins/stratum/published/Example.pdf"),
    true,
  );
  f.adapter.remove = remove;
  await migratePluginStorage(f.app);
  assert.equal(await f.exists(".custom/stratum"), false);
  assert.equal(
    (
      await new PublishStore(
        f.adapter as never,
        ".custom/plugins/stratum",
      ).list()
    ).documents[0].id,
    "pdf",
  );
});

test("copy corruption and malformed legacy data never retire the original stores", async (t) => {
  const f = await fixture(t);
  const write = f.adapter.writeBinary;
  f.adapter.writeBinary = (name) => write(name, new ArrayBuffer(0));
  await assert.rejects(migratePluginStorage(f.app), /verify/);
  assert.equal(await f.adapter.read("stratum-references.json"), f.refs);
  f.adapter.writeBinary = write;
  await f.put(".custom/stratum/published/catalog.json", "broken");
  await assert.rejects(migratePluginStorage(f.app));
  assert.equal(await f.exists("stratum-references.json"), true);
});

test("retry uses the migrated primary catalog when cleanup left only a stale legacy backup", async (t) => {
  const f = await fixture(t);
  await f.put(".custom/stratum/published/catalog.backup.json", "Stale backup");
  const list = f.adapter.list;
  f.adapter.list = async (path) => {
    const entries = await list(path);
    entries.files.sort(
      (a, b) =>
        Number(b.endsWith("/catalog.json")) -
        Number(a.endsWith("/catalog.json")),
    );
    return entries;
  };
  const remove = f.adapter.remove;
  f.adapter.remove = (path) =>
    path.endsWith("catalog.backup.json")
      ? Promise.reject(new Error("Cleanup interrupted"))
      : remove(path);
  await assert.rejects(migratePluginStorage(f.app), /Cleanup interrupted/);
  assert.equal(await f.exists(".custom/stratum/published/catalog.json"), false);
  f.adapter.remove = remove;
  await migratePluginStorage(f.app);
  assert.equal(await f.exists(".custom/stratum"), false);
  assert.equal(
    (
      await new PublishStore(
        f.adapter as never,
        ".custom/plugins/stratum",
      ).list()
    ).documents[0].id,
    "pdf",
  );
});

test("a source changed during cleanup is retained rather than deleting its newer bytes", async (t) => {
  const f = await fixture(t);
  const remove = f.adapter.remove;
  f.adapter.remove = async (path) => {
    if (path === "stratum-references.json")
      await f.put(
        ".custom/stratum/published/Example.pdf",
        "Updated during cleanup",
      );
    await remove(path);
  };
  await assert.rejects(migratePluginStorage(f.app), /changed during migration/);
  assert.equal(
    await f.adapter.read(".custom/stratum/published/Example.pdf"),
    "Updated during cleanup",
  );
  assert.deepEqual(
    new Uint8Array(
      await f.adapter.readBinary(
        ".custom/plugins/stratum/published/Example.pdf",
      ),
    ),
    new Uint8Array([37, 80, 68, 70, 0, 255]),
  );
});

test("migration uses the actual installation directory and recovers an interrupted catalog replacement", async (t) => {
  const f = await fixture(t);
  await f.adapter.rename(
    ".custom/stratum/published/catalog.json",
    ".custom/stratum/published/catalog.backup.json",
  );
  await migratePluginStorage(f.app, ".custom/plugins/custom-install");
  assert.equal(
    await f.exists(".custom/plugins/custom-install/stratum-references.json"),
    true,
  );
  const store = new PublishStore(
    f.adapter as never,
    ".custom/plugins/custom-install",
  );
  assert.equal((await store.list()).documents[0].id, "pdf");
});
