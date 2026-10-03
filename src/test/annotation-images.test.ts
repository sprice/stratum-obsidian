/* eslint-disable @typescript-eslint/require-await -- Async stubs model the host APIs. */
import { buildLiteratureNoteContent } from "../literature-note-content";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as Bbt from "../better-bibtex-images";
import type * as Files from "../annotation-image-file";
import type * as Images from "../plugin-annotation-images";
import {
  annotationImageName,
  validAnnotationImagePath,
  withPreservedAnnotationImages,
} from "../annotation-image-paths";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";
import { loadRuntime } from "./runtime-harness";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as buffer from "node:buffer";
import type { ZoteroItemDetail } from "../backend-types";

function fixture(): ZoteroItemDetail {
  return normalizeZoteroItemDetail({
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
      data: {
        itemType: "document",
        title: "Example study",
        citationKey: "exampleStudy2020",
      },
    },
    childItems: [
      {
        key: "PDFD1234",
        version: 1,
        data: {
          itemType: "attachment",
          parentItem: "ABCD1234",
          contentType: "application/pdf",
        },
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
          annotationComment: "A sample table",
          annotationPageLabel: "12",
        },
      },
    ],
    collections: [],
  });
}
const bbt = loadRuntime<typeof Bbt>("better-bibtex-images.ts", {
  Platform: { isDesktopApp: true, isDesktop: true },
});
const read = loadRuntime<typeof Files>(
  "annotation-image-file.ts",
  { Platform: { isDesktopApp: true, isDesktop: true } },
  {},
  "node",
  { "node:fs/promises": fs, "node:path": path, "node:buffer": buffer },
);
function response(open = "zotero://open-pdf/library/items/PDFD1234") {
  return {
    id: "stratum-images",
    result: [
      {
        open,
        annotations: [
          {
            key: "IMGD1234",
            parentItem: "PDFD1234",
            annotationType: "image",
            annotationImagePath: "/synthetic/cache/library/IMGD1234.png",
          },
        ],
      },
    ],
  };
}

