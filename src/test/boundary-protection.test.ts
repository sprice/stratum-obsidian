import { SYNC_BOUNDARY } from "../literature-note-content-types";
import {
  composeLiteratureNoteBody,
  requireLiteratureNoteLayout,
} from "../literature-note-layout";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiteratureNoteContent,
  markLiteratureNoteAsDeletedContent,
  MANAGED_START,
  MANAGED_END,
  USER_BOUNDARY_CALLOUT,
} from "../literature-note-content";
import type { ZoteroItemDetail } from "../backend-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_ITEM: ZoteroItemDetail["item"] = {
  key: "ABCD1234",
  version: 12,
  title: "Test Paper Title",
  creators: ["Alice Author"],
  year: "2024",
  date: "2024-01-01",
  itemType: "journalArticle",
  abstract: "An abstract.",
  doi: "10.0000/test",
  url: "https://example.com",
  publicationTitle: "Test Journal",
  collections: [],
  tags: [],
  zoteroSelectUri: "zotero://select/library/items/ABCD1234",
  isbn: null,
  issn: null,
  volume: null,
  issue: null,
  pages: null,
  publisher: null,
  place: null,
  language: null,
  shortTitle: null,
  citationKey: null,
  edition: null,
  numPages: null,
  series: null,
  seriesTitle: null,
  seriesNumber: null,
  journalAbbreviation: null,
  conferenceName: null,
  university: null,
  bookTitle: null,
  reportNumber: null,
  reportType: null,
  thesisType: null,
  pmid: null,
  pmcid: null,
  arxivId: null,
  dateAdded: null,
  dateModified: null,
  citation: null,
};

function createDetail(
  overrides?: Omit<Partial<ZoteroItemDetail>, "item"> & {
    item?: Partial<ZoteroItemDetail["item"]>;
  },
): ZoteroItemDetail {
  const { item: itemOverrides, ...rest } = overrides ?? {};
  return {
    zoteroUserId: "123456",
    library: {
      type: "user",
      id: "123456",
      zoteroUriSegment: "library",
      identity: "user:123456",
    },
    item: { ...DEFAULT_ITEM, ...itemOverrides },
    attachments: [],
    zoteroNotes: [],
    annotations: [],
    ...rest,
  };
}

function stringifyForTest(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(
      ([key, entry]) =>
        `${key}: ${
          Array.isArray(entry)
            ? `[${entry.join(", ")}]`
            : typeof entry === "string" && entry.includes("\n")
              ? JSON.stringify(entry)
              : String(entry)
        }`,
    )
    .join("\n");
}

/** Run a sync update against existing content and return the result. */
function syncUpdate(existingContent: string): string {
  return buildLiteratureNoteContent({
    stratumVersion: "0.2.1",
    detail: createDetail({
      item: { title: "Updated Title From Zotero", version: 99 },
    }),
    filenameStem: "Updated Name",
    existingContent,
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });
}

/** Extract personal content from the new layout. */
function extractUserSection(content: string): string | null {
  const from = content.indexOf("## My Notes");
  const to = content.indexOf(SYNC_BOUNDARY);
  return from >= 0 && to > from ? content.slice(from, to) : null;
}

test("mixed layout preserves bottom writing through refresh and deletion", () => {
  const personal =
    "\nMigration research  \n- [x] Read\n- [ ] Compare\n[[Companion]]\n\n> A quotation\n\n^migration-check\n\n";
  const managed = `${MANAGED_START}\nOld source\n${MANAGED_END}\n`;
  const mixed = `---\nstratum_note_layout: 2\n---\n${composeLiteratureNoteBody("## My Notes\n\nReplaceable header\n\n", managed)}\n${USER_BOUNDARY_CALLOUT}\n${personal}`;
  const parseYaml = () => ({ stratum_note_layout: 2 });
  const refresh = (existingContent: string) =>
    buildLiteratureNoteContent({
      stratumVersion: "0.3.6",
      detail: createDetail(),
      filenameStem: "Synthetic paper",
      existingContent,
      parseYaml,
      stringifyYaml: stringifyForTest,
      htmlToMarkdown: (html) => html,
    });
  const deletion = (existingContent: string) =>
    markLiteratureNoteAsDeletedContent({
      existingContent,
      parseYaml,
      stringifyYaml: stringifyForTest,
    });
  const refreshed = refresh(mixed);
  for (const output of [
    refreshed,
    refresh(refreshed),
    deletion(mixed),
    deletion(refreshed),
  ]) {
    const body = output.slice(output.indexOf("\n---\n") + 5);
    const layout = requireLiteratureNoteLayout(body, 2);
    assert.equal(layout.personal, `## My Notes\n${personal}`);
    assert.doesNotMatch(output, /Replaceable header|\[!stratum\]/);
    assert.ok(output.indexOf(personal) < output.indexOf(SYNC_BOUNDARY));
    assert.equal(output.split(personal).length, 2);
  }
});

