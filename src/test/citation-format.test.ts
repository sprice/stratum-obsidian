import { citationFooter } from "../citation-footer";
import assert from "node:assert/strict";
import test from "node:test";
import assets from "../csl/assets.json";
import { formatCitationDocument } from "../citation-format";
import { citationDocument } from "../citation-document";
import { citationDisplayEdits } from "../citation-display";
import { type CslItem, readCslItem } from "../csl-data";
const references = new Map<string, CslItem>([
  [
    "smith2024",
    {
      id: "user/1/A",
      type: "book",
      title: "Example research",
      author: [{ family: "Smith", given: "Jane" }],
      issued: { "date-parts": [[2024]] },
      publisher: "Example Press",
    },
  ],
  [
    "jones2023",
    {
      id: "group/2/B",
      type: "article-journal",
      title: "A second example",
      author: [{ family: "Jones", given: "Pat" }],
      issued: { "date-parts": [[2023]] },
      "container-title": "Example Journal",
      volume: "2",
      page: "100-120",
    },
  ],
]);
const styles = assets as Record<string, string>;
const format = (text: string, style = "apa") =>
  formatCitationDocument(text, styles[style], "en-US", styles, references);
test("one manuscript formats as author-date, numeric, and notes without mutation", () => {
  const source =
    "A claim [@smith2024, p. 42]. Another [@jones2023]. Again [@smith2024].";
  assert.deepEqual(format(source).citations, [
    "(Smith, 2024, p. 42)",
    "(Jones, 2023)",
    "(Smith, 2024)",
  ]);
  assert.deepEqual(format(source, "ieee").citations, [
    "[1, p. 42]",
    "[2]",
    "[1]",
  ]);
  const notes = format(source, "chicago-notes-bibliography");
  assert.deepEqual(
    notes.model.citations.map((c) => c.noteIndex),
    [1, 2, 3],
  );
  assert.match(notes.citations[0], /Jane Smith/);
  assert.match(notes.citations[2], /^Smith,/);
  assert.equal(
    source,
    "A claim [@smith2024, p. 42]. Another [@jones2023]. Again [@smith2024].",
  );
  const edit = citationDisplayEdits(source, "Papers/Example.md", notes)[0];
  assert.match(edit.html, /^\.<sup>/);
  assert.equal(source.slice(edit.from, edit.to), " [@smith2024, p. 42].");
});
test("footnotes are processed at reference locations, not definition order", () => {
  const text =
    "First[^b]. Claim [@smith2024]. Last[^a]. Again[^b].\n\n[^a]: Second note [@jones2023].\n\n[^b]: First note [@smith2024, p. 2].";
  const model = citationDocument(text, true);
  assert.deepEqual(
    model.notes.map((n) => [n.identifier, n.number]),
    [
      ["b", 1],
      ["a", 3],
    ],
  );
  assert.deepEqual(
    model.citations.map((c) => c.noteIndex),
    [1, 2, 3],
  );
  assert.deepEqual(
    model.references.map((n) => n.number),
    [1, 3, 1],
  );
  assert.deepEqual(format(text, "ieee").citations, ["[1, p. 2]", "[1]", "[2]"]);
});
test("narrative numeric citations retain an author rather than a placeholder", () => {
  const output = format("@smith2024 [p. 42] argues this.", "ieee").citations[0];
  assert.match(output, /Smith/);
  assert.match(output, /\[1, p. 42\]/);
  assert.doesNotMatch(output, /NO_PRINTED_FORM/);
});
test("bibliography excludes links and code, and updates when citations are removed", () => {
  const source =
    "[[Example]] `[@jones2023]` <!-- [@jones2023] --> [@smith2024]";
  assert.equal(format(source).model.citations.length, 1);
  assert.doesNotMatch(format(source).bibliography, /Jones/);
  assert.equal(format("Nothing cited.").bibliography, "");
});
test("unknown keys and unsupported constructs fail visibly rather than omit references", () => {
  assert.throws(() => format("[@missing]"), /Missing citation data/);
  assert.throws(() => format("[@smith2024, [nested]]"), /Unsupported citation/);
});
test("CSL data validates identity and preserves roles and dates", () => {
  const item = {
    id: "remote",
    type: "chapter",
    title: "Example",
    editor: [{ literal: "Example Institute" }],
    issued: { "date-parts": [[2024, 3, 2]] },
    "container-title": "Collected examples",
  };
  assert.deepEqual(readCslItem(JSON.stringify([item]), "user/1/A"), {
    ...item,
    id: "user/1/A",
  });
  assert.equal(readCslItem([item, item], "user/1/A"), null);
  assert.equal(readCslItem({}, "user/1/A"), null);
});

