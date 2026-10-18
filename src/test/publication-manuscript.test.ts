import assert from "node:assert/strict";
import test from "node:test";
import { publicationManuscript, escapeLatex } from "../publication-manuscript";
import {
  publicationCitationKeys,
  publicationReferences,
  publicationFormattedDocument,
  journalFormattedDocument,
} from "../publication-citations";
import { loadRuntime } from "./runtime-harness";
import {
  DEFAULT_ACADEMIC_OPTIONS,
  type NotePublishPreferences,
} from "../publish-options";
import { manuscriptSample as sample } from "./publication-manuscript-fixture";
import installation from "./fixtures/installation.json";
import { readTemplateInstallation } from "../publication-installation";
import { installedJournalProfile } from "../publication-installed-templates";
const profile = installedJournalProfile(readTemplateInstallation(installation));
test("note rendering consumes the chosen title and promotes section headings without changing the abstract", async () => {
  const rendered: string[] = [];
  const { renderJournalPublication } = loadRuntime<
    typeof import("../publication-render")
  >("publication-render.ts", {}, {}, "browser", {
    "./publication-citations": {
      publicationCitationKeys,
      publicationReferences,
      publicationFormattedDocument,
      journalFormattedDocument,
    },
    "./publish-render": {
      renderPublication: (_app: unknown, markdown: string) => {
        rendered.push(markdown);
        return Promise.resolve({
          html: markdown.replace(
            /^(#{1,6}) (.+)$/gm,
            (_match, hashes: string, title: string) =>
              `<h${hashes.length}>${title}</h${hashes.length}>`,
          ),
          assets: [],
        });
      },
    },
  });
  for (const source of ["properties", "body"] as const) {
    for (const topLevel of [1, 2]) {
      rendered.length = 0;
      const text = sample
        .replace("## Abstract", "# Consumed body title\n\n## Abstract")
        .replace(
          "## Introduction",
          `${"#".repeat(topLevel)} Introduction\n\n${"#".repeat(topLevel + 1)} Detail`,
        );
      const preferences: NotePublishPreferences = {
        documentType: "academic",
        templateId: "registry:example:1.0-r1",
        opening: "properties",
        pdf: { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: source },
      };
      const output = await renderJournalPublication(
        {} as never,
        { diagnose: () => Promise.resolve([]) } as never,
        text,
        "Papers/Synthetic manuscript.md",
        "Synthetic manuscript",
        preferences,
        new AbortController().signal,
        profile,
      );
      assert.equal(
        output.journal.manuscript.title,
        source === "body"
          ? "Consumed body title"
          : "Synthetic Stratum manuscript",
      );
      if (source === "body") {
        assert.ok(!rendered[0].includes("Consumed body title"));
        assert.match(output.html, /<h1>Introduction<\/h1>/);
        assert.match(output.html, /<h2>Detail<\/h2>/);
      } else {
        // A frontmatter title does not consume an unrelated leading body heading.
        assert.match(output.html, /<h1>Consumed body title<\/h1>/);
        assert.match(
          output.html,
          new RegExp(`<h${topLevel}>Introduction<\\/h${topLevel}>`),
        );
      }
      assert.ok(!rendered[0].includes("## Abstract"));
      assert.match(output.journal.abstractHtml, /A synthetic manuscript/);
      assert.equal(text.includes("# Consumed body title"), true);
    }
  }
});

test("title and abstract resolve once, nested abstract content survives, fenced headings are ignored", () => {
  const text =
    "# Body title\n\n## Abstract\nText\n### Detail\nMore\n## Introduction\nBody\n```md\n## Abstract\n```\n";
  const manuscript = publicationManuscript(text, "body");
  assert.equal(manuscript.title, "Body title");
  assert.match(manuscript.abstract, /### Detail\nMore/);
  assert.ok(!manuscript.body.startsWith("# Body title"));
  assert.throws(
    () => publicationManuscript(text + "\n## Abstract\nDuplicate", "body"),
    /multiple Abstract/,
  );
});

test("fence-like code lines with trailing content do not expose a literal Abstract heading", () => {
  for (const marker of ["```", "~~~"]) {
    const body = `${marker}text\n${marker}md\n## Abstract\nLiteral example.\n${marker}\n\n## Introduction\nBody`;
    const manuscript = publicationManuscript(`# Title\n\n${body}`, "body");
    assert.equal(manuscript.abstract, "");
    assert.equal(manuscript.body, body);
  }
});

test("structured citation tokens preserve groups, narrative form, locators and safe IDs", () => {
  const source =
    "A group [@first; @second]. @first shows a result. [see @second, p. 12]";
  const { ids } = publicationReferences(
    ["first", "second"],
    [
      { id: "private-id-1", type: "article-journal" },
      { id: "private-id-2", type: "article-journal" },
    ],
  );
  const formatted = publicationFormattedDocument(source, ids);
  assert.equal(formatted.citations.length, 3);
  assert.match(formatted.citations[0], /\\citep\{stratum0,stratum1\}/);
  assert.match(formatted.citations[1], /\\citet\{stratum0\}/);
  assert.match(formatted.citations[2], /p\. 12/);
  assert.ok(
    formatted.citations.every((value) => !value.includes("private-id")),
  );
});

test("LaTeX metadata escaping preserves literal special characters", () => {
  assert.equal(escapeLatex("50% & {special}"), "50\\% \\& \\{special\\}");
});

test("registry exports ignore every legacy layout switch and package approval", async () => {
  const { renderJournalPublication } = loadRuntime<
    typeof import("../publication-render")
  >("publication-render.ts", {}, {}, "browser", {
    "./publication-citations": {
      publicationCitationKeys,
      publicationReferences,
      publicationFormattedDocument,
      journalFormattedDocument,
    },
    "./publish-render": {
      renderPublication: (
        _app: unknown,
        markdown: string,
        _path: string,
        _title: string,
        formatted: unknown,
      ) =>
        Promise.resolve({
          html: JSON.stringify({ markdown, formatted }),
          assets: [],
        }),
    },
  });
  const preferences: NotePublishPreferences = {
    templateId: profile.id,
    documentType: "academic",
    opening: "properties",
    pdf: { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: "properties" },
  };
  const render = (prefs: NotePublishPreferences) =>
    renderJournalPublication(
      {} as never,
      { diagnose: () => Promise.resolve([]) } as never,
      sample + "\n## 1. Literal heading\n",
      "Papers/Synthetic.md",
      "Synthetic",
      prefs,
      new AbortController().signal,
      profile,
    );
  const baseline = await render(preferences);
  for (const showLineNumbers of [true, false])
    for (const showDraftDateHeader of [true, false])
      for (const numberedHeadings of [true, false]) {
        const legacy = {
          ...preferences,
          aastex: {
            options: { showLineNumbers, showDraftDateHeader, numberedHeadings },
            package: { id: "aastex", version: "0.1", upstreamVersion: "6.0" },
          },
        };
        assert.deepEqual(await render(legacy), baseline);
      }
  assert.match(baseline.html, /1\. Literal heading/);
  assert.ok(!("options" in baseline.journal));
  await assert.rejects(
    renderJournalPublication(
      {} as never,
      {} as never,
      sample,
      "Synthetic.md",
      "Synthetic",
      preferences,
      new AbortController().signal,
      undefined as never,
    ),
    /Install this template/,
  );
});

test("exports select citation commands by citation style in both the body and abstract", async () => {
  const { renderJournalPublication } = loadRuntime<
    typeof import("../publication-render")
  >("publication-render.ts", {}, {}, "browser", {
    "./publication-citations": {
      publicationCitationKeys,
      publicationReferences,
      journalFormattedDocument,
    },
    "./publish-render": {
      renderPublication: (
        _app: unknown,
        _markdown: string,
        _path: string,
        _title: string,
        formatted: { citations: string[] },
      ) =>
        Promise.resolve({ html: formatted.citations.join("\n"), assets: [] }),
    },
  });
  const source = sample + "\nEvidence [@synthetic].\n";
  for (const citations of ["numeric", "author-year"] as const) {
    const journal = { ...profile, citations };
    const result = await renderJournalPublication(
      {} as never,
      {
        diagnose: (keys: string[]) =>
          Promise.resolve(
            keys.map((key) => ({
              key,
              reference: {
                id: key,
                type: "article-journal",
                author: [{ family: "Example" }],
              },
            })),
          ),
      } as never,
      source.replace(
        "## Abstract",
        "## Abstract\nAbstract evidence [@synthetic].\n",
      ),
      "Papers/Synthetic.md",
      "Synthetic",
      {
        templateId: journal.id,
        documentType: "academic",
        opening: "properties",
        pdf: { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: "properties" },
      },
      new AbortController().signal,
      journal,
    );
    for (const html of [result.html, result.journal.abstractHtml]) {
      assert.match(
        html,
        citations === "numeric" ? /\\cite\{stratum0\}/ : /\\citep\{stratum0\}/,
      );
      if (citations === "numeric") assert.doesNotMatch(html, /\\cite[pt]/);
    }
  }
});
