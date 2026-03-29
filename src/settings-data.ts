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
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  lastDeviceCode: string | null;
  accountEmail: string | null;
  accountLinkedAt: string | null;
  authSessionExpiresAt: number | null;
  lastKnownZoteroUserId: string | null;
  lastKnownZoteroUsername: string | null;
  lastKnownZoteroConfirmedAt: string | null;
  itemFileMap: Record<string, ItemFileMapEntry>;
  enabledLibraries: EnabledLibrary[];
  libraryAutoSync: Record<string, ZoteroAutoSyncState>;
  libraryBulkSync: Record<string, BulkLibrarySyncState>;
  activeBulkSyncLibrary: string | null;
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
  lastKnownZoteroUserId: null,
  lastKnownZoteroUsername: null,
  lastKnownZoteroConfirmedAt: null,
  itemFileMap: {},
  enabledLibraries: [],
  libraryAutoSync: {},
  libraryBulkSync: {},
  activeBulkSyncLibrary: null,
};
