import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import * as publishMath from "../publish-math";
import * as publishDocument from "../publish-document";
import { aastexProblems } from "../publication-package";
import * as publicationCitations from "../publication-citations";
import { readNotePreferences } from "../publish-options";

class Element {
  children: (Element | string)[] = [];
  parent: Element | null = null;
  attributes: { name: string; value?: string }[] = [];
  style = { textAlign: "" };
  get tagName() {
    return this.tag.toUpperCase();
  }
  setAttribute(name: string, value: string) {
    this.removeAttribute(name);
    this.attributes.push({ name, value });
  }
  getAttribute(name: string) {
    return this.attributes.find((attr) => attr.name === name)?.value ?? null;
  }
  removeAttribute(name: string) {
    this.attributes = this.attributes.filter((attr) => attr.name !== name);
  }
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
            (part.trim() === ".stratum-publish-image" &&
              node.getAttribute("class") === "stratum-publish-image") ||
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
  replaceWith(value: Element | string) {
    const children = this.parent!.children;
    if (value instanceof Element) value.parent = this.parent;
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
          : `<${child.tag}${child.attributes.map((attr) => ` ${attr.name}="${attr.value ?? ""}"`).join("")}>${child.innerHTML}</${child.tag}>`,
      )
      .join("");
  }
}

test("AASTeX body and abstract images have distinct assets without rewriting literal filenames", async () => {
  class File {
    extension = "png";
    constructor(public path: string) {}
  }
  const files = new Map([
    ["body.png", new File("body.png")],
    ["abstract.png", new File("abstract.png")],
  ]);
  const { renderAastexPublication } = loadRuntime<
    typeof import("../publication-render")
  >(
    "publication-render.ts",
    {
      Component: class {
        load() {}
        unload() {}
      },
      TFile: File,
      MarkdownRenderer: {
        render: (_app: unknown, markdown: string, root: Element) => {
          let cursor = 0;
          for (const match of markdown.matchAll(
            /<span class="stratum-publish-image" data-publish-image="([^"]+)" data-publish-alt="([^"]*)"><\/span>/g,
          )) {
            root.append(markdown.slice(cursor, match.index));
            const placeholder = new Element("span");
            placeholder.setAttribute("class", "stratum-publish-image");
            placeholder.setAttribute("data-publish-image", match[1]);
            placeholder.setAttribute("data-publish-alt", match[2]);
            root.append(placeholder);
            cursor = match.index + match[0].length;
          }
          root.append(markdown.slice(cursor));
          return Promise.resolve();
        },
      },
    },
    {
      createDiv: () => new Element(),
      createEl: (tag: string) => new Element(tag),
    },
    "browser",
    {
      "./publication-package": { aastexProblems },
      "./publication-citations": publicationCitations,
      "./publish-document": publishDocument,
      "./publish-math": publishMath,
      "./publish-image": {
        publishImage: (bytes: ArrayBuffer, extension: string) =>
          Promise.resolve({ bytes, extension }),
      },
    },
  );
  const app = {
    metadataCache: {
      getFirstLinkpathDest: (path: string) => files.get(path),
    },
    vault: {
      readBinary: (file: File) =>
        Promise.resolve(
          new Uint8Array([file.path === "body.png" ? 1 : 2]).buffer,
        ),
    },
  };
  const preferences = readNotePreferences({
    documentType: "academic",
    templateId: "package:aastex",
    format: "pdf",
    pdf: { titleSource: "properties" },
  });
  for (const abstractImages of [
    "",
    "![Abstract](abstract.png)\n![Repeated](abstract.png)",
  ]) {
    const text = `---
title: Synthetic asset manuscript
stratum_publish:
  authors:
    - name: Alex Example
      email: alex@example.org
      affiliations: [Example University]
---
## Abstract
Literal asset-0.png and \`asset-0.png\` remain unchanged.
${abstractImages}
## Introduction
![Body](body.png)
![Repeated](body.png)
`;
    const result = await renderAastexPublication(
      app as never,
      { diagnose: () => Promise.resolve([]) } as never,
      text,
      "Papers/Synthetic manuscript.md",
      "Synthetic manuscript",
      preferences,
      new AbortController().signal,
    );
    assert.match(
      result.aastex.abstractHtml,
      /Literal asset-0\.png and `asset-0\.png` remain unchanged\./,
    );
    assert.equal((result.html.match(/src="asset-0.png"/g) ?? []).length, 2);
    assert.equal(result.assets.length, abstractImages ? 2 : 1);
    assert.equal(result.assets[0].name, "asset-0.png");
    assert.equal(new Uint8Array(result.assets[0].bytes)[0], 1);
    if (abstractImages) {
      assert.equal(
        (result.aastex.abstractHtml.match(/src="asset-1.png"/g) ?? []).length,
        2,
      );
      assert.equal(result.assets[1].name, "asset-1.png");
      assert.equal(new Uint8Array(result.assets[1].bytes)[0], 2);
    }
  }
});

