import assert from "node:assert/strict";
import test from "node:test";
import { citationDocument } from "../citation-document";
import { nativeFootnoteReference } from "../citation-footnotes";
test("native identifiers and repeated-reference suffixes survive citation numbering", () => {
  const model = citationDocument(
    "A [@first]. Explain[^explain]. Another [@second]. Again[^explain].\n\n[^explain]: Explanation.",
    true,
  );
  const native = (text: string) => ({
    textContent: text,
    getAttribute: (name: string) =>
      name === "data-footref"
        ? "explain"
        : name === "href"
          ? "#fn-1-doc123"
          : null,
  });
  assert.equal(nativeFootnoteReference(native("[1]"), model).note.number, 2);
  assert.equal(nativeFootnoteReference(native("[1]"), model).referenceIndex, 0);
  assert.equal(
    nativeFootnoteReference(native("[1-1]"), model).referenceIndex,
    1,
  );
  assert.throws(
    () =>
      nativeFootnoteReference(
        { textContent: "[3]", getAttribute: () => "unknown" },
        model,
      ),
    /Native notes were retained/,
  );
});
