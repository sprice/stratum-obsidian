import type { ZoteroCollectionSummary } from "./backend-types";

export interface CollectionCatalog {
  libraryName: string;
  collections: ZoteroCollectionSummary[];
  updatedAt: number;
}
export type CollectionCatalogs = Record<string, CollectionCatalog>;

export function readCollectionCatalogs(value: unknown): CollectionCatalogs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: CollectionCatalogs = {};
  for (const [identity, raw] of Object.entries(value)) {
    if (
      !/^(user|group):[^:]+$/.test(identity) ||
      !raw ||
      typeof raw !== "object"
    )
      continue;
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.libraryName !== "string" ||
      !Array.isArray(entry.collections) ||
      typeof entry.updatedAt !== "number" ||
      !Number.isFinite(entry.updatedAt)
    )
      continue;
    const collections: ZoteroCollectionSummary[] = [];
    for (const value of entry.collections as unknown[]) {
      if (!value || typeof value !== "object") continue;
      const c = value as Record<string, unknown>;
      if (
        typeof c.key !== "string" ||
        !c.key ||
        typeof c.name !== "string" ||
        (c.parentCollectionKey !== null &&
          typeof c.parentCollectionKey !== "string")
      )
        continue;
      collections.push({
        key: c.key,
        name: c.name,
        parentCollectionKey: c.parentCollectionKey,
        displayName: c.name,
      });
    }
    result[identity] = {
      libraryName: entry.libraryName,
      collections,
      updatedAt: entry.updatedAt,
    };
  }
  return result;
}

/** Follow keys, never names or display-path prefixes; tolerate malformed cycles. */
export function collectionPath(
  collections: ZoteroCollectionSummary[],
  key: string,
): string {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const names: string[] = [];
  const visited = new Set<string>();
  let current: string | null = key;
  while (current && !visited.has(current)) {
    visited.add(current);
    const c = byKey.get(current);
    names.unshift(c?.name ?? current);
    current = c?.parentCollectionKey ?? null;
  }
  return names.join(" › ");
}

export function collectionScope(
  collections: ZoteroCollectionSummary[],
  key: string,
  descendants: boolean,
): Set<string> {
  const result = new Set([key]);
  if (!descendants) return result;
  const children = new Map<string, string[]>();
  for (const c of collections) {
    if (!c.parentCollectionKey) continue;
    const entries = children.get(c.parentCollectionKey) ?? [];
    entries.push(c.key);
    children.set(c.parentCollectionKey, entries);
  }
  const queue = [key];
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}
