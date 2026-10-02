import { buildLiteratureNoteEntries } from "./library-search-modal";
import {
  readCollectionKeys,
  type CollectionPaper,
} from "./collection-browser-model";
import type StratumPlugin from "./plugin";

export function getCollectionPapers(plugin: StratumPlugin): CollectionPaper[] {
  const papers = new Map<string, CollectionPaper>();
  for (const entry of buildLiteratureNoteEntries(plugin)) {
    const fm = plugin.app.metadataCache.getFileCache(entry.file)?.frontmatter;
    if (!fm) continue;
    const type: unknown = fm.zotero_library_type;
    const id: unknown = fm.zotero_library_id;
    const key: unknown = fm.zotero_item_key;
    if (
      (type !== "user" && type !== "group") ||
      (typeof id !== "string" && typeof id !== "number") ||
      typeof key !== "string" ||
      !key
    )
      continue;
    const identity = `${type}/${id}/${key}`;
    // Match sync's identity contract: never let conflicting explicit identity
    // metadata win simply because the file happens to be in the path cache.
    if (
      fm.zotero_item_identity != null &&
      fm.zotero_item_identity !== identity &&
      fm.zotero_item_identity !== key
    )
      continue;
    const previous = papers.get(identity);
    const preferredPath = plugin.settings.itemFileMap[identity]?.filePath;
    if (
      previous &&
      (previous.path === preferredPath ||
        (entry.file.path !== preferredPath &&
          previous.path.localeCompare(entry.file.path) < 0))
    )
      continue;
    const names: unknown = fm.collections;
    papers.set(identity, {
      path: entry.file.path,
      identity,
      libraryIdentity: `${type}:${id}`,
      libraryName:
        typeof fm.zotero_library_name === "string"
          ? fm.zotero_library_name
          : type === "user"
            ? "My Library"
            : `Group ${id}`,
      title: entry.displayTitle,
      authors: entry.authors,
      year: entry.year,
      keys: readCollectionKeys(fm.zotero_collection_keys),
      collectionNames: Array.isArray(names)
        ? names
            .filter((v): v is string => typeof v === "string")
            .map(
              (v) =>
                v.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|").pop() ??
                v,
            )
        : [],
    });
  }
  return [...papers.values()];
}
