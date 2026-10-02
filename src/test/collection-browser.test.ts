import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionPath,
  collectionScope,
  readCollectionCatalogs,
  type CollectionCatalogs,
} from "../collection-catalog";
import {
  buildCollectionChoices,
  collectionChoiceId,
  DEFAULT_BROWSER_STATE,
  filterCollectionPapers,
  readBrowserState,
  readCollectionKeys,
  type CollectionPaper,
} from "../collection-browser-model";

const collections = [
  {
    key: "ROOT",
    name: "Culture",
    parentCollectionKey: null,
    displayName: "Culture",
  },
  {
    key: "CHILD",
    name: "Papers",
    parentCollectionKey: "ROOT",
    displayName: "Culture / Papers",
  },
  {
    key: "LEAF",
    name: "Nested",
    parentCollectionKey: "CHILD",
    displayName: "Nested",
  },
  {
    key: "OTHER",
    name: "Papers",
    parentCollectionKey: null,
    displayName: "Papers",
  },
];
const catalogs: CollectionCatalogs = {
  "user:1": { libraryName: "My Library", updatedAt: 1, collections },
  "group:2": { libraryName: "Research group", updatedAt: 1, collections },
};
function paper(
  identity: string,
  keys: string[] | null,
  title = identity,
): CollectionPaper {
  const [type, id] = identity.split("/");
  return {
    path: `${identity}.md`,
    identity,
    libraryIdentity: `${type}:${id}`,
    libraryName: id === "1" ? "My Library" : "Research group",
    title,
    authors: ["A Researcher"],
    year: "2024",
    keys,
    collectionNames: [],
  };
}
const papers = [
  paper("user/1/A", ["ROOT", "CHILD"]),
  paper("user/1/B", ["LEAF"]),
  paper("user/1/C", ["OTHER"]),
  paper("group/2/A", ["CHILD"]),
  paper("user/1/D", []),
  paper("user/1/E", null),
];
const choices = buildCollectionChoices(papers, catalogs);
function filter(id: string, descendants = true, query = "") {
  return filterCollectionPapers(
    papers,
    choices.find((c) => c.id === id),
    catalogs,
    {
      ...DEFAULT_BROWSER_STATE,
      collection: id,
      includeSubcollections: descendants,
      query,
    },
  ).map((p) => p.identity);
}

test("collection membership uses library-qualified keys and includes descendants once", () => {
  assert.deepEqual(filter(collectionChoiceId("user:1", "ROOT")), [
    "user/1/A",
    "user/1/B",
  ]);
  assert.deepEqual(filter(collectionChoiceId("user:1", "ROOT"), false), [
    "user/1/A",
  ]);
  assert.deepEqual(filter(collectionChoiceId("group:2", "CHILD")), [
    "group/2/A",
  ]);
  assert.deepEqual(filter(collectionChoiceId("user:1", "OTHER")), ["user/1/C"]);
});
test("unknown legacy membership is visible in all papers but never unfiled", () => {
  assert.equal(filter("all").length, 6);
  assert.deepEqual(filter("unfiled"), ["user/1/D"]);
  for (const value of [undefined, null, "ROOT", ["ROOT", 1], [""]])
    assert.equal(readCollectionKeys(value), null);
  assert.deepEqual(readCollectionKeys([]), []);
  assert.deepEqual(readCollectionKeys(["ROOT", "ROOT"]), ["ROOT"]);
});
test("same-named collections are distinct and nested paths are searchable", () => {
  const sameNames = choices.filter((c) => c.name === "Papers");
  assert.equal(sameNames.length, 4);
  assert.equal(new Set(sameNames.map((c) => c.id)).size, 4);
  assert.ok(
    sameNames.some((c) => c.context === "My Library › Culture › Papers"),
  );
});
test("search matches title author and year within the selected collection", () => {
  assert.deepEqual(
    filter(
      collectionChoiceId("user:1", "ROOT"),
      true,
      "researcher 2024 user/1/B",
    ),
    ["user/1/B"],
  );
  assert.deepEqual(
    filter(collectionChoiceId("user:1", "ROOT"), true, "missing"),
    [],
  );
  assert.deepEqual(filter("missing-selection"), []);
});
test("renaming a collection keeps the same selection identity", () => {
  const renamed = {
    ...catalogs,
    "user:1": {
      ...catalogs["user:1"],
      collections: collections.map((c) =>
        c.key === "ROOT" ? { ...c, name: "Society" } : c,
      ),
    },
  };
  const id = collectionChoiceId("user:1", "ROOT");
  const choice = buildCollectionChoices(papers, renamed).find(
    (c) => c.id === id,
  );
  assert.equal(choice?.name, "Society");
  assert.equal(
    filterCollectionPapers(papers, choice, renamed, DEFAULT_BROWSER_STATE)
      .length,
    2,
  );
});
test("missing catalogs retain direct membership without guessing hierarchy", () => {
  const fallback = buildCollectionChoices(papers, {});
  const choice = fallback.find(
    (c) => c.id === collectionChoiceId("user:1", "CHILD"),
  );
  assert.ok(choice?.context.includes("hierarchy unavailable"));
  assert.deepEqual(
    filterCollectionPapers(papers, choice, {}, DEFAULT_BROWSER_STATE).map(
      (p) => p.identity,
    ),
    ["user/1/A"],
  );
});
test("hierarchy traversal handles cycles and missing parents", () => {
  const cycle = [
    { ...collections[0], parentCollectionKey: "CHILD" },
    collections[1],
  ];
  assert.deepEqual(
    [...collectionScope(cycle, "ROOT", true)],
    ["ROOT", "CHILD"],
  );
  assert.equal(collectionPath(cycle, "ROOT"), "Papers › Culture");
  assert.equal(
    collectionPath(
      [{ ...collections[1], parentCollectionKey: "MISSING" }],
      "CHILD",
    ),
    "MISSING › Papers",
  );
});
test("persisted state and offline catalogs validate data without losing stable identity", () => {
  assert.deepEqual(
    readBrowserState({
      collection: "unfiled",
      query: "abc",
      includeSubcollections: false,
      scrollTop: 90,
      visibleCount: 100,
    }),
    {
      collection: "unfiled",
      query: "abc",
      includeSubcollections: false,
      scrollTop: 90,
      visibleCount: 100,
    },
  );
  assert.deepEqual(
    readBrowserState({ scrollTop: NaN, query: 4 }),
    DEFAULT_BROWSER_STATE,
  );
  const restored = readCollectionCatalogs(JSON.parse(JSON.stringify(catalogs)));
  assert.equal(
    collectionPath(restored["user:1"].collections, "LEAF"),
    "Culture › Papers › Nested",
  );
  assert.deepEqual(
    readCollectionCatalogs({ garbage: {}, "user:1": { updatedAt: "bad" } }),
    {},
  );
});
