import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import type * as Reading from "../citation-reading";

test("Reading postprocessing never formats rendered blocks inside Live Preview", () => {
  class Child {
    constructor(public containerEl: unknown) {}
    register() {}
  }
  const { registerCitationReading } = loadRuntime<typeof Reading>(
    "citation-reading.ts",
    {
      Component: class {},
      MarkdownRenderChild: Child,
      TFile: class {},
    },
    { document: { createElement: () => ({}) } },
    "browser",
  );
  let processor!: (el: unknown, ctx: unknown) => void;
  let formats = 0;
  registerCitationReading({
    plugin: {
      registerMarkdownPostProcessor(fn: typeof processor) {
        processor = fn;
      },
    },
    subscribe: () => () => {},
    format() {
      formats++;
      throw new Error("Must not format editor blocks");
    },
  } as never);
  const el = {
    closest: (selector: string) =>
      selector.includes(".cm-editor") ? {} : null,
    normalize() {},
    removeAttribute() {},
  };
  processor(el, {
    addChild(child: { onload(): void }) {
      child.onload();
    },
    getSectionInfo() {
      throw new Error("Must not read a publication context in the editor");
    },
  });
  assert.equal(formats, 0);
});

test("a detached block mounted in Live Preview during formatting receives no output", async () => {
  class File {}
  class Child {
    constructor(public containerEl: unknown) {}
    register() {}
  }
  const { registerCitationReading } = loadRuntime<typeof Reading>(
    "citation-reading.ts",
    {
      Component: class {},
      MarkdownRenderChild: Child,
      TFile: File,
    },
    { document: { createElement: () => ({}) } },
    "browser",
  );
  let processor!: (el: unknown, ctx: unknown) => void;
  let finish!: (value: unknown) => void;
  let inEditor = false;
  let restored = 0;
  registerCitationReading({
    plugin: {
      registerMarkdownPostProcessor(fn: typeof processor) {
        processor = fn;
      },
      app: { vault: { getAbstractFileByPath: () => new File() } },
    },
    subscribe: () => () => {},
    format: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  } as never);
  processor(
    {
      closest: (selector: string) =>
        inEditor && selector.includes(".cm-editor") ? {} : null,
      normalize() {
        restored++;
      },
      removeAttribute() {},
    },
    {
      sourcePath: "Papers/Test.md",
      addChild(child: { onload(): void }) {
        child.onload();
      },
      getSectionInfo: () => ({ text: "[@example]", lineStart: 0, lineEnd: 0 }),
    },
  );
  inEditor = true;
  finish(undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(restored, 1);
});

test("ordinary notes and removed citations restore native output without formatting", () => {
  class File {}
  class Child {
    constructor(public containerEl: unknown) {}
    register() {}
  }
  const { registerCitationReading } = loadRuntime<typeof Reading>(
    "citation-reading.ts",
    { Component: class {}, MarkdownRenderChild: Child, TFile: File },
    { document: { createElement: () => ({}) } },
    "browser",
  );
  let processor!: (el: unknown, ctx: unknown) => void;
  let restored = 0;
  let formats = 0;
  registerCitationReading({
    plugin: {
      registerMarkdownPostProcessor(fn: typeof processor) {
        processor = fn;
      },
      app: { vault: { getAbstractFileByPath: () => new File() } },
    },
    subscribe: () => () => {},
    format() {
      formats++;
      throw new Error("No citations to format");
    },
  } as never);
  for (const text of [
    "Contact person@example.test[^n].\n\n[^n]: Keep this note.",
    "No citations left.",
    "`[@example]`",
    "[[note|@example]]",
  ]) {
    processor(
      {
        closest: () => null,
        normalize() {
          restored++;
        },
        removeAttribute() {},
      },
      {
        sourcePath: "Papers/Test.md",
        addChild(child: { onload(): void }) {
          child.onload();
        },
        getSectionInfo: () => ({ text, lineStart: 0, lineEnd: 0 }),
      },
    );
  }
  assert.equal(formats, 0);
  assert.equal(restored, 4);
});
