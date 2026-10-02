import assert from "node:assert/strict";
import test from "node:test";
import type * as Catalog from "../plugin-collection-catalog";
import type * as Data from "../collection-browser-data";
import type { ZoteroItemDetail } from "../backend-types";
import type { CollectionCatalogs } from "../collection-catalog";
import { loadRuntime } from "./runtime-harness";

const detail = { library: { type: "user", id: "1" } } as ZoteroItemDetail;
const collection = {
  key: "C",
  name: "Culture",
  parentCollectionKey: null,
  displayName: "Culture",
};
function host() {
  let fetches = 0;
  let saves = 0;
  const plugin = {
    settings: {
      collectionCatalogs: {} as CollectionCatalogs,
      bulkSyncEnabled: false,
    },
    isUnloaded: false,
    backend: {
      getZoteroLibraryCollections: () => {
        fetches++;
        return Promise.resolve({ collections: [collection] });
      },
    },
    saveSettings: () => {
      saves++;
      return Promise.resolve();
    },
  };
  return { plugin, counts: () => ({ fetches, saves }) };
}
test("concurrent note writes share one catalog request and persist offline data", async () => {
  const catalog = loadRuntime<typeof Catalog>("plugin-collection-catalog.ts", {
    Platform: { isDesktopApp: false },
  });
  const { plugin, counts } = host();
  await Promise.all(
    Array.from({ length: 20 }, () =>
      catalog.ensureCollectionCatalog(plugin as never, detail),
    ),
  );
  assert.deepEqual(counts(), { fetches: 1, saves: 1 });
  assert.equal(
    plugin.settings.collectionCatalogs["user:1"]?.collections[0]?.key,
    "C",
  );
  await catalog.ensureCollectionCatalog(plugin as never, detail);
  assert.deepEqual(counts(), { fetches: 1, saves: 1 });
});
test("failed catalog refresh retains previous metadata and does not fail note writing", async () => {
  const catalog = loadRuntime<typeof Catalog>(
    "plugin-collection-catalog.ts",
    { Platform: { isDesktopApp: false } },
    { console: { error() {} } },
  );
  const { plugin } = host();
  const old = {
    libraryName: "My Library",
    collections: [collection],
    updatedAt: 0,
  };
  plugin.settings.collectionCatalogs["user:1"] = old;
  let attempts = 0;
  plugin.backend.getZoteroLibraryCollections = () => {
    attempts++;
    return Promise.reject(new Error("offline"));
  };
  await catalog.ensureCollectionCatalog(plugin as never, detail);
  await catalog.ensureCollectionCatalog(plugin as never, detail);
  assert.equal(attempts, 1);
  assert.equal(plugin.settings.collectionCatalogs["user:1"], old);
});
test("browser deduplicates by Zotero identity, respects the indexed canonical file and scans outside root", () => {
  const data = loadRuntime<typeof Data>("collection-browser-data.ts", {
    FuzzySuggestModal: class {},
  });
  const files = ["Elsewhere/manual.md", "Literature Notes/duplicate.md"].map(
    (path) => ({ path, basename: path }),
  );
  const fm = {
    stratum_note_type: "literature-note",
    zotero_library_type: "user",
    zotero_library_id: "1",
    zotero_item_key: "A",
    aliases: ["Author 2024", "Paper title"],
    zotero_collection_keys: ["C"],
    collections: ["[[Culture]]"],
  };
  const plugin = {
    settings: { itemFileMap: { "user/1/A": { filePath: files[0].path } } },
    app: {
      vault: { getMarkdownFiles: () => files },
      metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
    },
  };
  const papers = data.getCollectionPapers(plugin as never);
  assert.equal(papers.length, 1);
  assert.equal(papers[0]?.path, "Elsewhere/manual.md");
  assert.equal(papers[0]?.keys?.[0], "C");
});