// ---------------------------------------------------------------------------
// Core boundary: user content below [!stratum] callout survives sync
// ---------------------------------------------------------------------------

test("boundary: simple user content below boundary callout is preserved", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> old managed text",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "My thoughts on this paper.",
    "",
    "### Sub-heading I created",
    "",
    "More of my analysis.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /My thoughts on this paper\./);
  assert.match(output, /### Sub-heading I created/);
  assert.match(output, /More of my analysis\./);
});

test("boundary: multi-paragraph user content with complex markdown is preserved", () => {
  const userContent = [
    "",
    "### Key Arguments",
    "",
    "1. First point with **bold** and *italic*",
    "2. Second point with `inline code`",
    "3. Third point with a [link](https://example.com)",
    "",
    "### My Critique",
    "",
    "> A blockquote I wrote summarizing my thoughts.",
    "> It spans multiple lines.",
    "",
    "```python",
    "# Some code I wrote",
    "def analyze(data):",
    '    return data.groupby("author").count()',
    "```",
    "",
    "- [ ] TODO: Follow up on methodology",
    "- [x] Read supplementary materials",
    "",
    "| Column A | Column B |",
    "|----------|----------|",
    "| data 1   | data 2   |",
    "",
    "---",
    "",
    "Final thoughts with a footnote[^1].",
    "",
    "[^1]: This is my footnote.",
  ].join("\n");

  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> old managed block",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    userContent,
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /### Key Arguments/);
  assert.match(output, /First point with \*\*bold\*\* and \*italic\*/);
  assert.match(output, /`inline code`/);
  assert.match(output, /\[link\]\(https:\/\/example\.com\)/);
  assert.match(output, /### My Critique/);
  assert.match(output, /A blockquote I wrote summarizing my thoughts\./);
  assert.match(output, /def analyze\(data\):/);
  assert.match(output, /TODO: Follow up on methodology/);
  assert.match(output, /\| Column A \| Column B \|/);
  assert.match(output, /Final thoughts with a footnote/);
  assert.match(output, /\[\^1\]: This is my footnote\./);
});

test("boundary: user content with wikilinks and embeds is preserved", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "See also [[Other Paper]] and [[Author Name]].",
    "![[embedded-image.png]]",
    "![[another-note#section]]",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /\[\[Other Paper\]\]/);
  assert.match(output, /\[\[Author Name\]\]/);
  assert.match(output, /!\[\[embedded-image\.png\]\]/);
  assert.match(output, /!\[\[another-note#section\]\]/);
});

// ---------------------------------------------------------------------------
// Renamed callout title: code matches callout type, not title
// ---------------------------------------------------------------------------

test("boundary: user content survives if callout title is renamed", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    "> [!stratum]- My Thoughts",
    "> Custom description the user wrote.",
    "",
    "User wrote this under a renamed callout.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /User wrote this under a renamed callout\./);
  // The old callout is replaced while writing beneath it is preserved.
  assert.match(output, /\[!warning\] Synced source content/);
});

test("boundary: user content survives if callout title is completely different", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    "> [!stratum]- Research Log",
    "> I changed the title and description.",
    "",
    "User renamed the section entirely.",
    "They wrote important analysis here.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /## My Notes/);
  assert.match(output, /User renamed the section entirely\./);
  assert.match(output, /They wrote important analysis here\./);
});

test("boundary: user content survives if callout is expanded (+) instead of collapsed (-)", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    "> [!stratum]+ My Notes",
    "> User changed to expanded.",
    "",
    "Content after expanded callout.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /Content after expanded callout\./);
  assert.match(output, /\[!warning\] Synced source content/);
});

// ---------------------------------------------------------------------------
// Content placement: user content outside managed block
// ---------------------------------------------------------------------------

test("boundary: content above the owned My Notes callout is replaced", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    "Some text the user put between managed block and the callout.",
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "More user content here.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.doesNotMatch(
    output,
    /Some text the user put between managed block and the callout\./,
  );
  assert.match(output, /More user content here\./);
});

