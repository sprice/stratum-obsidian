import { buildLiteratureNoteContent } from "../literature-note-content";
import assert from "node:assert/strict";
import test from "node:test";
import {
  setTimeout as scheduleTimeout,
  clearTimeout as cancelTimeout,
} from "node:timers";
import type * as StratumImages from "../stratum-zotero-images";
import type * as Images from "../plugin-annotation-images";
import {
  annotationImageName,
  validAnnotationImagePath,
  withPreservedAnnotationImages,
} from "../annotation-image-paths";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";
import { loadRuntime } from "./runtime-harness";
import * as http from "node:http";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import type { AnnotationHttp } from "../annotation-node-api";
import type { ZoteroItemDetail } from "../backend-types";

// Compile against real Node declarations so the independent contracts cannot drift.
const desktopApis: {
  http: AnnotationHttp;
} = { http };

function httpTransport(chunks: unknown[]) {
  let cleared = false;
  const runtime = loadRuntime<typeof StratumImages>(
    "stratum-zotero-images.ts",
    { Platform: { isDesktop: true } },
    {
      TextDecoder,
      window: {
        setTimeout: () => 1,
        clearTimeout: () => {
          cleared = true;
        },
      },
    },
    "node",
    {
      "node:http": {
        request: (
          _url: string,
          _options: unknown,
          respond: (response: unknown) => void,
        ) => {
          let destroyed = false;
          const request = Object.assign(new EventEmitter(), {
            destroy: (error: Error) => {
              destroyed = true;
              request.emit("error", error);
              request.emit("close");
            },
            setTimeout: () => {},
            end: () => {
              queueMicrotask(() => {
                const response = Object.assign(new EventEmitter(), {
                  statusCode: 200,
                });
                respond(response);
                for (const chunk of chunks) {
                  if (destroyed) break;
                  response.emit("data", chunk);
                }
                if (!destroyed) {
                  response.emit("end");
                  request.emit("close");
                }
              });
            },
          });
          return request;
        },
      },
    },
  );
  return {
    request: () =>
      runtime.requestStratumImage(
        "http://127.0.0.1:23119/stratum/v1/annotation-image",
      ),
    get cleared() {
      return cleared;
    },
  };
}

test("desktop host contracts match Node and decode cross-realm split UTF-8 HTTP chunks", async () => {
  assert.equal(desktopApis.http, http);
  const bytes = new TextEncoder().encode(JSON.stringify({ title: "Étoiles" }));
  const foreign: unknown = runInNewContext("Uint8Array.from(bytes)", { bytes });
  assert.equal(foreign instanceof Uint8Array, false);
  const transport = httpTransport([
    bytes.subarray(0, 11),
    (foreign as Uint8Array).subarray(11),
  ]);
  const result = await transport.request();
  assert.equal((result.json as { title: string }).title, "Étoiles");
  assert.equal(transport.cleared, true);
});

test("HTTP transport rejects non-byte chunks and closes the request", async () => {
  for (const chunk of ["unexpected text", new DataView(new ArrayBuffer(2))]) {
    const transport = httpTransport([chunk]);
    await assert.rejects(
      transport.request(),
      /Unexpected Stratum Zotero response chunk/,
    );
    assert.equal(transport.cleared, true);
  }
});

test("HTTP transport enforces its byte limit before decoding", async () => {
  const transport = httpTransport([new Uint8Array(80 * 1024 * 1024 + 4097)]);
  await assert.rejects(transport.request(), /response is too large/);
  assert.equal(transport.cleared, true);
});

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
const stratum = loadRuntime<typeof StratumImages>(
  "stratum-zotero-images.ts",
  {
    Platform: { isDesktopApp: true, isDesktop: true },
  },
  { URLSearchParams },
);
function imageResponse() {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  return {
    status: 200,
    json: {
      apiVersion: 1,
      library: { type: "user", id: "1" },
      annotationKey: "IMGD1234",
      attachmentKey: "PDFD1234",
      contentType: "image/png",
      bytes: Array.from(bytes),
    },
  };
}

