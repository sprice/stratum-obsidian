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
  const state = await page.evaluate("window.publicationFixture?.state()");
  throw new Error(
    `Timed out: ${expression}; fixture state: ${JSON.stringify(state)}`,
  );
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
      diagnostics.modal = await page.evaluate(
        "document.querySelector('.stratum-publishing-settings-modal')?.outerHTML",
      );
      diagnostics.text = await page.evaluate(
        "window.publicationFixture.text()",
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
  await until("!window.publicationFixture.state().saving");
}
async function expectError(fonts: string[]) {
  if (await page.locator(".stratum-publishing-done").count()) {
    await until("!window.publicationFixture.state().saving");
    await page.locator(".stratum-publishing-done").click();
  }
  await page.locator(".stratum-publish-create").click();
  const message = `${fonts.map((font) => `“${font}”`).join(" and ")} ${fonts.length === 1 ? "isn’t" : "aren’t"} available on this computer. Choose another font to publish this PDF.`;
  await until(
    `window.publicationFixture.state().error === ${JSON.stringify(message)}`,
  );
  assert.equal(
    await page
      .locator(".stratum-publish-status .stratum-publish-error")
      .innerText(),
    message,
  );
}
async function focusFont(label: string) {
  await page
    .locator('button[aria-label="Publishing settings for this note"]')
    .click();
  await until(
    `document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(label)}`,
  );
  assert.equal(
    await page.evaluate(
      "document.querySelector('.stratum-publishing-advanced').open",
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

test("publishing actions match shared Sync styling and retain responsive disabled states", async () => {
  await scenario("shared-publishing-buttons", async () => {
    for (const theme of ["light", "dark"])
      for (const width of [320, 720]) {
        await page.setViewportSize(width, 900);
        await page.evaluate(
          `window.publicationFixture.reset({templateId:'general',theme:'${theme}'})`,
        );
        await page.evaluate(`(() => {
          // Exercise a host with fixed native button height and compact padding.
          const style = document.createElement('style');
          style.textContent = 'button:not(.clickable-icon) { height: var(--input-height); min-height: 0; font-size: var(--font-ui-small); line-height: normal; padding: 2px 12px; }';
          document.querySelector('#publish').append(style);
          window.publicationFixture.buttonReferences();
        })()`);
        const measure = `(() => {
          const create = document.querySelector('.stratum-publish-create');
          const sync = document.querySelector('.synthetic-sync-reference');
          const row = create.parentElement.getBoundingClientRect();
          const rect = create.getBoundingClientRect();
          const style = getComputedStyle(create), reference = getComputedStyle(sync);
          const keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderRadius', 'backgroundColor', 'color', 'opacity', 'cursor'];
          return {
            sameStyles: keys.every(key => style[key] === reference[key]),
            shared: create.classList.contains('stratum-control-button') && create.classList.contains('stratum-control-cta') && create.classList.contains('stratum-control-wrap'),
            height: rect.height, referenceHeight: sync.getBoundingClientRect().height,
            halfWidth: Math.abs(rect.width - (row.width - parseFloat(getComputedStyle(create.parentElement).columnGap)) / 2) <= 1,
            sameActionStyles: (() => { const secondary = getComputedStyle(create.parentElement.querySelector('button')), reference = getComputedStyle(document.querySelector('.synthetic-secondary-reference')); return keys.filter(key => !['backgroundColor','color','opacity','cursor'].includes(key)).every(key => secondary[key] === style[key]) && secondary.backgroundColor === reference.backgroundColor && secondary.color === reference.color; })(),
            sameActionSize: (() => { const settings = create.parentElement.querySelector('button'); const s = settings.getBoundingClientRect(); return Math.abs(s.width - rect.width) <= 1 && Math.abs(s.height - rect.height) <= 1; })(),
            flushRight: Math.abs(rect.right - row.right) <= 1,
            fits: create.scrollWidth <= create.clientWidth && create.scrollHeight <= create.clientHeight,
            overflow: document.documentElement.scrollWidth > innerWidth,
            disabled: create.disabled,
          };
        })()`;
        const ready = await page.evaluate<{
          sameStyles: boolean;
          shared: boolean;
          height: number;
          referenceHeight: number;
          halfWidth: boolean;
          sameActionSize: boolean;
          sameActionStyles: boolean;
          flushRight: boolean;
          fits: boolean;
          overflow: boolean;
          disabled: boolean;
        }>(measure);
        assert.equal(ready.sameStyles, true);
        assert.equal(ready.shared, true);
        assert.ok(ready.height >= ready.referenceHeight);
        if (width === 720) assert.equal(ready.height, ready.referenceHeight);
        assert.equal(
          ready.halfWidth &&
            ready.sameActionSize &&
            ready.sameActionStyles &&
            ready.flushRight &&
            ready.fits,
          true,
        );
        assert.equal(ready.overflow, false);
        assert.equal(ready.disabled, false);
        await page.evaluate(
          `window.publicationFixture.setBusy(true); document.querySelector('.synthetic-sync-reference').disabled = true`,
        );
        const busy = await page.evaluate<typeof ready>(measure);
        assert.equal(busy.disabled, true);
        assert.equal(busy.sameStyles, true);
        assert.equal(busy.height, ready.height);
        assert.equal(
          busy.halfWidth &&
            busy.sameActionSize &&
            busy.sameActionStyles &&
            busy.flushRight &&
            busy.fits,
          true,
        );
        await page.evaluate(
          `window.publicationFixture.setBusy(false); document.querySelector('.synthetic-sync-reference').disabled = false`,
        );
        assert.equal(
          await page.evaluate("!window.publicationFixture.state().saving"),
          true,
        );
        await capture(`shared-publishing-buttons-${theme}-${width}`);
      }
  });
});

test("AASTeX document options stay compact, keyboard accessible and within a narrow panel", async () => {
  await scenario("aastex-options", async () => {
    await page.setViewportSize(320, 900);
    await page.evaluate("window.publicationFixture.reset({aastex:true})");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-panel').textContent.includes('Stratum adapter')",
      ),
      false,
    );
    await page
      .locator('button[aria-label="Publishing settings for this note"]')
      .click();
    await page.evaluate(
      "document.querySelector('.stratum-aastex-option .checkbox-container')?.focus()",
    );
    await until("!!document.querySelector('.stratum-document-options-modal')");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-document-options-modal').textContent.includes('Stratum adapter')",
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        "document.activeElement === document.querySelector('.stratum-aastex-option .checkbox-container')",
      ),
      true,
    );
    await page.evaluate("window.publicationFixture.holdSaves(true)");
    // This driver path sends Space key/code/VK on both native key events.
    await page.type(" ");
    await until("window.publicationFixture.state().saving");
    assert.equal(
      await page.evaluate(`(() => {
        const switches = [...document.querySelectorAll('.stratum-aastex-option .checkbox-container')];
        return document.activeElement === switches[0]
          && !switches[0].classList.contains('is-disabled')
          && switches.slice(1).every(toggle => toggle.classList.contains('is-disabled'));
      })()`),
      true,
    );
    await page.evaluate("window.publicationFixture.holdSaves(false)");
    await until(
      "!window.publicationFixture.state().saving && !window.publicationFixture.state().aastexOptions.showLineNumbers",
    );
    assert.equal(
      await page.evaluate(
        "document.activeElement === document.querySelector('.stratum-aastex-option .checkbox-container')",
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.state().aastexOptions.showDraftDateHeader",
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        "document.querySelectorAll('.stratum-aastex-option').length",
      ),
      3,
    );
    assert.equal(
      await page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    assert.equal(
      await page.evaluate(`Array.from(document.querySelectorAll('.stratum-aastex-option')).every(row => {
        const toggle = row.querySelector('.checkbox-container');
        const label = row.querySelector('span');
        const bounds = toggle.getBoundingClientRect();
        return toggle.tagName === 'LABEL' && !!toggle.querySelector('input[type=checkbox]')
          && toggle.getAttribute('aria-label') === label.textContent
          && bounds.width === 40 && bounds.height === 22
          && Math.abs(bounds.right - row.getBoundingClientRect().right) < 1
          && label.getBoundingClientRect().right <= bounds.left;
      })`),
      true,
    );
    await page.evaluate(
      "document.querySelector('.stratum-publishing-done').focus()",
    );
    await page.keyPress("Tab");
    assert.equal(
      await page.evaluate(
        "document.activeElement?.getAttribute('aria-label') === 'Title'",
      ),
      true,
    );
    await capture("aastex-options-narrow-keyboard");
    await page.keyPress("Escape");
    await until("!document.querySelector('.stratum-document-options-modal')");
    assert.equal(
      await page.evaluate(
        "document.activeElement === document.querySelector('button[aria-label=\"Publishing settings for this note\"]')",
      ),
      true,
    );
  });
});