test("boundary: text before the My Notes callout is managed", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "User content right after managed end with no blank line.",
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "Notes section content.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.doesNotMatch(
    output,
    /User content right after managed end with no blank line\./,
  );
  assert.match(output, /Notes section content\./);
});

// ---------------------------------------------------------------------------
// Multiple headings: don't clobber user structure
// ---------------------------------------------------------------------------

test("boundary: multiple user headings below boundary callout are all preserved", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "### Summary",
    "My summary of the paper.",
    "",
    "### Methodology Critique",
    "The sample size was too small.",
    "",
    "### Follow-up Questions",
    "- Why did they use that metric?",
    "- What about confounding variables?",
    "",
    "## Connections to My Research",
    "This relates to my dissertation chapter 3.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /### Summary/);
  assert.match(output, /My summary of the paper\./);
  assert.match(output, /### Methodology Critique/);
  assert.match(output, /The sample size was too small\./);
  assert.match(output, /### Follow-up Questions/);
  assert.match(output, /Why did they use that metric\?/);
  assert.match(output, /## Connections to My Research/);
  assert.match(output, /This relates to my dissertation chapter 3\./);
});

// ---------------------------------------------------------------------------
// Edge cases: empty, whitespace, special characters
// ---------------------------------------------------------------------------

test("boundary: empty user section (just callout) is preserved without corruption", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /\[!warning\] Synced source content/);
  const managedStartCount = (
    output.match(/<!-- stratum:managed:start -->/g) || []
  ).length;
  assert.equal(
    managedStartCount,
    1,
    "Should have exactly one managed start marker",
  );
});

test("boundary: user content with HTML-like comments is preserved", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "<!-- My own HTML comment -->",
    "User content with <!-- inline comment --> here.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /<!-- My own HTML comment -->/);
  assert.match(output, /User content with <!-- inline comment --> here\./);
});

test("boundary: user content with stratum-like markers is not confused for real markers", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "I was reading about the plugin and noted this:",
    "The managed block starts with `<!-- stratum:managed:start -->`",
    "and ends with `<!-- stratum:managed:end -->`",
    "Pretty clever system.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /I was reading about the plugin and noted this:/);
  assert.match(output, /Pretty clever system\./);
  assert.match(output, /`<!-- stratum:managed:start -->`/);
});

test("boundary: user content with YAML-like frontmatter syntax is not corrupted", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "Key findings:",
    "---",
    "This horizontal rule should survive.",
    "---",
    "More content after horizontal rules.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /Key findings:/);
  assert.match(output, /This horizontal rule should survive\./);
  assert.match(output, /More content after horizontal rules\./);
});

// ---------------------------------------------------------------------------
// Repeated syncs: content stability across multiple updates
// ---------------------------------------------------------------------------

test("boundary: user content is stable across multiple consecutive syncs", () => {
  let content = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed v1",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "### Round 1 notes",
    "I added these notes after the first sync.",
    "",
    "### Round 2 notes",
    "I added more notes after the second sync.",
  ].join("\n");

  for (let i = 0; i < 3; i++) {
    content = buildLiteratureNoteContent({
      stratumVersion: "0.2.1",
      detail: createDetail({
        item: { title: `Title v${i + 2}`, version: i + 2 },
      }),
      filenameStem: "Test",
      existingContent: content,
      parseYaml: () => ({}),
      stringifyYaml: stringifyForTest,
      htmlToMarkdown: (html) => html,
    });
  }

  assert.match(content, /Round 1 notes/);
  assert.match(content, /I added these notes after the first sync\./);
  assert.match(content, /Round 2 notes/);
  assert.match(content, /I added more notes after the second sync\./);
  const managedStartCount = (
    content.match(/<!-- stratum:managed:start -->/g) || []
  ).length;
  assert.equal(managedStartCount, 1);
});

// ---------------------------------------------------------------------------
// No managed markers: first sync on a pre-existing note
// ---------------------------------------------------------------------------

test("boundary: note without managed markers preserves only writing after the callout", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    "",
    "This is a note someone created manually before Stratum existed.",
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "Their original thoughts.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /<!-- stratum:managed:start -->/);
  assert.match(output, /<!-- stratum:managed:end -->/);
  assert.doesNotMatch(
    output,
    /This is a note someone created manually before Stratum existed\./,
  );
  assert.match(output, /Their original thoughts\./);
});

