import type { PersistedAuthSession } from "./settings";

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
}

export interface ZoteroLibraryIdentity {
  type: "user" | "group";
  id: string;
  identity: string;
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

export interface ZoteroItemDetail {
  zoteroUserId: string;
  library: {
    type: ZoteroLibraryIdentity["type"];
    id: string;
    zoteroUriSegment: "library" | "groups";
    identity: string;
  };
  item: {
    key: string;
    version: number;
    title: string;
    creators: string[];
    year: string | null;
    date: string | null;
    itemType: string | null;
    abstract: string | null;
    doi: string | null;
    url: string | null;
    publicationTitle: string | null;
    collections: Array<{
      key: string;
      name: string;
    }>;
    tags: string[];
    zoteroSelectUri: string;
    isbn: string | null;
    issn: string | null;
    volume: string | null;
    issue: string | null;
    pages: string | null;
    publisher: string | null;
    place: string | null;
    language: string | null;
    shortTitle: string | null;
    citationKey: string | null;
    edition: string | null;
    numPages: string | null;
    series: string | null;
    seriesTitle: string | null;
    seriesNumber: string | null;
    journalAbbreviation: string | null;
    conferenceName: string | null;
    university: string | null;
    bookTitle: string | null;
    reportNumber: string | null;
    reportType: string | null;
    thesisType: string | null;
    pmid: string | null;
    pmcid: string | null;
    arxivId: string | null;
    dateAdded: string | null;
    dateModified: string | null;
    citation: string | null;
  };
  attachments: Array<{
    key: string;
    title: string;
    itemType: string;
    contentType: string | null;
    linkMode: string | null;
    filename: string | null;
    url: string | null;
    zoteroSelectUri: string;
    zoteroOpenPdfUri: string | null;
  }>;
  zoteroNotes: Array<{
    key: string;
    parentItemKey: string | null;
    html: string;
    dateAdded: string | null;
    dateModified: string | null;
    zoteroSelectUri: string;
  }>;
  annotations: Array<{
    key: string;
    attachmentKey: string;
    type: string | null;
    color: string | null;
    pageLabel: string | null;
    text: string | null;
    comment: string | null;
    dateModified: string | null;
    zoteroOpenPdfUri: string | null;
  }>;
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
  citedByCount: number;
  countsByYear: Array<{ year: number; citedByCount: number }>;
  isRetracted: boolean;
  isOpenAccess: boolean;
  oaStatus: string | null;
  oaUrl: string | null;
  primaryLocation: {
    sourceName: string | null;
    sourceType: string | null;
    landingPageUrl: string | null;
    pdfUrl: string | null;
    isOa: boolean;
  } | null;
  authorships: Array<{
    authorName: string;
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
