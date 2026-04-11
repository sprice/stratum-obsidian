import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonalLibrary } from "../plugin-libraries";
import {
  ensureLocalZoteroReady,
  LocalZoteroApiDisabledError,
  LocalZoteroApiVersionMismatchError,
  loadLocalZoteroCatalogPage,
  loadLocalZoteroCollections,
  loadLocalZoteroItemVersions,
  loadLocalZoteroItemDetail,
  loadLocalZoteroLibraryVersion,
  loadLocalZoteroLibraries,
} from "../zotero-local";

type MockResponse = {
  status: number;
  headers?: Record<string, string>;
  json: unknown;
  text?: string;
};

function createRequestMock(routes: Record<string, MockResponse>) {
  return ({
    url,
  }: {
    url: string;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    json: unknown;
    text: string;
  }> => {
    const route = routes[url];
    assert.ok(route, `Unexpected local Zotero URL: ${url}`);
    return Promise.resolve({
      status: route.status,
      headers: route.headers ?? {},
      json: route.json,
      text: route.text ?? JSON.stringify(route.json),
    });
  };
}

test("loadLocalZoteroLibraries resolves the real personal user id and groups", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/connector/ping": {
      status: 200,
      json: null,
      text: "<!DOCTYPE html><html><body>Zotero is running</body></html>",
    },
    "http://127.0.0.1:23119/api/": {
      status: 200,
      headers: {
        "Zotero-API-Version": "3",
      },
      json: {},
      text: "",
    },
    "http://127.0.0.1:23119/api/users/0/items/top?format=versions&limit=1&start=0":
      {
        status: 200,
        headers: {
          Link: '<https://www.zotero.org/users/19946899/items/top>; rel="alternate"',
        },
        json: {},
      },
    "http://127.0.0.1:23119/api/users/0/groups?format=json&limit=100&start=0": {
      status: 200,
      json: [
        {
          id: 6489674,
          data: {
            id: 6489674,
            name: "sprice",
          },
          meta: {
            numItems: 3,
          },
        },
      ],
    },
  });

  const response = await loadLocalZoteroLibraries({
    port: 23119,
    request,
  });

  assert.equal(response.userId, "19946899");
  assert.deepEqual(
    response.libraries.map((library) => ({
      identity: library.identity,
      name: library.name,
    })),
    [
      { identity: "user:19946899", name: "My Library" },
      { identity: "group:6489674", name: "sprice" },
    ],
  );
});

test("ensureLocalZoteroReady fails when the local API is disabled", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/connector/ping": {
      status: 200,
      json: null,
      text: "<!DOCTYPE html><html><body>Zotero is running</body></html>",
    },
    "http://127.0.0.1:23119/api/": {
      status: 403,
      json: null,
      text: "Local API is not enabled",
    },
  });

  await assert.rejects(
    () =>
      ensureLocalZoteroReady({
        port: 23119,
        request,
      }),
    (error: unknown) =>
      error instanceof LocalZoteroApiDisabledError &&
      error.message.includes("Allow other applications"),
  );
});

test("ensureLocalZoteroReady fails when the local API version is incompatible", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/connector/ping": {
      status: 200,
      json: null,
      text: "<!DOCTYPE html><html><body>Zotero is running</body></html>",
    },
    "http://127.0.0.1:23119/api/": {
      status: 200,
      headers: {
        "Zotero-API-Version": "4",
      },
      json: {},
      text: "",
    },
  });

  await assert.rejects(
    () =>
      ensureLocalZoteroReady({
        port: 23119,
        request,
      }),
    (error: unknown) =>
      error instanceof LocalZoteroApiVersionMismatchError &&
      error.message.includes("expects Zotero API v3"),
  );
});

test("loadLocalZoteroCollections builds nested display names", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/api/users/19946899/collections?format=json&limit=100&start=0":
      {
        status: 200,
        json: [
          {
            key: "ROOT",
            data: {
              key: "ROOT",
              name: "Papers",
              parentCollection: false,
            },
          },
          {
            key: "CHILD",
            data: {
              key: "CHILD",
              name: "Methods",
              parentCollection: "ROOT",
            },
          },
        ],
      },
  });

  const collections = await loadLocalZoteroCollections({
    port: 23119,
    library: buildPersonalLibrary("19946899"),
    request,
  });

  assert.deepEqual(collections, [
    {
      key: "ROOT",
      name: "Papers",
      parentCollectionKey: null,
      displayName: "Papers",
    },
    {
      key: "CHILD",
      name: "Methods",
      parentCollectionKey: "ROOT",
      displayName: "Papers / Methods",
    },
  ]);
});

test("loadLocalZoteroCatalogPage reads versions, totals, and library version headers", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/api/users/19946899/items/top?format=json&sort=dateAdded&direction=asc&limit=50&start=0":
      {
        status: 200,
        headers: {
          "Total-Results": "75",
          "Last-Modified-Version": "98",
        },
        json: [
          {
            key: "ITEMA",
            version: 10,
            data: {
              itemType: "journalArticle",
            },
          },
          {
            key: "ATTACH1",
            version: 10,
            data: {
              itemType: "attachment",
            },
          },
          {
            key: "ITEMB",
            version: 11,
            data: {
              itemType: "conferencePaper",
            },
          },
        ],
      },
  });

  const page = await loadLocalZoteroCatalogPage({
    port: 23119,
    library: buildPersonalLibrary("19946899"),
    start: 0,
    limit: 50,
    request,
  });

  assert.equal(page.snapshotLibraryVersion, 98);
  assert.equal(page.totalResults, 75);
  assert.equal(page.nextStart, 3);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.items, [
    { key: "ITEMA", version: 10 },
    { key: "ITEMB", version: 11 },
  ]);
});