test("native options save once in both directions and persist across modal reopen", async () => {
  await scenario("aastex-native-toggle-matrix", async () => {
    const keys = ["showLineNumbers", "showDraftDateHeader", "numberedHeadings"];
    for (const [index, key] of keys.entries())
      for (const start of [false, true]) {
        await page.evaluate("window.publicationFixture.reset({aastex:true})");
        await page.evaluate(
          `window.publicationFixture.setAastexOptions({${key}:${start}})`,
        );
        await page.evaluate("window.publicationFixture.resetSaveCount()");
        await page
          .locator('button[aria-label="Publishing settings for this note"]')
          .click();
        const toggle = `.stratum-aastex-option:nth-of-type(${index + 1}) .checkbox-container`;
        await page.evaluate(
          `document.querySelector('${toggle} input').focus()`,
        );
        await page.type(" ");
        await until(
          `!window.publicationFixture.state().saving && window.publicationFixture.state().aastexOptions.${key} === ${!start}`,
        );
        assert.equal(
          await page.evaluate("window.publicationFixture.state().saveCount"),
          1,
        );
        assert.equal(
          await page.evaluate(
            "[...document.querySelectorAll('.stratum-aastex-option .checkbox-container')].every(toggle => !toggle.classList.contains('is-disabled'))",
          ),
          true,
        );
        assert.equal(
          await page.evaluate(
            `document.querySelector('${toggle} input').checked`,
          ),
          !start,
        );
        await page.keyPress("Escape");
        await page
          .locator('button[aria-label="Publishing settings for this note"]')
          .click();
        assert.equal(
          await page.evaluate(
            `document.querySelector('${toggle} input').checked`,
          ),
          !start,
        );
        assert.equal(
          await page.evaluate("window.publicationFixture.state().saveCount"),
          1,
        );
        await page.keyPress("Escape");
      }
  });
});

