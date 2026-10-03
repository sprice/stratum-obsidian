import assert from "node:assert/strict";
import test from "node:test";
import type * as Store from "../citation-reference-store";
import { loadRuntime } from "./runtime-harness";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";

class File {
  constructor(public path: string) {}
}
const store = loadRuntime<typeof Store>("citation-reference-store.ts", {
  TFile: File,
});
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
  const app = {
    vault: {
      getAbstractFileByPath: () =>
        text === undefined ? null : new File(store.REFERENCE_FILE),
      read: () => Promise.resolve(text!),
      create: async (_path: string, value: string) => {
        await Promise.resolve();
        assert.equal(text, undefined);
        text = value;
      },
      process: async (_file: File, update: (value: string) => string) => {
        await Promise.resolve();
        text = update(text!);
      },
    },
  };
  return {
    app: app as never,
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
