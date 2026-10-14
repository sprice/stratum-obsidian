import assert from "node:assert/strict";
import test from "node:test";
import {
  changePublicationAuthors,
  changePublicationProperty,
  publicationAuthors,
  publicationYaml,
  type AuthorOperation,
  type PublicationPropertyOperation,
} from "../publication-metadata";

function edit(text: string, operation: AuthorOperation) {
  const change = changePublicationAuthors(text, operation);
  const next =
    text.slice(0, change.from) + change.insert + text.slice(change.to);
  publicationYaml(next);
  return next;
}
function setProperty(text: string, operation: PublicationPropertyOperation) {
  const change = changePublicationProperty(text, operation);
  const next =
    text.slice(0, change.from) + change.insert + text.slice(change.to);
  publicationYaml(next);
  return next;
}
const note = (newline: string, ...lines: string[]) =>
  ["---", ...lines, "---", "Body", ""].join(newline);
const bareLineFeed = /(?<!\r)\n/;
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

test("flow scalar edits preserve punctuation as part of the name", () => {
  const source =
    "---\nstratum_publish: {authors: [{name: Alex, email: a@example.org, affiliations: [University]}], extra: keep}\n---\nBody";
  for (const value of ["Alex, Example", "Alex } Example", "Alex [Example]"]) {
    const next = edit(source, { type: "field", author: 0, key: "name", value });
    assert.equal(
      publicationAuthors(publicationYaml(next).properties).authors[0].name,
      value,
    );
    assert.equal(
      next,
      source.replace("name: Alex", `name: ${JSON.stringify(value)}`),
    );
  }
});

