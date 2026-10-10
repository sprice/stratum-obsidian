import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
const server = createServer();
let browser: StagehandBrowser;
let driver: Stagehand;
let page: Page;
before(
  async () => {
    const bundle = await build({
      entryPoints: [
        join(directory, "src/test/browser/publication-editor-fixture.ts"),
      ],
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      target: "chrome120",
      alias: { obsidian: join(directory, "src/test/browser/obsidian-host.ts") },
    });
    const css = await readFile(join(directory, "styles.css"));
    server.on("request", (request, response) => {
      const script = request.url === "/fixture.js";
      const style = request.url === "/plugin.css";
      response.writeHead(200, {
        "Content-Type": script
          ? "text/javascript"
          : style
            ? "text/css"
            : "text/html",
      });
      response.end(
        script
          ? bundle.outputFiles[0].contents
          : style
            ? css
            : '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/plugin.css"><style>body{margin:0}.cm-editor{height:90vh}.cm-scroller{overflow:auto}</style></head><body><main id="editor"></main><script type="module" src="/fixture.js"></script></body></html>',
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    browser = await localBrowser.launch({
      headless: true,
      viewport: { width: 560, height: 900 },
      ...(process.env.STRATUM_TEST_CHROME
        ? { executablePath: process.env.STRATUM_TEST_CHROME }
        : {}),
    });
    driver = await Stagehand.create({ browser });
    [page] = await browser.context.pages();
    await page.setViewportSize(560, 900);
    const address = server.address();
    assert(address && typeof address !== "string");
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await until('document.body.dataset.ready === "true"');
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
async function until(expression: string) {
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
    if (await page.evaluate(expression)) return;
    await delay(30);
  }
  const state = await page.evaluate(`({
    text: window.publicationEditorFixture.text(),
    pending: window.publicationEditorFixture.pending(),
    events: window.publicationEditorFixture.events,
    viewport: { height: innerHeight, width: innerWidth },
    addButton: (() => {
      const button = document.querySelector('button[aria-label="Add author"]');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      const details = button.closest('details');
      return {rect: rect.toJSON(), target: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.tagName, open: details.open,
        whiteSpace: getComputedStyle(details).whiteSpace, display: getComputedStyle(button.parentElement).display,
        sheets: [...document.styleSheets].map(sheet=>({href:sheet.href,rules:sheet.cssRules.length}))};
    })(),
    active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,
    conflicts: [...document.querySelectorAll('.stratum-publication-conflict')].map(node => node.textContent)
  })`);
  throw new Error(`Timed out: ${expression}\n${JSON.stringify(state)}`);
}
async function reset() {
  await page.evaluate("window.publicationEditorFixture.reset()");
  await until(
    'document.querySelectorAll(".stratum-publication-author").length === 2',
  );
}
async function click(label: string) {
  const selector = `button[aria-label="${label}"]`;
  await until(`document.querySelector(${JSON.stringify(selector)}) !== null`);
  await page.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block: "center"})`,
  );
  await until(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return button === target || button.contains(target);
  })()`);
  await page.locator(selector).click();
}
test("Tab commits YAML, maintains focus, and Shift+Tab reaches the summary", async () => {
  await reset();
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 name", "Alex Changed"); window.publicationEditorFixture.key("Author 1 name", "Tab")',
  );
  await until(
    'window.publicationEditorFixture.authors()[0].name === "Alex Changed"',
  );
  assert.equal(
    await page.evaluate('document.activeElement.getAttribute("aria-label")'),
    "Author 1 email",
  );
  await page.evaluate(
    'window.publicationEditorFixture.key("Author 1 email", "Tab", true)',
  );
  await until(
    'document.activeElement.getAttribute("aria-label") === "Author 1 name"',
  );
  await page.evaluate(
    'window.publicationEditorFixture.key("Author 1 name", "Tab", true)',
  );
  await until('document.activeElement.tagName === "SUMMARY"');
  assert.match(
    await page.evaluate<string>("window.publicationEditorFixture.text()"),
    /unrelated: retained # Keep this comment/,
  );
});
test("clicking a list action flushes the focused draft and performs the action", async () => {
  await reset();
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 name", "Alex Pending")',
  );
  await click("Add author");
  await until("window.publicationEditorFixture.authors().length === 3");
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.authors()[0].name"),
    "Alex Pending",
  );
  await click("Move author 2 up");
  await until(
    'window.publicationEditorFixture.authors()[0].name === "Morgan Sample"',
  );
  await click("Remove author 3");
  await until("window.publicationEditorFixture.authors().length === 2");
});
test("affiliation conflicts require an explicit current affiliation target", async () => {
  await reset();
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 affiliation 1", "Retained affiliation draft"); window.publicationEditorFixture.replace(window.publicationEditorFixture.text().replace("        - Example University\\n        - Example Observatory", "        - Example Observatory\\n        - New Institute")); window.publicationEditorFixture.flush()',
  );
  await until(
    'document.querySelector(".stratum-publication-conflict") !== null',
  );
  assert.equal(
    await page.locator('button[aria-label="Apply draft to author 1"]').count(),
    0,
  );
  await click("Apply draft to author 1, affiliation 2");
  await until("!window.publicationEditorFixture.pending()");
  assert.deepEqual(
    await page.evaluate(
      "window.publicationEditorFixture.authors()[0].affiliations",
    ),
    ["Example Observatory", "Retained affiliation draft"],
  );
});
test("composition Enter retains the draft; title-source changes refresh validation", async () => {
  await reset();
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 name", "Composition draft"); window.publicationEditorFixture.key("Author 1 name", "Enter", false, true)',
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.authors()[0].name"),
    "Alex Example",
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.pending()"),
    true,
  );
  await page.evaluate(
    'window.publicationEditorFixture.key("Author 1 name", "Enter"); window.publicationEditorFixture.titleSource("body")',
  );
  await until(
    'document.querySelector(".stratum-publication-validation").textContent.includes("title")',
  );
});
test("a namespace example in body prose does not activate the widget", async () => {
  await page.evaluate(
    'window.publicationEditorFixture.reset("A literal example:\\n\\nstratum_publish:\\n  authors: []\\n")',
  );
  await until(
    'document.querySelector(".stratum-publication-details") === null',
  );
});
test("the form distinguishes PDF requirements from guidance and updates them for Word drafts", async () => {
  await page.evaluate(
    'window.publicationEditorFixture.reset(window.publicationEditorFixture.sample.replace("      email: alex@example.org\\n", "").replace("## Abstract\\nSynthetic abstract.\\n", ""))',
  );
  await until(
    'document.querySelector(".stratum-publication-content").textContent.includes("Required: Author 1 needs an email address.")',
  );
  assert.equal(
    await page.evaluate(
      'document.querySelector(".stratum-publication-content").textContent.includes("Guidance: No Abstract section was found.")',
    ),
    true,
  );
  const source = await page.evaluate("window.publicationEditorFixture.text()");
  await page.evaluate('window.publicationEditorFixture.output("docx")');
  await until(
    'document.querySelector(".stratum-publication-content").textContent.includes("Guidance: Author 1 needs an email address.")',
  );
  assert.equal(
    await page.evaluate(
      'document.querySelector(".stratum-publication-content").textContent.includes("Required:")',
    ),
    false,
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.text()"),
    source,
  );
});
test("flush uses the edited view when another view of the same note is registered first", async () => {
  await page.evaluate(
    "window.publicationEditorFixture.reset(window.publicationEditorFixture.sample, true)",
  );
  await until(
    'document.querySelectorAll(".stratum-publication-author").length === 2',
  );
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 name", "Active view author"); window.publicationEditorFixture.flush()',
  );
  await until(
    'window.publicationEditorFixture.authors()[0].name === "Active view author"',
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.pending()"),
    false,
  );
  assert.match(
    await page.evaluate<string>(
      "window.publicationEditorFixture.backgroundText()",
    ),
    /Background author/,
  );
});
test("repeatable affiliations commit and remove without altering other authors", async () => {
  await reset();
  await click("Add affiliation to author 2");
  await until(
    `document.querySelector('input[aria-label="Author 2 affiliation 2"]') !== null`,
  );
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 2 affiliation 2", "New Observatory"); window.publicationEditorFixture.key("Author 2 affiliation 2", "Enter")',
  );
  await until(
    'window.publicationEditorFixture.authors()[1].affiliations[1] === "New Observatory"',
  );
  await click("Remove affiliation 1 from author 2");
  await until(
    "window.publicationEditorFixture.authors()[1].affiliations.length === 1",
  );
  assert.deepEqual(
    await page.evaluate(
      "window.publicationEditorFixture.authors()[0].affiliations",
    ),
    ["Example University", "Example Observatory"],
  );
  assert.deepEqual(
    await page.evaluate(
      "window.publicationEditorFixture.authors()[1].affiliations",
    ),
    ["New Observatory"],
  );
});
test("switching Source and Live Preview flushes a valid draft and preserves the body", async () => {
  await reset();
  await page.evaluate(
    'window.publicationEditorFixture.rememberInput("Author 1 email"); window.publicationEditorFixture.edit("Author 1 email", "changed@example.org"); window.publicationEditorFixture.livePreview(false)',
  );
  await until(
    'window.publicationEditorFixture.authors()[0].email === "changed@example.org"',
  );
  assert.equal(await page.locator(".stratum-publication-details").count(), 0);
  await page.evaluate("window.publicationEditorFixture.blurRememberedInput()");
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.pending()"),
    false,
  );
  await page.evaluate("window.publicationEditorFixture.livePreview(true)");
  await until(
    `document.querySelector('input[aria-label="Author 1 email"]')?.value === "changed@example.org"`,
  );
  assert.match(
    await page.evaluate<string>("window.publicationEditorFixture.text()"),
    /Synthetic body remains unchanged/,
  );
});
test("narrow layouts keep controls within the editor", async () => {
  await page.setViewportSize(360, 900);
  await reset();
  const fits = await page.evaluate(`(() => {
    const widget = document.querySelector('.stratum-publication-details');
    const bounds = widget.getBoundingClientRect();
    return [...widget.querySelectorAll('input,button')].every(control => {
      const rect = control.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right;
    });
  })()`);
  assert.equal(fits, true);
  await page.setViewportSize(560, 900);
});
test("a protected frontmatter transaction retries only the validated edit without losing the body", async () => {
  await page.evaluate(
    "window.publicationEditorFixture.reset(window.publicationEditorFixture.sample, false, true)",
  );
  await until(
    'document.querySelectorAll(".stratum-publication-author").length === 2',
  );
  await click("Add author");
  await until("window.publicationEditorFixture.authors().length === 3");
  assert.equal(
    await page.evaluate(
      "window.publicationEditorFixture.blockedTransactions()",
    ),
    1,
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.pending()"),
    false,
  );
  assert.match(
    await page.evaluate<string>("window.publicationEditorFixture.text()"),
    /Synthetic body remains unchanged/,
  );
});
test("the trusted frontmatter retry respects an explicitly read-only note", async () => {
  await page.evaluate(
    "window.publicationEditorFixture.reset(window.publicationEditorFixture.sample, false, true, true)",
  );
  await until(
    'document.querySelectorAll(".stratum-publication-author").length === 2',
  );
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 name", "Read-only draft"); window.publicationEditorFixture.flush()',
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.authors()[0].name"),
    "Alex Example",
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.pending()"),
    true,
  );
  assert.match(
    await page.locator(".stratum-publication-conflict").innerText(),
    /read-only/,
  );
});

