import type { PersistedAuthSession } from "./settings";
export type { ZoteroItemDetail } from "./zotero-item-detail-normalizer";

export interface BackendAuthState {
  session: PersistedAuthSession | null;
}

export interface AuthenticatedUserSummary {
  email: string | null;
}

export interface ZoteroConnectionState {
  connected: boolean;
  zoteroUsername: string | null;
  zoteroUserId: string | null;
  lastSyncedAt: string | null;
  tokenValid: boolean | null;
  groupsLoaded: boolean;
  groups: ZoteroGroupSummary[];
}

export interface ZoteroLibraryIdentity {
  type: "user" | "group";
  id: string;
  identity: string;
}

export interface ZoteroGroupSummary {
  id: string;
  name: string;
  type: string;
  numItems: number;
}

export interface ZoteroCollectionSummary {
  key: string;
  name: string;
  parentCollectionKey: string | null;
  displayName: string;
}

export interface ZoteroLibraryCollectionsResponse {
  library: ZoteroLibraryIdentity;
  collections: ZoteroCollectionSummary[];
}

export interface ZoteroSearchResult {
  key: string;
  version: number;
  title: string;
  creators: string[];
  year: string | null;
  itemType: string | null;
  abstract: string | null;
  doi: string | null;
}

export interface ZoteroSearchMeta {
  source: "live" | "cache" | "stale-cache";
  stale: boolean;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  libraryVersion: number | null;
}

export interface ZoteroSearchResponse {
  results: ZoteroSearchResult[];
  meta: ZoteroSearchMeta;
}

export interface ZoteroLibraryChangesResponse {
  library: ZoteroLibraryIdentity;
  sinceVersion: number | null;
  latestLibraryVersion: number | null;
  changedParentKeys: string[];
  deletedItemKeys: string[];
}

export interface ZoteroLibraryCatalogItem {
  key: string;
  version: number;
}

export interface ZoteroLibraryCatalogPageResponse {
  library: ZoteroLibraryIdentity;
  snapshotLibraryVersion: number | null;
  totalResults: number | null;
  items: ZoteroLibraryCatalogItem[];
  start: number;
  limit: number;
  nextStart: number | null;
  hasMore: boolean;
}

export type BackendErrorPayload = {
  error?: string;
  retryAfterSeconds?: number | null;
  rateLimited?: boolean;
  zoteroTokenInvalid?: boolean;
};

export type RefreshResponse = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user?: {
    email?: string | null;
  };
};

export type AuthenticatedUserResponse = {
  email?: string | null;
};

export interface OpenAlexEnrichment {
  openAlexId: string;
  doi: string;
  title: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  type: string | null;
  language: string | null;
  citedByCount: number;
  countsByYear: Array<{ year: number; citedByCount: number }>;
  fwci: number | null;
  citationPercentile: {
    value: number;
    isInTop1Percent: boolean;
    isInTop10Percent: boolean;
  } | null;
  isRetracted: boolean;
  isOpenAccess: boolean;
  oaStatus: string | null;
  oaUrl: string | null;
  apc: { value: number; currency: string } | null;
  primaryLocation: {
    sourceName: string | null;
    sourceType: string | null;
    landingPageUrl: string | null;
    pdfUrl: string | null;
    isOa: boolean;
  } | null;
  authorships: Array<{
    authorName: string;
    orcid: string | null;
    institutions: string[];
    isCorresponding: boolean;
  }>;
  topics: Array<{
    name: string;
    score: number;
    subfield: string | null;
    field: string | null;
    domain: string | null;
  }>;
  keywords: Array<{ keyword: string; score: number }>;
  funders: Array<{ name: string; awardId: string | null }>;
  sustainableDevelopmentGoals: Array<{ name: string; score: number }>;
  abstractFromOpenAlex: string | null;
  referencedWorksCount: number;
  relatedWorksCount: number;
  ids: {
    openalex: string | null;
    doi: string | null;
    pmid: string | null;
    pmcid: string | null;
  };
  updatedDate: string | null;
}

export type OpenAlexEnrichmentStatus =
  | "enriched"
  | "not_found"
  | "temporary_failure";

export interface OpenAlexEnrichmentBatchResult {
  doi: string;
  enrichment: OpenAlexEnrichment | null;
  status: OpenAlexEnrichmentStatus;
}

export interface OpenAlexEnrichmentBatchResponse {
  results: OpenAlexEnrichmentBatchResult[];
}
