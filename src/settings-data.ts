import { DEFAULT_NOTE_FOLDER } from "./constants";
import type { LiteratureNoteFilenameFormat } from "./literature-note-filenames";
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

export interface StratumSettings {
  notesFolder: string;
  filenameFormat: LiteratureNoteFilenameFormat;
  bulkSyncEnabled: boolean;
  zoteroLocalApiPort: number;
  lastDeviceCode: string | null;
  accountEmail: string | null;
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
  notesFolder: DEFAULT_NOTE_FOLDER,
  filenameFormat: "readable",
  bulkSyncEnabled: false,
  zoteroLocalApiPort: 23119,
  lastDeviceCode: null,
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
