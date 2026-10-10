import assert from "node:assert/strict";
import test from "node:test";
import {
  changePublicationAuthors,
  publicationAuthors,
  publicationYaml,
  type AuthorOperation,
} from "../publication-metadata";

function edit(text: string, operation: AuthorOperation) {
  const change = changePublicationAuthors(text, operation);
  const next =
    text.slice(0, change.from) + change.insert + text.slice(change.to);
  publicationYaml(next);
  return next;
}
test("structured authors take precedence, empty lists stay empty, and invalid data is not discarded", () => {
  assert.equal(
    publicationAuthors({ authors: ["Legacy"] }).authors[0].name,
    "Legacy",
  );
  assert.deepEqual(
    publicationAuthors({
      authors: ["Legacy"],
      stratum_publish: { authors: [] },
    }).authors,
    [],
  );
  assert.throws(
    () => publicationAuthors({ stratum_publish: "existing user value" }),
    /must be an object/,
  );
  assert.throws(
    () => publicationAuthors({ stratum_publish: { authors: ["Name"] } }),
    /must be an object/,
  );
});
test("scalar edits preserve unrelated bytes, comments, unknown fields and CRLF", () => {
  const text =
    "---\r\npublication: '[[Example Journal]]' # journal\r\ntags: [a, b]\r\nstratum_publish:\r\n  authors:\r\n    - name: Alex # author\r\n      email: a@example.org\r\n      orcid: preserved\r\n      affiliations: [University]\r\n---\r\nMy untouched body.\r\n";
  assert.equal(
    edit(text, { type: "field", author: 0, key: "name", value: "Morgan" }),
    text.replace("name: Alex", "name: Morgan"),
  );
});
test("structural edits preserve unknown author fields and author comments", () => {
  let text =
    "---\nother: 'exact' # untouched\nstratum_publish:\n  authors:\n    - name: Alex # retain\n      email: a@example.org\n      orcid: known-later\n      affiliations:\n        - University\n  extra: unchanged\n---\nBody\n";
  text = edit(text, { type: "add" });
  text = edit(text, { type: "field", author: 1, key: "name", value: "Morgan" });
  text = edit(text, { type: "move", author: 1, direction: -1 });
  text = edit(text, { type: "add-affiliation", author: 1 });
  text = edit(text, {
    type: "affiliation",
    author: 1,
    index: 1,
    value: "Observatory",
  });
  const properties = publicationYaml(text).properties;
  assert.deepEqual(
    publicationAuthors(properties).authors.map((a) => a.name),
    ["Morgan", "Alex"],
  );
  assert.deepEqual(publicationAuthors(properties).authors[1].affiliations, [
    "University",
    "Observatory",
  ]);
  assert.match(text, /# retain/);
  assert.match(text, /orcid: known-later/);
  assert.match(text, /other: 'exact' # untouched/);
  assert.match(text, / {2}extra: unchanged\n---\nBody\n$/);
  text = edit(text, { type: "remove", author: 0 });
  assert.equal(
    publicationAuthors(publicationYaml(text).properties).authors.length,
    1,
  );
});
test("new namespace, missing authors and frontmatter-free notes are supported", () => {
  for (const source of [
    "Body\n",
    "---\npublication: Journal\n---\nBody\n",
    "---\nstratum_publish:\n  custom: keep\n---\nBody\n",
  ]) {
    const text = edit(source, { type: "add" });
    assert.equal(
      publicationAuthors(publicationYaml(text).properties).authors.length,
      1,
    );
    assert.ok(text.endsWith("Body\n"));
    if (source.includes("custom")) assert.match(text, /custom: keep/);
  }
});
test("import keeps old names and never assigns global affiliations", () => {
  const text = edit(
    "---\nauthors: [Alex, Morgan]\naffiliations: [University]\n---\nBody",
    { type: "import" },
  );
  const props = publicationYaml(text).properties;
  assert.deepEqual(
    publicationAuthors(props).authors.map((a) => a.name),
    ["Alex", "Morgan"],
  );
  assert.deepEqual(
    publicationAuthors(props).authors.map((a) => a.affiliations),
    [[], []],
  );
  assert.deepEqual(props.authors, ["Alex", "Morgan"]);
  assert.throws(() => edit(text, { type: "import" }), /already exist/);
});
test("duplicate YAML and anchored authors are preserved and rejected for visual editing", () => {
  assert.throws(
    () => edit("---\ntitle: one\ntitle: two\n---\nBody", { type: "add" }),
    /invalid YAML/,
  );
  const text =
    "---\nstratum_publish:\n  authors: &authors\n    - name: Alex\n---\nBody";
  assert.throws(() => edit(text, { type: "add" }), /anchored/);
  assert.throws(
    () => edit("---\nstratum_publish: original\n---\nBody", { type: "add" }),
    /must be an object/,
  );
});

test("empty frontmatter is extended without duplicating delimiters; multiline fields remain valid", () => {
  for (const source of ["---\n---\nBody", "---\r\n---\r\nBody"]) {
    const next = edit(source, { type: "add" });
    assert.equal(next.split("---").length, 3);
    assert.equal(
      publicationAuthors(publicationYaml(next).properties).authors.length,
      1,
    );
    assert.ok(next.endsWith("Body"));
  }
  const source =
    "---\nstratum_publish:\n  authors:\n    - name: Alex # keep\n      email: alex@example.org\n---\nBody";
  const next = edit(source, {
    type: "field",
    author: 0,
    key: "name",
    value: "Alex\nExample",
  });
  assert.equal(
    publicationAuthors(publicationYaml(next).properties).authors[0].name,
    "Alex\nExample",
  );
  assert.ok(next.includes("# keep"));
});

test("unclosed frontmatter is rejected and a leading BOM is retained", () => {
  assert.throws(
    () => edit("---\ntitle: unfinished\nBody", { type: "add" }),
    /not closed/,
  );
  const next = edit("\uFEFFBody", { type: "add" });
  assert.ok(next.startsWith("\uFEFF---\n"));
  assert.ok(next.endsWith("Body"));
});
