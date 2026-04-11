const MIN_LIBRARY_SEARCH_QUERY_LENGTH = 2;

export function normalizeLibrarySearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getLibrarySearchCacheKey(query: string): string {
  return normalizeLibrarySearchQuery(query);
}

export function isLibrarySearchQueryReady(query: string): boolean {
  return (
    getLibrarySearchCacheKey(query).length >= MIN_LIBRARY_SEARCH_QUERY_LENGTH
  );
}
