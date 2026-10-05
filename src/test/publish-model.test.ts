import {
  hasUnsupportedHtmlMedia,
  preparePublication,
  preparePublishLinks,
} from "../publish-document";
import test from "node:test";
import assert from "node:assert/strict";
import {
  publishFilename,
  readCatalog,
  emptyCatalog,
  movePublishedNotes,
} from "../publish-model";
import { formatCitationDocument } from "../citation-format";
import assets from "../csl/assets.json";
import type { CslItem } from "../csl-data";
const styles = assets as Record<string, string>;
const refs = new Map<string, CslItem>([
  [
    "example2024",
    {
      id: "user/1/EXAMPLE",
      type: "book",
      title: "Example research",
      author: [{ family: "Example", given: "Alex" }],
      issued: { "date-parts": [[2024]] },
      publisher: "Example Press",
    },
  ],
]);
const format = (text: string, style = "apa") =>
  formatCitationDocument(text, styles[style], "en-US", styles, refs);

test("publication keeps CSL output, explicit bibliography position, and removes properties", () => {
  const source =
    '---\ntitle: Private property\n---\n# Heading\nA claim [@example2024].\n\n<div id="refs"></div>\n\nAfter references.';
  const result = preparePublication(source, format(source));
  assert.doesNotMatch(result.markdown, /Private property|@example2024/);
  assert.match(result.markdown, /Example, 2024/);
  assert.ok(
    result.markdown.indexOf("Example research") <
      result.markdown.indexOf("After references"),
  );
  assert.equal(result.bibliography, "");
});

test("note styles preserve punctuation and interleave citations with explanatory footnotes", () => {
  const source =
    "A claim [@example2024]. More[^explanation]. Again [@example2024].\n\n[^explanation]: A *helpful* explanation [@example2024].";
  const result = preparePublication(
    source,
    format(source, "chicago-notes-bibliography"),
  );
  assert.match(result.markdown, /claim\.<a epub:type="noteref"/);
  assert.doesNotMatch(
    result.markdown,
    /\[\^explanation\]|helpful|@example2024/,
  );
  assert.equal(result.notes.length, 3);
  assert.match(
    result.notes.find((n) => n.id === "stratum-publish-note-2")!.markdown,
    /\*helpful\* explanation \(Example/,
  );
  assert.equal(result.heading, "Bibliography");
});

test("ordinary footnotes are preserved without citations and unresolved references block export", () => {
  const result = preparePublication("Text[^n].\n\n[^n]: An ordinary note.");
  assert.equal(result.notes[0].markdown, "An ordinary note.");
  assert.match(result.markdown, /epub:type="noteref"/);
  const source = "Unknown [@missing].";
  assert.throws(
    () => preparePublication(source, format(source)),
    /unavailable/,
  );
  assert.throws(
    () => preparePublication("Text ^[inline note]."),
    /Inline explanatory/,
  );
});

test("wiki labels and images are resolved without touching code examples", async () => {
  const source =
    "[[Papers/Example|Visible title]] and [[Other]].\n\n![[image.png|200]]\n\n![Alt](other.png)\n\n`[[Unchanged]]`";
  const requested: string[] = [];
  const output = await preparePublishLinks(source, (target) => {
    requested.push(target);
    return Promise.resolve(`asset-${requested.length}.png`);
  });
  assert.match(output, /Visible title and Other/);
  assert.match(output, /`\[\[Unchanged\]\]`/);
  assert.deepEqual(requested, ["image.png", "other.png"]);
  assert.match(output, /asset-1.png/);
  assert.match(output, /alt="Alt"/);
});

test("filenames are unique and safe on desktop platforms", () => {
  const date = new Date("2026-01-01T00:00:00Z");
  const first = publishFilename("CON", "pdf", date, "first");
  assert.match(first, /^Document-CON-/);
  assert.notEqual(first, publishFilename("CON", "pdf", date, "second"));
  assert.doesNotMatch(
    publishFilename('A/B:C*D?"E', "docx", date, "id"),
    /[<>:"/\\|?*]/,
  );
});

test("catalog rejects traversal, unknown formats and conflicting identity", () => {
  assert.deepEqual(readCatalog(JSON.stringify(emptyCatalog())), emptyCatalog());
  const catalog = {
    version: 1,
    notes: [{ id: "note", path: "Example.md", title: "Example", ctime: 1 }],
    documents: [
      {
        id: "doc",
        noteId: "note",
        filename: "../../outside.pdf",
        format: "pdf",
        createdAt: new Date().toISOString(),
        citationStyle: "apa",
        citationLanguage: "en-US",
      },
    ],
  };
  assert.throws(() => readCatalog(JSON.stringify(catalog)), /invalid/);
  catalog.documents[0].filename = "Example.pdf";
  assert.equal(readCatalog(JSON.stringify(catalog)).documents.length, 1);
  catalog.documents.push(catalog.documents[0]);
  assert.throws(() => readCatalog(JSON.stringify(catalog)), /conflicting/);
});

test("folder moves update descendants and deletion detaches retained publications", () => {
  const catalog = emptyCatalog();
  catalog.notes.push({
    id: "note",
    path: "Drafts/Example.md",
    title: "Example",
    ctime: 1,
  });
  movePublishedNotes(catalog, "Drafts", "Writing");
  assert.equal(catalog.notes[0].path, "Writing/Example.md");
  movePublishedNotes(catalog, "Writing/Example.md", null);
  assert.equal(catalog.notes[0].path, null);
  assert.equal(catalog.notes.length, 1);
});

test("publishing removes comments but preserves literal comment markers in code", () => {
  const source =
    "Before %%private%% after.\n\n`%%literal%%`\n\n```text\n%%literal block%%\n```";
  const result = preparePublication(source);
  assert.doesNotMatch(result.markdown, /private/);
  assert.match(result.markdown, /`%%literal%%`/);
  assert.match(result.markdown, /%%literal block%%/);
});

test("raw media checks distinguish HTML from code examples", () => {
  assert.equal(
    hasUnsupportedHtmlMedia('Example `<img src="example.png">`'),
    false,
  );
  assert.equal(
    hasUnsupportedHtmlMedia('<img src="https://example.com/image.png">'),
    true,
  );
});

test("publication filenames fit filesystem byte limits without splitting Unicode", () => {
  const filename = publishFilename(
    "研究😀".repeat(100),
    "docx",
    new Date("2026-01-01T00:00:00Z"),
    "12345678-1234-1234-1234-123456789012",
  );
  assert.ok(new TextEncoder().encode(filename).length <= 255);
  assert.doesNotMatch(filename, /\uFFFD/);
});

test("narrative note citations keep the author's name before punctuation", () => {
  const source = "As @example2024.";
  const result = preparePublication(
    source,
    format(source, "chicago-notes-bibliography"),
  );
  assert.match(result.markdown, /Example\.<a epub:type="noteref"/);
});

test("literal comment delimiters in code do not consume the next prose comment", () => {
  const result = preparePublication("`%%literal` before %%private%% after");
  assert.equal(result.markdown, "`%%literal` before  after");
});
