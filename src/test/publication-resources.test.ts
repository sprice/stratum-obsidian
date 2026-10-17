import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { zip } from "./publication-resource-fixture";
import {
  resolveRegistryResources,
  verifyRegistryMetadata,
  registryJson,
  registryUrl,
  type RegistryPin,
} from "../publication-registry";
import { extractPublicationClass } from "../publication-source-class";
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
  return { cache, files };
}
function fixture() {
  const { cache, files } = setup();
  const archive = zip([
    { name: "official/class.cls", value: "Synthetic class" },
    { name: "official/LICENSE", value: "Synthetic notice" },
  ]);
  const dependency = new TextEncoder().encode("Synthetic style and notice");
  const base = "/api/templates/v1/example/versions/1.0-r1";
  const pin: RegistryPin = {
    metadata: {
      schemaVersion: 1,
      templateId: "example",
      version: "1.0-r1",
      sha256: hash(archive),
      bytes: archive.length,
      download: `${base}/download`,
      validation: `${base}/validation`,
      requiredFiles: ["official/LICENSE", "official/class.cls"],
      dependencies: [
        {
          id: "style",
          targetPath: "official/style.bst",
          sha256: hash(dependency),
          bytes: dependency.length,
          requiredFiles: ["official/style.bst"],
          download: `${base}/dependencies/style/download`,
        },
      ],
      compilation: "not-tested",
      compilationNotes: "Synthetic fixture",
    },
    validation: { schemaVersion: 1, dimensions: { compilation: "passed" } },
    runtime: {
      "class.cls": {
        path: "official/class.cls",
        sha256: hash(new TextEncoder().encode("Synthetic class")),
      },
      "style.bst": { path: "official/style.bst", sha256: hash(dependency) },
    },
  };
  let count = 0;
  let mode = "success";
  const download = (spec: { url: string; maxBytes: number }) => {
    count++;
    if (mode === "offline") return Promise.reject(new Error("Offline"));
    if (spec.url.endsWith("/validation"))
      return Promise.resolve(registryJson(pin.validation));
    if (spec.url.endsWith("/style/download"))
      return Promise.resolve(
        mode === "damaged-dependency" ? new Uint8Array([0]) : dependency,
      );
    if (spec.url.endsWith("/download"))
      return Promise.resolve(
        mode === "damaged" ? new Uint8Array([0]) : archive,
      );
    return Promise.resolve(
      registryJson({
        ...pin.metadata,
        available: mode !== "unpublished",
        publication: mode === "unpublished" ? "not-synced" : "published",
        compilation: "tested",
      }),
    );
  };
  const run = (allowDownload = true, signal?: AbortSignal) =>
    resolveRegistryResources(
      cache,
      pin,
      download,
      (b, l) => inflateRawSync(b, { maxOutputLength: l }),
      signal,
      allowDownload,
    );
  return {
    cache,
    files,
    pin,
    run,
    get count() {
      return count;
    },
    set mode(value: string) {
      mode = value;
    },
  };
}
test("exact registry release installs once, retains sources and dependencies, and works offline", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(a, b);
  assert.equal(f.count, 4);
  assert.equal(f.files.size, 3);
  f.mode = "offline";
  assert.deepEqual(await f.run(false), a);
  assert.deepEqual(await f.run(), a);
  assert.equal(f.count, 4);
});
test("unpublished or incompatible metadata never activates an installation", async () => {
  const f = fixture();
  f.mode = "unpublished";
  await assert.rejects(f.run(), /not published/);
  assert.equal(f.files.size, 0);
  for (const patch of [
    { version: "2.0-r1" },
    { download: "https://evil.invalid/file" },
    { dependencies: [] },
    { requiredFiles: ["../file"] },
    { schemaVersion: 2 },
    { sha256: "0".repeat(64) },
  ])
    assert.throws(
      () =>
        verifyRegistryMetadata(
          {
            ...f.pin.metadata,
            ...patch,
            available: true,
            publication: "published",
            compilation: "tested",
          },
          f.pin,
        ),
      /incompatible/,
    );
  for (const path of [
    "//evil.invalid/api/templates/v1/file",
    "/api/templates/v1/../file",
    "/api/templates/v1/a?redirect=1",
    "https://evil.invalid/file",
  ])
    assert.throws(() => registryUrl(path), /Invalid/);
});
test("damaged caches fail offline and explicit reinstall repairs only the affected fingerprint", async () => {
  const f = fixture();
  await f.run();
  const archivePath = `${f.cache.directory}/${f.pin.metadata.sha256}.zip`;
  f.files.set(archivePath, new Uint8Array([1]).buffer);
  f.mode = "offline";
  await assert.rejects(f.run(false), /missing or damaged/);
  f.mode = "damaged";
  await assert.rejects(f.run(), /changed/);
  assert.equal(
    [...f.files.keys()].some((p) => p.endsWith(".tmp")),
    false,
  );
  f.mode = "success";
  await f.run();
  assert.equal(f.files.size, 3);
});
test("interrupted installs, dependencies, and missing runtime files fail closed", async () => {
  const f = fixture();
  const aborter = new AbortController();
  aborter.abort();
  await assert.rejects(f.run(true, aborter.signal), /cancelled/);
  assert.equal(f.count, 0);
  f.mode = "damaged-dependency";
  await assert.rejects(f.run(), /changed/);
  f.mode = "success";
  await f.run();
  f.pin.runtime["class.cls"].path = "missing.cls";
  await assert.rejects(f.run(), /missing or damaged/);
});
test("class preparation is bounded data filtering with explicit guards", () => {
  const source = new TextEncoder().encode(
    "%<*class>\n\\ProvidesClass{synthetic}\n%</class>\n",
  );
  assert.match(
    new TextDecoder().decode(
      extractPublicationClass(source, "synthetic.cls", "Notice\n"),
    ),
    /^Notice\n\\ProvidesClass/,
  );
  for (const text of ["%<*unknown>", "%<*class>", "%</class>"])
    assert.throws(
      () =>
        extractPublicationClass(
          new TextEncoder().encode(text),
          "synthetic.cls",
          "",
        ),
      /guard/,
    );
});

test("cache write damage and missing declared dependency files prevent enablement", async () => {
  const f = fixture();
  const write = f.cache.adapter.writeBinary;
  f.cache.adapter.writeBinary = (path, bytes) =>
    write(path, new Uint8Array([0]).buffer);
  await assert.rejects(f.run(), /cache could not be verified/);
  assert.equal(f.files.size, 0);
  f.cache.adapter.writeBinary = write;
  f.pin.metadata.dependencies[0].requiredFiles.push("official/missing-notice");
  await assert.rejects(f.run(), /missing a required/);
});
