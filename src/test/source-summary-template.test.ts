import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SOURCE_SUMMARY_TEMPLATE,
  renderSourceSummary,
  validateSourceSummaryTemplate,
} from "../source-summary-template";
import { summaryInsertion } from "../source-summary-insertion";
import type { LiteratureNoteEntry } from "../library-search-modal";

const entry = {
  title: "Synthetic [paper]",
  authors: ["Alex *Example*"],
  year: "2026",
} as LiteratureNoteEntry;

test("template validation rejects unknown, incomplete, nested, and reserved syntax", () => {
  for (const template of [
    "{{author}}",
    "{{unknown}}",
    "{{}}",
    "{{title}",
    "{title}}",
    "{{{title}}}",
    "{{title}}}",
    "{{year",
    "<!-- stratum:sync-boundary -->",
    "```\nUnclosed",
    "",
    " ",
  ]) {
    assert.ok(validateSourceSummaryTemplate(template), template);
  }
  assert.match(
    validateSourceSummaryTemplate("{{author}}")!,
    /Use \{\{authors\}\}/,
  );
  for (const template of [
    DEFAULT_SOURCE_SUMMARY_TEMPLATE,
    "My own prompts",
    "{{title}} / {{title}}",
    "Code: {example}",
  ])
    assert.equal(validateSourceSummaryTemplate(template), null);
});

test("all variables render safely once and missing fields remain empty", () => {
  const rendered = renderSourceSummary(
    "{{title_with_link}}\n{{title}}\n{{authors}}\n{{year}}",
    entry,
    "[[Synthetic|Synthetic paper]]",
  );
  assert.equal(
    rendered,
    "[[Synthetic|Synthetic paper]]\nSynthetic \\[paper\\]\nAlex \\*Example\\*\n2026",
  );
  const sparse = {
    ...entry,
    authors: [],
    year: null,
    title: "A {{year}} example",
  };
  assert.equal(
    renderSourceSummary("{{authors}}\n{{year}}\n{{title}}", sparse, "link"),
    "\n\nA \\{\\{year\\}\\} example",
  );
  assert.throws(() => renderSourceSummary("{{invalid}}", entry, "link"));
});

test("insertion keeps surrounding text, separates blocks, and locates the writing prompt", () => {
  const text = "BeforeSelectedAfter";
  const { insert, cursor } = summaryInsertion(
    text,
    14,
    DEFAULT_SOURCE_SUMMARY_TEMPLATE,
  );
  assert.ok(insert.startsWith("\n\n---\n###"));
  assert.ok(insert.endsWith("\n\n"));
  const next = text.slice(0, 14) + insert + text.slice(14);
  assert.ok(next.startsWith("BeforeSelected\n\n"));
  assert.ok(next.endsWith("\n\nAfter"));
  assert.ok(next.slice(0, cursor).endsWith("**Main argument:**"));
  const custom = summaryInsertion("", 0, "## My prompt");
  assert.equal(custom.cursor, "\n---\n## My prompt".length);
  assert.equal(custom.insert, "\n---\n## My prompt\n\n---\n\n");
});

test("a leading divider remains Markdown rather than creating note properties", () => {
  const summary = "---\n### Synthetic source\n---\n\nQuestions:";
  assert.equal(validateSourceSummaryTemplate(summary), null);
  for (const text of ["", "Existing writing"]) {
    const { insert, cursor } = summaryInsertion(text, 0, summary);
    const next = insert + text;
    assert.ok(next.startsWith("\n---\n### Synthetic source"));
    assert.ok(next.endsWith(text));
    assert.equal(next.slice(0, cursor), "\n" + summary);
  }
});

test("insertion preserves indentation in a valid Markdown template", () => {
  const template = "\n    First code line\n    Second code line\n";
  assert.equal(validateSourceSummaryTemplate(template), null);
  const { insert } = summaryInsertion("", 0, template);
  assert.equal(
    insert,
    "\n---\n\n    First code line\n    Second code line\n\n---\n\n",
  );
});