test("a partially accepted transaction retains the draft without overwriting the editor", async () => {
  await page.evaluate(
    "window.publicationEditorFixture.reset(window.publicationEditorFixture.sample, false, false, false, true)",
  );
  await until(
    'document.querySelectorAll(".stratum-publication-author").length === 2',
  );
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 name", "Alex Partial Draft"); window.publicationEditorFixture.flush()',
  );
  await until(
    'document.querySelector(".stratum-publication-conflict") !== null',
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.authors()[0].name"),
    "Partial editor value",
  );
  assert.equal(
    await page.evaluate("window.publicationEditorFixture.pending()"),
    true,
  );
  assert.match(
    await page.locator(".stratum-publication-conflict").innerText(),
    /did not retain the complete metadata change/,
  );
  assert.match(
    await page.evaluate<string>("window.publicationEditorFixture.text()"),
    /Synthetic body remains unchanged/,
  );
});

test("orderly unload commits a focused field before tearing down the editor", async () => {
  await reset();
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 name", "Alex Saved on unload"); window.publicationEditorFixture.unload()',
  );
  const text = await page.evaluate<string>(
    "window.publicationEditorFixture.text()",
  );
  assert.match(text, /name: Alex Saved on unload/);
  assert.match(text, /unrelated: retained # Keep this comment/);
  assert.match(text, /Synthetic body remains unchanged/);
});

