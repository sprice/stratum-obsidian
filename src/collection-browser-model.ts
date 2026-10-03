import { readSourceTableState, type SourceTableState } from "./source-table";
import type { CollectionCatalogs } from "./collection-catalog";
import { collectionPath, collectionScope } from "./collection-catalog";

export interface CollectionPaper {
  path: string;
  identity: string;
  libraryIdentity: string;
  libraryName: string;
  title: string;
  authors: string[];
  year: string | null;
  keys: string[] | null;
  collectionNames: string[];
  properties?: Record<string, unknown>;
}
export interface CollectionChoice {
  id: string;
  name: string;
  context: string;
  libraryIdentity?: string;
  key?: string;
}
export interface CollectionBrowserState extends SourceTableState {
  collection: string;
  query: string;
  includeSubcollections: boolean;
  scrollTop: number;
  visibleCount: number;
}
export const DEFAULT_BROWSER_STATE: CollectionBrowserState = {
  ...readSourceTableState(undefined),
  collection: "all",
  query: "",
  includeSubcollections: true,
  scrollTop: 0,
  visibleCount: 100,
};
export function readBrowserState(raw: unknown): CollectionBrowserState {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ...readSourceTableState(value),
    collection: typeof value.collection === "string" ? value.collection : "all",
    query: typeof value.query === "string" ? value.query : "",
    includeSubcollections:
      typeof value.includeSubcollections === "boolean"
        ? value.includeSubcollections
        : true,
    visibleCount:
      typeof value.visibleCount === "number" &&
      Number.isFinite(value.visibleCount)
        ? Math.max(100, Math.min(100000, Math.floor(value.visibleCount)))
        : 100,
    scrollTop:
      typeof value.scrollTop === "number" && Number.isFinite(value.scrollTop)
        ? Math.max(0, value.scrollTop)
        : 0,
  };
}
export function readCollectionKeys(value: unknown): string[] | null {
  // Missing/malformed metadata is unknown, not an empty collection membership.
  if (
    !Array.isArray(value) ||
    !value.every((key) => typeof key === "string" && key.length > 0)
  )
    return null;
  return [...new Set(value as string[])];
}
export function collectionChoiceId(library: string, key: string): string {
  return JSON.stringify([library, key]);
}
export function buildCollectionChoices(
  papers: CollectionPaper[],
  catalogs: CollectionCatalogs,
): CollectionChoice[] {
  const choices = new Map<string, CollectionChoice>();
  const libraries = new Set(papers.map((p) => p.libraryIdentity));
  for (const library of libraries) {
    const catalog = catalogs[library];
    for (const c of catalog?.collections ?? []) {
      const id = collectionChoiceId(library, c.key);
      choices.set(id, {
        id,
        name: c.name,
        context: `${catalog.libraryName} › ${collectionPath(catalog.collections, c.key)}`,
        libraryIdentity: library,
        key: c.key,
      });
    }
  }
  for (const paper of papers) {
    for (const [i, key] of (paper.keys ?? []).entries()) {
      const id = collectionChoiceId(paper.libraryIdentity, key);
      if (!choices.has(id))
        choices.set(id, {
          id,
          name: paper.collectionNames[i] ?? key,
          context: `${paper.libraryName} · hierarchy unavailable`,
          libraryIdentity: paper.libraryIdentity,
          key,
        });
    }
  }
  return [
    { id: "all", name: "All imported papers", context: "All libraries" },
    {
      id: "unfiled",
      name: "Unfiled papers",
      context: "No Zotero collection membership",
    },
    ...[...choices.values()].sort(
      (a, b) => a.context.localeCompare(b.context) || a.id.localeCompare(b.id),
    ),
  ];
}
export function filterCollectionPapers(
  papers: CollectionPaper[],
  choice: CollectionChoice | undefined,
  catalogs: CollectionCatalogs,
  state: CollectionBrowserState,
): CollectionPaper[] {
  const scope = choice?.key
    ? collectionScope(
        catalogs[choice.libraryIdentity!]?.collections ?? [],
        choice.key,
        state.includeSubcollections,
      )
    : null;
  const terms = state.query
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return papers
    .filter((paper) => {
      if (!choice) return false;
      if (choice.id === "unfiled" && paper.keys?.length !== 0) return false;
      if (
        scope &&
        (paper.libraryIdentity !== choice.libraryIdentity ||
          !paper.keys?.some((key) => scope.has(key)))
      )
        return false;
      const text =
        `${paper.title} ${paper.authors.join(" ")} ${paper.year ?? ""}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort(
      (a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path),
    );
}