test("repeated native changes during a held save retain the latest choice and close safely", async () => {
  await scenario("aastex-native-toggle-repeated", async () => {
    await page.evaluate("window.publicationFixture.reset({aastex:true})");
    await page.evaluate("window.publicationFixture.resetSaveCount()");
    await page
      .locator('button[aria-label="Publishing settings for this note"]')
      .click();
    await page.evaluate(
      "document.querySelector('.stratum-aastex-option .checkbox-container')?.focus()",
    );
    await page.evaluate("window.publicationFixture.holdSaves(true)");
    await page.type(" ");
    await page.type(" ");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-aastex-option input').checked",
      ),
      true,
    );
    await page.keyPress("Escape");
    await page.evaluate("window.publicationFixture.holdSaves(false)");
    await until("!window.publicationFixture.state().saving");
    assert.equal(
      await page.evaluate("window.publicationFixture.state().saveCount"),
      2,
    );
    await page
      .locator('button[aria-label="Publishing settings for this note"]')
      .click();
    await page.evaluate(
      "document.querySelector('.stratum-aastex-option .checkbox-container')?.focus()",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-aastex-option input').checked",
      ),
      true,
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().saveCount"),
      2,
    );
    await page.evaluate(
      "window.publicationFixture.resetSaveCount(); window.publicationFixture.holdSaves(true); window.publicationFixture.failNextSave()",
    );
    await page.type(" ");
    await page.type(" ");
    await page.evaluate("window.publicationFixture.holdSaves(false)");
    await until("!window.publicationFixture.state().saving");
    assert.equal(
      await page.evaluate("window.publicationFixture.state().saveCount"),
      2,
    );
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.state().aastexOptions.showLineNumbers",
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-document-options-modal .stratum-publish-error').hidden ? '' : document.querySelector('.stratum-document-options-modal .stratum-publish-error').innerText",
      ),
      "",
    );
    await page.keyPress("Escape");
  });
});

test("AASTeX reset retains auto-save and failed-save recovery", async () => {
  await scenario("aastex-modal-reset", async () => {
    await page.evaluate("window.publicationFixture.reset({aastex:true})");
    const gear = 'button[aria-label="Publishing settings for this note"]';
    await page.locator(gear).click();
    await page.evaluate(
      "document.querySelector('.stratum-aastex-option .checkbox-container').focus()",
    );
    await page.type(" ");
    await until(
      "!window.publicationFixture.state().saving && !window.publicationFixture.state().aastexOptions.showLineNumbers",
    );
    await page.locator(".stratum-publishing-reset").click();
    await until(
      "!window.publicationFixture.state().saving && window.publicationFixture.state().aastexOptions.showLineNumbers",
    );
    await page.evaluate("window.publicationFixture.failSave(true)");
    await page.evaluate("window.publicationFixture.resetSaveCount()");
    await page
      .locator(".stratum-aastex-option:first-of-type .checkbox-container")
      .click();
    await until(
      "document.querySelector('.stratum-document-options-modal .stratum-publish-error').innerText.includes('Synthetic preference save failed')",
    );
    await until("!window.publicationFixture.state().saving");
    assert.equal(
      await page.evaluate("window.publicationFixture.state().saveCount"),
      1,
    );
    assert.equal(
      await page.evaluate(
        "[...document.querySelectorAll('.stratum-aastex-option .checkbox-container')].every(toggle => !toggle.classList.contains('is-disabled'))",
      ),
      true,
    );
    await capture("aastex-modal-save-error");
    await page.evaluate("window.publicationFixture.failSave(false)");
    await page
      .locator(".stratum-aastex-option:first-of-type .checkbox-container")
      .click();
    await until(
      "!window.publicationFixture.state().saving && !window.publicationFixture.state().aastexOptions.showLineNumbers",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().saveCount"),
      2,
    );
    await page.keyPress("Escape");
  });
});

test("switching source notes closes options while queued changes save to the captured note", async () => {
  await scenario("aastex-modal-note-switch", async () => {
    await page.evaluate("window.publicationFixture.reset({aastex:true})");
    await page
      .locator('button[aria-label="Publishing settings for this note"]')
      .click();
    await page.evaluate(
      "document.querySelector('.stratum-aastex-option .checkbox-container')?.focus()",
    );
    await page.evaluate("window.publicationFixture.holdSaves(true)");
    await page.type(" ");
    await until("window.publicationFixture.state().saving");
    await page.evaluate("window.publicationFixture.switchNote()");
    assert.equal(
      await page.locator(".stratum-document-options-modal").count(),
      0,
    );
    await page.evaluate("window.publicationFixture.holdSaves(false)");
    await until("!window.publicationFixture.state().saving");
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.savedOptions('Papers/Synthetic paper.md').showLineNumbers",
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.state().aastexOptions.showLineNumbers",
      ),
      true,
    );
  });
});

