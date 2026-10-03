import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";

test("overlapping image syncs wait for note ownership before refreshing the same item", async () => {
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
      version: 1,
      data: { itemType: "document", title: "Synthetic source" },
    },
    childItems: [
      {
        key: "PDFD1234",
        version: 1,
        data: { itemType: "attachment", parentItem: "ABCD1234" },
      },
    ],
    annotationItems: [
      {
        key: "IMGD1234",
        version: 1,
        data: {
          itemType: "annotation",
          parentItem: "PDFD1234",
          annotationType: "image",
        },
      },
    ],
    collections: [],
  });
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const file = { path: "Literature Notes/Synthetic source.md" };
  const observed: unknown[] = [];
  let created = false;
  const plugin = {
    manifest: { version: "0.3.1" },
    settings: {
      accountId: "synthetic-account",
      notesFolder: "Literature Notes",
      enabledLibraries: [{ type: "user", id: "1" }],
      collectionCatalogs: {
        "user:1": { updatedAt: Date.now(), collections: [] },
      },
    },
    backend: { hasSession: () => true },
    rememberLiteratureNoteFile: () => {},
    app: {
      vault: {
        getMarkdownFiles: () => [],
        getAbstractFileByPath: (path: string) =>
          created && path === file.path ? file : null,
      },
    },
  };
  const runtime = loadRuntime<typeof import("../plugin-note-sync")>(
    "plugin-note-sync.ts",
    { normalizePath: (path: string) => path },
    {},
    "node",
    {
      "./plugin-annotation-images": {
        importAnnotationImages: async (
          _plugin: unknown,
          syncedDetail: unknown,
          existing: unknown,
        ) => {
          observed.push(existing);
          if (observed.length === 1) {
            started();
            await gate;
          }
          return syncedDetail;
        },
      },
      "./literature-note": {
        createOrUpdateLiteratureNote: (params: { canWrite: () => boolean }) => {
          assert.equal(params.canWrite(), true);
          created = true;
          return Promise.resolve({ file });
        },
      },
      "./citation-reference-store": { saveReference: () => Promise.resolve() },
    },
  );
  const params = {
    detail,
    existingFile: null,
    enrichmentMode: "skip" as const,
  };
  const first = runtime.writeLiteratureNoteFromDetail(plugin as never, params);
  await entered;
  const second = runtime.writeLiteratureNoteFromDetail(plugin as never, {
    ...params,
    // An update that removes the last image also waits for the pending write.
    detail: { ...detail, annotations: [] },
  });
  release();
  await Promise.all([first, second]);
  assert.deepEqual(observed, [null, file]);
});