test("historical keys for one identity produce one reference", () => {
  const refs = new Map(references);
  refs.set("oldSmith", references.get("smith2024")!);
  const result = formatCitationDocument(
    "[@smith2024] then [@oldSmith].",
    styles.ieee,
    "en-US",
    styles,
    refs,
  );
  assert.deepEqual(result.citations, ["[1]", "[1]"]);
  assert.equal((result.bibliography.match(/csl-entry/g) ?? []).length, 1);
});
test("note-style narrative citations retain their author in the text", () => {
  const source = "@smith2024 argues this.";
  const result = format(source, "chicago-notes-bibliography");
  assert.match(
    citationDisplayEdits(source, "Papers/Test.md", result)[0].html,
    /^Smith<sup>/,
  );
  assert.match(result.citations[0], /Example Research/);
});
test("bibliography markers inside code and comments are not active", () => {
  const source =
    '`<div id="refs"></div>`\n\n<!-- <div id="refs"></div> -->\n\n<div id="refs"></div>';
  assert.equal(citationDocument(source, false).bibliographies.length, 1);
  assert.equal(
    citationDocument(source, false).bibliographies[0].from,
    source.lastIndexOf("<div"),
  );
});
test("a reused processor updates disambiguation and removes deleted references", async () => {
  const { createCitationFormatter } = await import("../citation-format");
  const refs = new Map(references);
  refs.set("smithOther", {
    ...references.get("smith2024")!,
    id: "user/1/C",
    title: "Another example",
  });
  const render = createCitationFormatter(styles.apa, "en-US", styles, refs);
  const both = render("[@smith2024; @smithOther]");
  assert.match(both.citations[0], /2024[ab]/);
  const one = render("[@smith2024]");
  assert.deepEqual(one.citations, ["(Smith, 2024)"]);
  assert.doesNotMatch(one.bibliography, /Another example/);
  const edited = render("New prose [@smith2024]");
  assert.equal(edited.model.citations[0].from, 10);
  assert.equal(render("No citations").bibliography, "");
});

test("narrative names use conjunctions and the style's et-al threshold", () => {
  const refs = new Map(references);
  refs.set("team", {
    ...references.get("smith2024")!,
    id: "user/1/D",
    author: [{ family: "Smith" }, { family: "Jones" }],
  });
  assert.match(
    formatCitationDocument("@team", styles.apa, "en-US", styles, refs)
      .citations[0],
    /Smith and Jones/,
  );
  refs.set("team", {
    ...refs.get("team")!,
    author: [{ family: "Smith" }, { family: "Jones" }, { family: "Lee" }],
  });
  assert.match(
    formatCitationDocument("@team", styles.apa, "en-US", styles, refs)
      .citations[0],
    /Smith et al/,
  );
});
test("citations inside explanatory notes retain parentheses without duplicate punctuation", () => {
  const text = "A point[^a].\n\n[^a]: An explanation [@smith2024, p. 42].";
  const result = format(text, "chicago-notes-bibliography");
  const edit = citationDisplayEdits(text, "Papers/Test.md", result)[0];
  assert.match(edit.html, /^\(/);
  assert.match(edit.html, /42\)$/);
});

