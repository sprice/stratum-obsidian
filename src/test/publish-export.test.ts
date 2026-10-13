import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";
import {
  localBrowser,
  Stagehand,
  type Page,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";
import { loadRuntime } from "./runtime-harness";
import {
  DEFAULT_ACADEMIC_OPTIONS,
  DEFAULT_PUBLISH_OPTIONS,
} from "../publish-options";

const directory = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const server = createServer();
let browser: StagehandBrowser;
let driver: Stagehand;
let page: Page;
function tool(name: string, argument = "--version") {
  const configured = process.env[`STRATUM_TEST_${name.toUpperCase()}`];
  for (const candidate of [
    configured,
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, [argument], { stdio: "ignore", timeout: 15_000 });
      return candidate;
    } catch {
      /* Try another installed location. */
    }
  }
  return "";
}
const pandoc = tool("pandoc");
const tectonic = tool("tectonic");
const pdftotext = tool("pdftotext", "-v");
const desktop = loadRuntime<typeof import("../publish-desktop")>(
  "publish-desktop.ts",
  { Platform: { isDesktopApp: true, isDesktop: true } },
  {
    TextDecoder,
    TextEncoder,
    Uint8Array,
    window: { require, setTimeout, clearTimeout },
  },
  "browser",
);
before(
  async () => {
    const bundle = await build({
      entryPoints: [join(directory, "src/test/browser/export-fixture.ts")],
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      target: "chrome120",
      alias: { obsidian: join(directory, "src/test/browser/obsidian-host.ts") },
    });
    server.on("request", (request, response) => {
      const script = request.url === "/fixture.js";
      response.writeHead(200, {
        "Content-Type": script ? "text/javascript" : "text/html",
      });
      response.end(
        script
          ? bundle.outputFiles[0].contents
          : '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/fixture.js"></script></body></html>',
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    browser = await localBrowser.launch({
      headless: true,
      ...(process.env.STRATUM_TEST_CHROME
        ? { executablePath: process.env.STRATUM_TEST_CHROME }
        : {}),
    });
    driver = await Stagehand.create({ browser });
    [page] = await browser.context.pages();
    const address = server.address();
    assert(address && typeof address !== "string");
    await page.goto(`http://127.0.0.1:${address.port}/`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await page.evaluate(
          "typeof window.exportFixture?.render === 'function'",
        )
      )
        return;
      await delay(30);
    }
    assert.fail("Synthetic export fixture did not load");
  },
  { timeout: 45_000 },
);
after(async () => {
  try {
    await driver?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
interface ExportResult {
  html: string;
  abstractHtml: string;
  assets: { name: string; bytes: number[] }[];
}
async function render(kind: string, academic: boolean) {
  const result = await page.evaluate<ExportResult & { failure?: string }>(
    `window.exportFixture.render(${JSON.stringify(kind)}, ${academic}).catch(error => ({ failure: error.stack || String(error) }))`,
  );
  assert.equal(result.failure, undefined, result.failure);
  return result;
}
function assertImages(result: ExportResult, expected: number) {
  assert.equal(result.assets.length, expected);
  for (const asset of result.assets) {
    assert.match(asset.name, /^asset-\d+\.png$/);
    const bytes = Buffer.from(asset.bytes);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), 80);
    assert.equal(bytes.readUInt32BE(20), 40);
  }
  assert.doesNotMatch(
    result.html + result.abstractHtml,
    /<svg|callout-icon|callout-fold|\.svg/,
  );
  assert.match(result.html, /Synthetic source callout/);
  assert.match(result.html, /Synthetic callout text preserved\./);
  assert.match(result.html, /Synthetic body preserved\./);
  // Repeated references, including the callout figure, reuse the same image.
  assert.equal(
    (result.html.match(/src="asset-\d+\.png"/g) ?? []).length,
    result.abstractHtml ? 3 : expected + 2,
  );
}
for (const kind of ["draft", "literature"] as const) {
  for (const academic of [false, true]) {
    test(
      `real ${academic ? "Academic" : "General"} PDF retains ${kind} callouts and rasterized SVG figures`,
      { skip: !pandoc || !tectonic || !pdftotext, timeout: 150_000 },
      async () => {
        const result = await render(kind, academic);
        assertImages(result, kind === "draft" ? 2 : 1);
        if (kind === "literature")
          assert.match(result.html, /Synthetic personal writing preserved\./);
        else assert.match(result.html, /Synthetic abstract preserved\./);
        const pdf = await desktop.convertPublication(
          result.html,
          result.assets.map((asset) => ({
            name: asset.name,
            bytes: Uint8Array.from(asset.bytes).buffer,
          })),
          "pdf",
          { pandoc, tectonic },
          undefined,
          120_000,
          {
            ...(academic ? DEFAULT_ACADEMIC_OPTIONS : DEFAULT_PUBLISH_OPTIONS),
            bodyFont: "",
            titleFont: "",
          },
        );
        assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
        const text = execFileSync(pdftotext, ["-", "-"], {
          input: Buffer.from(pdf),
          encoding: "utf8",
          timeout: 15_000,
        });
        assert.match(text, /Synthetic source callout/);
        assert.match(text, /Synthetic callout text preserved\./);
        assert.match(text, /Synthetic body preserved\./);
        assert.match(
          text,
          kind === "literature"
            ? /Synthetic personal writing preserved\./
            : /Synthetic abstract preserved\./,
        );
        // Verify the figures survived conversion as actual PDF image objects.
        assert.match(
          Buffer.from(pdf).toString("latin1"),
          /\/Subtype\s*\/Image/,
        );
      },
    );
  }
}
test("AASTeX body and abstract share browser rasterization with distinct assets", async () => {
  const result = await render("aastex", true);
  assertImages(result, 2);
  assert.match(result.html, /src="asset-0\.png"/);
  assert.match(result.abstractHtml, /src="asset-1\.png"/);
  assert.match(result.abstractHtml, /Synthetic abstract preserved\./);
});
test("unexpected rendered SVG content gets actionable guidance instead of reaching TeX", async () => {
  const message = await page.evaluate<string>(
    "window.exportFixture.unsupportedInlineSvg()",
  );
  assert.match(message, /inline SVG/);
  assert.match(message, /Save the figure as an SVG file in the vault/);
});
