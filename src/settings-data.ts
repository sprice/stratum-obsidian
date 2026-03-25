import { DEFAULT_NOTE_FOLDER } from "./constants";
import type { LiteratureNoteFilenameFormat } from "./literature-note-filenames";
import {
  DEFAULT_BULK_LIBRARY_SYNC_STATE,
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

export interface StratumSettings {
  notesFolder: string;
  filenameFormat: LiteratureNoteFilenameFormat;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  lastDeviceCode: string | null;
  accountEmail: string | null;
  accountLinkedAt: string | null;
  authSessionExpiresAt: number | null;
  itemFileMap: Record<string, ItemFileMapEntry>;
  zoteroAutoSync: ZoteroAutoSyncState;
  bulkLibrarySync: BulkLibrarySyncState;
}

export const DEFAULT_SETTINGS: StratumSettings = {
  notesFolder: DEFAULT_NOTE_FOLDER,
  filenameFormat: "readable",
  autoSyncEnabled: true,
  autoSyncIntervalMinutes: 15,
  lastDeviceCode: null,
  accountEmail: null,
  accountLinkedAt: null,
  authSessionExpiresAt: null,
  itemFileMap: {},
  zoteroAutoSync: {
    libraryVersion: null,
    lastSuccessfulSyncAt: null,
    lastError: null,
    initialRefreshCompleted: false,
  },
  bulkLibrarySync: DEFAULT_BULK_LIBRARY_SYNC_STATE,
};