test("secondary tabs show PDF history and retain filtering across navigation", async () => {
  await scenario("publishing-documents-tabs", async () => {
    await page.setViewportSize(320, 900);
    await page.evaluate("window.publicationFixture.reset({aastex:true})");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-tabs button:first-child').textContent",
      ),
      "Create",
    );
    await page.evaluate("window.publicationFixture.addDocuments()");
    assert.equal(
      await page.evaluate(
        "!document.querySelector('.stratum-publish-panel .stratum-publish-history') && !document.querySelector('.stratum-publish-panel').hidden && document.querySelector('.stratum-publish-documents').parentElement.hidden",
      ),
      true,
    );
    await page.evaluate(
      "document.querySelector('.stratum-publish-tabs button:first-child').focus()",
    );
    await page.keyPress("ArrowRight");
    assert.equal(
      await page.evaluate(
        "document.activeElement === document.querySelector('.stratum-publish-tabs button:last-child') && document.querySelector('.stratum-publish-panel').hidden && !document.querySelector('.stratum-publish-documents').parentElement.hidden",
      ),
      true,
    );
    assert.equal(await page.locator(".stratum-publish-filename").count(), 1);
    assert.equal(
      await page
        .locator(
          '.stratum-publish-row-actions button[aria-label^="Preview PDF"]',
        )
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator('.stratum-publish-row-actions button[aria-label^="Save as"]')
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator('.stratum-publish-row-actions button[aria-label^="Delete"]')
        .count(),
      1,
    );
    await page
      .locator(
        '.stratum-publish-row-actions button[aria-label^="Delete"][aria-label$=".pdf"]',
      )
      .click();
    assert.equal(
      await page.evaluate(
        "document.querySelector('.modal').textContent.includes('Delete published document?')",
      ),
      true,
    );
    await page
      .locator(".modal .stratum-publish-actions button:first-child")
      .click();
    assert.equal(await page.locator(".stratum-publish-filename").count(), 1);
    await page
      .locator(
        '.stratum-publish-row-actions button[aria-label^="Delete"][aria-label$=".pdf"]',
      )
      .click();
    await page
      .locator(".modal .stratum-publish-actions button:last-child")
      .click();
    await until(
      "document.querySelectorAll('.stratum-publish-filename').length === 0 && !document.querySelector('.modal')",
    );
    await page
      .locator('select[aria-label="Choose which documents to view"]')
      .selectOption("all");
    await page.evaluate(
      "document.querySelector('.stratum-publish-tabs button:last-child').focus()",
    );
    await page.keyPress("Home");
    await page.keyPress("End");
    assert.equal(
      await page.evaluate(
        "document.querySelector('select[aria-label=\"Choose which documents to view\"]').value",
      ),
      "all",
    );
    assert.equal(
      await page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().legacyDocuments"),
      1,
    );
    await page.evaluate("window.publicationFixture.addDocuments(12)");
    await page.evaluate(
      `(() => { const list = document.querySelector('.stratum-publish-list'); list.style.height = '160px'; list.style.flex = 'none'; list.scrollTop = 240; })()`,
    );
    const scroll = await page.evaluate(
      "document.querySelector('.stratum-publish-list').scrollTop",
    );
    assert.ok(Number(scroll) > 0);
    await page.evaluate(
      "document.querySelector('.stratum-publish-tabs button:last-child').focus()",
    );
    await page.keyPress("Home");
    await page.evaluate("window.publicationFixture.addDocuments()");
    await page.keyPress("End");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-list').scrollTop",
      ),
      scroll,
    );
    await capture("publishing-documents-narrow");
  });
});

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
      assert.equal(
        await page.evaluate(
          "[...document.querySelectorAll('.stratum-publish-error')].filter(el => !el.hidden && el.innerText).length",
        ),
        0,
      );
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
      await page
        .locator(".stratum-publish-status .stratum-publish-error")
        .innerText(),
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
      await page
        .locator(".stratum-publish-status .stratum-publish-error")
        .innerText(),
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
      await page
        .locator(".stratum-publish-status .stratum-publish-error")
        .innerText(),
      `“${font}” isn’t available on this computer. Choose another font to publish this PDF.`,
    );
    await focusFont("Body font");
    await choose("Body font", "", "bodyFont");
    assert.equal(
      await page.evaluate(
        "[...document.querySelectorAll('.stratum-publish-error')].filter(el => !el.hidden && el.innerText).length",
      ),
      0,
    );
  }));

