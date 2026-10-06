import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import * as publishMath from "../publish-math";
import * as publishDocument from "../publish-document";

class Element {
  children: (Element | string)[] = [];
  parent: Element | null = null;
  attributes: { name: string }[] = [];
  checked = false;
  constructor(
    public tag = "div",
    public type = "",
  ) {}
  addClass() {}
  append(child: Element | string) {
    if (child instanceof Element) child.parent = this;
    this.children.push(child);
  }
  querySelectorAll(selector: string): Element[] {
    const matches = (node: Element) =>
      selector
        .split(",")
        .some(
          (part) =>
            part.trim() === "*" ||
            part.trim() === node.tag ||
            (part.trim() === 'input[type="checkbox"]' &&
              node.tag === "input" &&
              node.type === "checkbox"),
        );
    const descendants = this.children.filter(
      (child): child is Element => child instanceof Element,
    );
    return descendants.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  replaceWith(value: string) {
    const children = this.parent!.children;
    children.splice(children.indexOf(this), 1, value);
  }
  remove() {
    const children = this.parent!.children;
    children.splice(children.indexOf(this), 1);
  }
  get innerHTML(): string {
    return this.children
      .map((child) =>
        typeof child === "string"
          ? child
          : `<${child.tag}>${child.innerHTML}</${child.tag}>`,
      )
      .join("");
  }
}

test("publication retains checked and unchecked task states after removing controls", async () => {
  let unloaded = false;
  const { renderPublication } = loadRuntime<typeof import("../publish-render")>(
    "publish-render.ts",
    {
      Component: class {
        load() {}
        unload() {
          unloaded = true;
        }
      },
      TFile: class {},
      MarkdownRenderer: {
        render: (_app: unknown, _markdown: string, root: Element) => {
          const list = new Element("ul");
          root.append(list);
          for (const [checked, text] of [
            [true, "Finished"],
            [false, "Pending"],
          ] as const) {
            const item = new Element("li");
            const checkbox = new Element("input", "checkbox");
            checkbox.checked = checked;
            item.append(checkbox);
            item.append(text);
            list.append(item);
          }
          root.append(new Element("button"));
          return Promise.resolve();
        },
      },
    },
    { createDiv: () => new Element() },
    "browser",
    { "./publish-document": publishDocument, "./publish-math": publishMath },
  );
  const result = await renderPublication(
    {} as never,
    "- [x] Finished\n- [ ] Pending",
    "Example.md",
    "Example",
    undefined,
    new AbortController().signal,
  );
  assert.match(result.html, /\[x\] Finished/);
  assert.match(result.html, /\[ \] Pending/);
  assert.doesNotMatch(result.html, /<input|<button/);
  assert.equal(unloaded, true);
});

test("academic rendering builds one opening, indents Abstract, and promotes paper sections", async () => {
  const { renderPublication } = loadRuntime<typeof import("../publish-render")>(
    "publish-render.ts",
    {
      parseYaml: JSON.parse,
      Component: class {
        load() {}
        unload() {}
      },
      TFile: class {},
      MarkdownRenderer: {
        render: (_app: unknown, _markdown: string, root: Element) => {
          root.append(
            "<h2>Abstract</h2><p>Synthetic abstract.</p><h2>Introduction</h2><p>Synthetic body.</p>",
          );
          return Promise.resolve();
        },
      },
    },
    { createDiv: () => new Element() },
    "browser",
    { "./publish-document": publishDocument, "./publish-math": publishMath },
  );
  const { readNotePreferences } = await import("../publish-options");
  const preferences = readNotePreferences({ documentType: "academic" });
  const source =
    '---\n{"title":"Synthetic title","authors":["Alex Example"],"keywords":["testing"]}\n---\n\n## Abstract\n\nSynthetic abstract.\n\n## Introduction\n\nSynthetic body.';
  const result = await renderPublication(
    {} as never,
    source,
    "Example.md",
    "Example",
    undefined,
    new AbortController().signal,
    preferences,
  );
  assert.equal((result.html.match(/Synthetic title/g) ?? []).length, 1);
  assert.match(result.html, /stratum-publish-authors.*Alex Example/);
  assert.match(
    result.html,
    /stratum-publish-abstract.*<h1 class="unnumbered">Abstract/,
  );
  assert.match(result.html, /Keywords: testing/);
  assert.match(result.html, /<h1>Introduction<\/h1>/);
  await assert.rejects(
    () =>
      renderPublication(
        {} as never,
        '---\n{"title":"Synthetic title"}\n---\n\n# Synthetic title',
        "Example.md",
        "Example",
        undefined,
        new AbortController().signal,
        preferences,
      ),
    /body repeats the title/,
  );
});

test("academic body titles stay first, references match section level, and general headings are unchanged", async () => {
  const renderer = (html: string) =>
    loadRuntime<typeof import("../publish-render")>(
      "publish-render.ts",
      {
        parseYaml: JSON.parse,
        Component: class {
          load() {}
          unload() {}
        },
        TFile: class {},
        MarkdownRenderer: {
          render: (_app: unknown, _markdown: string, root: Element) => {
            root.append(html);
            return Promise.resolve();
          },
        },
      },
      { createDiv: () => new Element() },
      "browser",
      {
        "./publish-document": {
          ...publishDocument,
          preparePublication: (text: string) => ({
            ...publishDocument.preparePublication(text, undefined),
            bibliography: "<p>Synthetic reference.</p>",
            heading: "References",
          }),
        },
        "./publish-math": publishMath,
      },
    ).renderPublication;
  const { readNotePreferences } = await import("../publish-options");
  const render = (html: string, source: string, preferences?: unknown) =>
    renderer(html)(
      {} as never,
      source,
      "Example.md",
      "Example",
      undefined,
      new AbortController().signal,
      preferences ? readNotePreferences(preferences) : undefined,
    );
  const academic = await render(
    "<h1>Synthetic title</h1><h2>Introduction</h2><p>Body.</p>",
    '---\n{"title":"Synthetic title","keywords":["testing"]}\n---\n\n# Synthetic title',
    { documentType: "academic", opening: "body" },
  );
  assert.match(
    academic.html,
    /<body><div class="stratum-publish-title"><p>Synthetic title<\/p><\/div><div class="stratum-publish-keywords">/,
  );
  assert.match(academic.html, /<h1>Introduction<\/h1>/);
  assert.match(academic.html, /<h1 class="unnumbered">References<\/h1>/);
  for (const heading of [1, 2, 3]) {
    const paper = await render(
      `<h${heading}>Introduction</h${heading}><p>Body.</p>`,
      '---\n{"title":"Synthetic title"}\n---\n\n# Introduction',
      { documentType: "academic", opening: "properties" },
    );
    const level = heading === 1 ? 1 : heading - 1;
    assert.ok(paper.html.includes(`<h${level}>Introduction</h${level}>`));
    assert.ok(
      paper.html.includes(
        `<h${level} class="unnumbered">References</h${level}>`,
      ),
    );
  }
  const general = await render(
    "<h1>Synthetic heading</h1><p>Body.</p>",
    "# Synthetic heading",
  );
  assert.match(general.html, /<body><h1>Synthetic heading<\/h1>/);
  assert.match(general.html, /<h2 class="unnumbered">References<\/h2>/);
});