test("unload does not overwrite newer author metadata with a conflicting draft", async () => {
  await reset();
  await page.evaluate(
    'window.publicationEditorFixture.edit("Author 1 name", "Stale unload draft"); window.publicationEditorFixture.replace(window.publicationEditorFixture.text().replace("Alex Example", "Newer author")); window.publicationEditorFixture.unload()',
  );
  const text = await page.evaluate<string>(
    "window.publicationEditorFixture.text()",
  );
  assert.match(text, /name: Newer author/);
  assert.ok(!text.includes("Stale unload draft"));
  assert.match(text, /Synthetic body remains unchanged/);
});

test("legacy import is explicit, keeps the old properties and does not assign global affiliations", async () => {
  await page.evaluate(
    'window.publicationEditorFixture.reset("---\\ntitle: Legacy manuscript\\nauthors: [Alex Example, Morgan Sample]\\naffiliations: [Global University]\\n---\\n\\nSynthetic body remains unchanged.\\n"); window.publicationEditorFixture.open()',
  );
  await until(
    'document.querySelector(".stratum-publication-details") !== null',
  );
  assert.ok(
    !(
      await page.evaluate<string>("window.publicationEditorFixture.text()")
    ).includes("stratum_publish:"),
  );
  await click("Use existing authors");
  await until(
    'document.querySelectorAll(".stratum-publication-author").length === 2',
  );
  const authors = await page.evaluate<
    { name: string; affiliations: string[] }[]
  >("window.publicationEditorFixture.authors()");
  assert.deepEqual(
    authors.map((author) => author.name),
    ["Alex Example", "Morgan Sample"],
  );
  assert.deepEqual(
    authors.map((author) => author.affiliations),
    [[], []],
  );
  const text = await page.evaluate<string>(
    "window.publicationEditorFixture.text()",
  );
  assert.match(text, /authors: \[Alex Example, Morgan Sample\]/);
  assert.match(text, /affiliations: \[Global University\]/);
  assert.match(text, /Synthetic body remains unchanged/);
  assert.equal(
    await page.locator('button[aria-label="Use existing authors"]').count(),
    0,
  );
});
