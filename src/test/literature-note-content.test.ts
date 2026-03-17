import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiteratureNoteContent,
  findExistingLiteratureNoteMatch,
  markLiteratureNoteAsDeletedContent,
  preprocessZoteroNoteHtml,
  type LiteratureNoteCandidate,
} from "../literature-note-content";
import type { ZoteroItemDetail } from "../backend-client";

function createDetail(overrides?: Partial<ZoteroItemDetail>): ZoteroItemDetail {
  return {
    zoteroUserId: "123456",
    library: {
      type: "user",
      id: "123456",
      zoteroUriSegment: "library",
      identity: "user:123456",
    },
    item: {
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
      collections: [
        {
          key: "COLLECTION1",
          name: "Machine Learning Review",
        },
      ],
      tags: ["personality", "ml"],
      zoteroSelectUri: "zotero://select/library/items/ABCD1234",
    },
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
    ...overrides,
  };
}

function stringifyForTest(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) =>
      `${key}: ${
        Array.isArray(entry) ? `[${entry.join(", ")}]` : String(entry)
      }`
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
    "## My Notes",
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

  assert.match(output, /zotero_item_identity: user:123456:ABCD1234/);
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
    /aliases: \[Bleidorn & Hopwood 2019, Using Machine Learning to Advance Personality Assessment and Theory\]/
  );
  assert.match(output, /stratum_filename_stem: Managed Name/);
  assert.match(output, /zotero_status: active/);
  assert.match(output, /zotero_item_version: 12/);
  assert.match(output, /zotero_attachment_keys: \[ATTACH1\]/);
  assert.match(output, /zotero_note_keys: \[\]/);
  assert.match(output, /zotero_annotation_keys: \[\]/);
  assert.doesNotMatch(output, /zotero_version:/);
  assert.match(output, /tags: \[literature-note, source\/zotero, reference\/journal-article, zotero\/personality, zotero\/ml\]/);
  assert.match(output, /authors: \[Wiebke Bleidorn, Christopher James Hopwood\]/);
  assert.match(output, /publication: Journal of Examples/);
  assert.match(output, /collections: \[Machine Learning Review\]/);
  assert.match(output, /\*\*Authors\*\*: \[\[Wiebke Bleidorn\]\], \[\[Christopher James Hopwood\]\]/);
  assert.match(output, /\*\*Publication\*\*: \[\[Journal of Examples\]\]/);
  assert.match(output, /\*\*Collections\*\*: \[\[Machine Learning Review\]\]/);
  assert.match(output, /\*\*Topics\*\*: #zotero\/personality #zotero\/ml/);
  assert.match(output, /> \[!abstract\]\+ Abstract/);
  assert.doesNotMatch(output, /## Zotero Notes/);
  assert.doesNotMatch(output, /## Highlights/);
  assert.match(output, /## My Notes/);
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
    /> \[!note\]\+ Zotero note 1 · First imported insight from Zotero\./
  );
  assert.match(
    output,
    /> \[Open in Zotero\]\(zotero:\/\/select\/library\/items\/NOTE1\) · Last modified: 2026-03-14T17:56:02Z/
  );
  assert.match(output, /> First imported insight from Zotero\./);
  assert.match(output, /> Supporting detail\./);
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
    /> The source item is no longer in your Zotero library\. This note is preserved but will no longer receive updates\./
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
  assert.match(output, /> \[!quote\]\+ Yellow · 1 highlight/);
  assert.match(output, /> \*\*Page 4\*\* · highlight/);
  assert.match(output, /> A useful highlighted sentence\./);
  assert.match(output, /> Comment: This matters\./);
  assert.match(
    output,
    /> \[Open annotation in Zotero\]\(zotero:\/\/open-pdf\/library\/items\/ATTACH1\?page=4&annotation=ANNOT1\)/
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
          zoteroOpenPdfUri: "zotero://open-pdf/library/items/ATTACH1?page=4&annotation=ANNOT1",
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
          zoteroOpenPdfUri: "zotero://open-pdf/library/items/ATTACH1?page=5&annotation=ANNOT2",
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
          zoteroOpenPdfUri: "zotero://open-pdf/library/items/ATTACH1?page=6&annotation=ANNOT3",
        },
      ],
    }),
    filenameStem: "Managed Name",
    parseYaml: () => ({}),
    stringifyYaml: stringifyForTest,
    htmlToMarkdown: (html) => html,
  });

  assert.match(output, /> \[!quote\]\+ Yellow · 2 highlights/);
  assert.match(output, /> \[!quote\]\+ Green · 1 highlight/);
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
    "## Notes",
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
  assert.match(output, /tags: \[literature-note, source\/zotero, reference\/journal-article, zotero\/personality, zotero\/ml, custom\/topic\]/);
  assert.match(output, /custom_property: Keep me/);
  assert.match(output, /User notes stay here\./);
  assert.match(output, /## My Notes/);
  assert.doesNotMatch(output, /## Notes/);
});

test("findExistingLiteratureNoteMatch prefers exact library-aware matches in the preferred folder", () => {
  const candidates: LiteratureNoteCandidate[] = [
    {
      path: "Archive/ml-note.md",
      name: "ml-note.md",
      frontmatter: {
        zotero_item_identity: "user:123456:ABCD1234",
      },
    },
    {
      path: "Literature Notes/ml-note.md",
      name: "ml-note.md",
      frontmatter: {
        zotero_item_identity: "user:123456:ABCD1234",
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
    "Literature Notes"
  );

  assert.ok(match);
  assert.equal(match.candidate.path, "Literature Notes/ml-note.md");
  assert.equal(match.duplicateCount, 2);
});

test("preprocessZoteroNoteHtml adds Zotero links for annotation and citation data", () => {
  const annotationPayload = encodeURIComponent(
    JSON.stringify({
      attachmentURI: "http://zotero.org/users/123456/items/ATTACH1",
      pageLabel: "7",
      annotationKey: "ANNOT1",
    })
  );
  const citationPayload = encodeURIComponent(
    JSON.stringify({
      citationItems: [
        {
          uris: ["http://zotero.org/users/123456/items/ABCD1234"],
        },
      ],
    })
  );

  const html = [
    `<p><span data-annotation="${annotationPayload}">Highlighted text</span></p>`,
    `<p><span data-citation="${citationPayload}"><span>(Bleidorn, 2019)</span></span></p>`,
  ].join("");

  const output = preprocessZoteroNoteHtml(html);

  assert.match(
    output,
    /zotero:\/\/open-pdf\/library\/items\/ATTACH1\?page=7&annotation=ANNOT1/
  );
  assert.match(output, /Go to annotation/);
  assert.match(output, /<a href="zotero:\/\/select\/library\/items\/ABCD1234">\(Bleidorn, 2019\)<\/a>/);
});
