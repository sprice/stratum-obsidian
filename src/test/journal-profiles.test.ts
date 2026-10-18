import assert from "node:assert/strict";
import test from "node:test";
import {
  journalProfile,
  journalProblems,
  journalReference,
  journalLatex,
} from "../journal-profiles";
import { installedJournalProfile } from "../publication-installed-templates";
import { installationFixture } from "./publication-installation-fixture";
import { readNotePreferences } from "../publish-options";
import { journalFormattedDocument } from "../publication-citations";
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

const manifest = installationFixture().manifest;
const profile = installedJournalProfile(manifest);
test("profiles come only from exact registry installations", () => {
  assert.equal(journalProfile("journal:ieee-journal"), undefined);
  assert.equal(journalProfile("package:aastex"), undefined);
  assert.deepEqual(journalProfile(profile.id, [manifest]), profile);
  const result = journalProblems(source, "body", profile);
  assert.equal(result.issues.length, 0);
  assert.match(
    journalLatex(profile, result.manuscript, "Body", "Abstract", false),
    /documentclass/,
  );
});
test("disabled keywords preserve note values without blocking or publishing them", () => {
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
test("exact registry approval references survive persistence", () => {
  const reference = journalReference(profile);
  const value = {
    templateId: profile.id,
    journalPackages: { [profile.id]: reference, unsafe: reference },
  };
  assert.deepEqual(readNotePreferences(value).journalPackages, {
    [profile.id]: reference,
  });
});

test("numeric citations retain narrative names and locators", () => {
  const references = [
    {
      id: "stratum0",
      type: "article-journal",
      author: [{ family: "Example" }],
    },
  ];
  const ids = new Map([["key", "stratum0"]]);
  const result = journalFormattedDocument(
    "@key shows a result. [@key, p. 12]",
    ids,
    references,
    true,
  );
  assert.match(result.citations[0], /Example~.*citep/);
  assert.match(result.citations[1], /p\. 12/);
  assert.throws(
    () => journalFormattedDocument("[-@key]", ids, references, true),
    /Suppress-author/,
  );
});

function installedProfile(
  frontMatter: typeof manifest.adapter.frontMatter,
  cls = "class",
) {
  const installation = installationFixture().manifest;
  installation.adapter.frontMatter = frontMatter;
  installation.adapter.documentClass = cls;
  installation.pin.runtime[`${cls}.cls`] =
    installation.pin.runtime["class.cls"];
  return installedJournalProfile(installation);
}

for (const [frontMatter, cls] of [
  ["standard", "class"],
  ["standard", "llncs"],
  ["standard", "mnras"],
  ["acmart", "acmart"],
  ["revtex", "revtex4-2"],
  ["elsarticle", "elsarticle"],
  ["cas", "cas-sc"],
  ["aastex5", "aastex"],
  ["aastex7", "aastex701"],
] as const) {
  test(`${frontMatter}/${cls} retains enabled keywords and omits disabled keywords`, () => {
    const profile = installedProfile(frontMatter, cls);
    for (const enabled of [true, false]) {
      const { manuscript } = journalProblems(source, "body", profile, enabled);
      const tex = journalLatex(profile, manuscript, "Body", "Abstract", false);
      assert.equal(tex.includes("synthetic, validation"), enabled);
    }
  });
}

test("ACM retains extra affiliations and supplied publication metadata", () => {
  const profile = installedProfile("acmart", "acmart");
  const { manuscript } = journalProblems(source, "body", profile);
  Object.assign(manuscript.properties, {
    stratum_running_title: "Short [title] & methods",
    stratum_acm_conference: "Synthetic Conference",
    stratum_acm_year: "2026",
    stratum_acm_doi: "10.0000/synthetic",
  });
  const tex = journalLatex(profile, manuscript, "Body", "Abstract", false);
  assert.ok(tex.includes(String.raw`\title[{Short [title] \& methods}]`));
  assert.ok(
    tex.includes(
      String.raw`\renewcommand{\shortauthors}{Example and Synthetic}`,
    ),
  );
  assert.equal(tex.match(/\\affiliation\{/g)?.length, 2);
  assert.ok(
    tex.includes(
      String.raw`\additionalaffiliation{\institution{Second Institute}}`,
    ),
  );
  assert.ok(tex.includes(String.raw`\authornote{Corresponding author.}`));
  assert.ok(tex.includes(String.raw`\acmConference{Synthetic Conference}{}{}`));
  assert.ok(tex.includes(String.raw`\acmYear{2026}`));
  assert.ok(tex.includes(String.raw`\acmDOI{10.0000/synthetic}`));
});

test("anonymous ACM omits author identities and does not require author metadata", () => {
  const profile = installedProfile("acmart", "acmart");
  profile.installation.adapter.classOptions = [
    "manuscript",
    "review",
    "anonymous",
  ];
  const anonymous = installedJournalProfile(profile.installation);
  assert.equal(anonymous.anonymous, true);
  const { manuscript } = journalProblems(source, "body", anonymous);
  const tex = journalLatex(anonymous, manuscript, "Body", "Abstract", false);
  for (const identity of [
    "Alex Example",
    "Sam Synthetic",
    "Example Institute",
    "alex@example.invalid",
    "Example and Synthetic",
  ])
    assert.ok(!tex.includes(identity), identity);
  assert.ok(tex.includes("pdfauthor={}"));
  const withoutAuthors = source.slice(source.indexOf("# Synthetic"));
  assert.deepEqual(
    journalProblems(withoutAuthors, "body", anonymous).issues,
    [],
  );
});

for (const [frontMatter, cls, author] of [
  [
    "elsarticle",
    "elsarticle",
    String.raw`\author[1,2]{Alex Example\corref{corresponding}}`,
  ],
  ["cas", "cas-sc", String.raw`\author[1,2]{Alex Example}`],
  ["standard", "llncs", String.raw`Alex Example\inst{1,2}`],
  ["standard", "mnras", String.raw`Alex Example$^{1,2}$`],
] as const) {
  test(`${cls} preserves author-to-affiliation assignments`, () => {
    const profile = installedProfile(frontMatter, cls);
    const { manuscript } = journalProblems(source, "body", profile);
    const tex = journalLatex(profile, manuscript, "Body", "Abstract", false);
    assert.ok(tex.includes(author));
    assert.ok(tex.includes("Second Institute"));
    assert.ok(tex.includes("alex@example.invalid"));
    if (cls === "cas-sc") assert.ok(tex.includes(String.raw`\cormark[1]`));
  });
}
