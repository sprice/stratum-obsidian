import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiteratureNoteContent,
  findExistingLiteratureNoteMatch,
  markLiteratureNoteAsDeletedContent,
  preprocessZoteroNoteHtml,
  type LiteratureNoteCandidate,
} from "../literature-note-content";
import type { OpenAlexEnrichment, ZoteroItemDetail } from "../backend-client";

const DEFAULT_ITEM: ZoteroItemDetail["item"] = {
  key: "ABCD1234",
  version: 12,
  title: "Using Machine Learning to Advance Personality Assessment and Theory",
  creators: ["Wiebke Bleidorn", "Christopher James Hopwood"],
  year: "2019",
  date: "2019-05-01",
  itemType: "journalArticle",
  abstract: "An abstract from Zotero.",
  doi: "10.0000/example",
  url: "https://example.com/paper",
  publicationTitle: "Journal of Examples",
  collections: [{ key: "COLLECTION1", name: "Machine Learning Review" }],
  tags: ["personality", "ml"],
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

const DEFAULT_OPENALEX_ENRICHMENT: OpenAlexEnrichment = {
  openAlexId: "https://openalex.org/W1234567890",
  doi: "https://doi.org/10.0000/example",
  title: "Using Machine Learning to Advance Personality Assessment and Theory",
  publicationYear: 2019,
  publicationDate: "2019-05-01",
  type: "article",
  language: "en",
  citedByCount: 42,
  countsByYear: [
    { year: 2025, citedByCount: 10 },
    { year: 2024, citedByCount: 9 },
    { year: 2023, citedByCount: 8 },
  ],
  fwci: 5.2,
  citationPercentile: {
    value: 0.95,
    isInTop1Percent: false,
    isInTop10Percent: true,
  },
  isRetracted: false,
  isOpenAccess: true,
  oaStatus: "gold",
  oaUrl: "https://example.com/open-access.pdf",
  apc: { value: 3000, currency: "USD" },
  primaryLocation: {
    sourceName: "Journal of Examples",
    sourceType: "journal",
    landingPageUrl: "https://example.com/paper",
    pdfUrl: "https://example.com/open-access.pdf",
    isOa: true,
  },
  authorships: [
    {
      authorName: "Wiebke Bleidorn",
      orcid: null,
      institutions: ["University of Example"],
      isCorresponding: true,
    },
  ],
  topics: [
    {
      name: "Personality Assessment",
      score: 0.95,
      subfield: "Personality Psychology",
      field: "Psychology",
      domain: "Social Sciences",
    },
    {
      name: "Machine Learning",
      score: 0.88,
      subfield: "Artificial Intelligence",
      field: "Computer Science",
      domain: "Physical Sciences",
    },
  ],
  keywords: [
    { keyword: "personality", score: 0.9 },
    { keyword: "assessment", score: 0.8 },
  ],
  funders: [{ name: "Example Foundation", awardId: "EF-123" }],
  sustainableDevelopmentGoals: [{ name: "Quality Education", score: 0.7 }],
  abstractFromOpenAlex: null,
  referencedWorksCount: 12,
  relatedWorksCount: 5,
  ids: {
    openalex: "https://openalex.org/W1234567890",
    doi: "https://doi.org/10.0000/example",
    pmid: null,
    pmcid: null,
  },
  updatedDate: "2026-03-26",
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
    attachments: [
      {
        key: "ATTACH1",
        title: "Main PDF",
        itemType: "attachment",
        contentType: "application/pdf",
        linkMode: "imported_file",
        filename: "paper.pdf",
        url: null,
        zoteroSelectUri: "zotero://select/library/items/ATTACH1",
        zoteroOpenPdfUri: "zotero://open-pdf/library/items/ATTACH1",
      },
    ],
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
          Array.isArray(entry) ? `[${entry.join(", ")}]` : String(entry)
        }`,
    )
    .join("\n");
}

test("buildLiteratureNoteContent preserves invalid frontmatter during updates", () => {
  const existingContent = [
    "---",
    "aliases: [broken",
    "---",
    "This is existing user content.",
    "",
    "> [!stratum]- My Notes",
    "> Everything above this line is managed by Stratum.",
    "",
    "Personal analysis lives here.",
  ].join("\n");

  const output = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    existingContent,
    parseYaml: () => {
      throw new Error("invalid yaml");
    },
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /zotero_item_identity: user\/123456\/ABCD1234/);
  assert.match(output, /aliases: \[broken/);
  assert.match(output, /Personal analysis lives here\./);
});

test("buildLiteratureNoteContent emits native metadata and omits empty managed sections", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(
    output,
    /aliases: \[Bleidorn & Hopwood 2019, Using Machine Learning to Advance Personality Assessment and Theory\]/,
  );
  assert.match(output, /stratum_filename_stem: Managed Name/);
  assert.match(output, /zotero_status: active/);
  assert.match(output, /zotero_item_version: 12/);
  assert.match(output, /zotero_attachment_keys: \[ATTACH1\]/);
  assert.match(output, /zotero_note_keys: \[\]/);
  assert.match(output, /zotero_annotation_keys: \[\]/);
  assert.doesNotMatch(output, /zotero_version:/);
  assert.match(output, /zotero_library_name: My Library/);
  assert.match(
    output,
    /tags: \[literature-note, source\/zotero, reference\/journal-article, zotero\/personality, zotero\/ml\]/,
  );
  assert.match(
    output,
    /authors: \[\[\[Wiebke Bleidorn\]\], \[\[Christopher James Hopwood\]\]\]/,
  );
  assert.match(output, /publication: \[\[Journal of Examples\]\]/);
  assert.match(output, /collections: \[\[\[Machine Learning Review\]\]\]/);
  assert.match(
    output,
    /\*\*Authors\*\*: \[\[Wiebke Bleidorn\]\], \[\[Christopher James Hopwood\]\]/,
  );
  assert.match(output, /\*\*Publication\*\*: \[\[Journal of Examples\]\]/);
  // Collections and Topics are now in the Details callout
  assert.match(output, /\[!example\]\+ Details/);
  assert.match(output, /\*\*Collections\*\*: \[\[Machine Learning Review\]\]/);
  assert.match(output, /\*\*Topics\*\*: #zotero\/personality #zotero\/ml/);
  assert.match(output, /> \[!abstract\]\+ Abstract/);
  assert.doesNotMatch(output, /## Zotero Notes/);
  assert.doesNotMatch(output, /## Highlights/);
  assert.match(output, /\[!stratum\]/);
});

test("buildLiteratureNoteContent renders Zotero notes as foldable callouts", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      zoteroNotes: [
        {
          key: "NOTE1",
          parentItemKey: "ABCD1234",
          html: "First imported insight from Zotero.\n\nSupporting detail.",
          dateAdded: "2026-03-14T17:55:00Z",
          dateModified: "2026-03-14T17:56:02Z",
          zoteroSelectUri: "zotero://select/library/items/NOTE1",
        },
      ],
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /## Zotero Notes/);
  assert.match(
    output,
    /> \[!note\]\+ Zotero note 1 · First imported insight from Zotero\./,
  );
  assert.match(
    output,
    /> \[Open in Zotero\]\(zotero:\/\/select\/library\/items\/NOTE1\) · Last modified: 2026-03-14T17:56:02Z/,
  );
  assert.match(output, /> First imported insight from Zotero\./);
  assert.match(output, /> Supporting detail\./);
});

test("buildLiteratureNoteContent strips OpenAlex blocks when enrichment is absent on update", () => {
  const existingContent = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
    enrichment: DEFAULT_OPENALEX_ENRICHMENT,
  });

  const output = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    existingContent,
    parseYaml: () => ({
      openalex_id: "https://openalex.org/W1234567890",
      cited_by_count: 42,
      openalex_topics: ["Personality Assessment", "Machine Learning"],
    }),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.doesNotMatch(output, /cited_by_count:/);
  assert.doesNotMatch(output, /openalex_id:/);
  assert.doesNotMatch(output, /> \[!bar-chart\]- Impact/);
  assert.doesNotMatch(output, /> \[!globe\]- Enrichment/);
});

test("buildLiteratureNoteContent preserves existing OpenAlex blocks when enrichment is explicitly deferred and DOI is unchanged", () => {
  const existingContent = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
    enrichment: DEFAULT_OPENALEX_ENRICHMENT,
  });

  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        title: "Updated Zotero Title",
      },
    }),
    filenameStem: "Managed Name",
    existingContent,
    parseYaml: () => ({
      doi: "10.0000/example",
      openalex_id: "https://openalex.org/W1234567890",
      openalex_status: "enriched",
      cited_by_count: 42,
    }),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
    enrichment: undefined,
  });

  assert.match(output, /Updated Zotero Title/);
  assert.match(output, /openalex_id: https:\/\/openalex\.org\/W1234567890/);
  assert.match(output, /openalex_status: enriched/);
  assert.match(output, /> \[!bar-chart\]\+ Impact/);
  assert.match(output, /> \[!globe\]\+ Enrichment/);
});

test("buildLiteratureNoteContent normalizes legacy OpenAlex section labels when preserving deferred enrichment", () => {
  const existingContent = [
    "---",
    "doi: 10.0000/example",
    "openalex_id: https://openalex.org/W1234567890",
    "openalex_status: enriched",
    "---",
    "",
    "<!-- stratum:managed:start -->",
    "> [!cite]- Cite",
    "> Placeholder",
    "",
    "> [!bar-chart]+ Impact",
    "> **Cited by**: 42",
    "> **OpenAlex**: [W1234567890](https://openalex.org/W1234567890)",
    "",
    "> [!globe]+ OpenAlex",
    "> **Topics**: [[Machine Learning]]",
    "",
    "<!-- stratum:managed:end -->",
    "",
    "> [!stratum]- My Notes",
    "> Everything above this line is managed by Stratum.",
    "",
  ].join("\n");

  const output = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    existingContent,
    parseYaml: () => ({
      doi: "10.0000/example",
      openalex_id: "https://openalex.org/W1234567890",
      openalex_status: "enriched",
    }),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
    enrichment: undefined,
  });

  assert.match(output, /> \[!globe\]\+ Enrichment/);
  assert.match(
    output,
    /> \*\*Enrichment\*\*: \[W1234567890\]\(https:\/\/openalex\.org\/W1234567890\)/,
  );
  assert.doesNotMatch(output, /> \[!globe\]\+ OpenAlex/);
  assert.doesNotMatch(output, /\*\*OpenAlex\*\*:/);
});

test("buildLiteratureNoteContent clears existing OpenAlex blocks when enrichment is deferred and DOI changed", () => {
  const existingContent = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
    enrichment: DEFAULT_OPENALEX_ENRICHMENT,
  });

  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        doi: "10.0000/different",
      },
    }),
    filenameStem: "Managed Name",
    existingContent,
    parseYaml: () => ({
      doi: "10.0000/example",
      openalex_id: "https://openalex.org/W1234567890",
      openalex_status: "enriched",
      cited_by_count: 42,
    }),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
    enrichment: undefined,
  });

  assert.match(output, /doi: 10.0000\/different/);
  assert.doesNotMatch(output, /openalex_id:/);
  assert.doesNotMatch(output, /> \[!bar-chart\]- Impact/);
  assert.doesNotMatch(output, /> \[!globe\]- Enrichment/);
});

test("buildLiteratureNoteContent renders highlights as grouped callouts", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      annotations: [
        {
          key: "ANNOT1",
          attachmentKey: "ATTACH1",
          type: "highlight",
          color: "#ffd400",
          pageLabel: "4",
          text: "A useful highlighted sentence.",
          comment: "This matters.",
          dateModified: "2026-03-14T18:00:00Z",
          zoteroOpenPdfUri:
            "zotero://open-pdf/library/items/ATTACH1?page=4&annotation=ANNOT1",
        },
      ],
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /## Highlights/);
  assert.match(output, /> \[!stratum-yellow\]\+ Yellow · 1 highlight/);
  assert.match(output, /> \*\*Page 4\*\* · highlight/);
  assert.match(output, /> A useful highlighted sentence\./);
  assert.doesNotMatch(output, /> Comment: This matters\./);
  assert.match(
    output,
    /> \[Open annotation in Zotero\]\(zotero:\/\/open-pdf\/library\/items\/ATTACH1\?page=4&annotation=ANNOT1\)/,
  );
});

test("buildLiteratureNoteContent keeps grouped highlights expanded when there are many", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      annotations: [
        {
          key: "ANNOT1",
          attachmentKey: "ATTACH1",
          type: "highlight",
          color: "#ffd400",
          pageLabel: "4",
          text: "First highlight.",
          comment: null,
          dateModified: null,
          zoteroOpenPdfUri:
            "zotero://open-pdf/library/items/ATTACH1?page=4&annotation=ANNOT1",
        },
        {
          key: "ANNOT2",
          attachmentKey: "ATTACH1",
          type: "highlight",
          color: "#ffd400",
          pageLabel: "5",
          text: "Second highlight.",
          comment: null,
          dateModified: null,
          zoteroOpenPdfUri:
            "zotero://open-pdf/library/items/ATTACH1?page=5&annotation=ANNOT2",
        },
        {
          key: "ANNOT3",
          attachmentKey: "ATTACH1",
          type: "highlight",
          color: "#00ff00",
          pageLabel: "6",
          text: "Third highlight.",
          comment: null,
          dateModified: null,
          zoteroOpenPdfUri:
            "zotero://open-pdf/library/items/ATTACH1?page=6&annotation=ANNOT3",
        },
      ],
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /> \[!stratum-yellow\]\+ Yellow · 2 highlights/);
  assert.match(output, /> \[!stratum-green\]\+ Green · 1 highlight/);
});

test("markLiteratureNoteAsDeletedContent updates frontmatter and adds a warning", () => {
  const existingContent = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  const output = markLiteratureNoteAsDeletedContent({
    existingContent,
    parseYaml: () => ({
      zotero_status: "active",
    }),
    stringifyYaml: stringifyForTest,
  });

  assert.match(output, /zotero_status: deleted/);
  assert.match(output, /> \[!warning\] This item was removed from Zotero/);
  assert.match(
    output,
    /> The source item is no longer in your Zotero library\. This note is preserved but will no longer receive updates\./,
  );
});

test("buildLiteratureNoteContent keeps Zotero notes expanded when multiple are present", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      zoteroNotes: [
        {
          key: "NOTE1",
          parentItemKey: "ABCD1234",
          html: "First note.",
          dateAdded: null,
          dateModified: null,
          zoteroSelectUri: "zotero://select/library/items/NOTE1",
        },
        {
          key: "NOTE2",
          parentItemKey: "ABCD1234",
          html: "Second note.",
          dateAdded: null,
          dateModified: null,
          zoteroSelectUri: "zotero://select/library/items/NOTE2",
        },
      ],
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /> \[!note\]\+ Zotero note 1 · First note\./);
  assert.match(output, /> \[!note\]\+ Zotero note 2 · Second note\./);
});

test("buildLiteratureNoteContent removes stale managed frontmatter keys on update", () => {
  const existingContent = [
    "---",
    "zotero_title: Old title",
    "zotero_publication_title: Old journal",
    "tags: [custom/topic]",
    "custom_property: Keep me",
    "zotero_version: 11",
    "---",
    "",
    "> [!stratum]- My Notes",
    "> Managed by Stratum.",
    "",
    "User notes stay here.",
  ].join("\n");

  const output = buildLiteratureNoteContent({
    detail: createDetail(),
    filenameStem: "Managed Name",
    existingContent,
    parseYaml: () => ({
      zotero_title: "Old title",
      zotero_publication_title: "Old journal",
      tags: ["custom/topic"],
      custom_property: "Keep me",
      zotero_version: 11,
    }),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.doesNotMatch(output, /zotero_title: Old title/);
  assert.doesNotMatch(output, /zotero_publication_title: Old journal/);
  assert.doesNotMatch(output, /zotero_version: 11/);
  assert.match(output, /zotero_item_version: 12/);
  assert.match(
    output,
    /tags: \[literature-note, source\/zotero, reference\/journal-article, zotero\/personality, zotero\/ml, custom\/topic\]/,
  );
  assert.match(output, /custom_property: Keep me/);
  assert.match(output, /User notes stay here\./);
  assert.match(output, /\[!stratum\]/);
});

test("findExistingLiteratureNoteMatch prefers exact library-aware matches in the preferred folder", () => {
  const candidates: LiteratureNoteCandidate[] = [
    {
      path: "Archive/ml-note.md",
      name: "ml-note.md",
      frontmatter: {
        zotero_item_identity: "user/123456/ABCD1234",
      },
    },
    {
      path: "Literature Notes/ml-note.md",
      name: "ml-note.md",
      frontmatter: {
        zotero_item_identity: "user/123456/ABCD1234",
      },
    },
    {
      path: "Literature Notes/legacy--ABCD1234.md",
      name: "legacy--ABCD1234.md",
      frontmatter: {
        zotero_item_key: "ABCD1234",
      },
    },
  ];

  const match = findExistingLiteratureNoteMatch(
    candidates,
    {
      libraryType: "user",
      libraryId: "123456",
      itemKey: "ABCD1234",
    },
    "Literature Notes",
  );

  assert.ok(match);
  assert.equal(match.candidate.path, "Literature Notes/ml-note.md");
  assert.equal(match.duplicateCount, 2);
});

test("findExistingLiteratureNoteMatch keeps personal and group notes distinct for the same item key", () => {
  const candidates: LiteratureNoteCandidate[] = [
    {
      path: "Literature Notes/personal-note.md",
      name: "personal-note.md",
      frontmatter: {
        zotero_item_identity: "user/123456/ABCD1234",
      },
    },
    {
      path: "Literature Notes/group-note.md",
      name: "group-note.md",
      frontmatter: {
        zotero_item_identity: "group/2001/ABCD1234",
      },
    },
    {
      path: "Literature Notes/legacy-note.md",
      name: "legacy-note.md",
      frontmatter: {
        zotero_item_key: "ABCD1234",
      },
    },
  ];

  const match = findExistingLiteratureNoteMatch(
    candidates,
    {
      libraryType: "group",
      libraryId: "2001",
      itemKey: "ABCD1234",
    },
    "Literature Notes",
  );

  assert.ok(match);
  assert.equal(match.candidate.path, "Literature Notes/group-note.md");
  assert.equal(match.duplicateCount, 1);
});

test("preprocessZoteroNoteHtml adds Zotero links for annotation and citation data", () => {
  const annotationPayload = encodeURIComponent(
    JSON.stringify({
      attachmentURI: "http://zotero.org/users/123456/items/ATTACH1",
      pageLabel: "7",
      annotationKey: "ANNOT1",
    }),
  );
  const citationPayload = encodeURIComponent(
    JSON.stringify({
      citationItems: [
        {
          uris: ["http://zotero.org/users/123456/items/ABCD1234"],
        },
      ],
    }),
  );

  const html = [
    `<p><span data-annotation="${annotationPayload}">Highlighted text</span></p>`,
    `<p><span data-citation="${citationPayload}"><span>(Bleidorn, 2019)</span></span></p>`,
  ].join("");

  const output = preprocessZoteroNoteHtml(html);

  assert.match(
    output,
    /zotero:\/\/open-pdf\/library\/items\/ATTACH1\?page=7&annotation=ANNOT1/,
  );
  assert.match(output, /Go to annotation/);
  assert.match(
    output,
    /<a href="zotero:\/\/select\/library\/items\/ABCD1234">\(Bleidorn, 2019\)<\/a>/,
  );
});

// --- New tests for expanded metadata and redesigned layout ---

test("journal article with volume/issue/pages renders location in Details callout", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        volume: "23",
        issue: "2",
        pages: "190-203",
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /\[!example\]\+ Details/);
  assert.match(output, /\*\*Location\*\*: Vol\. 23 · No\. 2 · pp\. 190–203/);
});

test("book with ISBN and no DOI shows ISBN as primary identifier in Cite callout", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        itemType: "book",
        doi: null,
        isbn: "978-0-123456-78-9",
        publicationTitle: null,
        publisher: "Academic Press",
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /\[!cite\] Reference/);
  assert.match(output, /\*\*ISBN\*\*: 978-0-123456-78-9/);
  assert.match(output, /\*\*Publisher\*\*: Academic Press/);
  assert.doesNotMatch(output, /\*\*DOI\*\*/);
});

test("preprint with arXiv shows arXiv as primary identifier in Cite callout", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        itemType: "preprint",
        doi: null,
        arxivId: "2301.12345",
        publicationTitle: null,
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(
    output,
    /\*\*arXiv\*\*: \[2301\.12345\]\(https:\/\/arxiv\.org\/abs\/2301\.12345\)/,
  );
});

test("conference paper renders type-aware venue label", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        itemType: "conferencePaper",
        conferenceName: "KDD '19",
        publicationTitle: null,
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /\*\*Conference\*\*: \[\[KDD '19\]\]/);
});

test("thesis renders university as type-aware venue", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        itemType: "thesis",
        university: "MIT",
        publicationTitle: null,
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /\*\*University\*\*: \[\[MIT\]\]/);
});

test("formatted citation renders as a Citation callout", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        citation:
          "Bleidorn, W., & Hopwood, C. J. (2019). Using machine learning to advance personality assessment and theory. https://doi.org/10.0000/example",
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /\[!quote\]\+ Citation/);
  assert.match(output, /> Bleidorn, W\., & Hopwood, C\. J\. \(2019\)\./);
});

test("PMID and PMCID render as linked identifiers in Details callout", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        pmid: "12345678",
        pmcid: "PMC9876543",
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(
    output,
    /\*\*PMID\*\*: \[12345678\]\(https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/12345678\/\)/,
  );
  assert.match(
    output,
    /\*\*PMCID\*\*: \[PMC9876543\]\(https:\/\/www\.ncbi\.nlm\.nih\.gov\/pmc\/articles\/PMC9876543\/\)/,
  );
});

test("new frontmatter fields are emitted when present", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        volume: "10",
        isbn: "978-0-123456-78-9",
        citationKey: "bleidorn2019",
        language: "English",
        publisher: "Academic Press",
        dateAdded: "2024-01-15T10:00:00Z",
        pmid: "12345678",
        pmcid: "PMC9876543",
        arxivId: "2301.12345",
        issn: "1088-8683",
        shortTitle: "ML for Personality",
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /citation_key: bleidorn2019/);
  assert.match(output, /volume: 10/);
  assert.match(output, /isbn: 978-0-123456-78-9/);
  assert.match(output, /language: English/);
  assert.match(output, /publisher: \[\[Academic Press\]\]/);
  assert.match(output, /pmid: 12345678/);
  assert.match(output, /pmcid: PMC9876543/);
  assert.match(output, /arxiv: 2301\.12345/);
  assert.match(output, /issn: 1088-8683/);
  assert.match(output, /short_title: ML for Personality/);
});

test("group-backed notes emit group library metadata in frontmatter", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      library: {
        type: "group",
        id: "2001",
        zoteroUriSegment: "groups",
        identity: "group:2001",
        groupName: "example-group",
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /zotero_item_identity: group\/2001\/ABCD1234/);
  assert.match(output, /zotero_library_type: group/);
  assert.match(output, /zotero_library_id: 2001/);
  assert.match(output, /zotero_library_name: example-group/);
  assert.match(output, /zotero_user_id: 123456/);
  assert.match(output, /zotero_group_name: example-group/);
});

test("expanded aliases include @citationKey and shortTitle", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        citationKey: "bleidorn2019",
        shortTitle: "ML for Personality",
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /@bleidorn2019/);
  assert.match(output, /ML for Personality/);
});

test("Details callout is omitted when all detail fields are null", () => {
  const output = buildLiteratureNoteContent({
    detail: createDetail({
      item: {
        collections: [],
        tags: [],
      },
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.doesNotMatch(output, /\[!example\]\+ Details/);
});
