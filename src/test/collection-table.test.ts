import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCollectionChoices,
  filterCollectionPapers,
  readBrowserState,
  type CollectionPaper,
} from "../collection-browser-model";
import {
  collectionColumnValue,
  renderCollectionTable,
  sortCollectionTable,
} from "../collection-table";

function paper(index: number): CollectionPaper {
  return {
    path: `Synthetic ${index}.md`,
    identity: `user/1/K${index}`,
    libraryIdentity: "user:1",
    libraryName: "Synthetic library",
    title: `Synthetic ${index}`,
    authors: ["Synthetic author"],
    year: "2026",
    keys: index % 2 ? ["A"] : ["B"],
    collectionNames: [index % 2 ? "A" : "B"],
    properties: { sample_size: 150 - index },
  };
}

test("collection table sorts the full scoped search before pagination without changing library order", () => {
  const papers = Array.from({ length: 150 }, (_, index) => paper(index));
  const state = readBrowserState({
    layout: "table",
    columns: ["sample_size"],
    columnSort: "sample_size",
  });
  const all = buildCollectionChoices(papers, {})[0];
  const filtered = filterCollectionPapers(papers, all, {}, state);
  const sorted = sortCollectionTable(filtered, state);
  assert.equal(
    sorted.slice(0, state.visibleCount)[0].properties?.sample_size,
    1,
  );
  assert.equal(
    sorted.slice(0, state.visibleCount).at(-1)?.properties?.sample_size,
    100,
  );
  const choice = buildCollectionChoices(papers, {}).find(
    (choice) => choice.key === "A",
  );
  const scoped = sortCollectionTable(
    filterCollectionPapers(
      papers,
      choice,
      {},
      { ...state, query: "synthetic author" },
    ),
    state,
  );
  assert.equal(scoped.length, 75);
  assert.ok(scoped.every((paper) => paper.keys?.includes("A")));
  assert.equal(papers[0].properties?.sample_size, 150);
});

test("browser preferences restore independently and validate column sort without sharing mutable defaults", () => {
  const saved = readBrowserState({
    layout: "table",
    columns: ["findings", "year"],
    columnSort: "findings",
    descending: true,
    collection: "unfiled",
  });
  assert.deepEqual(readBrowserState(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(
    readBrowserState({ columns: ["year"], columnSort: "removed" }).columnSort,
    null,
  );
  saved.columns.push("method");
  assert.deepEqual(readBrowserState(undefined).columns, [
    "authors",
    "year",
    "reference_type",
  ]);
});

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  constructor(
    public tag = "div",
    public text = "",
  ) {}
  createEl(
    tag: string,
    options?: { text?: string; attr?: Record<string, string> },
  ) {
    const child = new Element(tag, options?.text);
    child.attrs = options?.attr ?? {};
    this.children.push(child);
    return child;
  }
  setAttr(key: string, value: string) {
    this.attrs[key] = value;
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

test("collection table displays safe custom values, missing cells, title navigation, and accessible sorting", () => {
  const first = paper(0),
    missing = paper(1);
  first.properties = {
    findings: "<img src=x onerror=example>",
    method: ["[[Notes/Method|Interviews]]"],
    sample_size: 0,
  };
  missing.properties = {};
  const state = readBrowserState({
    layout: "table",
    columns: ["findings", "sample_size"],
    columnSort: "sample_size",
    descending: true,
  });
  const root = new Element();
  let opened = "",
    sorted = "";
  renderCollectionTable(
    root as never,
    [first, missing],
    state,
    (cell, paper) => {
      const link = cell.createEl("a", { text: paper.title });
      link.addEventListener("click", () => {
        opened = paper.path;
      });
    },
    (key) => {
      sorted = key;
    },
  );
  assert.ok(
    root
      .all()
      .some(
        (el) => el.tag === "td" && el.text === "<img src=x onerror=example>",
      ),
  );
  assert.ok(root.all().some((el) => el.tag === "td" && el.text === "0"));
  assert.ok(root.all().some((el) => el.tag === "td" && el.text === "—"));
  root
    .all()
    .find((el) => el.tag === "a")!
    .listeners.get("click")!();
  assert.equal(opened, first.path);
  const heading = root
    .all()
    .find((el) => el.dataset.collectionSort === "sample_size")!;
  heading.listeners.get("click")!();
  assert.equal(sorted, "sample_size");
  assert.ok(
    root
      .all()
      .some((el) => el.tag === "th" && el.attrs["aria-sort"] === "descending"),
  );
  assert.equal(collectionColumnValue(first, "method"), "Interviews");
  assert.equal(collectionColumnValue(first, "toString"), "");
  assert.equal(sortCollectionTable([missing, first], state)[1], missing);
});