test("publishing tool paths stack without display contents and reduced motion disables transitions", () =>
  scenario("scorecard-css", async () => {
    for (const width of [560, 240]) {
      await page.setViewportSize(width, 900);
      const layout = await page.evaluate(`(() => {
        const modal = document.createElement('div');
        modal.className = 'stratum-modal';
        modal.style.padding = '16px';
        modal.innerHTML = '<div class="stratum-publish-setup"><details open><summary>Advanced</summary><div class="setting-item"><div class="setting-item-info"><div class="setting-item-name">Pandoc</div></div><div class="setting-item-control"><input class="stratum-control-input" aria-label="Synthetic path"><button class="stratum-control-button">Browse</button></div><div class="setting-item-description">Found automatically<span class="stratum-publish-path">/synthetic/pandoc</span></div></div></details></div>';
        document.body.append(modal);
        const info = modal.querySelector('.setting-item-info');
        const control = modal.querySelector('.setting-item-control');
        const description = modal.querySelector('.setting-item-description');
        const a = info.getBoundingClientRect();
        const b = control.getBoundingClientRect();
        const c = description.getBoundingClientRect();
        const input = modal.querySelector('input');
        input.focus();
        const focused = document.activeElement === input;
        const result = { ordered: a.bottom <= b.top && b.bottom <= c.top,
          fits: b.right <= modal.getBoundingClientRect().right - 16,
          fullWidth: Math.abs(b.width - a.width) < 1, focused,
          display: getComputedStyle(info).display };
        modal.remove();
        return result;
      })()`);
      assert.deepEqual(
        layout,
        {
          ordered: true,
          fits: true,
          fullWidth: true,
          focused: true,
          display: "block",
        },
        `Tool path layout at ${width}px`,
      );
    }
    const motion = await page.evaluate<{
      matched: number;
      duration: string;
      focusedDuration: string;
      hoverDuration: string;
    }>(`(() => {
      const control = document.createElement('button');
      control.className = 'stratum-control-button';
      control.textContent = 'Synthetic motion check';
      document.body.append(control);
      // Activate the real reduced-motion declarations independent of host preferences.
      const changed = [];
      const selectors = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (!(rule instanceof CSSMediaRule)) continue;
          if (rule.conditionText === '(hover: hover)') {
            changed.push([rule, rule.media.mediaText]);
            rule.media.mediaText = 'all';
            for (const nested of rule.cssRules) {
              if (nested instanceof CSSStyleRule && nested.selectorText.includes(':hover')) {
                selectors.push([nested, nested.selectorText]);
                // A class has the same specificity as :hover; force that state deterministically.
                nested.selectorText = nested.selectorText.replaceAll(':hover', '.synthetic-hover');
              }
            }
          }
          if (rule.conditionText === '(prefers-reduced-motion: reduce)') {
            changed.push([rule, rule.media.mediaText]);
            rule.media.mediaText = 'all';
          }
        }
      }
      const duration = getComputedStyle(control).transitionDuration;
      control.classList.add('synthetic-hover');
      const hoverDuration = getComputedStyle(control).transitionDuration;
      control.focus();
      const focusedDuration = getComputedStyle(control).transitionDuration;
      for (const [rule, original] of selectors) rule.selectorText = original;
      for (const [rule, original] of changed) rule.media.mediaText = original;
      control.remove();
      return { matched: changed.length, duration, hoverDuration, focusedDuration };
    })()`);
    assert.ok(motion.matched > 0);
    assert.equal(motion.duration, "0s");
    assert.equal(motion.focusedDuration, "0s");
    assert.equal(motion.hoverDuration, "0s");
  }));

async function openSettings() {
  await page
    .locator('button[aria-label="Publishing settings for this note"]')
    .click();
  await until("!!document.querySelector('.stratum-publishing-settings-modal')");
}
async function editProperty(label: string, value: string, commit = true) {
  await page.evaluate(`(() => {
    const input = document.querySelector('.stratum-publishing-settings-modal [aria-label="${label}"]');
    input.focus(); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true}));
    ${commit ? "input.blur();" : ""}
  })()`);
}
const manuscript =
  "---\ntags: [private, retained] # Keep this comment\ncustom:\n  untouched: true\n---\n\n## Introduction\nSynthetic manuscript body.\n";

test("General and Academic settings edit only publishing fields, enforce dynamic title requirements and reset formatting only", async () => {
  await scenario("common-details-matrix", async () => {
    for (const templateId of ["general", "academic"] as const) {
      await reset({ templateId, source: manuscript });
      await openSettings();
      assert.deepEqual(
        await page.evaluate(
          "[...document.querySelectorAll('.stratum-publishing-settings-modal h4')].map(el => el.textContent)",
        ),
        ["Document details", "PDF options"],
      );
      assert.equal(
        await page.evaluate(
          "!!document.querySelector('select[aria-label=\"Choose template\"]') && !document.querySelector('.stratum-publishing-settings-modal select[aria-label=\"Choose template\"]')",
        ),
        true,
      );
      if (templateId === "general")
        await page
          .locator('select[aria-label="Title source"]')
          .selectOption("properties");
      await until(
        "!!document.querySelector('.stratum-publishing-settings-modal input[aria-label=\"Title\"]')",
      );
      assert.equal(
        await page.evaluate("window.publicationFixture.state().canCreate"),
        false,
      );
      await editProperty("Title", "Edited manuscript title");
      await until("window.publicationFixture.state().canCreate");
      for (const [key, label, value] of [
        ["authors", "Authors", "Alex\nMorgan"],
        ["date", "Date", "2026-10-12"],
        ["keywords", "Keywords", "one\ntwo"],
      ]) {
        await page
          .locator('select[aria-label="Add publishing property"]')
          .selectOption(key);
        await until(
          `!!document.querySelector('.stratum-publishing-settings-modal [aria-label="${label}"]')`,
        );
        await editProperty(label, value);
      }
      await until("!window.publicationFixture.state().saving");
      await page.locator('[data-property-control="remove:keywords"]').click();
      await until("!window.publicationFixture.text().includes('keywords:')");
      const before = await page.evaluate("window.publicationFixture.text()");
      assert.match(
        String(before),
        /tags: \[private, retained\] # Keep this comment\ncustom:\n {2}untouched: true/,
      );
      assert.match(String(before), /Alex/);
      await page.locator(".stratum-publishing-reset").click();
      await until("!window.publicationFixture.state().saving");
      assert.equal(
        await page.evaluate("window.publicationFixture.text()"),
        before,
      );
      assert.equal(
        await page.evaluate(
          "document.querySelector('select[aria-label=\"Title source\"]').value",
        ),
        templateId === "general" ? "body" : "properties",
      );
      assert.equal(
        await page.evaluate(
          "document.querySelector('.stratum-publishing-advanced').open",
        ),
        false,
      );
      await page.locator(".stratum-publishing-done").click();
      await until("!document.querySelector('.modal')");
      assert.equal(
        await page.evaluate(
          "document.activeElement?.textContent === 'Settings'",
        ),
        true,
      );
    }
  });
});

