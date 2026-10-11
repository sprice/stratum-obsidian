import { aastexHeadingIssues } from "../publication-heading-preview";
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAastexPandocHeadings } from "../publication-headings";
const str = (c: string) => ({ t: "Str", c });
const space = { t: "Space" };
function heading(level: number, text: string, classes: string[] = []) {
  return {
    t: "Header",
    c: [level, ["original-anchor", classes, []], [str(text)]],
  };
}
test("the entire class outline counts plain headings and preserves IDs, rich text and prose", () => {
  const rich = {
    t: "Header",
    c: [
      2,
      ["rich-anchor", [], []],
      [
        { t: "Strong", c: [str("1.1."), space, str("Methods")] },
        space,
        { t: "Emph", c: [str("details")] },
      ],
    ],
  };
  const document = {
    blocks: [
      heading(1, "Introduction"),
      rich,
      heading(3, "1.1.1. Nested"),
      heading(1, "2. Results"),
      heading(1, "2026 Outlook"),
      { t: "Para", c: [str("See 2. Results.")] },
    ],
  };
  assert.deepEqual(normalizeAastexPandocHeadings(document), []);
  assert.deepEqual(rich.c, [
    2,
    ["rich-anchor", [], []],
    [
      { t: "Strong", c: [str("Methods")] },
      space,
      { t: "Emph", c: [str("details")] },
    ],
  ]);
  assert.deepEqual(document.blocks[2], heading(3, "Nested"));
  assert.deepEqual(document.blocks[3], heading(1, "Results"));
  assert.deepEqual(document.blocks[4], heading(1, "2026 Outlook"));
  assert.deepEqual(document.blocks[5], {
    t: "Para",
    c: [str("See 2. Results.")],
  });
});
test("mismatched, missing-parent and unsupported outlines keep every heading unchanged", () => {
  for (const blocks of [
    [heading(1, "1. First"), heading(1, "1. Duplicate")],
    [heading(1, "1. First"), heading(3, "1.1.1. Missing parent")],
    [heading(1, "1. First"), heading(4, "1.1.1.1. Deep")],
    [heading(1, "1. First"), heading(1, "3.14 Constant")],
    [heading(1, "1. ")],
    [
      heading(1, "1. First"),
      {
        t: "Header",
        c: [
          1,
          ["code", [], []],
          [{ t: "Code", c: [["", [], []], "2."] }, space, str("Code prefix")],
        ],
      },
    ],
  ]) {
    const original = structuredClone(blocks);
    assert.ok(normalizeAastexPandocHeadings({ blocks }).length);
    assert.deepEqual(blocks, original);
  }
});
test("explicitly unnumbered headings do not change class counters or their own text", () => {
  const document = {
    blocks: [
      heading(1, "1. First"),
      heading(1, "9. Appendix", ["unnumbered"]),
      heading(1, "2. Second"),
    ],
  };
  assert.deepEqual(normalizeAastexPandocHeadings(document), []);
  assert.deepEqual(document.blocks, [
    heading(1, "First"),
    heading(1, "9. Appendix", ["unnumbered"]),
    heading(1, "Second"),
  ]);
});
test("preview promotes extracted-title headings and ignores fenced code and literal years", () => {
  assert.deepEqual(
    aastexHeadingIssues(
      "## 1. Introduction\n### 1.1. Methods\n## 2. Results\n## 2026 Outlook\n```md\n# 8. Not a heading\n```",
    ),
    [],
  );
  assert.match(
    aastexHeadingIssues("## 1. First\n## 3. Next").join(" "),
    /expected heading number 2/,
  );
});
