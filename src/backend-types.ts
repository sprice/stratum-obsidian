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
    type: "user" | "group";
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
  library: {
    type: "user";
    id: string;
    identity: string;
  };
  sinceVersion: number | null;
  latestLibraryVersion: number | null;
  changedParentKeys: string[];
  deletedItemKeys: string[];
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
