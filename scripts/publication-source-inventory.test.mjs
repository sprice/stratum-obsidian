import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  downloadArchive,
  inventorySource,
  sources,
} from "./publication-source-inventory.mjs";
const bytes = Buffer.from("Synthetic archive");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const source = {
  id: "example",
  url: "https://example.invalid/source.zip",
  required: ["class.cls"],
};
test("inventory records hashes, required files and source paths without retaining payloads", async () => {
  const data = {
    "dist/class.cls": Buffer.from("\\ProvidesClass{class}[2026/01/01 v1.0]"),
    "dist/source.dtx": Buffer.from("Original source"),
  };
  const result = await inventorySource(
    source,
    { "example/class.cls": digest(data["dist/class.cls"]) },
    () => data,
    async () => ({ bytes, finalUrl: source.url }),
  );
  assert.equal(result.status, "runtime-present");
  assert.equal(result.sha256, digest(bytes));
  assert.equal(result.required[0].matchesReference, true);
  assert.deepEqual(result.licenseAndSourcePaths, ["dist/source.dtx"]);
  assert.equal(result.versionDeclarations.length, 1);
  assert.ok(!JSON.stringify(result).includes("Original source"));
});
test("missing classes, hash changes and network failures are explicit report states", async () => {
  const missing = await inventorySource(
    source,
    {},
    () => ({}),
    async () => ({ bytes, finalUrl: source.url }),
  );
  assert.equal(missing.status, "missing-runtime");
  const mismatch = await inventorySource(
    { ...source, sha256: "f".repeat(64) },
    {},
    () => {
      throw new Error("Must not inspect mismatched archive");
    },
    async () => ({ bytes, finalUrl: source.url }),
  );
  assert.match(mismatch.error, /fingerprint differs/);
  const failure = await inventorySource(
    source,
    {},
    () => ({}),
    () => Promise.reject(new Error("HTTP 403")),
  );
  assert.equal(failure.status, "error");
  assert.equal(failure.error, "HTTP 403");
});
test("downloader rejects insecure URLs, downgrades, excessive redirects and oversized archives", async () => {
  await assert.rejects(
    downloadArchive("http://example.invalid", () => {
      throw new Error("Must not fetch");
    }),
    /HTTPS/,
  );
  await assert.rejects(
    downloadArchive(source.url, () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "http://example.invalid" },
        }),
      ),
    ),
    /HTTPS/,
  );
  await assert.rejects(
    downloadArchive(source.url, () =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: "/next" } }),
      ),
    ),
    /redirects/,
  );
  await assert.rejects(
    downloadArchive(source.url, () =>
      Promise.resolve(
        new Response("tiny", { headers: { "content-length": "25000001" } }),
      ),
    ),
    /byte limit/,
  );
  assert.ok(sources.every((entry) => entry.url.startsWith("https://")));
});
