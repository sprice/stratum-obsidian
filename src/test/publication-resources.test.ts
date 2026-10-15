import assert from "node:assert/strict";
import test from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { zip } from "./publication-resource-fixture";
import { loadRuntime } from "./runtime-harness";
import type { BibliographyCache } from "../publication-bibliography-cache";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function setup() {
  const files = new Map<string, ArrayBuffer>(),
    directories = new Set<string>();
  const cache: BibliographyCache = {
    directory: "plugin/cache",
    adapter: {
      exists: (path) =>
        Promise.resolve(files.has(path) || directories.has(path)),
      stat: (path) =>
        Promise.resolve(
          files.has(path)
            ? {
                type: "file",
                size: files.get(path)!.byteLength,
                ctime: 0,
                mtime: 0,
              }
            : null,
        ),
      mkdir: (path) => {
        directories.add(path);
        return Promise.resolve();
      },
      readBinary: (path) =>
        files.has(path)
          ? Promise.resolve(files.get(path)!)
          : Promise.reject(new Error("Missing")),
      writeBinary: (path, bytes) => {
        files.set(path, bytes);
        return Promise.resolve();
      },
      rename: (from, to) => {
        files.set(to, files.get(from)!);
        files.delete(from);
        return Promise.resolve();
      },
      remove: (path) => {
        files.delete(path);
        return Promise.resolve();
      },
    },
  };
  const runtime = loadRuntime<typeof import("../publication-resources")>(
    "publication-resources.ts",
    { Platform: { isDesktop: true } },
    { crypto: webcrypto, TextDecoder, Uint8Array },
  );
  const archive = zip([
    { name: "official/class-v1.2.cls", value: "Synthetic class" },
    { name: "official/source.dtx", value: "Required source" },
  ]);
  const style = new TextEncoder().encode("Synthetic bibliography");
  const pack = {
    archive: {
      url: "https://example.invalid/archive.zip",
      sha256: hash(archive),
      extension: "zip" as const,
      maxBytes: 10000,
    },
    entries: {
      "class-v1.2.cls": hash(new TextEncoder().encode("Synthetic class")),
    },
    files: {
      "style-v7.1.bst": {
        url: "https://example.invalid/style-v7.1.bst",
        sha256: hash(style),
      },
    },
  };
  let requests = 0;
  const download = (resource: { url: string }) => {
    requests++;
    return Promise.resolve(resource.url.endsWith("zip") ? archive : style);
  };
  const inflate = (bytes: Uint8Array, maxOutputLength: number) =>
    inflateRawSync(bytes, { maxOutputLength });
  return {
    cache,
    files,
    runtime,
    pack,
    download,
    inflate,
    requests: () => requests,
  };
}
test("shared installer retains full source archive, returns only pinned runtime files, and reuses verified cache offline", async () => {
  const f = setup();
  const result = await f.runtime.resolvePublicationResourcePack(
    f.cache,
    f.pack,
    f.download,
    f.inflate,
  );
  assert.deepEqual(Object.keys(result), ["class-v1.2.cls", "style-v7.1.bst"]);
  assert.equal(f.requests(), 2);
  assert.equal(f.files.size, 2);
  await f.runtime.resolvePublicationResourcePack(
    f.cache,
    f.pack,
    () => Promise.reject(new Error("Offline")),
    f.inflate,
  );
  assert.equal(f.requests(), 2);
});
test("corrupt cached archives and changed file pins cannot be used offline", async () => {
  const f = setup();
  await f.runtime.resolvePublicationResourcePack(
    f.cache,
    f.pack,
    f.download,
    f.inflate,
  );
  f.files.set(
    `${f.cache.directory}/${f.pack.archive.sha256}.zip`,
    new ArrayBuffer(1),
  );
  await assert.rejects(
    f.runtime.resolvePublicationResourcePack(
      f.cache,
      f.pack,
      () => Promise.reject(new Error("Offline")),
      f.inflate,
    ),
    /Offline/,
  );
  await assert.rejects(
    f.runtime.resolvePublicationResourcePack(
      f.cache,
      { ...f.pack, entries: { "class-v1.2.cls": "f".repeat(64) } },
      f.download,
      f.inflate,
    ),
    /fingerprint/,
  );
});

test("versioned resource names still reject path traversal and directory separators", async () => {
  for (const name of [
    "../style-v7.1.bst",
    "dir/style-v7.1.bst",
    "dir\\style-v7.1.bst",
  ]) {
    const f = setup();
    await assert.rejects(
      f.runtime.resolvePublicationResourcePack(
        f.cache,
        { ...f.pack, files: { [name]: f.pack.files["style-v7.1.bst"] } },
        f.download,
        f.inflate,
      ),
      /Invalid template resource name/,
    );
    assert.equal(
      f.requests(),
      1,
      "Only the pinned archive may be fetched before rejecting an invalid resource name",
    );
  }
});
