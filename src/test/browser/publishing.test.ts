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
    define: Object.fromEntries(
      [
        "__STRATUM_WEB_APP_URL__",
        "__STRATUM_SUPABASE_URL__",
        "__STRATUM_API_BASE_URL__",
        "__STRATUM_SUPABASE_PUBLISHABLE_KEY__",
      ].map((key) => [key, JSON.stringify("https://example.test")]),
    ),
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
/** Open Settings from the status's Choose font action, or from Settings. */
async function focusFont(label: string, launcher = "Choose font") {
  await page
    .locator(
      launcher === "Choose font"
        ? ".stratum-publish-status button:not([hidden])"
        : 'button[aria-label="Publishing settings for this note"]',
    )
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
            responsiveWidth: Math.abs(rect.width - ${width === 320 ? "row.width" : "(row.width - parseFloat(getComputedStyle(create.parentElement).columnGap)) / 2"}) <= 1,
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
          responsiveWidth: boolean;
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
          ready.responsiveWidth &&
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
          busy.responsiveWidth &&
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

test("secondary tabs show PDF history and retain filtering across navigation", async () => {
  await scenario("publishing-documents-tabs", async () => {
    await page.setViewportSize(320, 900);
    await page.evaluate("window.publicationFixture.reset({journal:true})");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-shell .stratum-tab-bar button:first-child').textContent",
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
      "document.querySelector('.stratum-publish-shell .stratum-tab-bar button:first-child').focus()",
    );
    await page.keyPress("ArrowRight");
    assert.equal(
      await page.evaluate(
        "document.activeElement === document.querySelector('.stratum-publish-shell .stratum-tab-bar button:last-child') && document.querySelector('.stratum-publish-panel').hidden && !document.querySelector('.stratum-publish-documents').parentElement.hidden",
      ),
      true,
    );
    assert.equal(await page.locator(".stratum-publish-filename").count(), 1);
    assert.equal(
      await page
        .locator('.stratum-publish-row-actions button[aria-label^="View PDF"]')
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator(
          '.stratum-publish-row-actions button[aria-label^="Download PDF"]',
        )
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
        "document.querySelector('.modal').textContent.includes('Delete PDF?')",
      ),
      true,
    );
    await page
      .locator(".modal .modal-button-container button:first-child")
      .click();
    assert.equal(await page.locator(".stratum-publish-filename").count(), 1);
    await page
      .locator(
        '.stratum-publish-row-actions button[aria-label^="Delete"][aria-label$=".pdf"]',
      )
      .click();
    await page
      .locator(".modal .modal-button-container button:last-child")
      .click();
    await until(
      "document.querySelectorAll('.stratum-publish-filename').length === 0 && !document.querySelector('.modal')",
    );
    await page
      .locator('select[aria-label="Choose which documents to view"]')
      .selectOption("all");
    await page.evaluate(
      "document.querySelector('.stratum-publish-shell .stratum-tab-bar button:last-child').focus()",
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
    await page.evaluate("window.publicationFixture.addDocuments(12)");
    await page.evaluate(
      `(() => { const list = document.querySelector('.stratum-publish-list'); list.style.height = '160px'; list.style.flex = 'none'; list.scrollTop = 240; })()`,
    );
    const scroll = await page.evaluate(
      "document.querySelector('.stratum-publish-list').scrollTop",
    );
    assert.ok(Number(scroll) > 0);
    await page.evaluate(
      "document.querySelector('.stratum-publish-shell .stratum-tab-bar button:last-child').focus()",
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
    await focusFont("Body font", "Settings");
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
    assert.equal(
      await page
        .locator(".stratum-publish-status button:not([hidden])")
        .innerText(),
      "Choose font",
    );
    await focusFont("Body font");
    await page.keyPress("Escape");
    await until("!document.querySelector('.modal')");
    assert.equal(
      await page.evaluate(
        "document.activeElement.textContent === 'Choose font'",
      ),
      true,
    );
    await focusFont("Body font");
    await choose("Body font", "", "bodyFont");
    assert.equal(
      await page.evaluate(
        "[...document.querySelectorAll('.stratum-publish-error')].filter(el => !el.hidden && el.innerText).length",
      ),
      0,
    );
    assert.equal(
      await page
        .locator(".stratum-publish-status button:not([hidden])")
        .count(),
      0,
      "Choose font leaves once the font error clears",
    );
    await page.keyPress("Escape");
    await until("!document.querySelector('.modal')");
    assert.equal(
      await page.evaluate(
        "document.activeElement === document.querySelector('button[aria-label=\"Publishing settings for this note\"]')",
      ),
      true,
      "closing returns focus to Settings",
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
  await until(`(() => {
    const input = document.querySelector('.stratum-publishing-settings-modal input:not([type="checkbox"])[aria-label="${label}"], .stratum-publishing-settings-modal textarea[aria-label="${label}"]');
    return !!input && !input.disabled && input.getClientRects().length>0;
  })()`);
  await page.evaluate(`(() => {
    const input = document.querySelector('.stratum-publishing-settings-modal input:not([type="checkbox"])[aria-label="${label}"], .stratum-publishing-settings-modal textarea[aria-label="${label}"]');
    input.focus(); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true}));
    ${commit ? "input.blur();" : ""}
  })()`);
}
const manuscript =
  "---\ntags: [private, retained] # Keep this comment\ncustom:\n  untouched: true\n---\n\n## Introduction\nSynthetic manuscript body.\n";
/** The Title field's invalid state and the text of the message describing it. */
function titleIssue() {
  return page.evaluate(`(() => {
    const input = document.querySelector('.stratum-publishing-settings-modal input[aria-label="Title"]');
    const id = input?.getAttribute('aria-describedby');
    return [input?.getAttribute('aria-invalid') ?? null, id ? document.getElementById(id)?.textContent ?? "missing" : null];
  })()`);
}
/** Settings validation block text, which excludes field issues. */
function validationBlock() {
  return page.evaluate<string>(
    "document.querySelector('.stratum-publishing-validation').innerText.trim()",
  );
}

test("General and Academic settings edit only publishing fields, enforce dynamic title requirements and reset formatting only", async () => {
  await scenario("common-details-matrix", async () => {
    for (const templateId of ["general", "academic"] as const) {
      await reset({ templateId, source: manuscript });
      await openSettings();
      assert.deepEqual(
        await page.evaluate(
          "[...document.querySelectorAll('.stratum-publishing-settings-modal h4.stratum-subheading')].map(el => el.textContent)",
        ),
        ["Document details", "PDF options"],
      );
      assert.equal(
        await page.evaluate(
          "!!document.querySelector('select[aria-label=\"Choose template\"]') && !document.querySelector('.stratum-publishing-settings-modal select[aria-label=\"Choose template\"]')",
        ),
        true,
      );
      assert.equal(
        await page.evaluate("window.publicationFixture.state().titleSource"),
        "body",
      );
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
      await until(
        "document.querySelector('.stratum-publishing-settings-modal input[aria-label=\"Title\"]').getAttribute('aria-invalid') === 'true'",
      );
      assert.deepEqual(await titleIssue(), [
        "true",
        "Add a value for the required “title” property.",
      ]);
      assert.equal(await validationBlock(), "");
      if (templateId === "general") await capture("title-field-issue");
      await editProperty("Title", "Edited manuscript title");
      await until("window.publicationFixture.state().canCreate");
      await until(
        "!document.querySelector('.stratum-publishing-settings-modal input[aria-label=\"Title\"]').hasAttribute('aria-invalid')",
      );
      assert.deepEqual(await titleIssue(), [null, null]);
      if (templateId === "academic") {
        await page.locator('button[aria-label="Add author"]').click();
        await editProperty("Author 1 name", "Alex");
      } else {
        await page
          .locator('.checkbox-container:has(input[aria-label="Authors"])')
          .click();
        await editProperty("Authors", "Alex\nMorgan");
      }
      for (const [label, value] of [
        ["Date", "2026-10-12"],
        ["Keywords", "one\ntwo"],
      ]) {
        const enabled = await page.evaluate(
          `document.querySelector('.checkbox-container:has(input[aria-label="${label}"]) input').checked`,
        );
        if (!enabled)
          await page
            .locator(`.checkbox-container:has(input[aria-label="${label}"])`)
            .click();
        await until(
          `!document.querySelector('[data-property-control="${label.toLowerCase()}"]').closest('.stratum-control-field').hidden`,
        );
        await editProperty(label, value);
      }
      await until("!window.publicationFixture.state().saving");
      assert.equal(
        await page.locator('[data-property-control^="remove:"]').count(),
        0,
      );
      await editProperty("Keywords", "", false);
      await page.locator(".stratum-publishing-cleanup").click();
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
        "body",
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
          "document.activeElement?.textContent === 'Document settings'",
        ),
        true,
      );
    }
  });
});

test("template switches restore saved title sources and default new templates to body", async () => {
  await scenario("saved-template-title-sources", async () => {
    await reset({
      templateId: "general",
      source: manuscript.replace("tags:", "title: Synthetic title\ntags:"),
    });
    for (const [templateId, expected, saved] of [
      ["general", "body", "properties"],
      ["academic", "body", "properties"],
      ["general", "properties", "body"],
      ["academic", "properties", "body"],
      ["general", "body", "body"],
      ["academic", "body", "body"],
    ]) {
      await page
        .locator('select[aria-label="Choose template"]')
        .selectOption(templateId);
      await until("!window.publicationFixture.state().saving");
      await openSettings();
      assert.equal(
        await page.evaluate("window.publicationFixture.state().titleSource"),
        expected,
      );
      await page
        .locator('select[aria-label="Title source"]')
        .selectOption(saved);
      await page.keyPress("Tab");
      await until(
        `window.publicationFixture.state().titleSource === ${JSON.stringify(saved)} && !window.publicationFixture.state().saving && !document.querySelector('.stratum-publishing-done').disabled`,
      );
      await page.locator(".stratum-publishing-done").click();
      await until("!document.querySelector('.modal')");
    }
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

test("one Settings window survives panel re-renders and returns focus to the new button", async () => {
  await scenario("settings-window-owner", async () => {
    await reset({ templateId: "academic", source: manuscript });
    await page.evaluate(`(() => {
      const button = document.querySelector('button[aria-label="Publishing settings for this note"]');
      button.click();
      button.click();
    })()`);
    await until(
      "!!document.querySelector('.stratum-publishing-settings-modal')",
    );
    const windows = () =>
      page.evaluate(
        "document.querySelectorAll('.stratum-publishing-settings-modal').length",
      );
    assert.equal(await windows(), 1, "a repeated click opens one window");
    await page.evaluate("window.publicationFixture.remountPanel()");
    await page.evaluate(
      "window.publicationFixture.openCommandSettings().then(() => true)",
    );
    assert.equal(await windows(), 1, "the command replaces the window");
    await page.keyPress("Escape");
    await until("!document.querySelector('.modal')");
    await openSettings();
    await page.evaluate("window.publicationFixture.remountPanel()");
    assert.equal(
      await windows(),
      1,
      "a sidebar re-render keeps the open window",
    );
    await page.keyPress("Escape");
    await until("!document.querySelector('.modal')");
    assert.equal(
      await page.evaluate(
        "document.activeElement === document.querySelector('button[aria-label=\"Publishing settings for this note\"]')",
      ),
      true,
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
    await page
      .locator('select[aria-label="Title source"]')
      .selectOption("properties");
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
    await page.evaluate(
      "window.openedModal = document.querySelector('.stratum-publishing-settings-modal')",
    );
    const openNote = page.locator(
      '.stratum-publishing-settings-modal button[aria-label="Open note for editing"]',
    );
    await page.evaluate("window.publicationFixture.failNextOpen()");
    await openNote.click();
    await until("!!window.publicationFixture.state().error");
    // A failed opening keeps the window, and focus returns to the button.
    await until(
      "document.activeElement?.getAttribute('aria-label') === 'Open note for editing'",
    );
    assert.equal(
      await page.evaluate(
        "window.openedModal.isConnected && window.openedModal.contains(document.activeElement) && !document.activeElement.hasAttribute('aria-disabled')",
      ),
      true,
      "focus stays in the window after a failed opening",
    );
    await openNote.click();
    // The note opens behind the window, which stays open and gains the fields.
    await until(
      "window.publicationFixture.state().editable && !!document.querySelector('.stratum-publishing-settings-modal input[aria-label=\"Title\"]')",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelectorAll('.modal').length === 1 && window.openedModal.isConnected",
      ),
      true,
      "the same window stays open",
    );
    await until(
      "window.openedModal.contains(document.activeElement) && document.activeElement.matches('input')",
    );
    await capture("metadata-open-note-mounted");
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

test("shared author conflict recovery refreshes current values after a second external edit", async () => {
  await scenario("author-conflict-current-value", async () => {
    await reset({
      journal: true,
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

test("publishing starting state guides template selection in both themes", async () => {
  await scenario("publishing-starting-state", async () => {
    for (const theme of ["theme-dark", "theme-light"]) {
      await reset({ templateId: "general" });
      await page.evaluate(
        `document.body.classList.remove("theme-dark", "theme-light"); document.body.classList.add("${theme}"); window.publicationFixture.selectTemplate("")`,
      );
      await until(
        "!window.publicationFixture.state().saving && document.querySelector('.stratum-publish-controls').hidden",
      );
      for (const width of [320, 560]) {
        await page.setViewportSize(width, 900);
        const state = await page.evaluate(`(() => {
          const panel = document.querySelector('.stratum-publish-panel');
          const hint = [...panel.querySelectorAll('p')].find(p => p.textContent === 'Choose a template to get started.');
          const field = panel.querySelector('select[aria-label="Choose template"]');
          const selectors = panel.querySelector('.stratum-publish-template-selectors');
          return {hint: !!hint && !hint.hidden, warning: !panel.querySelector('.stratum-publish-status').hidden,
            managers: [...panel.querySelectorAll('button')].filter(b => b.textContent === 'Manage templates').length,
            width: field.getBoundingClientRect().width, available: selectors.getBoundingClientRect().width,
            overflow: document.documentElement.scrollWidth > innerWidth};
        })()`);
        assert.deepEqual(state, {
          hint: true,
          warning: false,
          managers: 1,
          width: (state as { available: number }).available,
          available: (state as { available: number }).available,
          overflow: false,
        });
        await capture(`publishing-start-${theme}-${width}`);
      }
      await page
        .locator('select[aria-label="Choose template"]')
        .selectOption("general");
      await until(
        "!window.publicationFixture.state().saving && !document.querySelector('.stratum-publish-controls').hidden",
      );
      await capture(`publishing-ready-${theme}`);
    }
    await page.evaluate(
      'document.body.classList.remove("theme-light");document.body.classList.add("theme-dark")',
    );
  });
});

test("template and installed version selectors keep equal available columns and use exact registry versions", async () => {
  await scenario("template-version-columns", async () => {
    for (const width of [320, 560]) {
      await page.setViewportSize(width, 900);
      for (const templateId of ["general", "academic", "journal"]) {
        await reset(
          templateId === "journal" ? { journal: true } : { templateId },
        );
        const measure = await page.evaluate(
          `(() => { const row=document.querySelector('.stratum-publish-template-selectors');const fields=[...row.children],r=row.getBoundingClientRect(),gap=parseFloat(getComputedStyle(row).columnGap),t=fields[0].getBoundingClientRect(); const version=document.querySelector('select[aria-label="Choose template version"]');return {width:t.width,expected:!fields[1].hidden && innerWidth-40>448 ? (r.width-gap)/2 : r.width,versionVisible:!fields[1].hidden,label:document.querySelector('select[aria-label="Choose template"]').selectedOptions[0].textContent,versions:[...version.options].map(o=>o.textContent),overflow:document.documentElement.scrollWidth>innerWidth};})()`,
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
        assert.equal(m.versionVisible, templateId === "journal");
        if (templateId === "journal") {
          assert.equal(m.label, "Synthetic template");
          assert.deepEqual(m.versions, ["1.0-r1"]);
        }
        if (width === 320 && templateId === "general")
          await capture("publishing-generic-columns");
        if (width === 560 && templateId === "journal")
          await capture("publishing-version-columns");
      }
    }
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

test("editor undo and redo transactions refresh Settings metadata without the removed note widget", async () => {
  await scenario("metadata-editor-history", async () => {
    await reset({
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
      await page.locator(".cm-editor .stratum-publication-content").count(),
      0,
    );
  });
});

test("cleanup silently follows the selected template and restores all removed keys with one undo", async () => {
  await scenario("template-frontmatter-cleanup", async () => {
    const source =
      '---\ntitle: ""\nauthors: []\naffiliations: []\ndate: null\nkeywords: []\ncustom: "" # retained\n---\nBody\n';
    for (const templateId of ["general", "academic"]) {
      for (const width of [320, 560]) {
        await page.setViewportSize(width, 900);
        await reset(
          {
            templateId,
            source,
          },
          width,
        );
        await openSettings();
        assert.equal(
          await page.locator('[data-property-control^="remove:"]').count(),
          0,
        );
        assert.deepEqual(
          await page.evaluate(
            "[...document.querySelectorAll('.modal-button-container button')].map(b=>b.textContent)",
          ),
          ["Reset to defaults", "Remove empty properties", "Done"],
        );
        assert.equal(
          await page.evaluate(`(() => {
          const footer=document.querySelector('.modal-button-container');
          const done=document.querySelector('.stratum-publishing-done');
          const leading=footer.querySelector('.mod-secondary');
          return innerWidth===${width} && parseFloat(getComputedStyle(footer).marginTop)>0 &&
            Math.abs(done.getBoundingClientRect().right-footer.getBoundingClientRect().right)<1 &&
            Math.abs(leading.getBoundingClientRect().left-footer.getBoundingClientRect().left)<1 &&
            document.documentElement.scrollWidth<=innerWidth;
        })()`),
          true,
        );
        await page.locator(".stratum-publishing-cleanup").click();
        const cleaned = String(
          await page.evaluate("window.publicationFixture.text()"),
        );
        if (templateId === "general") assert.equal(cleaned, source);
        else if (templateId === "academic") {
          assert.doesNotMatch(
            cleaned,
            /authors:|affiliations:|date:|keywords:/,
          );
          assert.equal(
            await page.evaluate("window.publicationFixture.state().canCreate"),
            true,
          );
          assert.match(cleaned, /title: ""/);
        } else {
          assert.doesNotMatch(cleaned, /title:/);
          assert.match(cleaned, /authors: \[\]/);
          assert.match(cleaned, /keywords: \[\]/);
        }
        assert.match(cleaned, /custom: "" # retained\n---\nBody\n$/);
        assert.equal(
          await page.evaluate(
            "[...document.querySelectorAll('.stratum-publishing-settings-modal .stratum-publish-error')].some(e=>!e.hidden && e.textContent.trim())",
          ),
          false,
        );
        if (templateId !== "general") {
          await page.evaluate("window.publicationFixture.undoMetadataEdit()");
          assert.equal(
            await page.evaluate("window.publicationFixture.text()"),
            source,
          );
          await page.evaluate("window.publicationFixture.redoMetadataEdit()");
          assert.equal(
            await page.evaluate("window.publicationFixture.text()"),
            cleaned,
          );
        }
        await capture(
          `frontmatter-cleanup-${templateId.replace(":", "-")}-${width}`,
        );
        await page.keyPress("Escape");
      }
    }
  });
});

test("cleanup flushes focused drafts but blocks conflicts, pending settings and unavailable original editors", async () => {
  await scenario("frontmatter-cleanup-guards", async () => {
    const source = "---\ntitle: Original\nkeywords: []\n---\nBody";
    await reset({ templateId: "academic", source });
    await openSettings();
    await editProperty("Title", "Pending title", false);
    await page.evaluate(
      "document.querySelector('.stratum-publishing-cleanup').click()",
    );
    assert.match(
      String(await page.evaluate("window.publicationFixture.text()")),
      /title: Pending title/,
    );
    assert.doesNotMatch(
      String(await page.evaluate("window.publicationFixture.text()")),
      /keywords:/,
    );
    await editProperty("Title", "Conflicting draft", false);
    await page.evaluate(
      "window.publicationFixture.replaceText(window.publicationFixture.text().replace('Pending title','External title').replace('---\\nBody','keywords: []\\n---\\nBody'))",
    );
    await page.evaluate(
      "document.querySelector('[aria-label=\"Title\"]').blur()",
    );
    const conflicted = await page.evaluate("window.publicationFixture.text()");
    await page.evaluate(
      "document.querySelector('.stratum-publishing-cleanup').click()",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      conflicted,
    );
    await until(
      "document.querySelector('.stratum-publishing-cleanup').disabled && document.querySelector('.stratum-publishing-settings-modal').textContent.includes('changed elsewhere')",
    );

    await reset({ templateId: "academic", source });
    await openSettings();
    await page.evaluate("window.publicationFixture.holdSaves(true)");
    await page
      .locator('select[aria-label="Title source"]')
      .selectOption("body");
    await until("window.publicationFixture.state().saving");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publishing-cleanup').disabled",
      ),
      true,
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      source,
    );
    await page.evaluate("window.publicationFixture.holdSaves(false)");
    await until("!window.publicationFixture.state().saving");
    await until(
      "!document.querySelector('.stratum-publishing-cleanup').disabled",
    );
    await page.evaluate(
      "window.publicationFixture.detachEditor(); document.querySelector('.stratum-publishing-cleanup').click()",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      source,
    );
    await until(
      "document.querySelector('.stratum-publishing-cleanup').disabled",
    );
    await reset({ templateId: "academic", source });
    await openSettings();
    await page.evaluate(
      "window.publicationFixture.makeEditorReadOnly(); document.querySelector('.stratum-publishing-cleanup').click()",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      source,
    );
    await until(
      "document.querySelector('.stratum-publishing-cleanup').disabled",
    );
  });
});

test("cleanup cannot target a switched note through a retained button", async () => {
  await scenario("frontmatter-cleanup-captured-note", async () => {
    const source = "---\ntitle: Original\nkeywords: []\n---\nBody";
    await reset({ templateId: "academic", source });
    await openSettings();
    await page.evaluate(`(() => {
      const button=document.querySelector('.stratum-publishing-cleanup');
      window.publicationFixture.switchNote(); button.click();
    })()`);
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      source,
    );
    assert.equal(
      await page.locator(".stratum-publishing-settings-modal").count(),
      0,
    );
  });
});

test("reset availability reacts to saved changes and resets only the selected template's options", async () => {
  await scenario("reset-no-op-states", async () => {
    for (const templateId of ["general", "academic"]) {
      await reset({
        templateId,
        bodyFont: "",
        titleFont: "",
        source: manuscript,
      });
      await openSettings();
      await until(
        "document.querySelector('.stratum-publishing-reset').disabled",
      );
      const before = await page.evaluate("window.publicationFixture.text()");
      await page
        .locator('select[aria-label="Title source"]')
        .selectOption("properties");
      await until(
        "!window.publicationFixture.state().saving && !document.querySelector('.stratum-publishing-reset').disabled",
      );
      await page.evaluate(
        "document.querySelector('.stratum-publishing-reset').click()",
      );
      await until(
        "!window.publicationFixture.state().saving && document.querySelector('.stratum-publishing-reset').disabled",
      );
      assert.equal(
        await page.evaluate("window.publicationFixture.text()"),
        before,
      );
      await page.keyPress("Escape");
    }
  });
});

test("cleanup availability follows focused drafts, current mappings, external edits and undo without saving during prediction", async () => {
  await scenario("cleanup-no-op-states", async () => {
    for (const journal of [false]) {
      const source = "---\ntitle: Populated\nkeywords: [retained]\n---\nBody";
      await reset({ templateId: "academic", journal, bodyFont: "", source });
      await openSettings();
      await page
        .locator('select[aria-label="Title source"]')
        .selectOption("properties");
      await until(
        "document.querySelector('.stratum-publishing-cleanup').disabled",
      );
      await editProperty("Title", "", false);
      await until(
        "!document.querySelector('.stratum-publishing-cleanup').disabled",
      );
      assert.equal(
        await page.evaluate("window.publicationFixture.text()"),
        source,
      );
      await editProperty("Title", "Populated", false);
      await until(
        "document.querySelector('.stratum-publishing-cleanup').disabled",
      );
      await editProperty("Title", "", false);
      await page.locator(".stratum-publishing-cleanup").click();
      await until(
        "document.querySelector('.stratum-publishing-cleanup').disabled",
      );
      assert.doesNotMatch(
        String(await page.evaluate("window.publicationFixture.text()")),
        /title:/,
      );
      await page.evaluate("window.publicationFixture.undoMetadataEdit()");
      await until(
        "!document.querySelector('.stratum-publishing-cleanup').disabled",
      );
      await page.evaluate("window.publicationFixture.redoMetadataEdit()");
      await until(
        "document.querySelector('.stratum-publishing-cleanup').disabled",
      );
      await page.evaluate(
        "window.publicationFixture.replaceText(window.publicationFixture.text().replace('---\\nBody', 'title: null\\n---\\nBody'))",
      );
      await until(
        "!document.querySelector('.stratum-publishing-cleanup').disabled",
      );
      await page.keyPress("Escape");
    }
    await reset({
      journal: true,
      source:
        "---\ntitle: Populated\nstratum_publish:\n  authors:\n    - name: Author\n      email: author@example.org\n      affiliations: [Institute]\n---\nBody",
    });
    await openSettings();
    const authorSource = await page.evaluate(
      "window.publicationFixture.text()",
    );
    await page.evaluate(
      "document.querySelector('[aria-label=\"Author 1 name\"]').focus(); document.querySelector('.stratum-publishing-settings-modal').dispatchEvent(new Event('change', {bubbles:true}))",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().pending"),
      false,
    );
    await editProperty("Author 1 name", "", false);
    await until(
      "!document.querySelector('.stratum-publishing-cleanup').disabled",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      authorSource,
    );
    await editProperty("Author 1 name", "Author", false);
    await until(
      "document.querySelector('.stratum-publishing-cleanup').disabled",
    );
    await page.keyPress("Escape");
    await reset({ templateId: "general", source: '---\ntitle: ""\n---\nBody' });
    await openSettings();
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publishing-cleanup').disabled",
      ),
      true,
    );
    await page
      .locator('select[aria-label="Title source"]')
      .selectOption("properties");
    await until(
      "!document.querySelector('.stratum-publishing-cleanup').disabled",
    );
  });
});

test("PDF option fields and Advanced layout use shared token spacing across templates and narrow widths", async () => {
  await scenario("pdf-options-shared-spacing", async () => {
    for (const templateId of ["general", "academic"])
      for (const theme of ["dark", "light"] as const)
        for (const width of [320, 560]) {
          const journal = templateId === "registry:example:1.0-r1";
          await reset({ templateId, journal, theme, bodyFont: "" }, width);
          await openSettings();
          assert.equal(
            await page.evaluate(`(() => {
        const options=document.querySelector('.stratum-publishing-pdf-options');
        const field=options.querySelector('.stratum-control-field');
        return innerWidth===${width} && parseFloat(getComputedStyle(field).gap)===8 &&
          parseFloat(getComputedStyle(options).gap)===12 && document.documentElement.scrollWidth<=innerWidth;
      })()`),
            true,
          );
          if (!journal) {
            assert.equal(
              await page.evaluate(`(() => {
                const rows = [...document.querySelectorAll('.stratum-publishing-details .setting-item')];
                return rows.length === 4 && rows.every(row => {
                  const style = getComputedStyle(row);
                  return style.paddingTop === '16px' && style.paddingBottom === '16px' && style.borderTopWidth === '0px';
                });
              })()`),
              true,
            );
            assert.equal(
              await page.evaluate(
                "parseFloat(getComputedStyle(document.querySelector('.stratum-publishing-advanced')).marginTop)",
              ),
              16,
            );
            await page.evaluate(
              "document.querySelector('.stratum-publishing-advanced').open=true",
            );
            await until(
              "!!document.querySelector('.stratum-publish-customize .stratum-control-field')",
            );
            assert.equal(
              await page.evaluate(
                "[...document.querySelectorAll('.stratum-publish-customize .stratum-control-field')].every(e=>parseFloat(getComputedStyle(e).gap)===8)",
              ),
              true,
            );
          }
          await capture(
            `pdf-options-spacing-${templateId.replace(":", "-")}-${theme}-${width}`,
          );
          await page.keyPress("Escape");
        }
  });
});

test("Date and Keywords toggles reveal inputs, preserve disabled values and leave inactive keys outside cleanup", async () => {
  await scenario("direct-property-toggles", async () => {
    for (const templateId of ["general", "academic"] as const) {
      await reset(
        {
          templateId,
          source:
            "---\ntitle: Paper\ndate: 2026-10-13\nkeywords: [one, two]\n---\nBody",
        },
        320,
      );
      await openSettings();
      assert.equal(
        await page
          .locator('select[aria-label="Add publishing property"]')
          .count(),
        0,
      );
      const before = await page.evaluate("window.publicationFixture.text()");
      for (const label of ["Date", "Keywords"]) {
        const toggle = `.checkbox-container:has(input[aria-label="${label}"])`;
        await until(
          `!window.publicationFixture.state().saving && !document.querySelector('${toggle}').classList.contains('is-disabled')`,
        );
        if (
          !(await page.evaluate(
            `document.querySelector('${toggle} input').checked`,
          ))
        )
          await page.locator(toggle).click();
        await until(
          `!document.querySelector('[data-property-control="${label.toLowerCase()}"]').closest('.stratum-control-field').hidden`,
        );
        await until(
          `!window.publicationFixture.state().saving && !document.querySelector('${toggle}').classList.contains('is-disabled')`,
        );
        await page.locator(toggle).click();
        await until(
          `document.querySelector('[data-property-control="${label.toLowerCase()}"]').closest('.stratum-control-field').hidden`,
        );
      }
      assert.equal(
        await page.evaluate("window.publicationFixture.text()"),
        before,
      );
      assert.equal(
        await page.evaluate(
          "document.querySelector('.stratum-publishing-cleanup').disabled",
        ),
        true,
      );
      await capture(`direct-property-toggles-${templateId}-320`);
      await page.keyPress("Escape");
    }
  });
});

test("Academic shares grouped authors without automatic legacy conversion or AASTeX requirements", async () => {
  await scenario("academic-grouped-authors", async () => {
    const source =
      "---\ntitle: Paper\nauthors: [Alex, Morgan]\naffiliations: [Institute]\ncustom: exact # retained\n---\nBody";
    await reset({ templateId: "academic", source });
    await openSettings();
    assert.equal(
      await page.locator('textarea[aria-label="Authors"]').count(),
      0,
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      source,
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().canCreate"),
      true,
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publishing-settings-modal').textContent.includes('affiliations must be assigned')",
      ),
      true,
    );
    await page.locator('button[aria-label="Use existing authors"]').click();
    await until(
      "!!document.querySelector('input[aria-label=\"Author 1 name\"]')",
    );
    await page
      .locator('button[aria-label="Add affiliation to author 1"]')
      .click();
    await editProperty("Author 1 affiliation 1", "Institute");
    await until("window.publicationFixture.state().canCreate");
    const grouped = String(
      await page.evaluate("window.publicationFixture.text()"),
    );
    assert.match(grouped, /authors: \[Alex, Morgan\]/);
    assert.match(grouped, /affiliations: \[Institute\]/);
    assert.match(grouped, /stratum_publish:/);
    assert.match(grouped, /custom: exact # retained/);
    await capture("academic-grouped-authors");
    await page.keyPress("Escape");
    await page.evaluate(
      "window.publicationFixture.selectTemplate('registry:example:1.0-r1')",
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.text()"),
      grouped,
    );
    assert.equal(
      await page.evaluate("window.publicationFixture.state().canCreate"),
      false,
    );
  });
});

test("Settings readiness notices inherit warning color while failures remain errors", async () => {
  await scenario("settings-readiness-notice", async () => {
    await reset({ journal: true, source: "---\ntitle: Paper\n---\nBody" });
    await until(
      "document.querySelector('.stratum-publish-status .stratum-publish-notice')?.textContent.includes('Settings: Add at least one author')",
    );
    assert.equal(
      await page.evaluate(
        "(() => {document.body.style.setProperty('--text-warning', 'rgb(240, 140, 30)');return getComputedStyle(document.querySelector('.stratum-publish-status .stratum-publish-notice')).color;})()",
      ),
      "rgb(240, 140, 30)",
    );
    await page.evaluate("window.publicationFixture.unrelatedError()");
    await until(
      "!!document.querySelector('.stratum-publish-status .stratum-publish-error')",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-status').textContent.includes('Settings: ')",
      ),
      false,
    );
    await reset({
      journal: true,
      source: "---\nstratum_publish:\n  authors: []\n---\nBody",
    });
    await page.evaluate("window.publicationFixture.setTitleSource('body')");
    await until(
      "document.querySelector('.stratum-publish-status .stratum-publish-notice')?.textContent.includes('Add a manuscript title using the selected title source.')",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-status .stratum-publish-notice').textContent.split('\\n')[0].includes('Settings: ')",
      ),
      false,
    );
  });
});

test("confirmed publication retains an accent outline icon until Documents is activated", async () => {
  await scenario("publication-success-indicator", async () => {
    await reset({ templateId: "general" });
    await page.evaluate(
      "document.body.style.setProperty('--interactive-accent', 'rgb(145, 80, 220)');window.publicationFixture.confirmPublished()",
    );
    await until(
      "!document.querySelector('.stratum-publish-success-icon').hidden",
    );
    assert.equal(
      await page.evaluate(
        "getComputedStyle(document.querySelector('.stratum-publish-success-icon')).color",
      ),
      "rgb(145, 80, 220)",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon svg').getAttribute('fill')",
      ),
      "none",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-sr-only').textContent",
      ),
      "PDF created. Available in documents.",
    );
    await delay(220);
    assert.equal(
      await page.evaluate(`(() => {
      const icon=document.querySelector('.stratum-publish-success-icon'), button=icon.closest('button');
      return Math.abs(button.getBoundingClientRect().right-icon.getBoundingClientRect().right-8-parseFloat(getComputedStyle(button).borderRightWidth))<1;
    })()`),
      true,
    );
    await capture("publication-success-indicator");
    await delay(1700);
    await page.evaluate("window.publicationFixture.confirmPublished()");
    await delay(3300);
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon').hidden",
      ),
      false,
    );
    await page.locator(".stratum-publish-success-icon svg").click();
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon').hidden",
      ),
      true,
    );
    await page
      .locator(".stratum-publish-shell .stratum-tab-bar button:first-child")
      .click();
    await page.evaluate("window.publicationFixture.unrelatedError()");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon').hidden",
      ),
      true,
    );
    await page.evaluate(`(() => {
      window.originalPublicationMatchMedia = window.matchMedia;
      window.matchMedia = (query) => ({matches: query.includes('prefers-reduced-motion'), media: query});
    })()`);
    await page.evaluate("window.publicationFixture.confirmPublished()");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon').getAnimations().length===0",
      ),
      true,
    );
    await page.evaluate(
      "window.matchMedia=window.originalPublicationMatchMedia",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon').hidden",
      ),
      false,
    );
    await page.evaluate("window.publicationFixture.confirmPublished()");
    await until(
      "!document.querySelector('.stratum-publish-success-icon').hidden",
    );
    await page.evaluate("window.publicationFixture.remountPanel()");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon').hidden",
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-sr-only').textContent",
      ),
      "",
    );
    await page.setViewportSize(320, 900);
    assert.equal(
      await page.evaluate(
        `(() => { const icon=document.querySelector('.stratum-publish-success-icon'),button=icon.closest('button'); const range=document.createRange(); range.selectNodeContents(button.firstChild); return document.documentElement.scrollWidth<=innerWidth && range.getBoundingClientRect().right<icon.getBoundingClientRect().left && Math.abs(button.getBoundingClientRect().right-icon.getBoundingClientRect().right-8-parseFloat(getComputedStyle(button).borderRightWidth))<1; })()`,
      ),
      true,
    );
    await page.evaluate(
      "document.querySelector('.stratum-publish-shell .stratum-tab-bar button:nth-child(2)').focus()",
    );
    await page.keyPress("Enter");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon').hidden",
      ),
      true,
    );
    await page
      .locator(".stratum-publish-shell .stratum-tab-bar button:first-child")
      .click();
    await page.evaluate("window.publicationFixture.confirmPublished()");
    await until(
      "!document.querySelector('.stratum-publish-success-icon').hidden",
    );
    await page.evaluate(
      "document.querySelector('.stratum-publish-shell .stratum-tab-bar button:nth-child(2)').focus()",
    );
    await page.type(" ");
    assert.equal(
      await page.evaluate(
        "document.querySelector('.stratum-publish-success-icon').hidden",
      ),
      true,
    );
  });
});

test("Documents label stays centered in the entire button with and without its right-side icon", async () => {
  await scenario("documents-centered-label", async () => {
    for (const width of [320, 560]) {
      await reset({ templateId: "general" }, width);
      const geometry = () =>
        page.evaluate<{
          center: number;
          buttonCenter: number;
          labelRight: number;
          iconLeft: number;
          overflow: boolean;
        }>(`(() => {
        const button=document.querySelector('.stratum-publish-documents-tab'), icon=button.querySelector('.stratum-publish-success-icon');
        const range=document.createRange(); range.selectNodeContents(button.firstChild);
        const label=range.getBoundingClientRect(), b=button.getBoundingClientRect();
        return {center:(label.left+label.right)/2, buttonCenter:(b.left+b.right)/2, labelRight:label.right, iconLeft:icon.getBoundingClientRect().left, overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      const hidden = await geometry();
      assert.ok(
        Math.abs(hidden.center - hidden.buttonCenter) < 1,
        JSON.stringify(hidden),
      );
      await page.evaluate("window.publicationFixture.confirmPublished()");
      await until(
        "!document.querySelector('.stratum-publish-success-icon').hidden",
      );
      const shown = await geometry();
      assert.ok(
        Math.abs(shown.center - shown.buttonCenter) < 1,
        JSON.stringify(shown),
      );
      assert.ok(Math.abs(shown.center - hidden.center) < 1);
      assert.ok(shown.labelRight < shown.iconLeft, JSON.stringify(shown));
      assert.equal(shown.overflow, false);
      await delay(220);
      await capture(`documents-centered-label-${width}`);
      await page.locator(".stratum-publish-success-icon svg").click();
      const acknowledged = await geometry();
      assert.ok(Math.abs(acknowledged.center - acknowledged.buttonCenter) < 1);
      assert.ok(Math.abs(acknowledged.center - hidden.center) < 1);
    }
  });
});

test("property YAML alerts and unchanged conflict recovery keep their nodes", async () => {
  await scenario("persistent-property-alerts", async () => {
    await reset({
      templateId: "general",
      source: "---\ntitle: Synthetic\n---\nBody",
    });
    await openSettings();
    await page.evaluate("document.activeElement.blur()");
    await page.evaluate(
      "window.publicationFixture.replaceText('---\\ntitle: [\\n---\\nBody')",
    );
    await until(
      "!!document.querySelector('.stratum-publishing-details [role=alert]')",
    );
    assert.equal(
      await page.evaluate(`(async () => {
      const alert = document.querySelector('.stratum-publishing-details [role=alert]');
      window.publicationFixture.setBusy(false);
      await Promise.resolve();
      window.publicationFixture.setBusy(false);
      await Promise.resolve();
      return alert === document.querySelector('.stratum-publishing-details [role=alert]');
    })()`),
      true,
    );
    await page.keyPress("Escape");
    await reset({
      templateId: "general",
      source: "---\ntitle: Original\n---\nBody",
    });
    await openSettings();
    await editProperty("Title", "Retained draft", false);
    await page.evaluate(
      "window.publicationFixture.replaceText(window.publicationFixture.text().replace('title: Original', 'title: Newer'))",
    );
    await page.evaluate(
      "document.querySelector('input[aria-label=Title]').blur()",
    );
    await until(
      "document.querySelector('.stratum-publishing-details').textContent.includes('This property changed elsewhere')",
    );
    assert.equal(
      await page.evaluate(`(async () => {
      const alert = document.querySelector('.stratum-publishing-details [role=alert]');
      window.publicationFixture.setBusy(false);
      await Promise.resolve();
      window.publicationFixture.setBusy(false);
      await Promise.resolve();
      return alert === document.querySelector('.stratum-publishing-details [role=alert]');
    })()`),
      true,
    );
    await page.keyPress("Escape");
  });
});

test("Title validation merges its description and removes only its own help id", async () => {
  await scenario("title-description-ownership", async () => {
    await reset({
      templateId: "general",
      source: "---\ntitle: Synthetic\n---\nBody",
    });
    await openSettings();
    await page
      .locator('select[aria-label="Title source"]')
      .selectOption("properties");
    await until(
      "window.publicationFixture.state().titleSource === 'properties' && !window.publicationFixture.state().saving",
    );
    await page.evaluate("document.activeElement.blur()");
    await page.evaluate(
      "document.querySelector('input[aria-label=Title]').setAttribute('aria-describedby', 'synthetic-help')",
    );
    await page.evaluate(
      "window.publicationFixture.replaceText('---\\ntitle: \\n---\\nBody')",
    );
    await until(
      "document.querySelector('input[aria-label=Title]').getAttribute('aria-invalid') === 'true'",
    );
    assert.deepEqual(
      await page.evaluate(`(() => {
      const input = document.querySelector('input[aria-label=Title]');
      const ids = input.getAttribute('aria-describedby').split(' ');
      return {help: ids.includes('synthetic-help'), count: ids.length, message: document.getElementById(ids.find(id=>id!=='synthetic-help')).textContent};
    })()`),
      {
        help: true,
        count: 2,
        message: "Add a value for the required “title” property.",
      },
    );
    await page.evaluate(
      "window.publicationFixture.replaceText('---\\ntitle: Restored synthetic title\\n---\\nBody')",
    );
    await until(
      "!document.querySelector('input[aria-label=Title]').hasAttribute('aria-invalid')",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('input[aria-label=Title]').getAttribute('aria-describedby')",
      ),
      "synthetic-help",
    );
    await page.keyPress("Escape");
  });
});

test("registry adapter exposes structured metadata without a legacy catalogue", async () => {
  await scenario("journal-settings", async () => {
    await page.evaluate(
      `window.publicationFixture.reset({templateId:"registry:example:1.0-r1", acm:true, source:${JSON.stringify(`---\nstratum_publish:\n  authors:\n    - name: Example Author\n      email: author@example.invalid\n      affiliations: [Example Institute]\n---\n# Example manuscript\n## Abstract\nSynthetic abstract.\n## Introduction\nBody.`)}})`,
    );
    await page
      .locator('button[aria-label="Publishing settings for this note"]')
      .click();
    await until("!!document.querySelector('.stratum-document-options-modal')");
    assert.equal(
      await page.locator('input[aria-label="Author 1 institution"]').count(),
      1,
    );
    assert.equal(
      await page.locator('input[aria-label="ACM conference name"]').count(),
      1,
    );
    assert.equal(
      await page
        .locator('select[aria-label="Citation style for this note"]')
        .count(),
      0,
    );
    assert.equal(
      await page.locator('select[aria-label="Choose template"]').count(),
      1,
    );
    assert.equal(
      await page.evaluate(
        `Array.from(document.querySelectorAll('select[aria-label="Choose template"] option')).some(option => /JMLR|Astronomy & Astrophysics|unavailable/i.test(option.textContent))`,
      ),
      false,
    );
  });
});

test("one template management action can enable a built-in from the all-off state", async () => {
  await scenario("template-availability", async () => {
    await reset({ templateId: "registry:example:1.0-r1" });
    await page.evaluate("window.publicationFixture.setEnabledTemplates([])");
    await page
      .locator(
        ".stratum-publish-panel .stratum-control-actions:not([hidden]) button",
      )
      .click();
    await until(
      "!!document.querySelector('.modal[aria-label=\"Publishing templates\"]')",
    );
    assert.doesNotMatch(
      String(
        await page.evaluate("document.querySelector('.modal').textContent"),
      ),
      /Previous template profiles|For documents using earlier profiles/,
    );
    assert.equal(
      await page.evaluate(
        "document.querySelectorAll('.modal .checkbox-container.is-enabled').length",
      ),
      0,
    );
    assert.equal(
      await page.evaluate(
        "Array.from(document.querySelectorAll('.modal button')).filter(button => button.textContent === 'Configure').length",
      ),
      2,
    );
    await page
      .locator('.modal [aria-label="Enable General documents"]')
      .click();
    await until(
      "!!document.querySelector('.modal [aria-label=\"Enable General documents\"].is-enabled')",
    );
    await page.keyPress("Escape");
    assert.equal(
      await page.evaluate(
        "Array.from(document.querySelector('select[aria-label=\"Choose template\"]').options).some(option => option.textContent === 'General documents')",
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        "document.querySelector('select[aria-label=\"Choose template\"]').value",
      ),
      "",
    );
  });
});
