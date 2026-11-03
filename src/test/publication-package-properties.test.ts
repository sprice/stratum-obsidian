import assert from "node:assert/strict";
import test from "node:test";
import { declarativePackageFixture } from "./publication-package-fixture";
import {
  readTemplatePackage,
  packageVariant,
  packageProblems,
} from "../publication-package";
import { preparePackageProperties } from "../publication-package-properties";
import { publicationYaml } from "../publication-metadata";
import { publicationManuscript } from "../publication-manuscript";

function prepare(text: string, filename = "Synthetic filename") {
  const { manifest } = declarativePackageFixture();
  const variant = packageVariant(manifest);
  const result = preparePackageProperties(text, filename, variant);
  const next =
    text.slice(0, result.change.from) +
    result.change.insert +
    text.slice(result.change.to);
  return { ...result, next, properties: publicationYaml(next).properties };
}
test("unfamiliar package prepares required properties using heading, abstract, and defaults without editing content", () => {
  const body =
    "\n# Synthetic heading\n\n## Abstract\nA synthetic abstract.\n\n## Body\nKeep **all** manuscript bytes.\n";
  const original = "---\ntags: [retained] # keep comment\n---\n" + body;
  const result = prepare(original);
  assert.equal(result.properties.title, "Synthetic heading");
  assert.equal(result.properties.abstract, "A synthetic abstract.");
  assert.equal(result.properties.short_header, "Synthetic heading");
  assert.equal(result.properties.grant_code, "SYNTHETIC");
  assert.deepEqual(result.properties.authors, []);
  assert.ok(!Object.hasOwn(result.properties, "notes"));
  assert.ok(result.next.includes("tags: [retained] # keep comment"));
  assert.ok(result.next.endsWith(body));
  assert.ok(result.remaining.includes("Add an author."));
  const twice = prepare(result.next);
  assert.deepEqual(twice.added, []);
  assert.equal(twice.next, result.next);
});
test("filename fallback ignores fenced headings and preserves existing blank, null, and malformed values", () => {
  const fallback = prepare("```md\n# Example only\n```\nBody");
  assert.equal(fallback.properties.title, "Synthetic filename");
  const original =
    "---\ntitle: '' # retained\nshort_header: null\ngrant_code: 123\nauthor: Existing Author\n---\n# Different heading\n";
  const result = prepare(original);
  assert.equal(result.properties.title, "");
  assert.equal(result.properties.short_header, null);
  assert.equal(result.properties.grant_code, 123);
  assert.ok(!Object.hasOwn(result.properties, "authors"));
  assert.ok(result.next.includes("title: '' # retained"));
});
test("long running-title suggestions stay editable and fail validation without truncation", () => {
  const title = "A".repeat(65);
  const result = prepare(`# ${title}\n`);
  assert.equal(result.properties.short_header, title);
  assert.match(result.remaining.join(" "), /50 characters/);
});
test("layout changes add new requirements and preserve values from previous layouts", () => {
  const { manifest } = declarativePackageFixture();
  const first = prepare("# Synthetic\n");
  const layout = manifest.variants[0];
  assert.ok("properties" in layout);
  layout.properties.push({
    key: "course",
    label: "Course",
    type: "text",
    required: true,
    default: "",
    prefill: [],
  });
  const variant = packageVariant(readTemplatePackage(manifest));
  const result = preparePackageProperties(first.next, "Synthetic", variant);
  assert.deepEqual(result.added, ["course"]);
  assert.ok(result.remaining.includes("Add Course."));
});
test("prepared property title and abstract print once while source headings stay unchanged", () => {
  const original =
    "# Synthetic\n\n## Abstract\nSynthetic abstract.\n\n## Body\nManuscript.";
  const result = prepare(original);
  const manuscript = publicationManuscript(result.next, "properties", {
    packageProperties: true,
  });
  assert.equal(manuscript.title, "Synthetic");
  assert.equal(manuscript.abstract, "Synthetic abstract.");
  assert.ok(!manuscript.body.includes("# Synthetic"));
  assert.ok(!manuscript.body.includes("## Abstract"));
  assert.ok(result.next.endsWith(original));
  assert.ok(
    publicationManuscript(result.next, "properties").body.includes(
      "# Synthetic",
    ),
    "legacy rendering remains unchanged",
  );
});
test("declarative schema rejects executable rules, invalid standard types, and duplicate properties", () => {
  const { manifest } = declarativePackageFixture();
  assert.equal(readTemplatePackage(manifest), manifest);
  for (const change of [
    (v: Record<string, unknown>[]) => {
      v[0].prefill = ["eval"];
    },
    (v: Record<string, unknown>[]) => {
      v[0].type = "authors";
    },
    (v: Record<string, unknown>[]) => {
      v.push(v[0]);
    },
  ]) {
    const copy = structuredClone(manifest);
    change(
      (copy.variants[0] as unknown as { properties: Record<string, unknown>[] })
        .properties,
    );
    assert.throws(() => readTemplatePackage(copy));
  }
});

test("preparation preserves one byte-order mark and the entire original body", () => {
  const body = "\uFEFF# Synthetic\nBody.";
  const result = prepare(body);
  assert.equal(result.next.split("\uFEFF").length, 2);
  assert.ok(result.next.startsWith("\uFEFF---"));
  assert.ok(result.next.endsWith("# Synthetic\nBody."));
});

test("an existing empty abstract remains empty and needs input despite a body abstract", () => {
  const result = prepare(
    "---\nabstract: '' # intentional\n---\n# Synthetic\n\n## Abstract\nBody abstract.\n",
  );
  assert.equal(result.properties.abstract, "");
  assert.ok(result.remaining.includes("Add an abstract."));
  assert.ok(result.next.includes("abstract: '' # intentional"));
});

test("package validation checks effective text defaults and blank required lists", () => {
  const { manifest } = declarativePackageFixture();
  const layout = manifest.variants[0];
  assert.ok("properties" in layout);
  layout.properties.push(
    {
      key: "review_header",
      label: "Review header",
      type: "text",
      required: false,
      default: "Too long",
      prefill: [],
      maxLength: 3,
    },
    {
      key: "topics",
      label: "Topics",
      type: "list",
      required: true,
      default: "",
      prefill: [],
    },
  );
  const issues = packageProblems(
    packageVariant(manifest),
    publicationManuscript(
      "---\ntopics: [' ', '  ']\n---\n# Synthetic\n",
      "body",
    ),
  );
  assert.ok(
    issues.includes(
      "Review header must be 3 characters or fewer. Edit the suggested value.",
    ),
  );
  assert.ok(issues.includes("Add Topics."));
});
