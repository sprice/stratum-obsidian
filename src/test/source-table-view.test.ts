import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { readSourceTableState } from "../source-table";
import type { SourceRow } from "../document-sources";

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  doc = { activeElement: null };
  isConnected = true;
  scrollTop = 0;
  scrollLeft = 0;
  textContent = "";
  value = "";
  focused = false;
  constructor(
    public tag = "div",
    public text = "",
  ) {}
  addClass() {}
  setAttr(key: string, value: string) {
    this.attrs[key] = value;
  }
  setText(text: string) {
    this.text = text;
  }
  empty() {
    this.children = [];
  }
  focus() {
    this.focused = true;
  }
  contains(element: Element): boolean {
    return (
      this === element || this.children.some((child) => child.contains(element))
    );
  }
  createEl(
    tag: string,
    options?: { text?: string; value?: string; attr?: Record<string, string> },
  ) {
    const element = new Element(tag, options?.text);
    element.value = options?.value ?? "";
    element.attrs = options?.attr ?? {};
    this.children.push(element);
    return element;
  }
  createDiv(options?: { text?: string }) {
    const element = new Element("div", options?.text);
    this.children.push(element);
    return element;
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  querySelectorAll() {
    return this.all().filter((element) => element.dataset.sourceAction);
  }
  trigger(event: string) {
    this.listeners.get(event)?.();
  }
}

test("native table preserves source navigation and diagnostics and sorts custom properties without writes", () => {
  const { SourcesPanel } = loadRuntime<typeof import("../view-sources")>(
    "view-sources.ts",
    {
      Component: class {
        register() {}
      },
      Modal: class {},
      SearchComponent: class {
        inputEl = new Element("input");
        setPlaceholder() {
          return this;
        }
        setValue() {
          return this;
        }
        onChange() {
          return this;
        }
      },
      setIcon() {},
    },
    { HTMLElement: Element },
  );
  const source = (id: string, title: string): SourceRow => ({
    id,
    keys: [],
    entry: {
      title,
      authors: ["Synthetic author"],
      year: "2026",
      file: { path: `${id}.md` },
    } as SourceRow["entry"],
    occurrences: [
      { kind: "link", excerpt: "A synthetic connection" },
    ] as SourceRow["occurrences"],
  });
  const first = source("A", "First synthetic source");
  const second = source("B", "Second synthetic source");
  const unresolved: SourceRow = {
    id: "unknown",
    keys: ["unknown2026"],
    issue: "unresolved",
    occurrences: [
      { kind: "citation", excerpt: "[@unknown2026]" },
    ] as SourceRow["occurrences"],
  };
  let opened = "",
    navigations = 0,
    saved = 0;
  const controller = {
    document: { basename: "Synthetic draft" },
    rows: [first, second, unresolved],
    subscribe: () => () => {},
    subscribeCitationChanges: () => () => {},
    citationStatus: () => Promise.resolve(null),
    properties: (row: SourceRow) =>
      row === first
        ? { sample_size: 100 }
        : { sample_size: 9, findings: "<img src=x onerror=example>" },
    openSource: (file: { path: string }) => {
      opened = file.path;
    },
    returnToDocument: () => {
      navigations++;
    },
  };
  const root = new Element();
  const state = {
    ...readSourceTableState({
      layout: "table",
      columns: ["sample_size", "findings"],
    }),
    query: "",
    sort: "appearance",
    scroll: 0,
    scrollLeft: 0,
    expanded: new Set<string>(),
  };
  const panel = new SourcesPanel(
    root as never,
    controller as never,
    state,
    {} as never,
    () => {
      saved++;
    },
  );
  panel.onload();
  assert.equal(
    root.all().filter((el) => el.tag === "tbody")[0].children.length,
    3,
  );
  const action = (id: string) =>
    root.all().find((el) => el.dataset.sourceAction === id)!;
  action("A:open").trigger("click");
  assert.equal(opened, "A.md");
  action("A:occurrence:0").trigger("click");
  assert.equal(navigations, 1);
  assert.ok(
    root.all().some((el) => el.text.includes("Citation key not found")),
  );
  assert.ok(
    root
      .all()
      .some(
        (el) => el.tag === "td" && el.text === "<img src=x onerror=example>",
      ),
  );
  action("sort:sample_size").trigger("click");
  assert.equal(state.columnSort, "sample_size");
  assert.equal(saved, 1);
  const sortMenu = root
    .all()
    .find((el) => el.attrs["aria-label"] === "Sort citations")!;
  assert.equal(sortMenu.value, "column");
  assert.equal(action("sort:sample_size").focused, true);
  const sorted = root.all().find((el) => el.tag === "tbody")!;
  assert.ok(
    sorted.children[0].all().some((el) => el.dataset.sourceAction === "B:open"),
  );
  action("sort:sample_size").trigger("click");
  assert.equal(state.descending, true);
  sortMenu.value = "appearance";
  sortMenu.trigger("change");
  assert.equal(state.columnSort, null);
  assert.ok(
    root
      .all()
      .find((el) => el.tag === "tbody")!
      .children[0].all()
      .some((el) => el.dataset.sourceAction === "A:open"),
  );
  const layout = root
    .all()
    .find((el) => el.attrs["aria-label"] === "Citations layout")!;
  layout.value = "list";
  layout.trigger("change");
  assert.equal(state.layout, "list");
  assert.ok(root.all().some((el) => el.tag === "li"));
  assert.equal(
    root.all().some((el) => el.tag === "table"),
    false,
  );
  panel.onunload();
  state.layout = "table";
  const firstContainer = new Element();
  const firstPanel = new SourcesPanel(
    firstContainer as never,
    controller as never,
    state,
    {} as never,
    () => {},
  );
  firstPanel.onload();
  const results = firstContainer
    .all()
    .find(
      (el) =>
        el.attrs["aria-label"] ===
        "Citation results; scroll to see additional columns",
    )!;
  results.scrollLeft = 420;
  results.trigger("scroll");
  firstPanel.onunload();
  const nextContainer = new Element();
  const nextPanel = new SourcesPanel(
    nextContainer as never,
    controller as never,
    state,
    {} as never,
    () => {},
  );
  nextPanel.onload();
  const restoredResults = nextContainer
    .all()
    .find(
      (el) =>
        el.attrs["aria-label"] ===
        "Citation results; scroll to see additional columns",
    )!;
  assert.equal(
    restoredResults.scrollLeft,
    420,
    "Rebuilding Sources must preserve the visible research columns",
  );
  nextPanel.onunload();
});