test("AASTeX modal shares author edits, preserves legacy associations and keeps body title and abstract rules", async () => {
  await scenario("aastex-details-and-title", async () => {
    await page.evaluate(
      `window.publicationFixture.reset({aastex:true,source:${JSON.stringify("---\ntitle: Property title\nauthors: [Legacy Writer]\naffiliations: [Legacy global affiliation]\ntags: [preserved] # Keep\n---\n\n# Leading title\n\n## Introduction\nBody.\n")}})`,
    );
    await openSettings();
    assert.equal(await page.locator(".stratum-publishing-advanced").count(), 0);
    assert.equal(
      await page
        .locator('select[aria-label="Citation style for this note"]')
        .count(),
      0,
    );
    await page
      .locator(
        '.stratum-publishing-settings-modal button[aria-label="Use existing authors"]',
      )
      .click();
    await editProperty("Author 1 email", "legacy@example.org");
    await page
      .locator(
        '.stratum-publishing-settings-modal button[aria-label="Add affiliation to author 1"]',
      )
      .click();
    await editProperty("Author 1 affiliation 1", "Explicit affiliation");
    await until("window.publicationFixture.state().canCreate");
    assert.equal(
      await page.evaluate(
        "document.querySelector('button[aria-label=\"Move author 1 up\"]').disabled && document.querySelector('button[aria-label=\"Move author 1 down\"]').disabled",
      ),
      true,
    );
    await page.evaluate("window.publicationFixture.setBusy(true)");
    await page.evaluate("window.publicationFixture.setBusy(false)");
    assert.equal(
      await page.evaluate(
        "document.querySelector('button[aria-label=\"Move author 1 up\"]').disabled && document.querySelector('button[aria-label=\"Move author 1 down\"]').disabled",
      ),
      true,
    );
    const original = String(
      await page.evaluate("window.publicationFixture.text()"),
    );
    assert.match(
      original,
      /authors: \[Legacy Writer\]\naffiliations: \[Legacy global affiliation\]/,
    );
    assert.match(original, /Explicit affiliation/);
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publishing-settings-modal').textContent.includes('No Abstract section was found')",
      ),
      true,
    );
    await page
      .locator('select[aria-label="Title source"]')
      .selectOption("body");
    await until("!window.publicationFixture.state().saving");
    await page.evaluate(
      "window.publicationFixture.replaceText(window.publicationFixture.text().replace('# Leading title\\n', ''))",
    );
    await until("!window.publicationFixture.state().canCreate");
    await until(
      "document.querySelector('.stratum-publishing-settings-modal').textContent.includes('Add a manuscript title using the selected title source')",
    );
    await page
      .locator('select[aria-label="Title source"]')
      .selectOption("properties");
    await until("window.publicationFixture.state().canCreate");
    await page.locator('[data-property-control="remove:title"]').click();
    await until("!window.publicationFixture.state().canCreate");
    await editProperty("Title", "Restored property title");
    await until("window.publicationFixture.state().canCreate");
    await capture("aastex-common-settings");
  });
});

test("metadata conflicts retain drafts and require explicit recovery before Done or export", async () => {
  await scenario("metadata-conflict", async () => {
    await reset({
      templateId: "academic",
      source: manuscript.replace("tags:", "title: Original\ntags:"),
    });
    await openSettings();
    await editProperty("Title", "Retained draft", false);
    await page.evaluate(
      "window.publicationFixture.replaceText(window.publicationFixture.text().replace('title: Original', 'title: Newer value'))",
    );
    await page.evaluate(
      "document.querySelector('.stratum-publishing-settings-modal input[aria-label=\"Title\"]').blur()",
    );
    await until(
      "document.querySelector('.stratum-publishing-settings-modal').textContent.includes('This property changed elsewhere')",
    );
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.text().includes('title: Newer value')",
      ),
      true,
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().canCreate"),
      false,
    );
    await page.locator(".stratum-publishing-done").click();
    assert.equal(
      await page.locator(".stratum-publishing-settings-modal").count(),
      1,
    );
    await page.evaluate(
      "window.publicationFixture.replaceText(window.publicationFixture.text().replace('Newer value', 'Newest value'))",
    );
    await until(
      "document.querySelector('.stratum-publishing-settings-modal').textContent.includes('Current value: Newest value')",
    );
    await page
      .locator(
        '.stratum-publishing-settings-modal button[aria-label="Apply draft to current property"]',
      )
      .click();
    await until(
      "window.publicationFixture.text().includes('title: Retained draft') && !window.publicationFixture.state().pending",
    );
    await page.locator(".stratum-publishing-done").click();
    await until("!document.querySelector('.modal')");
  });
});

test("note and template changes close Settings without dropping captured metadata or mutating it during format reset", async () => {
  await scenario("metadata-note-template-switch", async () => {
    await reset({
      templateId: "academic",
      source: manuscript.replace("tags:", "title: Original\ntags:"),
    });
    await openSettings();
    await editProperty("Title", "Captured original note", false);
    await page.evaluate("window.publicationFixture.switchNote()");
    await until("!document.querySelector('.modal')");
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.text().includes('Captured original note')",
      ),
      true,
    );
    await reset({
      templateId: "academic",
      source: manuscript.replace("tags:", "title: Original\ntags:"),
    });
    await openSettings();
    const before = await page.evaluate("window.publicationFixture.text()");
    await page.evaluate("window.publicationFixture.selectTemplate('general')");
    await until("!document.querySelector('.modal')");
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      before,
    );
  });
});