test("structured references retain non-article types, editors, and corporate names", () => {
  const data: CslItem[] = [
    {
      id: "chapter",
      type: "chapter",
      title: "Synthetic chapter",
      "container-title": "Collected Examples",
      author: [{ family: "Smith", given: "Alex" }],
      editor: [{ family: "Jones", given: "Pat" }],
      page: "20-35",
      publisher: "Example Press",
      issued: { "date-parts": [[2024]] },
    },
    {
      id: "dataset",
      type: "dataset",
      title: "Synthetic dataset",
      author: [{ literal: "Example Research Institute" }],
      version: "2",
      DOI: "10.0000/example",
      issued: { "date-parts": [[2023]] },
    },
    {
      id: "report",
      type: "report",
      title: "Synthetic report",
      author: [{ literal: "Example Research Institute" }],
      number: "7",
      publisher: "Example Institute",
      issued: { "date-parts": [[2022]] },
    },
    {
      id: "case",
      type: "legal_case",
      title: "Example v. Sample",
      authority: "Example Court",
      "container-title": "Example Reporter",
      volume: "1",
      page: "10",
      issued: { "date-parts": [[2021, 2, 3]] },
    },
  ];
  const result = formatCitationDocument(
    "[@chapter; @dataset; @report; @case]",
    styles.apa,
    "en-US",
    styles,
    new Map(data.map((item) => [item.id, item])),
  );
  assert.match(result.bibliography, /Jones/);
  assert.match(result.bibliography, /Collected Examples/);
  assert.match(result.bibliography, /Example Research Institute/);
  assert.match(result.bibliography, /Example v\. Sample/);
  assert.match(result.bibliography, /2021/);
});

test("Reading footer follows the selected style without a source marker", () => {
  const source = "A claim [@smith2024]. Another [@jones2023].";
  for (const style of ["apa", "ieee", "chicago-notes-bibliography"]) {
    const result = format(source, style);
    const footer = citationFooter(source, result);
    assert.equal(footer.line, 0);
    assert.equal(footer.bibliography, result.bibliography);
    assert.match(footer.bibliography, /Example research/i);
    assert.equal(
      footer.heading,
      result.noteStyle ? "Bibliography" : "References",
    );
  }
  assert.equal(source, "A claim [@smith2024]. Another [@jones2023].");
});

test("automatic references respect explicit placement and absent bibliographies", () => {
  const source = 'A claim [@smith2024].\n\n<div id="refs"></div>';
  assert.equal(citationFooter(source, format(source)).bibliography, "");
  assert.equal(
    citationFooter("Just prose.", format("Just prose.")).bibliography,
    "",
  );
  const notesOnly = styles["chicago-notes-bibliography"].replace(
    /<bibliography\b[\s\S]*?<\/bibliography>/,
    "",
  );
  const result = formatCitationDocument(
    "A claim [@smith2024].",
    notesOnly,
    "en-US",
    styles,
    references,
  );
  assert.equal(
    citationFooter("A claim [@smith2024].", result).bibliography,
    "",
  );
  assert.equal(result.model.citations[0].generatedNote, true);
});

test("Reading footer ignores trailing definitions and comments but follows code blocks", () => {
  const source =
    "A claim [@smith2024]. A note[^one].\n\n[^one]: Explanation.\n\n[link]: https://example.test\n\n<!-- hidden -->\n\n%% private comment %%\n";
  assert.equal(citationFooter(source, format(source)).line, 0);
  const code = source + "\n```text\nA final example\n```\n";
  assert.equal(
    citationFooter(code, format(code)).line,
    code.trimEnd().split("\n").length - 1,
  );
});

test("footnote bodies preserve leading code and allow empty notes", () => {
  for (const body of ["`code`", "`code` before ordinary prose", ""]) {
    const source = `A claim [@smith2024]. Note[^n].\n\n[^n]: ${body}`;
    const model = format(source).model;
    assert.equal(model.notes.length, 1);
    assert.equal(
      source.slice(model.notes[0].bodyFrom, model.notes[0].bodyTo),
      body,
    );
  }
  const source =
    "A claim [@smith2024]. %% hidden[^n] %%\n\n[^n]: Hidden definition";
  assert.equal(format(source).model.notes.length, 0);
});

test("inline Obsidian footnotes fail visibly rather than lose explanatory text", () => {
  assert.throws(
    () => format("A claim [@smith2024]. An explanation^[Keep this text]."),
    /Inline explanatory footnotes/,
  );
  assert.doesNotThrow(() => format("A claim [@smith2024]. `^[example]`"));
  assert.doesNotThrow(() => format("A claim [@smith2024]. \\^[literal]"));
  assert.doesNotThrow(() => format("A claim [@smith2024]. %% ^[hidden] %%"));
});

test("implicit numeric pages match Pandoc's locator formatting", () => {
  assert.deepEqual(format("[@smith2024, 42]").citations, [
    "(Smith, 2024, p. 42)",
  ]);
  assert.deepEqual(
    format("[@smith2024, 12–14, for discussion]", "ieee").citations,
    ["[1, pp. 12–14], for discussion"],
  );
});
