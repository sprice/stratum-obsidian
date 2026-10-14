import assert from "node:assert/strict";
import test from "node:test";
import { createServer, get } from "node:http";
import { createHash, webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdtemp, rm } from "node:fs/promises";
import { loadRuntime } from "./runtime-harness";
import { aastexPackage, aastexManuscript } from "../publication-package";

const require = createRequire(import.meta.url);
const body = "Synthetic bibliography download\n";
const sha256 = createHash("sha256").update(body).digest("hex");
const url = aastexPackage.manifest.bibliographyDownload.url;

test(
  "direct downloads retain security checks and export cleanup on failure",
  { timeout: 10000 },
  async () => {
    let count = 0;
    let mode = "success";
    const server = createServer((request, response) => {
      count++;
      assert.equal(request.headers["cache-control"], "no-store");
      assert.equal(
        request.headers["user-agent"],
        "Stratum-Obsidian (AASTeX publishing)",
      );
      assert.equal(request.method, "GET");
      if (mode === "stall") return;
      response.writeHead(mode === "unavailable" ? 503 : 200);
      response.end(mode === "mismatch" ? "Changed style" : body);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert(address && typeof address !== "string");
    const paths: string[] = [];
    const fs = require("node:fs/promises") as typeof import("node:fs/promises");
    const desktop = loadRuntime<typeof import("../publish-desktop")>(
      "publish-desktop.ts",
      { Platform: { isDesktopApp: true, isDesktop: true } },
      {
        TextDecoder,
        TextEncoder,
        Uint8Array,
        window: {
          require: (name: string): unknown =>
            name === "node:https"
              ? {
                  get: (
                    target: string,
                    options: Parameters<typeof get>[1],
                    callback: Parameters<typeof get>[2],
                  ) => {
                    assert.equal(target, url);
                    return get(
                      `http://127.0.0.1:${address.port}/style`,
                      options,
                      callback,
                    );
                  },
                }
              : name === "node:fs/promises"
                ? {
                    ...fs,
                    mkdtemp: async (prefix: string) => {
                      const path = await mkdtemp(prefix);
                      paths.push(path);
                      return path;
                    },
                  }
                : require(name),
          setTimeout,
          clearTimeout,
        },
      },
      "browser",
    );
    try {
      for (let index = 0; index < 2; index++)
        assert.equal(
          new TextDecoder().decode(
            await desktop.downloadAastexBibliography({ url, sha256 }),
          ),
          body,
        );
      assert.equal(
        count,
        2,
        "The direct downloader makes independent requests; the cache owns reuse.",
      );
      mode = "mismatch";
      await assert.rejects(
        desktop.downloadAastexBibliography({ url, sha256 }),
        /style changed/,
      );
      mode = "unavailable";
      await assert.rejects(
        desktop.downloadAastexBibliography({ url, sha256 }),
        /could not supply.*HTTP 503/,
      );
      mode = "stall";
      await assert.rejects(
        desktop.downloadAastexBibliography({ url, sha256 }, undefined, 30),
        /timed out/,
      );
      const aborter = new AbortController();
      const cancelled = desktop.downloadAastexBibliography(
        { url, sha256 },
        aborter.signal,
      );
      aborter.abort();
      await assert.rejects(cancelled, /cancelled/);
      mode = "unavailable";
      await assert.rejects(
        desktop.convertPublication(
          "<p>Body</p>",
          [],
          "pdf",
          { pandoc: "unused", tectonic: "unused" },
          undefined,
          1000,
          undefined,
          {
            manuscript: aastexManuscript(
              aastexPackage.files["examples/manuscript.md"],
              "properties",
            ),
            abstractHtml: "<p>Abstract</p>",
            references: [{ id: "stratum0", type: "article-journal" }],
          },
        ),
        /could not supply/,
      );
      assert.equal(paths.length, 1);
      await assert.rejects(access(paths[0]));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const path of paths)
        await rm(path, { recursive: true, force: true });
    }
  },
);

test("converter reuses verified cache offline and keeps it separate from failed-export cleanup", async () => {
  let requests = 0;
  let available = true;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(available ? 200 : 503);
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const files = new Map<string, ArrayBuffer>();
  const directories = new Set<string>();
  const adapter: import("../publication-bibliography-cache").BibliographyCache["adapter"] =
    {
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
      readBinary: (path) => Promise.resolve(files.get(path)!),
      writeBinary: (path, data) => {
        files.set(path, data.slice(0));
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
    };
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  const scratch: string[] = [];
  const desktop = loadRuntime<typeof import("../publish-desktop")>(
    "publish-desktop.ts",
    { Platform: { isDesktopApp: true, isDesktop: true } },
    {
      TextDecoder,
      TextEncoder,
      Uint8Array,
      crypto: webcrypto,
      window: {
        require: (name: string): unknown =>
          name === "node:https"
            ? {
                get: (
                  _target: string,
                  options: Parameters<typeof get>[1],
                  callback: Parameters<typeof get>[2],
                ) =>
                  get(
                    `http://127.0.0.1:${address.port}/style`,
                    options,
                    callback,
                  ),
              }
            : name === "node:fs/promises"
              ? {
                  ...fs,
                  mkdtemp: async (prefix: string) => {
                    const directory = await mkdtemp(prefix);
                    scratch.push(directory);
                    return directory;
                  },
                }
              : require(name),
        setTimeout,
        clearTimeout,
      },
    },
    "browser",
    {
      "./publication-package": {
        aastexPackage: {
          ...aastexPackage,
          manifest: {
            ...aastexPackage.manifest,
            bibliographyDownload: { url, sha256 },
          },
        },
      },
    },
  );
  const tools = {
    pandoc: "stratum-missing-cache-test-tool",
    tectonic: "unused",
    bibliographyCache: {
      adapter,
      directory: ".synthetic/plugins/stratum/cache/bibliography",
    },
  };
  const input = {
    manuscript: aastexManuscript(
      aastexPackage.files["examples/manuscript.md"],
      "properties",
    ),
    abstractHtml: "<p>Abstract</p>",
    references: [{ id: "stratum0", type: "article-journal" }],
  };
  try {
    const convert = () =>
      desktop.convertPublication(
        "<p>Body</p>",
        [],
        "pdf",
        tools,
        undefined,
        1000,
        undefined,
        input,
      );
    await assert.rejects(convert(), /ENOENT|could not start/);
    const path = `${tools.bibliographyCache.directory}/${sha256}.bst`;
    assert.equal(files.has(path), true);
    assert.equal(requests, 1);
    available = false;
    await assert.rejects(convert(), /ENOENT|could not start/);
    assert.equal(
      requests,
      1,
      "A later export reaches conversion offline using the cache",
    );
    assert.equal(files.has(path), true);
    files.set(path, new Uint8Array([0]).buffer);
    await assert.rejects(convert(), /HTTP 503/);
    assert.equal(files.size, 0);
    assert.equal(requests, 2);
    for (const directory of scratch) await assert.rejects(access(directory));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const directory of scratch)
      await rm(directory, { recursive: true, force: true });
  }
});