test("Stratum requests images by library and annotation identity without citation keys", async () => {
  const detail = fixture();
  detail.item.citationKey = null;
  const image = await stratum.loadStratumAnnotationImage(
    detail,
    detail.annotations[0],
    23119,
    (url) => {
      const endpoint = new URL(url);
      assert.equal(endpoint.pathname, "/stratum/v1/annotation-image");
      assert.equal(endpoint.searchParams.get("annotationKey"), "IMGD1234");
      assert.equal(endpoint.searchParams.get("libraryId"), "1");
      assert.equal(endpoint.searchParams.get("format"), "bytes");
      return Promise.resolve(imageResponse());
    },
  );
  assert.equal(image.byteLength, 24);
});

test("Stratum rejects mismatched libraries, annotations, attachments, and malformed PNG bytes", async () => {
  const detail = fixture();
  for (const change of [
    { library: { type: "group", id: "1" } },
    { library: { type: "user", id: "2" } },
    { annotationKey: "OTHER123" },
    { attachmentKey: "OTHER123" },
    { bytes: [-1] },
    { bytes: Array(24).fill(0) },
    { bytes: [...imageResponse().json.bytes.slice(0, 23), 1.5] },
    { bytes: undefined },
    { apiVersion: 2 },
  ]) {
    const response = imageResponse();
    Object.assign(response.json, change);
    await assert.rejects(
      stratum.loadStratumAnnotationImage(
        detail,
        detail.annotations[0],
        23119,
        () => Promise.resolve(response),
      ),
    );
  }
});

test("Stratum distinguishes an unavailable annotation from a missing Zotero plugin", async () => {
  const detail = fixture();
  await assert.rejects(
    stratum.loadStratumAnnotationImage(
      detail,
      detail.annotations[0],
      23119,
      () =>
        Promise.resolve({
          status: 409,
          json: { error: { code: "image_unavailable" } },
        }),
    ),
    stratum.StratumAnnotationItemError,
  );
  await assert.rejects(
    stratum.loadStratumAnnotationImage(
      detail,
      detail.annotations[0],
      23119,
      () => Promise.resolve({ status: 404, json: null }),
    ),
    /HTTP 404/,
  );
});

test("image connection diagnostics exclude raw errors and private paths", async () => {
  const detail = fixture();
  for (const code of ["ECONNREFUSED", "UNKNOWN"]) {
    await assert.rejects(
      stratum.loadStratumAnnotationImage(
        detail,
        detail.annotations[0],
        23119,
        () =>
          Promise.reject(
            Object.assign(new Error("Private title at /private/example"), {
              code,
            }),
          ),
      ),
      (error: unknown) => {
        assert.ok(error instanceof stratum.StratumAnnotationError);
        assert.doesNotMatch(error.message, /Private|\/private/);
        assert.match(
          error.message,
          code === "ECONNREFUSED" ? /Connection refused/ : /Could not send/,
        );
        return true;
      },
    );
  }
});