test("block scalar field edits retain adjacent properties, comments and body", () => {
  for (const marker of ["|", ">", "|-", ">-"]) {
    const source = `---\r\nother: 'exact' # untouched\r\nstratum_publish:\r\n  authors:\r\n    - name: ${marker} # author comment\r\n        Alex\r\n        Example\r\n      email: a@example.org\r\n      orcid: keep\r\n      affiliations: [University]\r\n---\r\nBody`;
    const next = edit(source, {
      type: "field",
      author: 0,
      key: "name",
      value: "Morgan",
    });
    const properties = publicationYaml(next).properties;
    const author = publicationAuthors(properties).authors[0];
    assert.equal(author.name, "Morgan");
    assert.equal(author.email, "a@example.org");
    assert.deepEqual(author.affiliations, ["University"]);
    assert.match(next, /# author comment/);
    assert.match(next, /orcid: keep/);
    assert.ok(next.startsWith("---\r\nother: 'exact' # untouched\r\n"));
    assert.ok(next.endsWith("---\r\nBody"));
  }
});

test("adding authors extends a root flow mapping without rewriting existing properties", () => {
  for (const mapping of [
    "{title: Test, tags: [keep]}",
    "{title: Test, tags: [keep],}",
    "{title: Test, tags: [keep], # inside\r\n}",
    "{}",
  ]) {
    const source = `\uFEFF---\r\n${mapping} # keep\r\n---\r\nBody`;
    const next = edit(source, { type: "add" });
    const properties = publicationYaml(next).properties;
    assert.equal(publicationAuthors(properties).authors.length, 1);
    if (mapping !== "{}") {
      assert.equal(properties.title, "Test");
      assert.deepEqual(properties.tags, ["keep"]);
      assert.ok(next.includes("{title: Test, tags: [keep],"));
    }
    if (mapping.includes("# inside")) assert.ok(next.includes("# inside\r\n"));
    assert.ok(next.startsWith("\uFEFF---\r\n{"));
    assert.ok(next.endsWith("} # keep\r\n---\r\nBody"));
  }
});

test("author edits reject an anchored namespace without changing unrelated aliases", () => {
  const text =
    "---\nstratum_publish: &publication\n  authors:\n    - name: Original\n      email: original@example.org\n      affiliations: [Institute]\nrelated: *publication\n---\nBody";
  for (const operation of [
    { type: "field", author: 0, key: "name", value: "Changed" },
    { type: "add" },
  ] as AuthorOperation[])
    assert.throws(() => edit(text, operation), /anchored/);
});

test("filling an empty property value writes valid YAML on the key line", () => {
  for (const [line, expected] of [
    ["title:", "title: My Paper"],
    ["title: ", "title: My Paper"],
    ["title: !!str", "title: !!str My Paper"],
    ["title: !!str # note", "title: !!str My Paper # note"],
    ["title:   # note", "title:   My Paper # note"],
  ]) {
    const next = setProperty(note("\n", line, "other: x"), {
      key: "title",
      value: "My Paper",
    });
    assert.equal(next, note("\n", expected, "other: x"));
    assert.equal(publicationYaml(next).properties.title, "My Paper");
  }
  const dated = setProperty(note("\n", "date:"), {
    key: "date",
    value: "2026-10-13",
  });
  assert.equal(dated, note("\n", "date: 2026-10-13"));
  assert.equal(publicationYaml(dated).properties.date, "2026-10-13");
  assert.equal(
    setProperty(note("\r\n", "keywords:", "other: x"), {
      key: "keywords",
      value: ["a", "b"],
    }),
    note("\r\n", "keywords:", "  - a", "  - b", "other: x"),
  );
});

test("repeated block list edits keep the list's column and add no blank lines", () => {
  for (const newline of ["\n", "\r\n"])
    for (const indent of ["", "  "]) {
      let text = note(
        newline,
        "keywords:",
        `${indent}- a`,
        `${indent}- b`,
        "other: x",
      );
      for (const value of [["k1"], ["k1", "k2"], ["k2"]])
        text = setProperty(text, { key: "keywords", value });
      assert.equal(
        text,
        note(newline, "keywords:", `${indent}- k2`, "other: x"),
      );
      assert.doesNotMatch(text, /\n[ \t]*\r?\n/);
      if (newline === "\r\n") assert.doesNotMatch(text, bareLineFeed);
    }
});

test("property values switch between scalar, block list and empty list in place", () => {
  for (const newline of ["\n", "\r\n"]) {
    const set = (lines: string[], value: string | string[]) => {
      const next = setProperty(note(newline, ...lines, "other: x"), {
        key: "keywords",
        value,
      });
      if (newline === "\r\n") assert.doesNotMatch(next, bareLineFeed);
      return next;
    };
    const expect = (...lines: string[]) => note(newline, ...lines, "other: x");
    assert.equal(
      set(["keywords: one  "], ["a", "b"]),
      expect("keywords:", "  - a", "  - b"),
    );
    assert.equal(
      set(["keywords: one # note"], ["a"]),
      expect("keywords: # note", "  - a"),
    );
    assert.equal(
      set(["keywords: [one, two] # note"], ["a"]),
      expect("keywords: [ a ] # note"),
    );
    assert.equal(
      set(["keywords: |- # note", "  one"], ["a"]),
      expect("keywords: # note", "  - a"),
    );
    assert.equal(
      set(["keywords: |", "  one"], ["a"]),
      expect("keywords:", "  - a"),
    );
    assert.equal(
      set(["keywords: >-", "  one"], "two"),
      expect("keywords: two"),
    );
    assert.equal(set(["keywords:", "- a"], "solo"), expect("keywords: solo"));
    assert.equal(
      set(["keywords:", "  - a", "  - b"], "solo"),
      expect("keywords: solo"),
    );
    assert.equal(set(["keywords:", "- a"], []), expect("keywords: []"));
    assert.equal(set(["keywords:", "  - a"], []), expect("keywords: []"));
    assert.equal(set(["keywords: one"], []), expect("keywords: []"));
    assert.equal(set(["keywords:"], []), expect("keywords: []"));
  }
});

test("a scalar or empty list replacing a tagged collection drops the tag and keeps comments", () => {
  for (const newline of ["\n", "\r\n"]) {
    const set = (lines: string[], value: string | string[]) => {
      const next = setProperty(note(newline, ...lines, "other: x"), {
        key: "keywords",
        value,
      });
      assert.deepEqual(publicationYaml(next).properties.keywords, value);
      if (newline === "\r\n") assert.doesNotMatch(next, bareLineFeed);
      return next;
    };
    const expect = (...lines: string[]) => note(newline, ...lines, "other: x");
    for (const tag of ["!!seq", "!custom"])
      assert.equal(
        set([`keywords: ${tag}`, "  - a"], "solo"),
        expect("keywords: solo"),
      );
    assert.equal(
      set(["keywords: !!map", "  a: 1"], "solo"),
      expect("keywords: solo"),
    );
    assert.equal(set(["keywords: !!seq", "  - a"], []), expect("keywords: []"));
    assert.equal(
      set(["keywords: !!seq # note", "  # more", "  - a"], "solo"),
      expect("keywords: solo # note", "  # more"),
    );
    assert.equal(
      set(["keywords: # note", "  !!seq", "  - a"], []),
      expect("keywords: [] # note"),
    );
  }
});

test("keywords: # note keeps its comment through list edits", () => {
  let text = note("\n", "keywords: # note", "other: x");
  text = setProperty(text, { key: "keywords", value: ["a", "b"] });
  assert.equal(
    text,
    note("\n", "keywords: # note", "  - a", "  - b", "other: x"),
  );
  text = setProperty(text, { key: "keywords", value: ["c"] });
  assert.equal(text, note("\n", "keywords: # note", "  - c", "other: x"));
  text = setProperty(text, { key: "keywords", value: [] });
  assert.equal(text, note("\n", "keywords: [] # note", "other: x"));
  text = setProperty(text, { key: "keywords", value: ["d"] });
  assert.equal(text, note("\n", "keywords: # note", "  - d", "other: x"));
});

test("author add, remove and move keep CRLF line endings", () => {
  let text = note(
    "\r\n",
    "title: Paper # keep",
    "stratum_publish:",
    "  authors:",
    "    - name: Alex # author",
    "      email: alex@example.org",
    "      affiliations:",
    "        - University",
    "other: x",
  );
  text = edit(text, { type: "add" });
  text = edit(text, { type: "field", author: 1, key: "name", value: "Morgan" });
  text = edit(text, { type: "move", author: 1, direction: -1 });
  assert.doesNotMatch(text, bareLineFeed);
  assert.deepEqual(
    publicationAuthors(publicationYaml(text).properties).authors.map(
      (author) => author.name,
    ),
    ["Morgan", "Alex"],
  );
  text = edit(text, { type: "remove", author: 0 });
  assert.doesNotMatch(text, bareLineFeed);
  assert.deepEqual(
    publicationAuthors(publicationYaml(text).properties).authors,
    [{ name: "Alex", email: "alex@example.org", affiliations: ["University"] }],
  );
  assert.ok(text.startsWith("---\r\ntitle: Paper # keep\r\n"));
  assert.match(text, /# author/);
  assert.ok(text.endsWith("other: x\r\n---\r\nBody\r\n"));
});

test("filling a tagged empty author name preserves spacing and comments", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const suffix of ["", " # author"]) {
      const source = note(
        newline,
        "stratum_publish:",
        "  authors:",
        `    - name: !!str${suffix}`,
        "      email: synthetic@example.org",
      );
      const next = edit(source, {
        type: "field",
        author: 0,
        key: "name",
        value: "Synthetic Author",
      });
      assert.equal(
        next,
        source.replace(
          `name: !!str${suffix}`,
          `name: !!str Synthetic Author${suffix}`,
        ),
      );
      assert.equal(
        publicationAuthors(publicationYaml(next).properties).authors[0].name,
        "Synthetic Author",
      );
    }
  }
});

test("journal institution edits retain comments, CRLF, affiliation assignments and unrelated author fields", () => {
  const original = note(
    "\r\n",
    "stratum_publish:",
    "  authors:",
    "    - name: Example",
    "      institution: Old # Preserve this comment",
    "      city: {custom: retained}",
    "      affiliations: [First, Second]",
    "unrelated: unchanged",
  );
  const updated = edit(original, {
    type: "field",
    author: 0,
    key: "institution",
    value: "New Institute",
  });
  assert.ok(updated.includes("# Preserve this comment"));
  assert.ok(updated.includes("city: {custom: retained}"));
  assert.ok(updated.includes("affiliations: [First, Second]"));
  assert.doesNotMatch(updated, bareLineFeed);
  assert.equal(
    publicationAuthors(publicationYaml(updated).properties).authors[0]
      .institution,
    "New Institute",
  );
});
