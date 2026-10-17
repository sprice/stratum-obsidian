import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import {
  aastexPackage,
  aastexProblems,
  aastexManuscript,
  aastexLatex,
  loadPublicationPackage,
} from "../publication-package";
import {
  aastexCitationKeys,
  aastexReferences,
  aastexFormattedDocument,
} from "../publication-citations";
import { loadRuntime } from "./runtime-harness";
import {
  DEFAULT_ACADEMIC_OPTIONS,
  type NotePublishPreferences,
} from "../publish-options";
const sample = aastexPackage.files["examples/manuscript.md"];

test("package input rejects malformed asset maps before reading files", () => {
  for (const assets of [
    null,
    undefined,
    "text",
    [],
    ["text"],
    42,
    { "manifest.json": 42 },
    { ...aastexPackage.files, "unexpected.txt": null },
  ])
    assert.throws(() => loadPublicationPackage(assets), /object of text files/);
  assert.equal(
    loadPublicationPackage(aastexPackage.files).manifest.id,
    "aastex",
  );
});

test("bibliography stays external to the renderer package", () => {
  assert.equal(
    Object.keys(aastexPackage.files).some((path) => path.endsWith(".bst")),
    false,
  );
  assert.throws(
    () =>
      loadPublicationPackage({
        ...aastexPackage.files,
        "vendor/extra.bst": "Unexpected bundled style",
      }),
    /external bibliography/,
  );
});

