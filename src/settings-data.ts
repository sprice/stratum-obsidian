import { INITIAL_CITATION_STYLES } from "./citation-style-defaults";
import {
  readEnabledTabs,
  type EnabledTabs,
  type StratumTab,
} from "./stratum-tabs";
import type { CollectionCatalogs } from "./collection-catalog";
import type { PublishReadinessCache } from "./publish-readiness";
import { DEFAULT_NOTE_FOLDER } from "./constants";
import type { LiteratureNoteFilenameFormat } from "./literature-note-filenames";
import { getDefaultZoteroDataDir } from "./zotero-data-dir";
import {
  type BulkLibrarySyncState,
  type ZoteroAutoSyncState,
} from "./zotero-sync";

export interface PersistedAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}

export interface ItemFileMapEntry {
  filePath: string;
  zoteroItemKey: string;
  zoteroVersion: number;
}

export interface EnabledLibrary {
  type: "user" | "group";
  id: string;
  name: string;
  identity: string;
}

export type PendingAuthFlow = "stratum-sign-in" | "zotero-connect";

export type PendingAuthReturnTarget = "stay-settings" | "open-panel-search";

export interface PendingAuthState {
  code: string;
  flow: PendingAuthFlow;
  returnTarget: PendingAuthReturnTarget;
  createdAt: string;
}

export interface StratumSettings {
  publishReadinessCache: PublishReadinessCache | null;
  publishPdfSetupComplete: boolean;
  pandocPath: string;
  tectonicPath: string;
  enabledTabs: EnabledTabs;
  lastActiveTab: StratumTab;
  citationStyle: string;
  availableCitationStyles?: string[];
  citationLanguage: string;
  citationStyles: Record<string, string>;
  citationStyleTitles?: Record<string, string>;
  citationLocales: Record<string, string>;
  collectionCatalogs: CollectionCatalogs;
  notesFolder: string;
  filenameFormat: LiteratureNoteFilenameFormat;
  bulkSyncEnabled: boolean;
  bulkSyncPreferenceInitialized: boolean;
  zoteroLocalApiPort: number;
  zoteroDataDir: string;
  pendingAuth: PendingAuthState | null;
  accountEmail: string | null;
  accountId?: string | null;
  accountLinkedAt: string | null;
  authSessionExpiresAt: number | null;
  lastKnownZoteroUserId: string | null;
  lastKnownZoteroUsername: string | null;
  lastKnownZoteroConfirmedAt: string | null;
  selectedSyncLibraryIdentity: string | null;
  selectedSyncCollectionKey: string | null;
  itemFileMap: Record<string, ItemFileMapEntry>;
  enabledLibraries: EnabledLibrary[];
  libraryAutoSync: Record<string, ZoteroAutoSyncState>;
  libraryBulkSync: Record<string, BulkLibrarySyncState>;
  activeBulkSyncLibrary: string | null;
}

export const DEFAULT_SETTINGS: StratumSettings = {
  publishReadinessCache: null,
  publishPdfSetupComplete: false,
  pandocPath: "",
  tectonicPath: "",
  enabledTabs: readEnabledTabs(undefined),
  lastActiveTab: "search",
  citationStyle: "apa",
  availableCitationStyles: [...INITIAL_CITATION_STYLES],
  citationLanguage: "en-US",
  citationStyles: {},
  citationLocales: {},
  collectionCatalogs: {},
  notesFolder: DEFAULT_NOTE_FOLDER,
  filenameFormat: "readable",
  bulkSyncEnabled: false,
  bulkSyncPreferenceInitialized: false,
  zoteroLocalApiPort: 23119,
  zoteroDataDir: getDefaultZoteroDataDir(),
  pendingAuth: null,
  accountEmail: null,
  accountLinkedAt: null,
  authSessionExpiresAt: null,
  lastKnownZoteroUserId: null,
  lastKnownZoteroUsername: null,
  lastKnownZoteroConfirmedAt: null,
  selectedSyncLibraryIdentity: null,
  selectedSyncCollectionKey: null,
  itemFileMap: {},
  enabledLibraries: [],
  libraryAutoSync: {},
  libraryBulkSync: {},
  activeBulkSyncLibrary: null,
};