test("metadata requires an explicitly registered editable note while options remain available", async () => {
  await scenario("metadata-open-note", async () => {
    await reset({
      templateId: "academic",
      editable: false,
      source: manuscript,
    });
    await openSettings();
    assert.equal(
      await page
        .locator('.stratum-publishing-settings-modal input[aria-label="Title"]')
        .count(),
      0,
    );
    assert.equal(
      await page.locator('select[aria-label="Title source"]').count(),
      1,
    );
    await page
      .locator(
        '.stratum-publishing-settings-modal button[aria-label="Open note for editing"]',
      )
      .click();
    await until(
      "!document.querySelector('.modal') && window.publicationFixture.state().editable",
    );
    await openSettings();
    assert.equal(
      await page
        .locator('.stratum-publishing-settings-modal input[aria-label="Title"]')
        .count(),
      1,
    );
  });
});

test("citation override and reset use the note's current style and preserve independent language", async () => {
  await scenario("citation-style-in-modal", async () => {
    await reset({
      source: manuscript.replace(
        "tags:",
        "stratum_citation_language: fr-FR\ntags:",
      ),
    });
    await openSettings();
    await until(
      "!!document.querySelector('select[aria-label=\"Citation style for this note\"]')",
    );
    await page
      .locator('select[aria-label="Citation style for this note"]')
      .selectOption("ieee");
    await until(
      "window.publicationFixture.text().includes('stratum_citation_style: ieee')",
    );
    await page
      .locator('select[aria-label="Citation style for this note"]')
      .selectOption("");
    await until(
      "!window.publicationFixture.text().includes('stratum_citation_style')",
    );
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.text().includes('stratum_citation_language: fr-FR')",
      ),
      true,
    );
  });
});

test("failed note options survive Escape and reopen for explicit retry", async () => {
  await scenario("interrupted-option-retry", async () => {
    await reset({ aastex: true });
    await openSettings();
    await page.evaluate("window.publicationFixture.failSave(true)");
    await page
      .locator(".stratum-aastex-option:first-of-type .checkbox-container")
      .click();
    await until(
      "!window.publicationFixture.state().saving && !document.querySelector('.stratum-publish-error').hidden",
    );
    await page.keyPress("Escape");
    await page.evaluate("window.publicationFixture.failSave(false)");
    await openSettings();
    await until(
      "!document.querySelector('.stratum-document-options-modal .stratum-publish-error').hidden",
    );
    await page.evaluate(
      "[...document.querySelectorAll('.modal button')].find(button => button.textContent === 'Retry saving options').click()",
    );
    await until(
      "!window.publicationFixture.state().saving && !window.publicationFixture.state().aastexOptions.showLineNumbers",
    );
    await page.locator(".stratum-publishing-done").click();
    await until("!document.querySelector('.modal')");
  });
});

test("closing during an option save retains a late failure in the reopened captured note", async () => {
  await scenario("late-option-failure", async () => {
    await reset({ aastex: true });
    await openSettings();
    await page.evaluate(
      "window.publicationFixture.holdSaves(true); window.publicationFixture.failNextSave()",
    );
    await page
      .locator(".stratum-aastex-option:first-of-type .checkbox-container")
      .click();
    await until("window.publicationFixture.state().saving");
    await page.keyPress("Escape");
    await page.evaluate("window.publicationFixture.holdSaves(false)");
    await until("!window.publicationFixture.state().saving");
    await openSettings();
    await until(
      "!document.querySelector('.stratum-document-options-modal .stratum-publish-error').hidden",
    );
    await page.evaluate(
      "[...document.querySelectorAll('.modal button')].find(button => button.textContent === 'Retry saving options').click()",
    );
    await until(
      "!window.publicationFixture.state().saving && !window.publicationFixture.state().aastexOptions.showLineNumbers",
    );
  });
});

test("shared author conflict recovery refreshes current values after a second external edit", async () => {
  await scenario("author-conflict-current-value", async () => {
    await reset({
      aastex: true,
      source:
        "---\ntitle: Paper\nstratum_publish:\n  authors:\n    - name: Original name\n      email: author@example.org\n      affiliations: [Institute]\n---\nBody",
    });
    await openSettings();
    await editProperty("Author 1 name", "Retained draft", false);
    await page.evaluate(
      "window.publicationFixture.replaceText(window.publicationFixture.text().replace('Original name','Newer author')); document.querySelector('input[aria-label=\"Author 1 name\"]').blur()",
    );
    await until("!!document.querySelector('.stratum-publication-conflict')");
    await page.evaluate(
      "window.publicationFixture.replaceText(window.publicationFixture.text().replace('Newer author','Later author'))",
    );
    await until(
      "document.querySelector('.stratum-publication-conflict').textContent.includes('Current author 1: Later author')",
    );
    await page.locator('button[aria-label="Apply draft to author 1"]').click();
    await until(
      "window.publicationFixture.text().includes('name: Retained draft') && !window.publicationFixture.state().pending",
    );
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.text().endsWith('---\\nBody')",
      ),
      true,
    );
  });
});

