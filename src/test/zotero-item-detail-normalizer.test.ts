import test from "node:test";
import assert from "node:assert/strict";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";

test("normalizeZoteroItemDetail shapes note-relevant data consistently", () => {
  const detail = normalizeZoteroItemDetail({
    zoteroUserId: "19946899",
    library: {
      type: "user",
      id: "19946899",
      zoteroUriSegment: "library",
      identity: "user:19946899",
      groupName: null,
    },
    parentItem: {
      key: "PARENT",
      version: 12,
      bib: "<div>Example citation</div>",
      data: {
        itemType: "journalArticle",
        title: "Example Paper",
        creators: [{ firstName: "Ada", lastName: "Lovelace" }],
        date: "2025-01-01",
        DOI: "https://doi.org/10.1000/ABC123",
        publicationTitle: "Journal of Tests",
        collections: ["COLL1"],
        tags: [{ tag: "ml" }],
        extra: "PMID: 12345\nCitation Key: Lovelace2025",
      },
    },
    childItems: [
      {
        key: "ATTACH1",
        version: 1,
        data: {
          itemType: "attachment",
          title: "Full Text PDF",
          parentItem: "PARENT",
          contentType: "application/pdf",
          linkMode: "imported_url",
          filename: "paper.pdf",
          url: "https://example.com/paper.pdf",
        },
      },
      {
        key: "NOTE1",
        version: 2,
        data: {
          itemType: "note",
          parentItem: "PARENT",
          note: "<p>Annotated note</p>",
        },
      },
    ],
    collections: [{ key: "COLL1", name: "Papers" }],
    annotationItems: [
      {
        key: "ANN1",
        version: 5,
        data: {
          itemType: "annotation",
          parentItem: "ATTACH1",
          annotationType: "highlight",
          annotationColor: "#ffd400",
          annotationPageLabel: "5",
          annotationText: "Important result",
          annotationComment: "",
          dateModified: "2025-01-03T00:00:00Z",
        },
      },
      {
        key: "ANN2",
        version: 6,
        data: {
          itemType: "annotation",
          parentItem: "ATTACH1",
          annotationType: "highlight",
          annotationColor: "#8a2be2",
          annotationPageLabel: "7",
          annotationText: "Standalone highlighted text",
          annotationComment: "Separate annotation comment",
          dateModified: "2025-01-05T00:00:00Z",
        },
      },
      {
        key: "ANN_OTHER",
        version: 7,
        data: {
          itemType: "annotation",
          parentItem: "OTHER_ATTACHMENT",
          annotationType: "highlight",
          annotationText: "Should be filtered out",
        },
      },
    ],
  });

  assert.equal(detail.item.doi, "10.1000/ABC123");
  assert.equal(detail.item.citation, "Example citation");
  assert.equal(detail.item.citationKey, "Lovelace2025");
  assert.deepEqual(detail.item.collections, [{ key: "COLL1", name: "Papers" }]);
  assert.deepEqual(detail.attachments, [
    {
      key: "ATTACH1",
      title: "Full Text PDF",
      itemType: "attachment",
      contentType: "application/pdf",
      linkMode: "imported_url",
      filename: "paper.pdf",
      url: "https://example.com/paper.pdf",
      zoteroSelectUri: "zotero://select/library/items/ATTACH1",
      zoteroOpenPdfUri: "zotero://open-pdf/library/items/ATTACH1",
    },
  ]);
  assert.deepEqual(detail.zoteroNotes, [
    {
      key: "NOTE1",
      parentItemKey: "PARENT",
      html: "<p>Annotated note</p>",
      dateAdded: null,
      dateModified: null,
      zoteroSelectUri: "zotero://select/library/items/NOTE1",
    },
  ]);
  assert.deepEqual(detail.annotations, [
    {
      key: "ANN1",
      attachmentKey: "ATTACH1",
      type: "highlight",
      color: "#ffd400",
      pageLabel: "5",
      text: "Important result",
      comment: null,
      dateModified: "2025-01-03T00:00:00Z",
      zoteroOpenPdfUri:
        "zotero://open-pdf/library/items/ATTACH1?page=5&annotation=ANN1",
    },
    {
      key: "ANN2",
      attachmentKey: "ATTACH1",
      type: "highlight",
      color: "#8a2be2",
      pageLabel: "7",
      text: "Standalone highlighted text",
      comment: "Separate annotation comment",
      dateModified: "2025-01-05T00:00:00Z",
      zoteroOpenPdfUri:
        "zotero://open-pdf/library/items/ATTACH1?page=7&annotation=ANN2",
    },
  ]);
});