test("boundary: a note without the required callout is not rewritten", () => {
  assert.throws(
    () => syncUpdate("Just some loose text with no structure."),
    /boundary is missing or damaged/,
  );
});

// ---------------------------------------------------------------------------
// Deletion marking: user content survives when note is marked deleted
// ---------------------------------------------------------------------------

test("boundary: marking a note as deleted preserves all user content", () => {
  const existing = [
    "---",
    "zotero_status: active",
    "---",
    MANAGED_START,
    "> managed text",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "My important analysis that must survive deletion.",
    "",
    "### Critical Findings",
    "These findings took me weeks to compile.",
  ].join("\n");

  const output = markLiteratureNoteAsDeletedContent({
    existingContent: existing,
    parseYaml: () => ({ zotero_status: "active" }),
    stringifyYaml: stringifyForTest,
  });

  assert.match(output, /zotero_status: deleted/);
  assert.match(output, /My important analysis that must survive deletion\./);
  assert.match(output, /### Critical Findings/);
  assert.match(output, /These findings took me weeks to compile\./);
});

// ---------------------------------------------------------------------------
// Large user content: stress test with lots of content
// ---------------------------------------------------------------------------

test("boundary: large user content section is fully preserved", () => {
  const userLines: string[] = [];
  for (let i = 1; i <= 100; i++) {
    userLines.push(
      `Line ${i}: This is paragraph ${i} of my extensive notes on this paper.`,
    );
    userLines.push("");
  }

  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    ...userLines,
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /Line 1: This is paragraph 1/);
  assert.match(output, /Line 50: This is paragraph 50/);
  assert.match(output, /Line 100: This is paragraph 100/);
});

// ---------------------------------------------------------------------------
// Frontmatter: user-added frontmatter keys survive sync
// ---------------------------------------------------------------------------

test("boundary: user-defined frontmatter keys are not removed by sync", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "my_custom_field: important value",
    "reading_status: in-progress",
    "priority: high",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "Notes here.",
  ].join("\n");

  const output = buildLiteratureNoteContent({
    stratumVersion: "0.2.1",
    detail: createDetail(),
    filenameStem: "Test",
    existingContent: existing,
    parseYaml: () => ({
      zotero_item_key: "ABCD1234",
      my_custom_field: "important value",
      reading_status: "in-progress",
      priority: "high",
    }),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /my_custom_field: important value/);
  assert.match(output, /reading_status: in-progress/);
  assert.match(output, /priority: high/);
  assert.match(output, /Notes here\./);
});

// ---------------------------------------------------------------------------
// New note creation: boundary callout is present from the start
// ---------------------------------------------------------------------------

test("boundary: new note always includes boundary callout", () => {
  const output = buildLiteratureNoteContent({
    stratumVersion: "0.2.1",
    detail: createDetail(),
    filenameStem: "Test",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /\[!warning\] Synced source content/);
  assert.match(output, /<!-- stratum:managed:start -->/);
  assert.match(output, /<!-- stratum:managed:end -->/);

  assert.ok(output.indexOf("## My Notes") < output.indexOf(SYNC_BOUNDARY));
  assert.ok(output.indexOf(SYNC_BOUNDARY) < output.indexOf(MANAGED_START));
});

// ---------------------------------------------------------------------------
// Managed block does not leak into user section
// ---------------------------------------------------------------------------

test("boundary: managed block content does not appear after boundary callout", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "User content only.",
  ].join("\n");

  const output = syncUpdate(existing);
  const userSection = extractUserSection(output);
  assert.ok(userSection);
  assert.doesNotMatch(userSection, /<!-- stratum:managed:start -->/);
  assert.doesNotMatch(userSection, /<!-- stratum:managed:end -->/);
});

// ---------------------------------------------------------------------------
// Unicode and special characters in user content
// ---------------------------------------------------------------------------

test("boundary: user content with unicode, emoji, and special chars is preserved", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    USER_BOUNDARY_CALLOUT,
    "",
    "Notes in multiple languages: 日本語テスト, Ünïcödé, العربية",
    "Mathematical notation: ∑(x²) = ∫f(x)dx",
    "Emoji: 📚 🔬 🧪 ✅",
    "Special chars: <angle> & ampersand | pipe \\ backslash",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /日本語テスト/);
  assert.match(output, /Ünïcödé/);
  assert.match(output, /العربية/);
  assert.match(output, /∑\(x²\) = ∫f\(x\)dx/);
  assert.match(output, /📚 🔬 🧪 ✅/);
  assert.match(output, /<angle> & ampersand \| pipe \\ backslash/);
});