test("BBT retrieves a native citekey and accepts only matching attachment annotations", async () => {
  const paths = await bbt.loadBetterBibtexImagePaths(
    fixture(),
    23119,
    async (url, body) => {
      assert.equal(url, "http://127.0.0.1:23119/better-bibtex/json-rpc");
      assert.deepEqual((JSON.parse(body) as { params: unknown }).params, [
        "exampleStudy2020",
      ]);
      return response();
    },
  );
  assert.equal(paths.size, 1);
  assert.equal(
    (
      await bbt.loadBetterBibtexImagePaths(fixture(), 23119, async () =>
        response("zotero://open-pdf/groups/2/items/PDFD1234"),
      )
    ).size,
    0,
  );
  const wrong = response();
  wrong.result[0].annotations[0].parentItem = "OTHER123";
  assert.equal(
    (await bbt.loadBetterBibtexImagePaths(fixture(), 23119, async () => wrong))
      .size,
    0,
  );
});
test("BBT failures are recoverable and missing citekeys never send fallback guesses", async () => {
  for (const result of [
    null,
    { error: { code: -32601 } },
    { id: "wrong", result: [] },
    { id: "stratum-images", result: {} },
  ]) {
    await assert.rejects(
      bbt.loadBetterBibtexImagePaths(fixture(), 23119, async () => result),
    );
  }
  const detail = fixture();
  detail.item.citationKey = null;
  assert.equal(
    (
      await bbt.loadBetterBibtexImagePaths(detail, 23119, async () => {
        assert.fail("No request expected");
      })
    ).size,
    0,
  );
});
test("stable image paths isolate libraries and reject traversal", () => {
  const detail = fixture();
  const name = annotationImageName(detail, "IMGD1234");
  assert.equal(name, "stratum-user-1-ABCD1234-IMGD1234.png");
  assert.equal(
    validAnnotationImagePath(
      detail,
      "IMGD1234",
      `Literature Notes/Attachments/${name}`,
    ),
    true,
  );
  for (const value of [
    `../Attachments/${name}`,
    `/Attachments/${name}`,
    `Attachments/OTHER.png`,
  ])
    assert.equal(validAnnotationImagePath(detail, "IMGD1234", value), false);
  const stored = {
    stratum_annotation_images: { IMGD1234: `Attachments/${name}` },
  };
  assert.equal(
    withPreservedAnnotationImages(detail, stored).annotations[0].imagePath,
    `Attachments/${name}`,
  );
  detail.annotations[0].imageMissing = true;
  assert.equal(
    withPreservedAnnotationImages(detail, stored).annotations[0].imagePath,
    undefined,
  );
});
test("PNG reads are constrained to the expected cache file and reject symlinks and invalid bytes", async () => {
  const folder = await mkdtemp(join(tmpdir(), "stratum-image-test-"));
  try {
    await mkdir(join(folder, "cache/library"), { recursive: true });
    const file = join(folder, "cache/library/IMGD1234.png");
    const png = Buffer.alloc(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.write("IHDR", 12);
    await writeFile(file, png);
    const params = {
      dataDir: folder,
      sourcePath: file,
      libraryType: "user" as const,
      libraryId: "1",
      key: "IMGD1234",
    };
    assert.equal((await read.readAnnotationPng(params)).byteLength, 24);
    await writeFile(file, Buffer.alloc(24));
    await assert.rejects(read.readAnnotationPng(params), /PNG/);
    const outside = join(folder, "other.png");
    await writeFile(outside, png);
    await assert.rejects(
      read.readAnnotationPng({ ...params, sourcePath: outside }),
      /path/,
    );
    await rm(file);
    await symlink(outside, file);
    await assert.rejects(read.readAnnotationPng(params), /path/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

class FakeFile {
  constructor(public path: string) {}
}
function importer(
  options: {
    unavailable?: boolean;
    owned?: boolean;
    collision?: boolean;
    mobile?: boolean;
  } = {},
) {
  const files = new Map<string, FakeFile>();
  const bytes = new Map<string, ArrayBuffer>();
  const detail = fixture();
  const destination = `Literature Notes/Attachments/${annotationImageName(detail, "IMGD1234")}`;
  if (options.owned || options.collision) {
    files.set(destination, new FakeFile(destination));
    bytes.set(destination, new Uint8Array([9]).buffer);
  }
  const old = options.owned
    ? { stratum_annotation_images: { IMGD1234: destination } }
    : {};
  let requests = 0,
    folders = 0,
    writes = 0;
  const plugin = {
    settings: {
      zoteroLocalApiPort: 23119,
      zoteroDataDir: "/synthetic",
      notesFolder: "Literature Notes",
      enabledLibraries: [{ type: "user", id: "1" }],
    },
    backend: { hasSession: () => true },
    isUnloaded: false,
    bulkLibrarySyncRunPromise: {},
    app: {
      vault: {
        read: async () => `---\n${JSON.stringify(old)}\n---\n`,
        getAbstractFileByPath: (p: string) => files.get(p),
        readBinary: async (file: FakeFile) => bytes.get(file.path),
        createBinary: async (p: string, data: ArrayBuffer) => {
          writes++;
          files.set(p, new FakeFile(p));
          bytes.set(p, data);
        },
        modifyBinary: async (file: FakeFile, data: ArrayBuffer) => {
          writes++;
          bytes.set(file.path, data);
        },
      },
    },
  };
  const runtime = loadRuntime<typeof Images>(
    "plugin-annotation-images.ts",
    {
      Platform: { isDesktopApp: !options.mobile, isDesktop: !options.mobile },
      TFile: FakeFile,
      Notice: class {},
      normalizePath: (value: string) => value,
      parseYaml: JSON.parse,
    },
    {},
    "node",
    {
      "./better-bibtex-images": {
        BetterBibtexItemError: class extends Error {},
        loadBetterBibtexImagePaths: async () => {
          requests++;
          if (options.unavailable) throw new Error("Missing BBT");
          return new Map([["IMGD1234", "/synthetic"]]);
        },
      },
      "./annotation-image-file": {
        readAnnotationPng: async () => new Uint8Array([1, 2, 3]).buffer,
      },
      "./literature-note-files": {
        ensureFolder: async () => {
          folders++;
        },
      },
      "./zotero-local": {
        loadLocalZoteroLibraries: async () => ({ userId: "1" }),
      },
    },
  );
  return {
    detail,
    runtime,
    plugin: plugin as never,
    existing: options.owned ? (new FakeFile("note.md") as never) : null,
    destination,
    get requests() {
      return requests;
    },
    get folders() {
      return folders;
    },
    get writes() {
      return writes;
    },
    removeImage() {
      files.delete(destination);
      bytes.delete(destination);
    },
  };
}
test("image import creates the folder lazily and repeated sync does not rewrite identical images", async () => {
  const f = importer();
  const first = await f.runtime.importAnnotationImages(
    f.plugin,
    f.detail,
    null,
  );
  assert.equal(first.annotations[0].imagePath, f.destination);
  await f.runtime.importAnnotationImages(f.plugin, f.detail, null);
  assert.equal(f.writes, 1);
  assert.equal(f.folders, 1);
});
test("missing BBT preserves old images, caches failure, and aggregates a single summary", async () => {
  const f = importer({ unavailable: true, owned: true });
  for (let i = 0; i < 2; i++) {
    const result = await f.runtime.importAnnotationImages(
      f.plugin,
      f.detail,
      f.existing,
    );
    assert.equal(result.annotations[0].imagePath, f.destination);
    assert.equal(result.annotations[0].comment, "A sample table");
  }
  assert.equal(f.requests, 1);
  assert.equal(f.writes, 0);
  assert.equal(f.folders, 0);
  assert.match(f.runtime.annotationImageSyncSummary(f.plugin), /1 area image/);
  assert.equal(f.runtime.annotationImageSyncSummary(f.plugin), "");
});
test("mobile and unrelated attachment collisions fall back without disk writes", async () => {
  for (const options of [{ mobile: true }, { collision: true }]) {
    const f = importer(options);
    const result = await f.runtime.importAnnotationImages(
      f.plugin,
      f.detail,
      null,
    );
    assert.equal(result.annotations[0].imageMissing, true);
    assert.ok(result.annotations[0].imageUnavailable);
    assert.equal(f.writes, 0);
    assert.equal(f.folders, 0);
  }
});

test("owned images can update and group libraries cannot use personal attachments", async () => {
  const f = importer({ owned: true });
  const result = await f.runtime.importAnnotationImages(
    f.plugin,
    f.detail,
    f.existing,
  );
  assert.equal(result.annotations[0].imagePath, f.destination);
  assert.equal(f.writes, 1);
  const detail = fixture();
  detail.library.type = "group";
  detail.library.id = "2";
  assert.equal(
    (
      await bbt.loadBetterBibtexImagePaths(detail, 23119, async () =>
        response(),
      )
    ).size,
    0,
  );
  assert.equal(
    (
      await bbt.loadBetterBibtexImagePaths(detail, 23119, async () =>
        response("zotero://open-pdf/groups/2/items/PDFD1234"),
      )
    ).size,
    1,
  );
});
test("managed image embeds survive enrichment refresh while My Notes stays untouched", () => {
  const detail = fixture();
  const imagePath = `Literature Notes/Attachments/${annotationImageName(detail, "IMGD1234")}`;
  detail.annotations[0].imagePath = imagePath;
  const params = {
    detail,
    stratumVersion: "1.0.0",
    filenameStem: "Example study",
    parseYaml: JSON.parse,
    stringifyYaml: JSON.stringify,
    htmlToMarkdown: (html: string) => html,
  };
  const original =
    buildLiteratureNoteContent(params) + "\nMy private writing stays here.\n";
  assert.match(
    original,
    /!\[Selected area\]\(<Literature%20Notes\/Attachments\//,
  );
  assert.match(original, /stratum_annotation_images/);
  assert.match(original, /A sample table/);
  const refreshed = buildLiteratureNoteContent({
    ...params,
    detail: fixture(),
    existingContent: original,
  });
  assert.match(refreshed, /!\[Selected area\]/);
  assert.match(refreshed, /My private writing stays here/);
  const missing = fixture();
  missing.annotations[0].imageMissing = true;
  missing.annotations[0].imageUnavailable = "Area image unavailable.";
  const retry = buildLiteratureNoteContent({
    ...params,
    detail: missing,
    existingContent: refreshed,
  });
  assert.doesNotMatch(retry, /!\[Selected area\]/);
  assert.match(retry, /Area image unavailable/);
  assert.match(retry, /My private writing stays here/);
});

test("manual sync resets the missing-plugin cache and deleted vault images are recreated", async () => {
  const missing = importer({ unavailable: true });
  await missing.runtime.importAnnotationImages(
    missing.plugin,
    missing.detail,
    null,
  );
  missing.runtime.beginAnnotationImageSync(missing.plugin);
  await missing.runtime.importAnnotationImages(
    missing.plugin,
    missing.detail,
    null,
  );
  assert.equal(missing.requests, 2);
  const f = importer({ owned: true });
  f.removeImage();
  const result = await f.runtime.importAnnotationImages(
    f.plugin,
    f.detail,
    f.existing,
  );
  assert.equal(result.annotations[0].imagePath, f.destination);
  assert.equal(f.folders, 1);
  assert.equal(f.writes, 1);
});

/* eslint-enable @typescript-eslint/require-await -- End of asynchronous host stubs. */