test("image paths validate the clipping key and reject traversal", () => {
  const detail = fixture();
  const name = annotationImageName(detail, "IMGD1234");
  assert.equal(name, "example-study-area-imgd1234.png");
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
class FakeFile {
  stat = { size: 1 };
  constructor(public path: string) {}
}
function importer(
  options: {
    unavailable?: boolean;
    identityMismatch?: boolean;
    unsafeFailure?: boolean;
    owned?: boolean;
    collision?: boolean;
    mobile?: boolean;
    wrongIdentity?: boolean;
    identityHangs?: boolean;
    changeSettings?: boolean;
    oversizedCollision?: boolean;
    changeAccount?: boolean;
    revokeOwnership?: boolean;
  } = {},
) {
  const files = new Map<string, FakeFile>();
  const bytes = new Map<string, ArrayBuffer>();
  const detail = fixture();
  const destination = `Literature Notes/Attachments/${annotationImageName(detail, "IMGD1234")}`;
  if (options.owned || options.collision) {
    const file = new FakeFile(destination);
    if (options.oversizedCollision) file.stat.size = 1024 * 1024 * 1024;
    files.set(destination, file);
    bytes.set(destination, new Uint8Array([9]).buffer);
  }
  const old: Record<string, unknown> = options.owned
    ? {
        zotero_item_identity: options.wrongIdentity
          ? "user/1/OTHER123"
          : "user/1/ABCD1234",
        stratum_annotation_images: { IMGD1234: destination },
      }
    : {};
  let requests = 0,
    folders = 0,
    writes = 0,
    reads = 0;
  const plugin = {
    settings: {
      zoteroLocalApiPort: 23119,
      accountId: "synthetic-account",
      zoteroDataDir: "/synthetic",
      notesFolder: "Literature Notes",
      enabledLibraries: [{ type: "user", id: "1" }],
    },
    backend: { hasSession: () => true },
    isUnloaded: false,
    bulkLibrarySyncRunPromise: {},
    app: {
      vault: {
        read: () => Promise.resolve(`---\n${JSON.stringify(old)}\n---\n`),
        getAbstractFileByPath: (p: string) => files.get(p),
        readBinary: (file: FakeFile) => {
          reads++;
          return Promise.resolve(bytes.get(file.path));
        },
        createBinary: (p: string, data: ArrayBuffer) => {
          writes++;
          const file = new FakeFile(p);
          file.stat.size = data.byteLength;
          files.set(p, file);
          bytes.set(p, data);
          return Promise.resolve();
        },
        modifyBinary: (file: FakeFile, data: ArrayBuffer) => {
          writes++;
          file.stat.size = data.byteLength;
          bytes.set(file.path, data);
          return Promise.resolve();
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
    {
      window: {
        setTimeout: (callback: () => void) => scheduleTimeout(callback, 5),
        clearTimeout: cancelTimeout,
      },
    },
    "node",
    {
      "./stratum-zotero-images": {
        StratumAnnotationItemError: stratum.StratumAnnotationItemError,
        StratumAnnotationError: stratum.StratumAnnotationError,
        loadStratumAnnotationImage: () => {
          requests++;
          if (options.unavailable)
            return Promise.reject(
              new stratum.StratumAnnotationError(
                "Stratum Zotero image endpoint returned HTTP 404.",
              ),
            );
          if (options.unsafeFailure)
            return Promise.reject(
              new Error("Private source title at /private/example"),
            );
          if (options.changeSettings) plugin.settings.notesFolder = "Changed";
          if (options.changeAccount)
            plugin.settings.accountId = "another-account";
          if (options.revokeOwnership)
            old.zotero_item_identity = "user/1/OTHER123";
          return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
        },
      },
      "./literature-note-files": {
        ensureFolder: () => {
          folders++;
          return Promise.resolve();
        },
      },
      "./zotero-local": {
        loadLocalZoteroLibraries: () =>
          options.identityHangs
            ? new Promise(() => {})
            : Promise.resolve({ userId: options.identityMismatch ? "2" : "1" }),
      },
    },
  );
  return {
    detail,
    runtime,
    plugin: plugin as never,
    existing: new FakeFile("note.md") as never,
    rememberImage() {
      old.zotero_item_identity = "user/1/ABCD1234";
      old.stratum_annotation_images = { IMGD1234: destination };
    },
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
    get reads() {
      return reads;
    },
    get originalBytes() {
      return bytes.get(destination);
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
  f.rememberImage();
  await f.runtime.importAnnotationImages(f.plugin, f.detail, f.existing);
  assert.equal(f.writes, 1);
  assert.equal(f.folders, 1);
});

test("a stalled local identity check falls back without blocking text sync", async () => {
  const f = importer({ identityHangs: true });
  const result = await f.runtime.importAnnotationImages(
    f.plugin,
    f.detail,
    null,
  );
  assert.equal(result.annotations[0].imageMissing, true);
  assert.equal(result.annotations[0].comment, "A sample table");
  assert.equal(f.requests, 0);
  assert.equal(f.writes, 0);
});

test("changed settings cancel image writes", async () => {
  for (const options of [{ changeSettings: true }]) {
    const f = importer(options);
    const result = await f.runtime.importAnnotationImages(
      f.plugin,
      f.detail,
      null,
    );
    assert.equal(result.annotations[0].imageMissing, true);
    assert.equal(f.writes, 0);
    assert.equal(f.reads, 0);
  }
});

test("a stale note identity cannot authorize overwriting an image", async () => {
  const f = importer({ owned: true, wrongIdentity: true });
  await assert.rejects(
    f.runtime.importAnnotationImages(f.plugin, f.detail, f.existing),
    /no longer matches/,
  );
  assert.equal(f.requests, 0);
  assert.equal(f.writes, 0);
});

test("an account switch cancels image writes even when the same library remains enabled", async () => {
  const f = importer({ changeAccount: true });
  const result = await f.runtime.importAnnotationImages(
    f.plugin,
    f.detail,
    null,
  );
  assert.equal(result.annotations[0].imageMissing, true);
  assert.equal(f.writes, 0);
});

test("ownership is checked again after fetching the source PNG", async () => {
  const f = importer({ owned: true, revokeOwnership: true });
  await f.runtime.importAnnotationImages(f.plugin, f.detail, f.existing);
  assert.equal(f.writes, 0);
  assert.deepEqual(new Uint8Array(f.originalBytes!), new Uint8Array([9]));
});

test("short title slugs use the clipping key without account identifiers", () => {
  const detail = fixture();
  detail.item.title = "The significance of stellar motion.";
  assert.equal(
    annotationImageName(detail, "IMGD1234"),
    "stellar-motion-area-imgd1234.png",
  );
  detail.item.title = "Étoiles: An introduction to Étude céleste";
  assert.equal(
    annotationImageName(detail, "IMGD1234"),
    "etude-celeste-area-imgd1234.png",
  );
  detail.item.title = "!!!";
  assert.equal(
    annotationImageName(detail, "IMGD1234"),
    "image-area-imgd1234.png",
  );
});

test("unowned collision files stay untouched and receive a safe numbered alternative", async () => {
  const f = importer({ collision: true, oversizedCollision: true });
  const result = await f.runtime.importAnnotationImages(
    f.plugin,
    f.detail,
    null,
  );
  assert.equal(
    result.annotations[0].imagePath,
    f.destination.replace(/\.png$/, "-2.png"),
  );
  assert.equal(f.reads, 0);
  assert.equal(f.writes, 1);
  assert.deepEqual(new Uint8Array(f.originalBytes!), new Uint8Array([9]));
});

test("assigned names survive title changes and recreation of a deleted image", async () => {
  const f = importer({ owned: true });
  f.detail.item.title = "A completely revised heading";
  f.removeImage();
  const result = await f.runtime.importAnnotationImages(
    f.plugin,
    f.detail,
    f.existing,
  );
  assert.equal(result.annotations[0].imagePath, f.destination);
  assert.equal(f.writes, 1);
});
test("missing Stratum preserves old images, caches failure, and aggregates a single summary", async () => {
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
  const summary = f.runtime.annotationImageSyncSummary(f.plugin);
  assert.match(summary, /1 area image/);
  assert.match(
    summary,
    /Details: Stratum Zotero image endpoint returned HTTP 404/,
  );
  assert.equal(f.runtime.annotationImageSyncSummary(f.plugin), "");
});
test("mobile falls back without disk writes", async () => {
  for (const options of [{ mobile: true }]) {
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

test("sync diagnostics distinguish account mismatch and redact unexpected failures", async () => {
  const mismatch = importer({ identityMismatch: true });
  await mismatch.runtime.importAnnotationImages(
    mismatch.plugin,
    mismatch.detail,
    null,
  );
  assert.equal(mismatch.requests, 0);
  assert.match(
    mismatch.runtime.annotationImageSyncSummary(mismatch.plugin),
    /account does not match/,
  );
  const unknown = importer({ unsafeFailure: true });
  await unknown.runtime.importAnnotationImages(
    unknown.plugin,
    unknown.detail,
    null,
  );
  const summary = unknown.runtime.annotationImageSyncSummary(unknown.plugin);
  assert.match(summary, /Could not save/);
  assert.doesNotMatch(summary, /Private|\/private/);
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
  await assert.rejects(
    stratum.loadStratumAnnotationImage(
      detail,
      detail.annotations[0],
      23119,
      () => Promise.resolve(imageResponse()),
    ),
    /identity/,
  );
  const response = imageResponse();
  response.json.library = { type: "group", id: "2" };
  assert.equal(
    (
      await stratum.loadStratumAnnotationImage(
        detail,
        detail.annotations[0],
        23119,
        () => Promise.resolve(response),
      )
    ).byteLength,
    24,
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
  const original = buildLiteratureNoteContent(params).replace(
    "## My Notes\n",
    "## My Notes\n\nMy private writing stays here.\n",
  );
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