test("rendering preserves safe table alignment while stripping CSS and event attributes", async () => {
  const { renderPublication } = loadRuntime<typeof import("../publish-render")>(
    "publish-render.ts",
    {
      Component: class {
        load() {}
        unload() {}
      },
      TFile: class {},
      MarkdownRenderer: {
        render: (_app: unknown, _markdown: string, root: Element) => {
          const table = new Element("table");
          const row = new Element("tr");
          table.append(row);
          root.append(table);
          for (const alignment of ["left", "center", "right", "justify"]) {
            const cell = new Element("td");
            cell.style.textAlign = alignment;
            cell.setAttribute(
              "style",
              `text-align:${alignment};background:url(https://invalid.example)`,
            );
            cell.setAttribute("onclick", "unsafe()");
            cell.append(alignment);
            row.append(cell);
          }
          return Promise.resolve();
        },
      },
    },
    { createDiv: () => new Element() },
    "browser",
    { "./publish-document": publishDocument, "./publish-math": publishMath },
  );
  const { html } = await renderPublication(
    {} as never,
    "Synthetic table",
    "Example.md",
    "Example",
    undefined,
    new AbortController().signal,
  );
  for (const alignment of ["left", "center", "right"])
    assert.match(
      html,
      new RegExp(`<td align="${alignment}">${alignment}</td>`),
    );
  assert.match(html, /<td>justify<\/td>/);
  assert.doesNotMatch(html, /style=|onclick=|invalid\.example/);
});

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
  // A repeated title is a warning: publishing keeps the body heading.
  const repeated = await renderPublication(
    {} as never,
    '---\n{"title":"Synthetic title"}\n---\n\n# Synthetic title',
    "Example.md",
    "Example",
    undefined,
    new AbortController().signal,
    preferences,
  );
  assert.match(repeated.html, /stratum-publish-title/);
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

test("template mappings publish renamed fields, exclude private metadata, and permit optional titles", async () => {
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
          root.append("<h2>Introduction</h2><p>Synthetic body.</p>");
          return Promise.resolve();
        },
      },
    },
    { createDiv: () => new Element() },
    "browser",
    { "./publish-document": publishDocument, "./publish-math": publishMath },
  );
  const { readNotePreferences } = await import("../publish-options");
  const { readPublishingProperties } = await import("../publish-properties");
  const preferences = readNotePreferences({
    documentType: "general",
    docx: { titleSource: "properties" },
  });
  const fields = readPublishingProperties([
    { key: "paper_title", use: "title", required: false },
    { key: "writers", use: "authors", type: "list" },
    { key: "secret", use: "metadata" },
  ]);
  const source =
    '---\n{"paper_title":"Mapped title","title":"Unmapped title","writers":["Synthetic author"],"secret":"Private metadata"}\n---\n\n## Introduction';
  const result = await renderPublication(
    {} as never,
    source,
    "Example.md",
    "Example",
    undefined,
    new AbortController().signal,
    preferences,
    fields,
  );
  assert.match(result.html, /Mapped title/);
  assert.match(result.html, /Synthetic author/);
  assert.doesNotMatch(result.html, /Unmapped title|Private metadata/);
  preferences.docx.titleSource = "body";
  const noTitle = await renderPublication(
    {} as never,
    '---\n{"writers":["Synthetic author"]}\n---\n## Introduction',
    "Example.md",
    "Example",
    undefined,
    new AbortController().signal,
    preferences,
    fields,
  );
  assert.match(noTitle.html, /Synthetic author/);
  assert.doesNotMatch(noTitle.html, /stratum-publish-title/);
});

