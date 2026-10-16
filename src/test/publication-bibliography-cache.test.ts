import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  cachedPublicationResource,
  type BibliographyCache,
} from "../publication-bibliography-cache";

const bytes = new TextEncoder().encode("Synthetic bibliography style");
const sha256 = createHash("sha256").update(bytes).digest("hex");
function setup() {
  const files = new Map<string, ArrayBuffer>();
  const directories = new Set<string>();
  let downloads = 0;
  let offline = false;
  let writeFails = false;
  let renameFails = false;
  const cache: BibliographyCache = {
    directory: ".synthetic/plugins/stratum/cache/bibliography",
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
      readBinary: (path) => {
        if (!files.has(path)) return Promise.reject(new Error("Missing"));
        return Promise.resolve(files.get(path)!);
      },
      writeBinary: (path, data) => {
        files.set(path, data.slice(0));
        return writeFails
          ? Promise.reject(new Error("Synthetic write failure"))
          : Promise.resolve();
      },
      rename: (from, to) => {
        if (renameFails)
          return Promise.reject(new Error("Synthetic rename failure"));
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
  const download = () => {
    downloads++;
    return offline
      ? Promise.reject(new Error("Synthetic offline"))
      : Promise.resolve(bytes.slice());
  };
  return {
    cache,
    files,
    download,
    downloads: () => downloads,
    offline: () => {
      offline = true;
    },
    writeFails: () => {
      writeFails = true;
    },
    renameFails: () => {
      renameFails = true;
    },
    path: `${cache.directory}/${sha256}.bst`,
  };
}
test("first download is cached and verified on repeat and offline reuse", async () => {
  const s = setup();
  assert.deepEqual(
    await cachedPublicationResource(s.cache, { sha256 }, s.download),
    bytes,
  );
  assert.ok(s.files.has(s.path));
  await cachedPublicationResource(s.cache, { sha256 }, s.download);
  s.offline();
  assert.deepEqual(
    await cachedPublicationResource(s.cache, { sha256 }, s.download),
    bytes,
  );
  assert.equal(s.downloads(), 1);
  assert.deepEqual([...s.files.keys()], [s.path]);
});
test("corrupt or missing cache entries download again; corrupt bytes cannot be reused offline", async () => {
  const s = setup();
  await cachedPublicationResource(s.cache, { sha256 }, s.download);
  s.files.set(s.path, new TextEncoder().encode("Corrupted").buffer);
  await cachedPublicationResource(s.cache, { sha256 }, s.download);
  assert.equal(s.downloads(), 2);
  s.files.delete(s.path);
  await cachedPublicationResource(s.cache, { sha256 }, s.download);
  assert.equal(s.downloads(), 3);
  s.files.set(s.path, new TextEncoder().encode("Corrupted again").buffer);
  s.offline();
  await assert.rejects(
    cachedPublicationResource(s.cache, { sha256 }, s.download),
    /offline/,
  );
  assert.equal(s.files.size, 0);
});
test("changed required fingerprint never falls back to an older cached style", async () => {
  const s = setup();
  await cachedPublicationResource(s.cache, { sha256 }, s.download);
  const newer = new TextEncoder().encode("New synthetic style version");
  const fingerprint = createHash("sha256").update(newer).digest("hex");
  s.offline();
  await assert.rejects(
    cachedPublicationResource(s.cache, { sha256: fingerprint }, s.download),
    /offline/,
  );
  await cachedPublicationResource(s.cache, { sha256: fingerprint }, () =>
    Promise.resolve(newer),
  );
  assert.equal(s.files.size, 2);
  assert.deepEqual(
    await cachedPublicationResource(
      s.cache,
      { sha256: fingerprint },
      s.download,
    ),
    newer,
  );
});
test("hash mismatch, failed download and partial cache writes leave no trusted entry or temporary file", async () => {
  for (const mode of ["mismatch", "offline", "write", "rename"]) {
    const s = setup();
    if (mode === "offline") s.offline();
    if (mode === "write") s.writeFails();
    if (mode === "rename") s.renameFails();
    await assert.rejects(
      cachedPublicationResource(
        s.cache,
        { sha256 },
        mode === "mismatch"
          ? () => Promise.resolve(new Uint8Array([0]))
          : s.download,
      ),
    );
    assert.equal(s.files.size, 0, mode);
  }
});
test("concurrent exports serialize one download and independent cancellation cannot poison reuse", async () => {
  const s = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = cachedPublicationResource(s.cache, { sha256 }, async () => {
    await gate;
    return s.download();
  });
  const aborter = new AbortController();
  const cancelled = cachedPublicationResource(
    s.cache,
    { sha256 },
    s.download,
    aborter.signal,
  );
  const third = cachedPublicationResource(s.cache, { sha256 }, s.download);
  aborter.abort();
  await assert.rejects(cancelled, /cancelled/);
  release();
  assert.deepEqual(await first, bytes);
  assert.deepEqual(await third, bytes);
  assert.equal(s.downloads(), 1);
});
test("cancellation before publication cleans partial files and permits a later retry", async () => {
  const s = setup();
  const aborter = new AbortController();
  const write = s.cache.adapter.writeBinary;
  s.cache.adapter.writeBinary = async (path, data) => {
    await write(path, data);
    aborter.abort();
  };
  await assert.rejects(
    cachedPublicationResource(s.cache, { sha256 }, s.download, aborter.signal),
    /cancelled/,
  );
  // The request may reject immediately; let the queued cleanup finish.
  await cachedPublicationResource(s.cache, { sha256 }, s.download);
  assert.deepEqual([...s.files.keys()], [s.path]);
});
