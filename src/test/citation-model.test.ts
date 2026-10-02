import assert from "node:assert/strict";
import { test } from "node:test";
import {
  citationAt,
  citationItem,
  parseCitation,
  serializeCitation,
} from "../citation-model";

test("group citations round trip with per-source details", () => {
  const draft = {
    narrative: false,
    items: [
      {
        ...citationItem("smith2024"),
        locator: "42–44",
        label: "pp." as const,
        prefix: "see",
        suffix: "for discussion",
      },
      { ...citationItem("lee2023"), suppressAuthor: true, locator: "xiv" },
    ],
  };
  const text = serializeCitation(draft);
  assert.equal(
    text,
    "[see @smith2024, pp. 42–44, for discussion; -@lee2023, p. xiv]",
  );
  assert.deepEqual(parseCitation(text), draft);
});
test("narrative citations retain locator", () => {
  const draft = {
    narrative: true,
    items: [
      { ...citationItem("smith2024"), locator: "12", label: "chap." as const },
    ],
  };
  assert.deepEqual(parseCitation(serializeCitation(draft)), draft);
});
test("punctuated citation keys use braces", () => {
  const draft = { narrative: false, items: [citationItem("key:ends:")] };
  assert.deepEqual(parseCitation(serializeCitation(draft)), draft);
});
test("editing locators finds the whole citation group", () => {
  const text = "A [see @smith2024, p. 855; @lee2023] sentence.";
  const result = citationAt(text, text.indexOf("855"));
  assert.equal(
    text.slice(result!.from, result!.to),
    "[see @smith2024, p. 855; @lee2023]",
  );
  assert.equal(result?.draft?.items.length, 2);
});
test("code, comments, and links are not citations", () => {
  for (const text of [
    "`[@smith2024]`",
    "<!-- [@smith2024] -->",
    "[[@smith2024]]",
    "[x](https://example.org/@smith2024)",
  ])
    assert.equal(citationAt(text, text.indexOf("smith")), null);
});
test("invalid inputs cannot inject another citation", () => {
  assert.throws(() =>
    serializeCitation({
      narrative: false,
      items: [{ ...citationItem("smith"), suffix: "; @other" }],
    }),
  );
  assert.equal(parseCitation("[@smith, {complex}]"), null);
});

test("nested and unfinished groups refuse partial citation edits", () => {
  for (const text of ["[see [a detail] @smith2024]", "[see @smith2024"]) {
    const result = citationAt(text, text.indexOf("smith"));
    assert.ok(result);
    assert.equal(result.draft, null);
    assert.equal(result.from, 0);
    assert.equal(result.to, text.length);
  }
});
test("narrative locators are editable at their end", () => {
  const text = "@smith2024 [p. xiv]";
  assert.equal(citationAt(text, text.length)?.draft?.items[0].locator, "xiv");
});
test("page lists and named section locators survive editing", () => {
  for (const locator of ["12, 15–17", "Methods", "Part I", "S12", "xiv"]) {
    const draft = {
      narrative: false,
      items: [
        { ...citationItem("synthetic"), locator, suffix: "for discussion" },
      ],
    };
    assert.deepEqual(parseCitation(serializeCitation(draft)), draft);
  }
});