test("template and installed version selectors keep equal available columns and preserve package approval", async () => {
  await scenario("template-version-columns", async () => {
    for (const width of [320, 560]) {
      await page.setViewportSize(width, 900);
      for (const templateId of ["general", "academic", "aastex"]) {
        await reset(
          templateId === "aastex" ? { aastex: true } : { templateId },
        );
        const measure = await page.evaluate(
          `(() => { const row=document.querySelector('.stratum-publish-template-selectors');const fields=[...row.children],r=row.getBoundingClientRect(),gap=parseFloat(getComputedStyle(row).columnGap),t=fields[0].getBoundingClientRect(); const version=document.querySelector('select[aria-label="Choose template version"]');return {width:t.width,expected:(r.width-gap)/2,versionVisible:!fields[1].hidden,label:document.querySelector('select[aria-label="Choose template"]').selectedOptions[0].textContent,versions:[...version.options].map(o=>o.textContent),overflow:document.documentElement.scrollWidth>innerWidth};})()`,
        );
        const m = measure as {
          width: number;
          expected: number;
          versionVisible: boolean;
          label: string;
          versions: string[];
          overflow: boolean;
        };
        assert.ok(Math.abs(m.width - m.expected) <= 1);
        assert.equal(m.overflow, false);
        assert.equal(m.versionVisible, templateId === "aastex");
        if (templateId === "aastex") {
          assert.equal(m.label, "AASTeX");
          assert.deepEqual(m.versions, ["7.0.2"]);
        }
        if (width === 320 && templateId === "general")
          await capture("publishing-generic-columns");
        if (width === 560 && templateId === "aastex")
          await capture("publishing-version-columns");
      }
    }
    await page.evaluate(
      "window.publicationFixture.setAastexPackage({id: 'aastex', version: '0.1.0', upstreamVersion: '7.0.1'})",
    );
    await page
      .locator('select[aria-label="Choose template version"]')
      .selectOption("package:aastex");
    await openSettings();
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-document-options-modal').textContent.includes('Older package assets are not retained')",
      ),
      true,
    );
    await page.keyPress("Escape");
    await page.locator('select[aria-label="Choose template"]').selectOption("");
    await until(
      "!window.publicationFixture.state().saving && document.querySelector('button[aria-label=\"Publishing settings for this note\"]').disabled",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('select[aria-label=\"Choose template\"]').value",
      ),
      "",
    );
  });
});

test("mobile Create exposes the same Settings writer without a note widget or desktop actions", async () => {
  await scenario("mobile-publishing-settings", async () => {
    await reset({
      mobile: true,
      aastex: true,
      source:
        "---\ntitle: Paper\nstratum_publish:\n  authors:\n    - name: Original\n      email: author@example.org\n      affiliations: [Institute]\n---\nBody",
    });
    assert.equal(
      await page.evaluate("window.publicationFixture.state().canPublishPdf"),
      false,
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-create').disabled",
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        "[...document.querySelectorAll('.stratum-publish-tabs button')].some(b=>b.textContent === 'Documents')",
      ),
      false,
    );
    await openSettings();
    await editProperty("Author 1 name", "Mobile author");
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.text().includes('name: Mobile author')",
      ),
      true,
    );
    assert.equal(
      await page.locator(".cm-editor .stratum-publication-details").count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-document-options-modal').textContent.includes('Create PDF documents in desktop Obsidian')",
      ),
      true,
    );
    await capture("mobile-platform-publishing-settings");
    await page.locator(".stratum-publishing-done").click();
    await reset({
      mobile: true,
      templateId: "academic",
      editable: false,
      source: manuscript,
    });
    await openSettings();
    await page.locator('button[aria-label="Open note for editing"]').click();
    await until(
      "window.publicationFixture.state().editable && !document.querySelector('.modal')",
    );
    await openSettings();
    await editProperty("Title", "Mobile title");
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.text().includes('title: Mobile title')",
      ),
      true,
    );
    await page.evaluate(
      "document.querySelector('.stratum-publishing-advanced').open = true",
    );
    await until("!!document.querySelector('.stratum-publish-font-status')");
    await page.evaluate(
      "document.querySelector('.stratum-publish-section').open = true",
    );
    await until(
      "document.querySelector('.stratum-publish-font-status').textContent.includes('selected on desktop')",
    );
    assert.equal(
      await page.evaluate(
        "window.publicationFixture.state().fontDiscoveryCalls",
      ),
      0,
    );
  });
});

test("editor undo and redo transactions refresh Settings metadata without the removed note widget", async () => {
  await scenario("metadata-editor-history", async () => {
    await reset({
      mobile: true,
      templateId: "academic",
      source: manuscript.replace("tags:", "title: Original\ntags:"),
    });
    await openSettings();
    const original = await page.evaluate("window.publicationFixture.text()");
    await editProperty("Title", "History title");
    const changed = await page.evaluate("window.publicationFixture.text()");
    await page.evaluate("window.publicationFixture.undoMetadataEdit()");
    await until(
      "document.querySelector('input[aria-label=\"Title\"]').value === 'Original'",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      original,
    );
    await page.evaluate("window.publicationFixture.redoMetadataEdit()");
    await until(
      "document.querySelector('input[aria-label=\"Title\"]').value === 'History title'",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      changed,
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().pending"),
      false,
    );
    assert.equal(
      await page.locator(".cm-editor .stratum-publication-details").count(),
      0,
    );
  });
});
