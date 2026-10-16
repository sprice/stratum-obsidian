import assert from "node:assert/strict";
import test from "node:test";
import {
  citationAuthoringDocument,
  citationDocument,
} from "../citation-document";
import { parseSourceOccurrences, sourceProse } from "../source-occurrences";
import { mathjaxParityMarkdown } from "./fixtures/mathjax-parity";
import { readingFooterLine } from "../citation-footer";

test("references stay below a final equation and ignore trailing comments", () => {
  const text = "A citation [@real].\n\n$$\nx^2\n$$\n\n%% Hidden %%";
  assert.equal(readingFooterLine(text), 4);
});

test("diagram arrows are not citations in either authoring or publication", () => {
  const text = `${mathjaxParityMarkdown}\n\nSee [@actual2026].`;
  for (const model of [
    citationAuthoringDocument(text),
    citationDocument(text, false),
    citationDocument(text, true),
  ]) {
    assert.deepEqual(model.problems, []);
    assert.deepEqual(
      model.citations.flatMap((citation) =>
        citation.draft.items.map((item) => item.key),
      ),
      ["actual2026"],
    );
    assert.equal(
      text.slice(model.citations[0].from, model.citations[0].to),
      "[@actual2026]",
    );
  }
});

test("math masking preserves offsets and ignores inline math and math links", () => {
  const text = String.raw`$@inline$ and $$@display [[not-a-link]]$$ then [@real].`;
  const prose = sourceProse(text);
  assert.equal(prose.length, text.length);
  assert.deepEqual(
    parseSourceOccurrences(text).map(({ target, from }) => ({ target, from })),
    [{ target: "real", from: text.indexOf("@real") }],
  );
});

test("currency, escaped dollars, code, and unmatched delimiters retain citations", () => {
  for (const prefix of [
    "$5 and $10 ",
    String.raw`\$5 `,
    "`$` ",
    "<!-- $ --> ",
    "%% $ %% ",
    "$unclosed\n",
    "$$unclosed\n",
  ]) {
    assert.deepEqual(
      parseSourceOccurrences(`${prefix}[@real]`).map((item) => item.target),
      ["real"],
      prefix,
    );
  }
});