test("loadLocalZoteroLibraryVersion reads the lightweight versions header", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/api/users/19946899/items/top?format=versions&limit=1&start=0":
      {
        status: 200,
        headers: {
          "Last-Modified-Version": "123",
        },
        json: {
          ITEMA: 10,
        },
      },
  });

  const version = await loadLocalZoteroLibraryVersion({
    port: 23119,
    library: buildPersonalLibrary("19946899"),
    request,
  });

  assert.equal(version, 123);
});

test("loadLocalZoteroItemVersions pages through the local versions map", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/api/users/19946899/items/top?format=versions&limit=500&start=0":
      {
        status: 200,
        headers: {
          "Last-Modified-Version": "321",
        },
        json: Object.fromEntries(
          Array.from({ length: 500 }, (_entry, index) => [
            `ITEM${index.toString().padStart(3, "0")}`,
            index + 1,
          ]),
        ),
      },
    "http://127.0.0.1:23119/api/users/19946899/items/top?format=versions&limit=500&start=500":
      {
        status: 200,
        headers: {
          "Last-Modified-Version": "321",
        },
        json: {
          ITEM500: 501,
          ITEM501: 502,
        },
      },
  });

  const response = await loadLocalZoteroItemVersions({
    port: 23119,
    library: buildPersonalLibrary("19946899"),
    request,
  });

  assert.equal(response.libraryVersion, 321);
  assert.equal(Object.keys(response.itemVersions).length, 502);
  assert.equal(response.itemVersions.ITEM000, 1);
  assert.equal(response.itemVersions.ITEM499, 500);
  assert.equal(response.itemVersions.ITEM500, 501);
  assert.equal(response.itemVersions.ITEM501, 502);
});

test("loadLocalZoteroItemVersions can read a full library versions map including child items", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/api/users/19946899/items?format=versions&limit=500&start=0":
      {
        status: 200,
        headers: {
          "Last-Modified-Version": "654",
        },
        json: {
          PARENT: 12,
          ATTACH1: 21,
          ANNOT1: 34,
        },
      },
  });

  const response = await loadLocalZoteroItemVersions({
    port: 23119,
    library: buildPersonalLibrary("19946899"),
    topLevelOnly: false,
    request,
  });

  assert.equal(response.libraryVersion, 654);
  assert.deepEqual(response.itemVersions, {
    PARENT: 12,
    ATTACH1: 21,
    ANNOT1: 34,
  });
});

test("loadLocalZoteroItemDetail normalizes DOI values and fetches annotations via the itemType=annotation endpoint", async () => {
  const request = createRequestMock({
    "http://127.0.0.1:23119/api/users/19946899/items/PARENT?format=json&include=data,bib&style=apa":
      {
        status: 200,
        json: {
          key: "PARENT",
          version: 12,
          bib: "<div>Example citation https://doi.org/10.1000/ABC123</div>",
          data: {
            itemType: "journalArticle",
            title: "Example Paper",
            creators: [
              {
                firstName: "Ada",
                lastName: "Lovelace",
              },
            ],
            date: "2025-01-01",
            DOI: "https://doi.org/10.1000/ABC123",
            url: "https://example.com",
            publicationTitle: "Journal of Tests",
            collections: ["COLL1"],
            tags: [{ tag: "ml" }],
            dateAdded: "2025-01-01T00:00:00Z",
            dateModified: "2025-01-02T00:00:00Z",
          },
        },
      },
    "http://127.0.0.1:23119/api/users/19946899/items/PARENT/children?format=json&limit=500":
      {
        status: 200,
        json: [
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
        ],
      },
    "http://127.0.0.1:23119/api/users/19946899/collections/COLL1?format=json": {
      status: 200,
      json: {
        data: {
          key: "COLL1",
          name: "Papers",
        },
      },
    },
    "http://127.0.0.1:23119/api/users/19946899/items?format=json&itemType=annotation&limit=100&start=0":
      {
        status: 200,
        json: [
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
            key: "ANN_OTHER",
            version: 6,
            data: {
              itemType: "annotation",
              parentItem: "OTHER_ATTACHMENT",
              annotationType: "highlight",
              annotationColor: "#ff6666",
              annotationPageLabel: "1",
              annotationText: "Should be filtered out",
              annotationComment: "",
              dateModified: "2025-01-04T00:00:00Z",
            },
          },
          {
            key: "ANN_COMMENT",
            version: 7,
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
        ],
      },
  });

  const detail = await loadLocalZoteroItemDetail({
    port: 23119,
    userId: "19946899",
    library: buildPersonalLibrary("19946899"),
    itemKey: "PARENT",
    request,
  });

  assert.equal(detail.item.doi, "10.1000/ABC123");
  assert.equal(
    detail.item.citation,
    "Example citation https://doi.org/10.1000/ABC123",
  );
  assert.deepEqual(detail.item.collections, [{ key: "COLL1", name: "Papers" }]);
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
      key: "ANN_COMMENT",
      attachmentKey: "ATTACH1",
      type: "highlight",
      color: "#8a2be2",
      pageLabel: "7",
      text: "Standalone highlighted text",
      comment: "Separate annotation comment",
      dateModified: "2025-01-05T00:00:00Z",
      zoteroOpenPdfUri:
        "zotero://open-pdf/library/items/ATTACH1?page=7&annotation=ANN_COMMENT",
    },
  ]);
});
