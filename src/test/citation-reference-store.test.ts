import assert from "node:assert/strict";
import test from "node:test";
import type * as Store from "../citation-reference-store";
import { loadRuntime } from "./runtime-harness";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";

const store = loadRuntime<typeof Store>("citation-reference-store.ts", {});
function detail(key: string, title = "Synthetic reference") {
  return normalizeZoteroItemDetail({
    zoteroUserId: "1",
    library: {
      type: "user",
      id: "1",
      identity: "user:1",
      zoteroUriSegment: "library",
      groupName: null,
    },
    parentItem: {
      key,
      version: 1,
      data: { itemType: "book", title },
      csljson: {
        id: "upstream",
        type: "book",
        title,
        editor: [{ literal: "Example Institute" }],
        issued: { "date-parts": [[2024]] },
      },
    },
    childItems: [],
    collections: [],
  });
}
function fixture(initial?: string) {
  let text = initial;
  let writes = 0;
  const app = {
    vault: {
      configDir: ".custom",
      adapter: {
        exists: (path: string) =>
          Promise.resolve(path.endsWith(".json") ? text !== undefined : true),
        read: () => Promise.resolve(text!),
        mkdir: () => Promise.resolve(),
        process: (_path: string, update: (value: string) => string) => {
          text = update(text!);
          writes++;
          return Promise.resolve(text);
        },
        write: async (path: string, value: string) => {
          assert.equal(path, ".custom/plugins/stratum/stratum-references.json");
          await Promise.resolve();
          text = value;
          writes++;
        },
      },
    },
  };
  return {
    app: app as never,
    adapter: app.vault.adapter,
    get writes() {
      return writes;
    },
    set text(value: string | undefined) {
      text = value;
    },
    get text() {
      return text;
    },
  };
}
test("Zotero CSL is retained independently of generated literature notes", async () => {
  const f = fixture();
  const item = detail("A");
  assert.equal(item.item.csl?.id, "user/1/A");
  assert.deepEqual(item.item.csl?.editor, [{ literal: "Example Institute" }]);
  await store.saveReference(f.app, item, () => true);
  assert.equal(
    (await store.loadReferenceStore(f.app))[0].title,
    "Synthetic reference",
  );
  await store.saveReference(
    f.app,
    { ...item, item: { ...item.item, csl: null } },
    () => true,
  );
  assert.equal((await store.loadReferenceStore(f.app)).length, 1);
});

test("a cache restored while creating its parent folders is merged instead of replaced", async () => {
  const f = fixture();
  const exists = f.adapter.exists;
  let reads = 0;
  f.adapter.exists = (path) => {
    if (path.endsWith(".json") && ++reads === 2)
      f.text = JSON.stringify({ version: 1, items: [detail("B").item.csl] });
    return exists(path);
  };
  await store.saveReference(f.app, detail("A"), () => true);
  assert.deepEqual(
    [...(await store.loadReferenceStore(f.app))].map((item) => item.id).sort(),
    ["user/1/A", "user/1/B"],
  );
});

test("hidden reference writes notify citation listeners only on changes and subscriptions can be removed", async () => {
  const f = fixture();
  let notifications = 0;
  const remove = store.onReferenceStoreChange(f.app, () => notifications++);
  await store.saveReference(f.app, detail("A"), () => true);
  assert.equal(notifications, 1);
  await store.saveReference(f.app, detail("A"), () => true);
  assert.equal(notifications, 1);
  await store.saveReference(f.app, detail("A", "Revised"), () => true);
  assert.equal(notifications, 2);
  remove();
  await store.saveReference(f.app, detail("B"), () => true);
  assert.equal(notifications, 2);
});
test("concurrent source saves preserve both entries and update existing identities", async () => {
  const f = fixture();
  await Promise.all([
    store.saveReference(f.app, detail("A"), () => true),
    store.saveReference(f.app, detail("B"), () => true),
  ]);
  await store.saveReference(f.app, detail("A", "Revised title"), () => true);
  const items = await store.loadReferenceStore(f.app);
  assert.equal(items.length, 2);
  assert.equal(items.find((i) => i.id === "user/1/A")?.title, "Revised title");
});
test("unload and corrupt stores cannot overwrite retained reference data", async () => {
  const f = fixture();
  await store.saveReference(f.app, detail("A"), () => false);
  assert.equal(f.text, undefined);
  const broken = fixture('{"version":99,"items":[]}');
  await assert.rejects(
    store.saveReference(broken.app, detail("A"), () => true),
    /unsupported format/,
  );
  assert.equal(broken.text, '{"version":99,"items":[]}');
  assert.throws(() => store.readReferenceStore("null"), /unsupported format/);
});

test("an existing empty cache is not silently replaced during sync", async () => {
  const f = fixture("");
  await assert.rejects(store.saveReference(f.app, detail("A"), () => true));
  assert.equal(f.text, "");
});

test("catalog batches write once and repeated enrichment saves do not rewrite references", async () => {
  const f = fixture();
  const flush = store.beginReferenceBatch(f.app);
  await Promise.all([
    store.saveReference(f.app, detail("A"), () => true),
    store.saveReference(f.app, detail("B"), () => true),
  ]);
  assert.equal(f.writes, 0);
  await flush();
  assert.equal(f.writes, 1);
  await store.saveReference(f.app, detail("A"), () => true);
  assert.equal(f.writes, 1);
  const current = JSON.parse(f.text!) as {
    version: number;
    items: { id: string }[];
  };
  current.items.push({ ...current.items[0], id: "user/1/C" });
  f.text = JSON.stringify(current);
  await store.saveReference(f.app, detail("B", "Updated"), () => true);
  assert.equal((await store.loadReferenceStore(f.app)).length, 3);
});