test("note rendering consumes the chosen title and promotes section headings without changing the abstract", async () => {
  const rendered: string[] = [];
  const { renderAastexPublication } = loadRuntime<
    typeof import("../publication-render")
  >("publication-render.ts", {}, {}, "browser", {
    "./publication-package": { aastexProblems },
    "./publication-citations": {
      aastexCitationKeys,
      aastexReferences,
      aastexFormattedDocument,
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
        templateId: "package:aastex",
        opening: "properties",
        pdf: { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: source },
      };
      const output = await renderAastexPublication(
        {} as never,
        { diagnose: () => Promise.resolve([]) } as never,
        text,
        "Papers/Synthetic manuscript.md",
        "Synthetic manuscript",
        preferences,
        new AbortController().signal,
      );
      assert.equal(
        output.aastex.manuscript.title,
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
      assert.match(output.aastex.abstractHtml, /A synthetic manuscript/);
      assert.equal(text.includes("# Consumed body title"), true);
    }
  }
});

test("AASTeX PDF requires publication metadata and an abstract", () => {
  const text =
    "---\nstratum_publish:\n  authors:\n    - name: Alex\n---\n## Introduction\nDraft";
  assert.deepEqual(aastexProblems(text, "properties", "pdf").issues, [
    {
      target: "title",
      message: "Add a manuscript title using the selected title source.",
      blocking: true,
    },
    {
      target: "author",
      author: 0,
      field: "email",
      message: "Author 1 needs an email address.",
      blocking: true,
    },
    {
      target: "author",
      author: 0,
      field: "affiliations",
      message: "Author 1 needs an affiliation/address.",
      blocking: true,
    },
    {
      target: "general",
      message:
        "No Abstract section was found. Check the journal's submission requirements.",
      blocking: false,
    },
  ]);
  assert.deepEqual(aastexProblems(sample, "properties", "pdf").issues, []);
});
test("AASTeX issues target the title, each author by position, or the whole note", () => {
  const text =
    "---\nstratum_publish:\n  authors:\n    - name: Alex\n      email: alex@example.org\n      affiliations: [Example University]\n    - name: ''\n      email: ''\n      affiliations: [Example Observatory]\n---\n# Body title\n";
  assert.deepEqual(
    aastexProblems(text, "body", "pdf").issues.map((issue) => [
      issue.target === "author" ? issue.author : issue.target,
      issue.message,
    ]),
    [
      [1, "Author 2 needs a name."],
      [1, "Author 2 needs an email address."],
      [
        "general",
        "No Abstract section was found. Check the journal's submission requirements.",
      ],
    ],
  );
  assert.deepEqual(
    aastexProblems("---\ntitle: Synthetic\n---\n", "properties", "pdf")
      .issues[0],
    {
      target: "general",
      message: "Add at least one author.",
      blocking: true,
    },
  );
});
test("title and abstract resolve once, nested abstract content survives, fenced headings are ignored", () => {
  const text =
    "# Body title\n\n## Abstract\nText\n### Detail\nMore\n## Introduction\nBody\n```md\n## Abstract\n```\n";
  const manuscript = aastexManuscript(text, "body");
  assert.equal(manuscript.title, "Body title");
  assert.match(manuscript.abstract, /### Detail\nMore/);
  assert.ok(!manuscript.body.startsWith("# Body title"));
  assert.throws(
    () => aastexManuscript(text + "\n## Abstract\nDuplicate", "body"),
    /multiple Abstract/,
  );
});
test("fence-like code lines with trailing content do not expose a literal Abstract heading", () => {
  for (const marker of ["```", "~~~"]) {
    const body = `${marker}text\n${marker}md\n## Abstract\nLiteral example.\n${marker}\n\n## Introduction\nBody`;
    const manuscript = aastexManuscript(`# Title\n\n${body}`, "body");
    assert.equal(manuscript.abstract, "");
    assert.equal(manuscript.body, body);
  }
});
test("metadata is escaped, email does not opt into printing, and class assets are pinned", () => {
  const manuscript = aastexManuscript(sample, "properties");
  manuscript.title = "50% & {special} \\ title";
  const tex = aastexLatex(manuscript, "Body", "Abstract", false);
  assert.match(tex, /50\\% \\& \\{special\\}/);
  assert.match(tex, /\\email\{alex@example.org\}/);
  assert.ok(!tex.includes("\\email[show]"));
  assert.match(tex, /documentclass\[twocolumn,linenumbers\]\{aastex702\}/);
  assert.ok(!tex.includes("{{"));
  assert.equal(aastexPackage.manifest.upstreamVersion, "7.0.2");
});
test("PDF switches independently select public class controls without changing official assets", () => {
  for (const showLineNumbers of [true, false])
    for (const showDraftDateHeader of [true, false]) {
      const tex = aastexLatex(
        aastexManuscript(sample, "properties"),
        "Body",
        "Abstract",
        false,
        aastexPackage,
        "",
        { showLineNumbers, showDraftDateHeader, numberedHeadings: false },
      );
      assert.equal(tex.includes("twocolumn,linenumbers"), showLineNumbers);
      assert.equal(tex.includes("\\journalinfo{}"), !showDraftDateHeader);
      assert.ok(!tex.includes("{{"));
    }
});
test("archive/extract relocates the package and bundled assets match reviewable source files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stratum-package-test-"));
  try {
    const source = join(directory, "source"),
      extracted = join(directory, "extracted");
    for (const [name, content] of Object.entries(aastexPackage.files)) {
      assert.equal(
        await readFile(
          new URL(`../publication-templates/aastex/${name}`, import.meta.url),
          "utf8",
        ),
        content,
      );
      await mkdir(dirname(join(source, name)), { recursive: true });
      await writeFile(join(source, name), content);
    }
    execFileSync("zip", ["-qr", join(directory, "package.zip"), "."], {
      cwd: source,
    });
    await mkdir(extracted);
    execFileSync("unzip", [
      "-q",
      join(directory, "package.zip"),
      "-d",
      extracted,
    ]);
    const relocated: Record<string, string> = {};
    for (const name of Object.keys(aastexPackage.files))
      relocated[name] = await readFile(join(extracted, name), "utf8");
    const pkg = loadPublicationPackage(relocated);
    assert.equal(
      aastexLatex(
        aastexManuscript(sample, "properties"),
        "Body",
        "Abstract",
        true,
        pkg,
      ),
      aastexLatex(
        aastexManuscript(sample, "properties"),
        "Body",
        "Abstract",
        true,
      ),
    );
    assert.throws(
      () => loadPublicationPackage({ ...relocated, "../escape": "x" }),
      /Invalid.*path/,
    );
    assert.throws(
      () =>
        loadPublicationPackage({
          ...relocated,
          "manifest.json": JSON.stringify({ formatVersion: 2 }),
        }),
      /unsupported/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("structured citation tokens preserve groups, narrative form, locators and safe IDs", () => {
  const source =
    "A group [@first; @second]. @first shows a result. [see @second, p. 12]";
  const { ids } = aastexReferences(
    ["first", "second"],
    [
      { id: "private-id-1", type: "article-journal" },
      { id: "private-id-2", type: "article-journal" },
    ],
  );
  const formatted = aastexFormattedDocument(source, ids);
  assert.equal(formatted.citations.length, 3);
  assert.match(formatted.citations[0], /\\citep\{stratum0,stratum1\}/);
  assert.match(formatted.citations[1], /\\citet\{stratum0\}/);
  assert.match(formatted.citations[2], /p\. 12/);
  assert.ok(
    formatted.citations.every((value) => !value.includes("private-id")),
  );
});

test("package declarations drive requirements and class rendering; inconsistent declarations are rejected", () => {
  const changed = {
    ...aastexPackage.files,
    [aastexPackage.manifest.schema]: JSON.stringify({
      ...aastexPackage.schema,
      fields: aastexPackage.schema.fields.map((field) =>
        field.path.endsWith(".affiliations")
          ? { ...field, requiredFor: [] }
          : field,
      ),
      rules: {
        ...aastexPackage.schema.rules,
        pdf: { ...aastexPackage.schema.rules.pdf, affiliations: "warning" },
      },
    }),
    [aastexPackage.manifest.defaults]: JSON.stringify({
      ...aastexPackage.defaults,
      classOptions: ["twocolumn"],
      printEmails: true,
    }),
  };
  const pkg = loadPublicationPackage(changed);
  const text = sample.replace(
    /affiliations:\n {8}- Example University[^\n]*\n/g,
    "affiliations: []\n",
  );
  assert.ok(
    aastexProblems(text, "properties", "pdf").issues.some(
      (issue) => issue.blocking && issue.message.includes("affiliation"),
    ),
  );
  const relaxed = aastexProblems(text, "properties", "pdf", pkg).issues;
  assert.equal(relaxed.filter((issue) => issue.blocking).length, 0);
  assert.ok(
    relaxed.some(
      (issue) =>
        !issue.blocking &&
        issue.target === "author" &&
        issue.message.includes("affiliation"),
    ),
  );
  const tex = aastexLatex(
    aastexManuscript(sample, "properties"),
    "Body",
    "Abstract",
    false,
    pkg,
  );
  assert.match(tex, /documentclass\[twocolumn\]\{aastex702\}/);
  assert.match(tex, /\\email\[show\]/);
  assert.throws(
    () =>
      loadPublicationPackage({
        ...changed,
        [pkg.manifest.schema]: JSON.stringify({ ...pkg.schema, fields: [] }),
      }),
    /fields.*missing/,
  );
  assert.throws(
    () => loadPublicationPackage({ ...changed, [pkg.manifest.defaults]: "{}" }),
    /defaults/,
  );
});
