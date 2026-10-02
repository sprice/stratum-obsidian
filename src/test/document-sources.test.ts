import test from "node:test";
import assert from "node:assert/strict";
import { parseSourceOccurrences } from "../source-occurrences";
import {
  collectDocumentSources,
  readBibliographyBindings,
} from "../document-sources";
import { shouldFollowSourceDocument } from "../sources-context";
import type { LiteratureNoteEntry } from "../library-search-modal";

function entry(
  key = "example2024",
  identity = "user/1/EXAMPLE1",
  path = "Sources/Example.md",
): LiteratureNoteEntry {
  return {
    file: { path } as LiteratureNoteEntry["file"],
    identity,
    citationKey: key,
    title: "Synthetic example study",
    displayTitle: "Synthetic example study",
    preferredLinkText: null,
    authors: ["Example Author"],
    year: "2024",
    doi: null,
    publication: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    referenceType: "article",
  };
}
const keys = (text: string) =>
  parseSourceOccurrences(text)
    .filter((o) => o.kind === "citation")
    .map((o) => o.target);

test("recognizes grouped, narrative, suppressed-author, braced and footnote citations", () => {
  assert.deepEqual(
    keys(
      "@example2024 argues this [see @other2023, pp. 12–14; -@third2022, ch. 2]. [@{with:punctuation/2020}]\n\n[^1]: See @footnote2021.\n    And @continuation2022.",
    ),
    [
      "example2024",
      "other2023",
      "third2022",
      "with:punctuation/2020",
      "footnote2021",
      "continuation2022",
    ],
  );
});

test("ignores frontmatter, comments, fenced and inline code, URLs and emails", () => {
  const text =
    '---\nkey: "@yaml"\n---\n<!-- @html --> %% @comment %%\n```md\n[@fence]\n```\n~~~\n@tilde\n~~~\n`@inline` ``x ` @nested``\n    @indented\nname@example.com https://example.test/@path <span data-x="@attribute">\n\\@escaped [@real]';
  assert.deepEqual(keys(text), ["real"]);
});

test("unclosed fences and comments do not expose citations", () => {
  assert.deepEqual(keys("[@visible]\n```\n[@hidden]"), ["visible"]);
  assert.deepEqual(keys("<!-- [@hidden]"), []);
});

test("preserves exact editor offsets after Unicode and CRLF", () => {
  const text = "😀 Example\r\nSome prose [@example2024, p. 5].";
  const [occurrence] = parseSourceOccurrences(text);
  assert.equal(text.slice(occurrence.from, occurrence.to), "@example2024");
  assert.match(occurrence.excerpt, /p\. 5/);
});

test("recognizes wiki, aliased, embedded, inline Markdown and reference links", () => {
  const text =
    '[[Example#Section|Label]] ![[Example]] [label](Sources/Example%20Study.md) [label](<Sources/Example (draft).md>) [reference][source]\n[source]: Sources/Example.md "Title"';
  assert.deepEqual(
    parseSourceOccurrences(text).map((o) => o.target),
    [
      "Example#Section",
      "Example",
      "Sources/Example%20Study.md",
      "Sources/Example (draft).md",
      "Sources/Example.md",
    ],
  );
});

test("link labels and destinations are not separately interpreted as citations", () => {
  assert.deepEqual(
    keys(
      "[[Example|@label]] [@label](https://example.test/@path) <person@example.test>",
    ),
    [],
  );
});

test("repeated keys and note links become one source with ordered occurrences", () => {
  const rows = collectDocumentSources(
    "[@example2024] [[Example]] [@example2024, p. 4]",
    [entry()],
    [],
    () => "Sources/Example.md",
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].keys, ["example2024"]);
  assert.deepEqual(
    rows[0].occurrences.map((o) => o.kind),
    ["citation", "link", "citation"],
  );
});

test("established keys continue resolving after metadata keys and note paths change", () => {
  const rows = collectDocumentSources(
    "[@oldKey] [@newKey] [[Renamed]]",
    [entry("newKey", "user/1/EXAMPLE1", "Sources/Renamed.md")],
    [{ key: "oldKey", identity: "user/1/EXAMPLE1" }],
    () => "Sources/Renamed.md",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry?.file.path, "Sources/Renamed.md");
  assert.deepEqual(rows[0].keys, ["oldKey", "newKey"]);
});

test("a linked note displays its established citation key", () => {
  const rows = collectDocumentSources(
    "[[Example]]",
    [entry("newKey")],
    [{ key: "oldKey", identity: "user/1/EXAMPLE1" }],
    () => "Sources/Example.md",
  );
  assert.deepEqual(rows[0].keys, ["oldKey"]);
});

