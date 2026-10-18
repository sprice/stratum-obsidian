import assert from "node:assert/strict";
import test from "node:test";
import { cleanupPublicationProperties } from "../publication-cleanup";
import { publicationAuthors, publicationYaml } from "../publication-metadata";
import {
  DEFAULT_ACADEMIC_OPTIONS,
  DEFAULT_PUBLISH_OPTIONS,
  type PublishOptions,
} from "../publish-options";

function clean(
  source: string,
  layout: PublishOptions = DEFAULT_ACADEMIC_OPTIONS,
) {
  const change = cleanupPublicationProperties(source, layout);
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}
test("cleanup follows each template's effective mappings, including empty required title", () => {
  const source =
    '---\ntitle: ""\nauthors: []\naffiliations: []\ndate: null\nkeywords: {}\nother: null\n---\nBody\n';
  assert.equal(clean(source, DEFAULT_PUBLISH_OPTIONS), source);
  assert.equal(clean(source), '---\ntitle: ""\nother: null\n---\nBody\n');
  const titleOnly = {
    ...DEFAULT_PUBLISH_OPTIONS,
    titleSource: "properties" as const,
  };
  assert.equal(clean(source, titleOnly), source.replace('title: ""\n', ""));
  assert.equal(clean(source, DEFAULT_PUBLISH_OPTIONS), source);
  assert.equal(
    clean(source, { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: "properties" }),
    "---\nother: null\n---\nBody\n",
  );
  assert.equal(
    clean(source, {
      ...DEFAULT_ACADEMIC_OPTIONS,
      showDate: false,
      showKeywords: false,
    }),
    '---\ntitle: ""\ndate: null\nkeywords: {}\nother: null\n---\nBody\n',
  );
});
test("only literal empty values are removed, not populated or nonempty collections", () => {
  for (const value of ["null", '""', '"  "', "[]", "{}", ""])
    assert.equal(
      clean(`---\ntitle: ${value}\n---\nBody`, {
        ...DEFAULT_ACADEMIC_OPTIONS,
        titleSource: "properties",
      }),
      "---\n---\nBody",
    );
  for (const value of [
    "0",
    "false",
    "Text",
    '[""]',
    "[null]",
    '{name: ""}',
    "[{}]",
  ]) {
    const source = `---\ntitle: ${value}\n---\nBody`;
    assert.equal(
      clean(source, { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: "properties" }),
      source,
    );
  }
});
test("structured cleanup retains rows and unknown fields and obeys renderer field boundaries", () => {
  const source =
    '---\nstratum_publish:\n  custom: keep\n  authors:\n    - name: "" # retain name comment\n      email: ""\n      affiliations: []\n      orcid: ""\n    - name: ""\n      email: ""\n      affiliations: []\n---\nBody\n';
  const cleaned = clean(source, DEFAULT_ACADEMIC_OPTIONS);
  const props = publicationYaml(cleaned).properties;
  assert.equal(publicationAuthors(props).authors.length, 2);
  assert.match(cleaned, /# retain name comment/);
  assert.match(cleaned, /orcid: ""/);
  assert.match(cleaned, /custom: keep/);
  assert.doesNotMatch(cleaned, /name:|affiliations:/);
  assert.match(cleaned, /email: ""/);
  const academic = clean(source);
  assert.equal((academic.match(/email: ""/g) ?? []).length, 2);
  assert.equal(
    publicationAuthors(publicationYaml(academic).properties).authors.length,
    2,
  );
});
test("empty overrides never reactivate populated legacy authors, including simultaneous cleanup", () => {
  for (const source of [
    "---\nauthor: Legacy\nauthors: []\n---\nBody",
    "---\nauthors: [Legacy]\nstratum_publish:\n  authors: []\n---\nBody",
    "---\nauthor: Legacy\nauthors: []\nstratum_publish:\n  authors: []\n---\nBody",
  ]) {
    const before = publicationAuthors(
      publicationYaml(source).properties,
    ).authors;
    assert.deepEqual(
      publicationAuthors(publicationYaml(clean(source)).properties).authors,
      before,
    );
  }
  assert.equal(
    clean(
      "---\nstratum_publish:\n  authors: []\n---\nBody",
      DEFAULT_ACADEMIC_OPTIONS,
    ),
    "---\n---\nBody",
  );
});
test("empty namespace values can be repaired without touching unknown or legacy root fields", () => {
  for (const value of ["null", '""', "{}"])
    assert.equal(
      clean(
        `---\nstratum_publish: ${value}\nauthors: []\n---\nBody`,
        DEFAULT_ACADEMIC_OPTIONS,
      ),
      "---\n---\nBody",
    );
  assert.equal(
    clean(
      "---\nstratum_publish:\n  authors: null\n  custom: keep\n---\nBody",
      DEFAULT_ACADEMIC_OPTIONS,
    ),
    "---\nstratum_publish:\n  custom: keep\n---\nBody",
  );
});
test("targeted cleanup preserves CRLF, comments, unrelated YAML and body", () => {
  const source =
    '\uFEFF---\r\n# heading\r\ntitle: "" # title comment\r\ncustom: "exact" # untouched\r\nkeywords: []\r\n# body boundary\r\n---\r\nBody [[link]]\r\n';
  assert.equal(
    clean(source, { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: "properties" }),
    '\uFEFF---\r\n# heading\r\n# title comment\r\ncustom: "exact" # untouched\r\n# body boundary\r\n---\r\nBody [[link]]\r\n',
  );
});
test("anchors, aliases and flow mappings are preserved; malformed YAML reports an error", () => {
  for (const source of [
    '---\ntitle: &empty ""\nother: *empty\n---\nBody',
    '---\nother: &empty ""\ntitle: *empty\n---\nBody',
    '---\n{title: "", keywords: []}\n---\nBody',
    "---\nstratum_publish: &details\n  authors: []\nother: *details\n---\nBody",
  ])
    assert.equal(
      clean(source, { ...DEFAULT_ACADEMIC_OPTIONS, titleSource: "properties" }),
      source,
    );
  assert.throws(() => clean("---\ntitle: [\n---\nBody"), /invalid YAML/);
});

test("structured affiliation overrides and disabled field boundaries stay intact", () => {
  const source =
    "---\nstratum_publish:\n  authors: []\naffiliations: [University]\n---\nBody";
  assert.equal(
    clean(source, { ...DEFAULT_ACADEMIC_OPTIONS, showAuthors: false }),
    source,
  );
  const details =
    '---\nstratum_publish:\n  authors:\n    - name: ""\n      email: ""\n      affiliations: []\n---\nBody';
  const cleaned = clean(details, {
    ...DEFAULT_ACADEMIC_OPTIONS,
    showAuthors: false,
  });
  assert.match(cleaned, /name: ""/);
  assert.match(cleaned, /email: ""/);
  assert.doesNotMatch(cleaned, /affiliations:/);
});
test("null authors do not mask singular authors, and blank lines stay intact", () => {
  const source =
    "---\nauthor: Legacy\nauthors: null\n\ncustom: keep\n---\nBody";
  assert.equal(clean(source), source.replace("authors: null\n", ""));
});
