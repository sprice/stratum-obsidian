import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  JOURNAL_PROFILES,
  JOURNAL_TEMPLATES,
  journalFiles,
  journalLatex,
  journalProblems,
  journalReference,
} from "../journal-profiles";
import { readNotePreferences } from "../publish-options";
import { journalFormattedDocument } from "../publication-citations";
import { loadRuntime } from "./runtime-harness";
const source = `---
keywords: [synthetic, validation]
stratum_publish:
  authors:
    - name: Alex Example
      email: alex@example.invalid
      institution: Example Institute
      city: Example City
      country: Example Country
      affiliations: [Example Institute, Second Institute]
    - name: Sam Synthetic
      email: sam@example.invalid
      institution: Second Institute
      city: Other City
      country: Example Country
      affiliations: [Second Institute]
stratum_corresponding_author: alex@example.invalid
stratum_running_title: Synthetic paper
stratum_running_authors: Example and Synthetic
---
# Synthetic journal verification
## Abstract
Unique abstract content.
## Introduction
Synthetic manuscript.
`;
const require = createRequire(import.meta.url);

test("all ten families and required profiles are present with explicit blockers", () => {
  assert.equal(new Set(JOURNAL_PROFILES.map((p) => p.family)).size, 10);
  assert.equal(
    new Set(JOURNAL_PROFILES.map((p) => p.id)).size,
    JOURNAL_PROFILES.length,
  );
  for (const profile of JOURNAL_PROFILES) {
    const result = journalProblems(source, "body", profile);
    assert.equal(
      result.issues.filter((i) => i.blocking).length,
      profile.blocker ? 1 : 0,
      profile.id,
    );
    if (profile.blocker)
      assert.throws(
        () => journalLatex(profile, result.manuscript, "", "", false),
        /unavailable/,
      );
    else journalFiles(profile);
  }
});
test("template choices include every runnable profile and exclude deferred families", () => {
  assert.deepEqual(
    JOURNAL_TEMPLATES.map((template) => template.id),
    JOURNAL_PROFILES.filter((profile) => !profile.blocker).map(
      (profile) => profile.id,
    ),
  );
  assert.equal(JOURNAL_TEMPLATES.length, 22);
  assert.ok(
    JOURNAL_TEMPLATES.every(
      (template) => !/journal:(aa|jmlr)-/.test(template.id),
    ),
  );
});
test("disabled keywords preserve malformed note values without blocking or publishing them", () => {
  const profile = JOURNAL_PROFILES.find((p) => p.family === "research")!;
  const invalid = source.replace(
    "keywords: [synthetic, validation]",
    "keywords: {custom: preserved}",
  );
  assert.match(
    journalProblems(invalid, "body", profile)
      .issues.map((i) => i.message)
      .join("\n"),
    /Keywords must/,
  );
  const omitted = journalProblems(invalid, "body", profile, false);
  assert.equal(omitted.issues.length, 0);
  assert.equal(omitted.manuscript.properties.keywords, undefined);
  assert.ok(invalid.includes("keywords: {custom: preserved}"));
});
test("package maps reject traversal and malformed values", () => {
  const profile = JOURNAL_PROFILES[0];
  for (const invalid of [
    null,
    [],
    { "../class.cls": "" },
    { "/class.cls": "" },
    { "acm/acmart.cls": 1 },
    { "acm/./class.cls": "" },
  ])
    assert.throws(
      () => journalFiles(profile, invalid),
      /Invalid|object of text files/,
    );
  assert.throws(() => journalFiles(profile, {}), /missing/);
});
test("journal references survive persistence without accepting prototype or invalid package entries", () => {
  const profile = JOURNAL_PROFILES[0];
  const value = {
    templateId: profile.id,
    journalPackages: {
      [profile.id]: journalReference(profile),
      unsafe: journalReference(profile),
    },
  };
  assert.deepEqual(readNotePreferences(value).journalPackages, {
    [profile.id]: journalReference(profile),
  });
});
test("anonymous front matter has no identifying author text or PDF author metadata", () => {
  const profile = JOURNAL_PROFILES.find((p) => p.anonymous)!;
  const result = journalProblems(source, "body", profile);
  const tex = journalLatex(
    profile,
    result.manuscript,
    "Body",
    "Abstract",
    false,
  );
  assert.doesNotMatch(
    tex,
    /Alex Example|Sam Synthetic|Example and Synthetic|example.invalid|Example Institute/,
  );
  assert.match(tex, /pdfauthor=\{\}/);
});
test("numeric citations preserve narrative names and locators and reject unsupported suppression", () => {
  const ids = new Map([["key", "stratum0"]]);
  const references = [
    {
      id: "stratum0",
      type: "article-journal",
      author: [{ family: "Example" }],
    },
  ];
  const value = journalFormattedDocument(
    "@key shows a result. [@key, p. 12]",
    ids,
    references,
    true,
  );
  assert.match(value.citations[0], /Example~.*citep/);
  assert.match(value.citations[1], /p\. 12/);
  assert.throws(
    () => journalFormattedDocument("[-@key]", ids, references, true),
    /Suppress-author/,
  );
});
for (const profile of JOURNAL_PROFILES.filter((p) => !p.blocker))
  test(`real PDF: ${profile.id}`, { timeout: 120_000 }, async () => {
    const pandoc = process.env.STRATUM_TEST_PANDOC ?? "pandoc";
    const tectonic = process.env.STRATUM_TEST_TECTONIC ?? "tectonic";
    const desktop = loadRuntime<typeof import("../publish-desktop")>(
      "publish-desktop.ts",
      { Platform: { isDesktopApp: true, isDesktop: true } },
      {
        TextDecoder,
        TextEncoder,
        Uint8Array,
        window: { require, setTimeout, clearTimeout },
      },
      "browser",
    );
    const manuscript = journalProblems(source, "body", profile).manuscript;
    const references = [
      {
        id: "stratum0",
        type: "article-journal",
        title: "Synthetic bibliography entry",
        author: [{ family: "Reference", given: "R" }],
        issued: { "date-parts": [[2026]] },
        "container-title": "Synthetic Journal",
        volume: "1",
        page: "1-3",
      },
    ];
    const nativeCitations = journalFormattedDocument(
      "@first shows a result. [see @first, p. 12]",
      new Map([["first", "stratum0"]]),
      references,
      profile.citations === "numeric",
    );
    const bytes = await desktop.convertPublication(
      "<html><body><h1>Introduction</h1><p>Body verification with " +
        nativeCitations.citations.join("; ") +
        '.</p><p>Math \\(x^2 + y^2\\).</p><pre><code>synthetic_code = 42</code></pre><table><tr><td>Sample</td><td>7</td></tr></table><aside>Callout content</aside><p><img src="asset-0.png"></p></body></html>',
      [
        {
          name: "asset-0.png",
          bytes: Uint8Array.from([
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0,
            0, 16, 0, 0, 0, 16, 8, 2, 0, 0, 0, 144, 145, 104, 54, 0, 0, 0, 85,
            73, 68, 65, 84, 120, 156, 149, 210, 59, 14, 0, 32, 8, 68, 65, 214,
            251, 223, 25, 11, 140, 70, 228, 179, 90, 16, 139, 121, 198, 2, 168,
            170, 252, 156, 65, 58, 0, 31, 129, 105, 155, 125, 176, 223, 182,
            207, 55, 129, 211, 77, 240, 234, 42, 8, 117, 26, 100, 58, 14, 10,
            29, 4, 181, 246, 65, 171, 175, 128, 209, 39, 32, 245, 10, 120, 45,
            34, 216, 55, 114, 109, 135, 57, 126, 201, 39, 70, 70, 45, 28, 130,
            134, 158, 47, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
          ]).buffer,
        },
      ],
      "pdf",
      { pandoc, tectonic },
      undefined,
      120_000,
      undefined,
      {
        manuscript,
        journal: profile,
        abstractHtml: "<p>Unique abstract content.</p>",
        references,
      },
    );
    const directory = await mkdtemp(join(tmpdir(), "journal-pdf-test-"));
    try {
      const path = join(directory, "paper.pdf");
      await writeFile(path, new Uint8Array(bytes));
      const text = execFileSync("pdftotext", [path, "-"], {
        encoding: "utf8",
      }).normalize("NFKC");
      assert.match(text, /Synthetic journal verification/);
      assert.equal(text.match(/Unique abstract content/g)?.length, 1);
      assert.match(text, /Reference/);
      assert.match(text, /2026/);
      assert.match(text, /p\.\s*12/);
      assert.match(text, /Callout content/);
      if (!profile.anonymous) assert.match(text, /Second Institute/);
      assert.doesNotMatch(
        text,
        /\(author\?\)|\[\?\]|Conference acronym|XXXX|XXX|\[ht\]/,
      );
      if (profile.anonymous) {
        assert.doesNotMatch(
          text,
          /Alex Example|Sam Synthetic|Example and Synthetic|example.invalid/,
        );
        const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
        assert.doesNotMatch(
          info,
          /Alex Example|Sam Synthetic|Example and Synthetic|example.invalid/,
        );
      } else assert.match(text, /Alex Example/i);
      if (process.env.STRATUM_JOURNAL_PDF_DIR)
        await writeFile(
          join(
            process.env.STRATUM_JOURNAL_PDF_DIR,
            profile.id.replace(":", "-") + ".pdf",
          ),
          new Uint8Array(bytes),
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