// ---------------------------------------------------------------------------
// Callout type is the anchor, not the title or description
// ---------------------------------------------------------------------------

test("boundary: callout with deleted description lines still works as boundary", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    "> [!stratum]- My Notes",
    "",
    "User deleted the description line from the callout.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /\[!warning\] Synced source content/);
  assert.match(output, /User deleted the description line from the callout\./);
});

test("boundary: callout with extra user-added description lines works", () => {
  const existing = [
    "---",
    "zotero_item_key: ABCD1234",
    "---",
    MANAGED_START,
    "> managed",
    MANAGED_END,
    "",
    "> [!stratum]- My Research Notes",
    "> Original description.",
    "> I added another line to the callout description.",
    "> And a third line.",
    "",
    "Notes below the callout.",
  ].join("\n");

  const output = syncUpdate(existing);
  assert.match(output, /\[!warning\] Synced source content/);
  assert.doesNotMatch(output, /I added another line/);
  assert.match(output, /Notes below the callout\./);
});

test("standalone marker examples below the user boundary are never overwritten", () => {
  const personal = `${USER_BOUNDARY_CALLOUT}\n\nMy example:\n${MANAGED_START}\nKeep this example\n${MANAGED_END}\n`;
  const output = syncUpdate(personal);
  assert.match(output, /Keep this example/);
  assert.ok(
    output.includes(personal.slice(personal.indexOf("\n\n") + 2).trimEnd()),
  );
});

test("a missing managed end marker cannot swallow personal writing", () => {
  const personal = `${USER_BOUNDARY_CALLOUT}\n\nPreserve my notes\n${MANAGED_END}\n`;
  const output = syncUpdate(
    `${MANAGED_START}\nDamaged managed section\n${personal}`,
  );
  assert.ok(
    output.includes(personal.slice(personal.indexOf("\n\n") + 2).trimEnd()),
  );
});

test("quoted Zotero markers cannot prematurely end the managed section", () => {
  const initial = buildLiteratureNoteContent({
    stratumVersion: "0.2.1",
    detail: createDetail({
      item: {
        abstract: `Before\n${MANAGED_END}\nOld abstract tail`,
        publicationTitle: `Journal\n${MANAGED_END}\nOld journal tail`,
      },
    }),
    filenameStem: "Paper",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });
  const output = syncUpdate(
    initial.replace("## My Notes\n", "## My Notes\n\nPersonal writing\n"),
  );
  assert.doesNotMatch(output, /Old abstract tail|Old journal tail/);
  assert.match(output, /Personal writing/);
});

test("Zotero text containing replacement metacharacters is preserved literally", () => {
  const initial = buildLiteratureNoteContent({
    stratumVersion: "0.2.1",
    detail: createDetail(),
    filenameStem: "Paper",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });
  const output = buildLiteratureNoteContent({
    stratumVersion: "0.2.1",
    detail: createDetail({ item: { abstract: "Cost $& and $' and $`" } }),
    existingContent: initial.replace(
      "## My Notes\n",
      "## My Notes\n\nPersonal writing\n",
    ),
    filenameStem: "Paper",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });
  assert.ok(output.includes("Cost $& and $' and $`"));
  assert.equal(output.match(/Personal writing/g)?.length, 1);
});

test("deletion marking never edits warning or marker examples in personal notes", () => {
  const warning =
    "> [!warning] This item was removed from Zotero\n> The source item is no longer in your Zotero library. This note is preserved but will no longer receive updates.";
  const personal = `${USER_BOUNDARY_CALLOUT}\n\n${warning}\n\n${MANAGED_START}\nExample\n${MANAGED_END}\n`;
  for (const prefix of ["", `${MANAGED_START}\nManaged\n${MANAGED_END}\n\n`]) {
    const output = markLiteratureNoteAsDeletedContent({
      existingContent: prefix + personal,
      parseYaml: () => ({}),
      stringifyYaml: stringifyForTest,
    });
    assert.ok(
      output.includes(personal.slice(personal.indexOf("\n\n") + 2).trimEnd()),
    );
  }
});

test("deletion warning is inserted in CRLF managed notes", () => {
  const output = markLiteratureNoteAsDeletedContent({
    existingContent: `${MANAGED_START}\r\nManaged\r\n${MANAGED_END}\r\n${USER_BOUNDARY_CALLOUT}`,
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
  });
  assert.match(output, /This item was removed from Zotero/);
});
