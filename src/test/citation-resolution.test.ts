import assert from "node:assert/strict";
import test from "node:test";
import { citationResolver } from "../citation-resolution";
import type { LiteratureNoteEntry } from "../library-search-modal";
const note = (id = "user/1/A", path = "Papers/Synthetic.md") =>
  ({
    identity: id,
    citationKey: "example",
    file: { path },
  }) as LiteratureNoteEntry;
const reference = { id: "user/1/A", type: "book", title: "Synthetic source" };

test("known reference without a literature note still resolves for formatting", () => {
  const resolve = citationResolver(
    [],
    [{ key: "oldKey", identity: reference.id }],
    [reference],
  );
  const result = resolve("oldKey");
  assert.equal(result.problem, undefined);
  assert.equal(result.reference, reference);
  assert.equal(result.notes.length, 0);
});
test("duplicate notes for one identity are not conflicting citation ownership", () => {
  const result = citationResolver(
    [note(), note(undefined, "Papers/Copy.md")],
    [],
    [reference],
  )("example");
  assert.equal(result.problem, undefined);
  assert.equal(result.notes.length, 2);
  assert.equal(result.identity, reference.id);
});
test("different libraries and duplicate bibliography definitions block formatting", () => {
  assert.equal(
    citationResolver([note(), note("group/2/A")], [], [reference])("example")
      .problem,
    "conflicting-key",
  );
  assert.equal(
    citationResolver(
      [note()],
      [{ key: "example", identity: "ambiguous:example" }],
      [reference],
    )("example").problem,
    "conflicting-key",
  );
});
test("unknown keys differ from known sources with missing data", () => {
  const resolve = citationResolver([note()], []);
  assert.equal(resolve("absent").problem, "unknown-key");
  assert.equal(resolve("example").problem, "missing-data");
  assert.equal(resolve("example").identity, reference.id);
});
test("a historical key and a current key retain the same identity", () => {
  const resolve = citationResolver(
    [note()],
    [{ key: "historical", identity: reference.id }],
    [reference],
  );
  assert.equal(resolve("historical").reference, resolve("example").reference);
});
