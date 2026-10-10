import assert from "node:assert/strict";
import test from "node:test";
import { createServer, get } from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdtemp, rm } from "node:fs/promises";
import { loadRuntime } from "./runtime-harness";
import { aastexPackage, aastexManuscript } from "../publication-package";

const require = createRequire(import.meta.url);
const body = "Synthetic bibliography download\n";
const sha256 = createHash("sha256").update(body).digest("hex");
const url = aastexPackage.manifest.bibliographyDownload.url;

test(
  "direct export downloads are verified, uncached, cancellable and cleaned up on failure",
  { timeout: 10000 },
  async () => {
    let count = 0;
    let mode = "success";
    const server = createServer((request, response) => {
      count++;
      assert.equal(request.headers["cache-control"], "no-store");
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
      assert.equal(count, 2, "Each export must issue its own direct request.");
      mode = "mismatch";
      await assert.rejects(
        desktop.downloadAastexBibliography({ url, sha256 }),
        /style changed/,
      );
      mode = "unavailable";
      await assert.rejects(
        desktop.downloadAastexBibliography({ url, sha256 }),
        /could not supply/,
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