test("abstract display choices change export output without changing source text", async () => {
  const { renderPublication } = loadRuntime<typeof import("../publish-render")>(
    "publish-render.ts",
    {
      Component: class {
        load() {}
        unload() {}
      },
      TFile: class {},
      MarkdownRenderer: {
        render: (_app: unknown, _markdown: string, root: Element) => {
          root.append(
            "<h1>Abstract</h1><p>Synthetic summary.</p><h1>Introduction</h1><p>Retained body.</p>",
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
  const { publicationProperties } = await import("../publish-properties");
  const preferences = readNotePreferences({ documentType: "general" });
  const source =
    "# Abstract\n\nSynthetic summary.\n\n# Introduction\n\nRetained body.";
  const render = () =>
    renderPublication(
      {} as never,
      source,
      "Example.md",
      "Example",
      undefined,
      new AbortController().signal,
      preferences,
      publicationProperties(preferences.docx),
    );
  assert.match((await render()).html, /stratum-publish-abstract/);
  preferences.docx.showAbstract = false;
  const hidden = await render();
  assert.doesNotMatch(hidden.html, /Abstract|Synthetic summary/);
  assert.match(hidden.html, /Introduction|Retained body/);
  assert.match(source, /Synthetic summary/);
});

test("documents without published properties ignore unreadable YAML", async () => {
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
          root.append("<p>Synthetic body.</p>");
          return Promise.resolve();
        },
      },
    },
    { createDiv: () => new Element() },
    "browser",
    { "./publish-document": publishDocument, "./publish-math": publishMath },
  );
  const { readNotePreferences } = await import("../publish-options");
  const preferences = readNotePreferences({ documentType: "general" });
  const result = await renderPublication(
    {} as never,
    "---\n{unreadable\n---\n\nSynthetic body.",
    "Example.md",
    "Example",
    undefined,
    new AbortController().signal,
    preferences,
    [],
  );
  assert.match(result.html, /Synthetic body/);
});

test("repeated titles keep the body heading and keywords follow the abstract", async () => {
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
      { "./publish-document": publishDocument, "./publish-math": publishMath },
    ).renderPublication;
  const { readNotePreferences, DEFAULT_ACADEMIC_OPTIONS } =
    await import("../publish-options");
  const { publicationProperties } = await import("../publish-properties");
  const preferences = readNotePreferences({ documentType: "academic" });
  const definitions = publicationProperties(DEFAULT_ACADEMIC_OPTIONS);
  assert.ok(definitions.some((field) => field.key === "keywords"));
  const render = (html: string, properties: object) =>
    renderer(html)(
      {} as never,
      `---\n${JSON.stringify(properties)}\n---\n\nSynthetic source.`,
      "Example.md",
      "Example",
      undefined,
      new AbortController().signal,
      preferences,
      definitions,
    );
  const repeated = await render(
    "<h1>Synthetic title</h1><h2>Abstract</h2><p>Synthetic summary.</p><h2>Introduction</h2><p>Body.</p>",
    { title: "Synthetic title", keywords: ["alpha", "beta"] },
  );
  assert.equal((repeated.html.match(/Synthetic title/g) ?? []).length, 2);
  assert.match(
    repeated.html,
    /stratum-publish-abstract">[\s\S]*?Synthetic summary\.<\/p><\/div><div class="stratum-publish-keywords"><p>Keywords: alpha, beta<\/p><\/div>/,
  );
  assert.ok(
    repeated.html.indexOf("Keywords:") < repeated.html.indexOf("Introduction"),
  );
  assert.doesNotMatch(repeated.html, /stratum-publish-keywords-->|<!--/);
  const withoutAbstract = await render("<h2>Introduction</h2><p>Body.</p>", {
    title: "Synthetic title",
    keywords: ["alpha"],
  });
  assert.match(
    withoutAbstract.html,
    /stratum-publish-title[\s\S]*?Keywords: alpha[\s\S]*?Introduction/,
  );
  const empty = await render("<h2>Introduction</h2><p>Body.</p>", {
    title: "Synthetic title",
    keywords: [],
  });
  assert.doesNotMatch(empty.html, /Keywords/);
});
