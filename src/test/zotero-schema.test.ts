import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeZoteroMetadata,
  resolveZoteroFields,
  readCreators,
} from "../zotero-schema";
import { ZOTERO_SCHEMA } from "../zotero-schema-data";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";
import { getReadableAuthorLabel } from "../literature-note-filenames";

const metadata = {
  itemType: "case",
  caseName: "Delgamuukw v. British Columbia",
  dateDecided: "1997-12-11",
  court: "Supreme Court of Canada",
  reporterVolume: "3",
  firstPage: "1010",
  creators: [{ creatorType: "author", name: "Supreme Court of Canada" }],
};
test("case-specific fields reach both search metadata and full note detail", () => {
  const search = normalizeZoteroMetadata(metadata);
  const detail = normalizeZoteroItemDetail({
    zoteroUserId: "1",
    library: {
      type: "user",
      id: "1",
      identity: "user:1",
      zoteroUriSegment: "library",
    },
    parentItem: { key: "CASE", version: 1, data: metadata },
    childItems: [],
    collections: [],
  });
  assert.equal(search.title, "Delgamuukw v. British Columbia");
  assert.equal(search.year, "1997");
  for (const key of [
    "title",
    "date",
    "year",
    "creatorDetails",
    "sourceFields",
  ] as const)
    assert.deepEqual(detail.item[key], search[key]);
  assert.equal(detail.item.volume, "3");
  assert.equal(detail.item.pages, "1010");
  assert.equal(detail.item.sourceFields?.court, "Supreme Court of Canada");
  assert.equal(
    getReadableAuthorLabel(
      search.creators,
      search.creatorDetails,
      search.itemType,
    ),
    "Supreme Court of Canada",
  );
});
test("type-specific fields cover non-academic items and prefer populated specialized values", () => {
  for (const [itemType, source, expected] of [
    ["email", { subject: "Hello" }, { title: "Hello" }],
    [
      "statute",
      { nameOfAct: "Example Act", dateEnacted: "2001", publicLawNumber: "42" },
      { title: "Example Act", date: "2001", number: "42" },
    ],
    [
      "patent",
      { issueDate: "2004", patentNumber: "US123" },
      { date: "2004", number: "US123" },
    ],
    [
      "report",
      { institution: "Institute", reportNumber: "5" },
      { publisher: "Institute", number: "5" },
    ],
    [
      "conferencePaper",
      { proceedingsTitle: "Proceedings" },
      { publicationTitle: "Proceedings" },
    ],
  ] as const) {
    const fields = resolveZoteroFields({ itemType, ...source });
    for (const [key, value] of Object.entries(expected))
      assert.equal(fields[key], value, `${itemType}.${key}`);
  }
  assert.equal(
    normalizeZoteroMetadata({
      itemType: "case",
      title: "generic",
      caseName: "specific",
    }).title,
    "specific",
  );
  assert.equal(
    normalizeZoteroMetadata({
      itemType: "case",
      title: "generic",
      caseName: " ",
    }).title,
    "generic",
  );
});
test("authors, translators, editors and literal institutions remain distinct", () => {
  const book = normalizeZoteroMetadata({
    itemType: "book",
    creators: [
      { creatorType: "author", firstName: "Byung-Chul", lastName: "Han" },
      { creatorType: "translator", firstName: "Erik", lastName: "Butler" },
    ],
  });
  assert.deepEqual(book.creators, ["Byung-Chul Han"]);
  assert.equal(book.creatorDetails[1]?.creatorType, "translator");
  assert.equal(
    getReadableAuthorLabel(book.creators, book.creatorDetails, "book"),
    "Han",
  );
  const person = normalizeZoteroMetadata({
    itemType: "book",
    creators: [
      {
        creatorType: "author",
        firstName: "Sander",
        lastName: "van der Linden",
      },
    ],
  });
  assert.equal(
    getReadableAuthorLabel(person.creators, person.creatorDetails, "book"),
    "van der Linden",
  );
  assert.deepEqual(
    normalizeZoteroMetadata({
      itemType: "film",
      creators: [{ creatorType: "director", name: "Studio" }],
    }).creators,
    ["Studio"],
  );
  assert.deepEqual(
    normalizeZoteroMetadata({
      itemType: "book",
      creators: [{ creatorType: "editor", name: "Editorial Board" }],
    }).creators,
    ["Editorial Board"],
  );
  assert.deepEqual(
    readCreators([null, 2, {}, { name: 4 }, { name: " Institute " }]),
    [{ creatorType: "author", name: "Institute" }],
  );
});
test("the bundled schema exercises every declared base-field mapping", () => {
  assert.equal(Object.keys(ZOTERO_SCHEMA).length, 40);
  for (const [itemType, schema] of Object.entries(ZOTERO_SCHEMA)) {
    for (const [base, field] of Object.entries(schema.baseFields)) {
      assert.ok(schema.fields.includes(field));
      assert.equal(
        resolveZoteroFields({ itemType, [field]: " value " })[base],
        "value",
        `${itemType}.${field}`,
      );
    }
  }
  assert.equal(
    normalizeZoteroMetadata({
      itemType: "futureType",
      title: "Future",
      date: "2026",
    }).title,
    "Future",
  );
});

test("all known bibliographic types remain importable, including sparse items", async () => {
  const { supportsZoteroItemType } = await import("../zotero-item-support");
  for (const type of Object.keys(ZOTERO_SCHEMA))
    assert.equal(
      supportsZoteroItemType(type),
      !["annotation", "attachment", "note"].includes(type),
      type,
    );
  for (const type of [null, "", "futureType", "toString", "__proto__"])
    assert.equal(supportsZoteroItemType(type), false);
  assert.equal(
    supportsZoteroItemType(
      normalizeZoteroMetadata({ itemType: "book" }).itemType,
    ),
    true,
  );
});
