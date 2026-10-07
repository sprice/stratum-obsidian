import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import {
  localBrowser,
  Stagehand,
  type Page,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";

const directory = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = join(directory, ".test-artifacts/publishing");
const server = createServer();
let browser: StagehandBrowser;
let driver: Stagehand;
let page: Page;
const timings: Record<string, number> = {};
let executionStart: number | undefined;

async function startBrowserFixture() {
  await mkdir(artifacts, { recursive: true });
  const start = performance.now();
  const bundle = await build({
    entryPoints: [join(directory, "src/test/browser/fixture.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    alias: { obsidian: join(directory, "src/test/browser/obsidian-host.ts") },
  });
  timings.bundleMs = Math.round(performance.now() - start);
  const routes = new Map<string, [string, string | Uint8Array]>([
    [
      "/",
      [
        "text/html",
        '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/plugin.css"></head><body><main id="publish"></main><script type="module" src="/fixture.js"></script></body></html>',
      ],
    ],
    ["/fixture.js", ["text/javascript", bundle.outputFiles[0].contents]],
    [
      "/host.css",
      [
        "text/css",
        await readFile(join(directory, "src/test/browser/host.css")),
      ],
    ],
    [
      "/plugin.css",
      ["text/css", await readFile(join(directory, "styles.css"))],
    ],
  ]);
  server.on("request", (request, response) => {
    const route = routes.get(request.url ?? "");
    response.writeHead(route ? 200 : 404, {
      "Content-Type": route?.[0] ?? "text/plain",
    });
    response.end(route?.[1] ?? "Not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const launchStart = performance.now();
  browser = await localBrowser.launch({
    headless: true,
    viewport: { width: 560, height: 900 },
    ...(process.env.STRATUM_TEST_CHROME
      ? { executablePath: process.env.STRATUM_TEST_CHROME }
      : {}),
  });
  // No model calls or API credentials: only the local driver and explicit selectors.
  driver = await Stagehand.create({ browser });
  [page] = await browser.context.pages();
  timings.browserMs = Math.round(performance.now() - launchStart);
  const address = server.address();
  assert(address && typeof address !== "string");
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await until('document.body.dataset.ready === "true"');
  executionStart = performance.now();
}
before(
  async () => {
    try {
      await startBrowserFixture();
    } catch (error) {
      await mkdir(artifacts, { recursive: true });
      await writeFile(
        join(artifacts, "startup-failure.json"),
        JSON.stringify(
          {
            error: String(error),
            stack: error instanceof Error ? error.stack : undefined,
          },
          null,
          2,
        ),
      );
      if (page) {
        try {
          await capture("startup-failure");
        } catch {
          /* Chrome may have failed before a page exists. */
        }
      }
      throw error;
    }
  },
  { timeout: 45_000 },
);

after(
  async () => {
    try {
      timings.executionMs =
        executionStart === undefined
          ? 0
          : Math.round(performance.now() - executionStart);
      await writeFile(
        join(artifacts, "timings.json"),
        JSON.stringify(timings, null, 2),
      );
      process.stdout.write(
        `Publishing browser timings ${JSON.stringify(timings)}\n`,
      );
    } finally {
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
    }
  },
  { timeout: 15_000 },
);

async function until(expression: string) {
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
    if (await page.evaluate(expression)) return;
    await delay(30);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function capture(name: string) {
  const bytes = await page.screenshot({ fullPage: true });
  assert.equal(Buffer.from(bytes).subarray(1, 4).toString(), "PNG");
  await writeFile(join(artifacts, `${name}.png`), bytes);
}
async function scenario(name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    const diagnostics: Record<string, unknown> = {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    try {
      diagnostics.state = await page.evaluate(
        "window.publicationFixture.state()",
      );
      diagnostics.html = await page.evaluate(
        "document.querySelector('#publish').outerHTML",
      );
    } catch (inspectionError) {
      diagnostics.inspectionError = String(inspectionError);
    }
    await writeFile(
      join(artifacts, `${name}-failure.json`),
      JSON.stringify(diagnostics, null, 2),
    );
    try {
      await capture(`${name}-failure`);
    } catch (captureError) {
      console.error("Failure screenshot capture failed", captureError);
    }
    throw error;
  }
}
async function reset(options: object, width = 560) {
  await page.setViewportSize(width, 900);
  await page.evaluate(
    `window.publicationFixture.reset(${JSON.stringify(options)})`,
  );
  await until(
    "!document.querySelector('.stratum-publish-controls button').disabled",
  );
}
async function expectError(fonts: string[]) {
  await page.locator(".stratum-publish-controls button").click();
  const message = `${fonts.map((font) => `“${font}”`).join(" and ")} ${fonts.length === 1 ? "isn’t" : "aren’t"} available on this computer. Choose another font to publish this PDF.`;
  await until(
    `window.publicationFixture.state().error === ${JSON.stringify(message)}`,
  );
  assert.equal(
    await page.locator(".stratum-publish-error").innerText(),
    message,
  );
}
async function focusFont(label: string) {
  await page.locator(".stratum-publish-status button").click();
  await until(
    `document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(label)}`,
  );
  assert.equal(
    await page.evaluate(
      "document.querySelector('.stratum-publish-customization').open",
    ),
    true,
  );
  assert.equal(
    await page.evaluate(
      `document.querySelector('select[aria-label="${label}"]').closest('details').open`,
    ),
    true,
  );
}
async function choose(label: string, value: string, key: string) {
  await page.locator(`select[aria-label="${label}"]`).selectOption(value);
  await until(
    `!window.publicationFixture.state().saving && window.publicationFixture.state().${key} === ${JSON.stringify(value)}`,
  );
}

for (const configuration of [
  {
    name: "body-dark",
    bodyFont: "Missing Body Serif",
    titleFont: "",
    theme: "dark",
    width: 560,
    label: "Body font",
    key: "bodyFont",
    value: "Georgia",
    fonts: ["Missing Body Serif"],
  },
  {
    name: "title-light",
    bodyFont: "Georgia",
    titleFont: "Missing Title Serif",
    theme: "light",
    width: 560,
    label: "Title font",
    key: "titleFont",
    value: "",
    fonts: ["Missing Title Serif"],
  },
  {
    name: "both-narrow",
    bodyFont: "Missing Body Serif",
    titleFont: "Missing Title Serif",
    theme: "dark",
    width: 360,
    label: "Body font",
    key: "bodyFont",
    value: "Georgia",
    fonts: ["Missing Body Serif", "Missing Title Serif"],
  },
]) {
  test(configuration.name, () =>
    scenario(configuration.name, async () => {
      await reset(configuration, configuration.width);
      await expectError(configuration.fonts);
      await capture(`${configuration.name}-error`);
      await focusFont(configuration.label);
      await capture(`${configuration.name}-focused`);
      await choose(configuration.label, configuration.value, configuration.key);
      assert.equal(
        await page.evaluate("window.publicationFixture.state().error"),
        "",
      );
      if (configuration.fonts.length === 2) {
        await expectError(["Missing Title Serif"]);
        await focusFont("Title font");
        await choose("Title font", "", "titleFont");
      }
      assert.equal(await page.locator(".stratum-publish-error").count(), 0);
      await capture(`${configuration.name}-recovered`);
    }),
  );
}

test("failed save keeps the previous font and displays the save error", () =>
  scenario("failed-save", async () => {
    await reset({});
    await expectError(["Missing Body Serif"]);
    await focusFont("Body font");
    await page.evaluate("window.publicationFixture.failSave(true)");
    await page
      .locator('select[aria-label="Body font"]')
      .selectOption("Georgia");
    await until(
      'window.publicationFixture.state().error === "Synthetic preference save failed"',
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().bodyFont"),
      "Missing Body Serif",
    );
    assert.match(
      await page.locator(".stratum-publish-error").innerText(),
      /Synthetic preference save failed/,
    );
    await capture("failed-save");
  }));
test("saving a font does not dismiss an unrelated error", () =>
  scenario("unrelated-error", async () => {
    await reset({});
    await expectError(["Missing Body Serif"]);
    await focusFont("Body font");
    await page.evaluate("window.publicationFixture.unrelatedError()");
    await choose("Body font", "Georgia", "bodyFont");
    assert.match(
      await page.locator(".stratum-publish-error").innerText(),
      /Synthetic unrelated publishing error/,
    );
  }));

test("PDF-engine font errors use the same recovery and body default", () =>
  scenario("engine-fallback", async () => {
    const font = "Stratum Nonexistent Test Serif 8c671";
    await reset({ bodyFont: font });
    await page.evaluate(
      `window.publicationFixture.injectEngineError(${JSON.stringify(font)})`,
    );
    assert.equal(
      await page.locator(".stratum-publish-error").innerText(),
      `“${font}” isn’t available on this computer. Choose another font to publish this PDF.`,
    );
    await focusFont("Body font");
    await choose("Body font", "", "bodyFont");
    assert.equal(await page.locator(".stratum-publish-error").count(), 0);
  }));
