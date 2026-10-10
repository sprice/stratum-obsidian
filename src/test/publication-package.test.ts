import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
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
const require = createRequire(import.meta.url);
function installedTool(
  name: string,
  configured?: string,
  versionFlag = "--version",
): string {
  for (const candidate of [
    configured,
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, [versionFlag], { stdio: "ignore" });
      return candidate;
    } catch {
      /* Try the next installed location. */
    }
  }
  return "";
}
const pandoc = installedTool("pandoc", process.env.STRATUM_TEST_PANDOC);
const tectonic = installedTool("tectonic", process.env.STRATUM_TEST_TECTONIC);
const pdftotext = installedTool("pdftotext", undefined, "-v");

const sample = aastexPackage.files["examples/manuscript.md"];

test("bibliography stays external and requires an approved URL and checksum", () => {
  assert.equal(
    Object.keys(aastexPackage.files).some((path) => path.endsWith(".bst")),
    false,
  );
  const altered = (bibliographyDownload: unknown) => ({
    ...aastexPackage.files,
    "manifest.json": JSON.stringify({
      ...aastexPackage.manifest,
      bibliographyDownload,
    }),
  });
  for (const declaration of [
    undefined,
    { url: "https://example.com/style.bst", sha256: "a".repeat(64) },
    { ...aastexPackage.manifest.bibliographyDownload, sha256: "invalid" },
  ])
    assert.throws(
      () => loadPublicationPackage(altered(declaration)),
      /bibliography download/,
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
        format: "pdf",
        pdf: { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: source },
        docx: DEFAULT_ACADEMIC_OPTIONS,
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

test("output-specific requirements permit incomplete Word drafts, not incomplete AASTeX PDF", () => {
  const text =
    "---\nstratum_publish:\n  authors:\n    - name: Alex\n---\n## Introduction\nDraft";
  assert.equal(aastexProblems(text, "properties", "docx").errors.length, 0);
  assert.ok(
    aastexProblems(text, "properties", "docx").warnings.some((warning) =>
      warning.includes("email"),
    ),
  );
  assert.equal(aastexProblems(text, "properties", "pdf").errors.length, 3);
  assert.equal(aastexProblems(sample, "properties", "pdf").errors.length, 0);
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
test(
  "real packaged PDF compiles two authors, shared affiliations, a table, equation and native bibliography",
  { timeout: 120_000 },
  async () => {
    assert.ok(
      pandoc && tectonic,
      "Install Pandoc and Tectonic for the required compilation check.",
    );
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
    const reference = {
      id: "stratum0",
      type: "article-journal",
      title: "Synthetic bibliography verification",
      author: [{ family: "Example", given: "Alex" }],
      issued: { "date-parts": [[2026]] },
      "container-title": "Example Journal",
      volume: "1",
      page: "1-4",
    };
    const html =
      '<html><body><h1>Introduction</h1><p>A reference <span class="stratum-aastex-citation" data-tex="\\citep{stratum0}">Citation</span>.</p><p><span class="math inline">\\(E=mc^2\\)</span></p><table><caption>Synthetic measurements &amp; comparison</caption><thead><tr><th style="text-align:left">Sample</th><th style="text-align:right">Value</th><th style="text-align:center">Group</th></tr></thead><tbody><tr><td>A</td><td>1</td><td>Control</td></tr></tbody></table></body></html>';
    const probe = await mkdtemp(join(tmpdir(), "stratum-table-test-"));
    try {
      const filter = join(probe, "aastex.lua");
      await writeFile(filter, desktop.aastexFilter);
      const body = execFileSync(
        pandoc,
        ["-f", "html", "-t", "latex", `--lua-filter=${filter}`],
        { input: html, encoding: "utf8" },
      );
      assert.match(body, /\\caption\{Synthetic measurements \\& comparison\}/);
      assert.match(body, /\\multicolumn\{1\}\{r\}\{Value\}/);
      assert.match(body, /\\multicolumn\{1\}\{c\}\{Group\}/);
      assert.match(body, /A & 1 & Control/);
      const aligned = execFileSync(
        pandoc,
        ["-f", "markdown", "-t", "latex", `--lua-filter=${filter}`],
        {
          input:
            "| Left | Right | Center |\n|:--|--:|:--:|\n| A | 1 | Control |\n",
          encoding: "utf8",
        },
      );
      assert.match(aligned, /\\begin\{tabular\}\{lrc\}/);
      assert.throws(
        () =>
          execFileSync(
            pandoc,
            ["-f", "html", "-t", "latex", `--lua-filter=${filter}`],
            {
              input: '<table><tr><td colspan="2">Merged</td></tr></table>',
              encoding: "utf8",
              stdio: ["pipe", "pipe", "pipe"],
            },
          ),
        /Merged table cells are not supported/,
      );
    } finally {
      await rm(probe, { recursive: true, force: true });
    }
    for (const heading of ["section", "subsection", "prose"]) {
      const manuscriptHtml =
        heading === "section"
          ? html
          : html.replace(
              "<h1>Introduction</h1>",
              heading === "subsection"
                ? "<h2>Introduction</h2>"
                : "<p>Introduction</p>",
            );
      const bytes = await desktop.convertPublication(
        manuscriptHtml,
        [],
        "pdf",
        {
          pandoc,
          tectonic,
        },
        undefined,
        120_000,
        DEFAULT_ACADEMIC_OPTIONS,
        {
          manuscript: aastexManuscript(sample, "properties"),
          abstractHtml: "<p>Synthetic abstract</p>",
          references: [reference],
        },
      );
      assert.equal(
        new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5)),
        "%PDF-",
      );
      await writeFile(
        join(tmpdir(), "stratum-aastex-verified.pdf"),
        new Uint8Array(bytes),
      );
      if (pdftotext) {
        const text = execFileSync(
          pdftotext,
          [join(tmpdir(), "stratum-aastex-verified.pdf"), "-"],
          { encoding: "utf8" },
        );
        assert.match(text, /Synthetic measurements & comparison/);
        assert.match(text, /Control/);
        assert.match(text, /Example Journal/);
        assert.match(text, /Example.*2026/);
        assert.ok(!text.includes("A reference Citation"));
        assert.equal(
          (text.match(/Synthetic Stratum manuscript/g) ?? []).length,
          1,
          heading,
        );
        assert.equal(
          (text.match(/Synthetic abstract/g) ?? []).length,
          1,
          heading,
        );
        assert.match(text, /Alex Example/);
        assert.match(text, /Morgan Sample/);
      }
    }
  },
);

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
    aastexProblems(text, "properties", "pdf").errors.some((message) =>
      message.includes("affiliation"),
    ),
  );
  assert.equal(aastexProblems(text, "properties", "pdf", pkg).errors.length, 0);
  assert.ok(
    aastexProblems(text, "properties", "pdf", pkg).warnings.some((message) =>
      message.includes("affiliation"),
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