test("summaries separated by blank lines keep their own boundary dividers", () => {
  let text = "Working notes\n\n";
  for (let i = 0; i < 7; i++) {
    const rendered = renderSourceSummary(
      DEFAULT_SOURCE_SUMMARY_TEMPLATE,
      entry,
      `[[Source ${i}]]`,
    );
    const { insert } = summaryInsertion(text, text.length, rendered);
    text += insert;
  }
  assert.equal(text.split("\n").filter((line) => line === "---").length, 14);
  assert.equal((text.match(/### \[\[Source/g) ?? []).length, 7);
});

test("rules on either side are shared without modifying existing Markdown", () => {
  const summary = "---\n\n### Source\n\nWriting\n\n---";
  for (const rule of ["---", "***", "___", "* * *", "- - -", "_ _ _"]) {
    const before = `Notes\n\n${rule}\n`;
    const after = `\n${rule}\n\nOther notes`;
    const both = summaryInsertion(before + after, before.length, summary);
    assert.equal(both.insert, "### Source\n\nWriting\n");
    const top = summaryInsertion(before, before.length, summary);
    assert.ok(top.insert.startsWith("### Source"));
    assert.ok(top.insert.endsWith("---\n\n"));
    const bottom = summaryInsertion(after, 0, summary);
    assert.ok(bottom.insert.startsWith("\n---\n"));
    assert.ok(bottom.insert.endsWith("Writing\n"));
  }
});

test("code, properties, and heading underlines never replace a summary divider", () => {
  const summary = "---\n\n### Source\n\n---";
  for (const before of [
    "---\ntitle: Notes\n---\n\n",
    "---\n---\n\n",
    "Heading\n---\n\n",
    "```\n---\n\n",
    "    ---\n\n",
    "> ---\n\n",
  ]) {
    const { insert } = summaryInsertion(before, before.length, summary);
    assert.ok(insert.startsWith("---\n"), before);
  }
  const custom = "### Custom\n\nMy prompts";
  const text = "Notes\n\n---\n";
  assert.equal(
    summaryInsertion(text, text.length, custom).insert,
    custom + "\n\n---\n\n",
  );
});

test("default metadata stays compact when fields are missing", () => {
  for (const [authors, year, expected] of [
    [[], null, ""],
    [["Alex Example"], null, "Alex Example"],
    [[], "2026", "2026"],
  ] as const) {
    const rendered = renderSourceSummary(
      DEFAULT_SOURCE_SUMMARY_TEMPLATE,
      { ...entry, authors: [...authors], year },
      "[[Source]]",
    );
    assert.ok(rendered.includes(`### [[Source]]\n${expected}\n`));
    assert.ok(!rendered.includes(" · "));
  }
});

test("content-only templates receive shared dividers and keep the cursor inside", () => {
  assert.ok(!DEFAULT_SOURCE_SUMMARY_TEMPLATE.startsWith("---"));
  assert.ok(!DEFAULT_SOURCE_SUMMARY_TEMPLATE.endsWith("---"));
  const content = "### Source\n\nMy notes";
  const before = "Notes\n\n***\n";
  const after = "\n___\n\nOther notes";
  const shared = summaryInsertion(before + after, before.length, content);
  assert.equal(shared.insert, content + "\n");
  const isolated = summaryInsertion("", 0, content);
  assert.equal(isolated.insert, "\n---\n" + content + "\n\n---\n\n");
  assert.equal(isolated.insert.slice(0, isolated.cursor), "\n---\n" + content);
});

test("blank lines between the cursor and a divider prevent sharing on either side", () => {
  for (const newline of ["\n", "\r\n"]) {
    const adjacentBefore = "Notes" + newline.repeat(2) + "---" + newline;
    const adjacentAfter = newline + "---" + newline.repeat(2) + "Other notes";
    const adjacent = summaryInsertion(
      adjacentBefore + adjacentAfter,
      adjacentBefore.length,
      "### Source",
    );
    assert.equal(
      adjacent.insert.split("\n").filter((line) => line === "---").length,
      0,
    );
    for (const gap of [
      newline.repeat(2),
      newline + "  " + newline,
      newline.repeat(4),
    ]) {
      const before = "Notes" + newline.repeat(2) + "---" + gap;
      const after = gap + "---" + newline.repeat(2) + "Other notes";
      const { insert } = summaryInsertion(
        before + after,
        before.length,
        "### Source",
      );
      assert.equal(
        insert.split("\n").filter((line) => line === "---").length,
        2,
      );
      assert.ok((before + insert + after).startsWith(before));
      assert.ok((before + insert + after).endsWith(after));
    }
  }
});

test("a heading follows a shared top divider without an extra blank line", () => {
  for (const gap of ["", "\n", "\r\n"]) {
    const before = "Writing\n\n---" + gap;
    const result = summaryInsertion(
      before,
      before.length,
      "### Source\n\n**Main argument:**",
    );
    const next = before + result.insert;
    assert.ok(next.includes("---" + (gap || "\n") + "### Source"));
    assert.ok(!next.includes("---\n\n### Source"));
    assert.ok(next.slice(0, result.cursor).endsWith("**Main argument:**"));
  }
  const beforeCode = "Writing\n\n---\n";
  assert.ok(
    summaryInsertion(
      beforeCode,
      beforeCode.length,
      "    Code",
    ).insert.startsWith("\n    Code"),
  );
});
