import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import type * as Recovery from "../citation-refresh";

function fixture() {
  let finish!: (value: unknown) => void;
  let requests = 0;
  let writes = 0;
  let invalidations = 0;
  const plugin = {
    isUnloaded: false,
    settings: { enabledLibraries: [{ type: "user", id: "1" }] },
    citations: {
      invalidate() {
        invalidations++;
      },
    },
    app: {},
  };
  const recovery = loadRuntime<typeof Recovery>(
    "citation-refresh.ts",
    { Notice: class {}, FuzzySuggestModal: class {} },
    {},
    "node",
    {
      "./plugin-note-sync": {
        loadZoteroItemDetailForNoteSync() {
          requests++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      },
      "./citation-reference-store": {
        saveReference(_app: unknown, _detail: unknown, active: () => boolean) {
          if (active()) writes++;
        },
        loadReferenceStore: () => Promise.resolve([]),
      },
    },
  );
  const detail = {
    library: { type: "user", id: "1" },
    item: {
      key: "A",
      csl: { id: "user/1/A", type: "book", title: "Synthetic source" },
    },
  };
  return {
    plugin,
    detail,
    fetch: () => recovery.fetchCitationData(plugin as never, "user/1/A"),
    finish: (value: unknown) => finish(value),
    counts: () => ({ requests, writes, invalidations }),
  };
}
test("targeted recovery deduplicates requests and updates only reference data", async () => {
  const f = fixture();
  const first = f.fetch();
  assert.equal(first, f.fetch());
  f.finish({ detail: f.detail });
  await first;
  assert.deepEqual(f.counts(), { requests: 1, writes: 1, invalidations: 1 });
});
test("disabled libraries and plugin unload prevent pending recovery writes", async () => {
  for (const unload of [true, false]) {
    const f = fixture();
    const task = f.fetch();
    if (unload) f.plugin.isUnloaded = true;
    else f.plugin.settings.enabledLibraries = [];
    f.finish({ detail: f.detail });
    await assert.rejects(task, /cancelled/);
    assert.equal(f.counts().writes, 0);
  }
  const f = fixture();
  f.plugin.settings.enabledLibraries = [];
  await assert.rejects(f.fetch(), /Enable this source/);
  assert.equal(f.counts().requests, 0);
});
test("failures preserve cached data and distinguish connectivity from unavailable sources", async () => {
  for (const [result, message] of [
    [{ detail: null, localError: new Error("offline") }, /connection/],
    [
      {
        detail: null,
        backendMissing: true,
        backendError: new Error("not found"),
      },
      /unavailable/,
    ],
  ] as const) {
    const f = fixture();
    const task = f.fetch();
    f.finish(result);
    await assert.rejects(task, message);
    assert.equal(f.counts().writes, 0);
  }
});
test("mismatched identities and invalid CSL cannot overwrite reference data", async () => {
  for (const invalid of ["identity", "csl"]) {
    const f = fixture();
    const task = f.fetch();
    const detail =
      invalid === "identity"
        ? { ...f.detail, item: { ...f.detail.item, key: "B" } }
        : { ...f.detail, item: { ...f.detail.item, csl: {} } };
    f.finish({ detail });
    await assert.rejects(
      task,
      invalid === "identity" ? /different source/ : /usable citation data/,
    );
    assert.equal(f.counts().writes, 0);
  }
});