test("identical supplied keys in different libraries are ambiguous", () => {
  const rows = collectDocumentSources(
    "[@example2024]",
    [entry(), entry("example2024", "group/2/EXAMPLE1", "Other.md")],
    [],
    () => null,
  );
  assert.equal(rows[0].issue, "ambiguous");
  assert.equal(rows[0].entry, undefined);
});

test("a historical key conflicting with a current key is not guessed", () => {
  const rows = collectDocumentSources(
    "[@example2024]",
    [entry()],
    [{ key: "example2024", identity: "group/2/EXAMPLE1" }],
    () => null,
  );
  assert.equal(rows[0].issue, "ambiguous");
});

test("missing notes and unknown keys have different states", () => {
  const rows = collectDocumentSources(
    "[@missingNote] [@unknown]",
    [],
    [{ key: "missingNote", identity: "user/1/EXAMPLE1" }],
    () => null,
  );
  assert.deepEqual(
    rows.map((r) => r.issue),
    ["missing-note", "unresolved"],
  );
});

test("ordinary note links are excluded and note contents are not followed", () => {
  const rows = collectDocumentSources(
    "[[Ordinary]] [[Example]]",
    [entry()],
    [],
    (target) => (target === "Example" ? "Sources/Example.md" : "Ordinary.md"),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurrences.length, 1);
});

test("duplicate literature notes for an identity require review for key navigation", () => {
  const rows = collectDocumentSources(
    "[@example2024]",
    [entry(), entry("example2024", "user/1/EXAMPLE1", "Duplicate.md")],
    [],
    () => null,
  );
  assert.equal(rows[0].issue, "ambiguous");
  assert.equal(rows[0].entry, undefined);
});

test("bibliography ownership is accepted only with a valid identity and matching body key", () => {
  const block = (identity: string, key: string, bodyKey: string) =>
    `% stratum:begin ${encodeURIComponent(identity)} ${encodeURIComponent(key)} baseline\n@article{${bodyKey},\n title={Example}\n}\n% stratum:end\n`;
  const text =
    block("user/1/EXAMPLE1", "oldKey", "oldKey") +
    block("user/1/EXAMPLE2", "badKey", "different") +
    block("not-an-identity", "ignored", "ignored");
  assert.deepEqual(readBibliographyBindings(text), [
    { key: "oldKey", identity: "user/1/EXAMPLE1" },
  ]);
});

test("document following respects pinning and literature-note inspection", () => {
  assert.equal(
    shouldFollowSourceDocument({
      pinned: false,
      isLiteratureNote: false,
      isMarkdown: true,
    }),
    true,
  );
  assert.equal(
    shouldFollowSourceDocument({
      pinned: true,
      isLiteratureNote: false,
      isMarkdown: true,
    }),
    false,
  );
  assert.equal(
    shouldFollowSourceDocument({
      pinned: false,
      isLiteratureNote: true,
      isMarkdown: true,
    }),
    false,
  );
  assert.equal(
    shouldFollowSourceDocument({
      pinned: false,
      isLiteratureNote: false,
      isMarkdown: false,
    }),
    false,
  );
});

test("duplicate unmarked bibliography definitions cannot silently resolve to a note", () => {
  const bindings = readBibliographyBindings(
    "@article{example2024, title={One}}\n@book{example2024, title={Two}}",
  );
  const rows = collectDocumentSources(
    "[@example2024]",
    [entry()],
    bindings,
    () => null,
  );
  assert.equal(rows[0].issue, "ambiguous");
  assert.equal(rows[0].entry, undefined);
});

test("HTML code blocks are excluded", () => {
  assert.deepEqual(keys("<pre>[@hidden]</pre> <code>@hidden</code> [@shown]"), [
    "shown",
  ]);
});

test("masking leading inline code does not turn trailing prose into indented code", () => {
  assert.deepEqual(keys("`example code` [@shown]"), ["shown"]);
});

test("citations in list continuations are prose but nested code is excluded", () => {
  assert.deepEqual(
    keys(
      "- Claim\n    continued [@one]\n    - Nested [@two]\n\n          @code\n\nOutside [@three]",
    ),
    ["one", "two", "three"],
  );
  assert.deepEqual(keys("[^1]: [@one]\n    Continued [@two]\n        @code"), [
    "one",
    "two",
  ]);
  assert.deepEqual(keys(">     @code\n> Prose [@shown]"), ["shown"]);
});
