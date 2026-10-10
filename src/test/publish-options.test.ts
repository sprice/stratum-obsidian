import assert from "node:assert/strict";
import test from "node:test";
import {
  readPublishOptions,
  readNotePreferences,
  DEFAULT_ACADEMIC_OPTIONS,
} from "../publish-options";
import { preparePublishMath, protectTexDelimiters } from "../publish-math";
import { loadRuntime } from "./runtime-harness";
import { publicationAuthors } from "../publication-metadata";

function academicRuntime() {
  return loadRuntime<typeof import("../publish-academic")>(
    "publish-academic.ts",
    { parseYaml: JSON.parse },
    {},
    "node",
    { "./publication-metadata": { publicationAuthors } },
  );
}

test("publishing settings normalize malformed values and keep independent format choices", () => {
  const options = readPublishOptions({
    bodyFont: "Bad\\command",
    titleSize: -1,
    margin: 0,
    lineSpacing: Infinity,
  });
  assert.equal(options.bodyFont, "");
  assert.equal(options.titleSize, 24);
  const note = readNotePreferences({
    documentType: "academic",
    format: "pdf",
    pdf: { bodyFont: "Georgia", bodySize: 11 },
    docx: { bodyFont: "Arial", lineSpacing: 2 },
  });
  assert.equal(note.pdf.bodyFont, "Georgia");
  assert.equal(note.docx.bodyFont, "Arial");
  assert.equal(note.pdf.lineSpacing, DEFAULT_ACADEMIC_OPTIONS.lineSpacing);
  assert.equal(note.format, "pdf");
});

test("academic preparation preserves existing values, legacy author, and unrelated properties", () => {
  const academic = academicRuntime();
  const properties: Record<string, unknown> = {
    author: "Existing Writer",
    tags: ["private"],
    title: "Existing title",
    keywords: [],
  };
  academic.addAcademicProperties(properties, "Filename", {
    authors: ["Default Author"],
    affiliations: ["Example University"],
    keywords: ["example"],
    date: "",
  });
  assert.equal(properties.title, "Existing title");
  assert.equal(properties.author, "Existing Writer");
  assert.ok(!Object.hasOwn(properties, "authors"));
  assert.ok(!Object.hasOwn(properties, "date"));
  assert.deepEqual(properties.keywords, []);
  assert.deepEqual(properties.tags, ["private"]);
  const metadata = academic.academicMetadata(
    { ...properties, authors: ["Preferred Writer"] },
    "# Existing title\n\nBody text",
  );
  assert.equal(metadata.duplicateTitle, true);
  assert.equal(metadata.bothAuthors, true);
  assert.deepEqual(Array.from(metadata.authors), ["Preferred Writer"]);
  assert.match(academic.academicOpening(metadata), /Preferred Writer/);
  assert.throws(
    () => academic.academicOpening(academic.academicMetadata({ title: "" })),
    /nonempty title/,
  );
});

test("structured academic authors preserve affiliations and suppress legacy precedence notices", () => {
  const academic = academicRuntime();
  const properties = {
    title: "Synthetic manuscript",
    author: "Old singular author",
    authors: ["Old list author"],
    affiliations: ["Old global affiliation"],
    stratum_publish: {
      authors: [
        {
          name: "Alex Example",
          email: "alex@example.org",
          affiliations: ["University", "Observatory"],
        },
        {
          name: "Morgan Sample",
          email: "morgan@example.org",
          affiliations: ["University"],
        },
      ],
    },
  };
  const metadata = academic.academicMetadata(properties);
  assert.equal(metadata.bothAuthors, false);
  const opening = academic.academicOpening(metadata);
  assert.match(opening, /Alex Example, Morgan Sample/);
  assert.match(opening, /Alex Example: University; Observatory/);
  assert.match(opening, /Morgan Sample: University/);
  assert.doesNotMatch(opening, /Old |example\.org/);
  const empty = academic.academicOpening(
    academic.academicMetadata({
      ...properties,
      stratum_publish: { authors: [] },
    }),
  );
  assert.doesNotMatch(empty, /Old |University|Example|Sample/);
  assert.match(empty, /Synthetic manuscript/);
});

test("math preserves equations, ignores code and currency, and reports malformed display math", () => {
  const source =
    "Inline $x^2$ and $y+1$.\n\n$$\n\\begin{bmatrix}1 & 2\\\\3 & 4\\end{bmatrix}\n$$\n\n`$code$` costs $5 and $10.\n\n```tex\n$$example$$\n```";
  const math = preparePublishMath(source);
  const restored = math.restore(math.markdown);
  assert.equal((restored.match(/class="math /g) ?? []).length, 3);
  assert.match(restored, /bmatrix/);
  assert.match(restored, /&amp;/);
  assert.match(restored, /`\$code\$` costs \$5 and \$10/);
  assert.match(restored, /\$\$example\$\$/);
  assert.throws(
    () => preparePublishMath("$$missing"),
    /line 1.*closing delimiter/,
  );
  assert.throws(() => preparePublishMath("$\\input{private}$"), /unsupported/);
  for (const tex of ["\\csname input\\endcsname{x}", "^^5cinput{x}"])
    assert.throws(() => preparePublishMath(`$${tex}$`), /unsupported/);
  assert.throws(() => math.restore("No equations survived"), /Equation 1/);
});

test("backslash brackets stay Markdown escapes and never become Pandoc math", () => {
  const source = "He said \\[sic\\]. See \\[1] and \\(note\\).";
  const math = preparePublishMath(source);
  assert.equal(math.markdown, source);
  const html = math.restore(
    "<p>He said [sic]. Code <code>\\(\\d+\\)</code> \\[x\\]</p>",
  );
  assert.doesNotMatch(html, /\\[[(]/);
  assert.equal(
    protectTexDelimiters('<p title="a\\(b">\\(x\\)</p>'),
    '<p title="a\\(b">\\<span></span>(x\\)</p>',
  );
});

test("default fonts remain automatic while named fonts are honored", async () => {
  const { publicationHeader } = await import("../publish-layout");
  const automatic = readPublishOptions({ bodyFont: "", titleFont: "" });
  assert.doesNotMatch(
    publicationHeader(automatic),
    /newfontfamily|texgyretermes/,
  );
  const named = readPublishOptions({ bodyFont: "Times New Roman" });
  assert.equal(named.bodyFont, "Times New Roman");
  assert.match(publicationHeader(named), /stratumtitlefont\{Times New Roman\}/);
  assert.doesNotMatch(publicationHeader(named), /texgyretermes/);
  assert.match(
    publicationHeader(readPublishOptions({ titleFont: "Arial" })),
    /stratumtitlefont\{Arial\}/,
  );
});
