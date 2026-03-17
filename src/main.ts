import {
  Notice,
  Plugin,
  TFile,
  normalizePath,
  type CachedMetadata,
  type ObsidianProtocolData,
  type TAbstractFile,
} from "obsidian";
import {
  AUTH_PROTOCOL_ACTION,
  AUTH_ACCESS_TOKEN_SECRET_ID,
  AUTH_REFRESH_TOKEN_SECRET_ID,
  PLUGIN_NAME,
  VIEW_TYPE_STRATUM,
} from "./constants";
import {
  BackendClient,
  type ZoteroLibraryChangesResponse,
  type ZoteroSearchMeta,
  type ZoteroSearchResult,
  type ZoteroConnectionState,
} from "./backend-client";
import {
  createOrUpdateLiteratureNote,
  getLiteratureNoteSummary,
  markLiteratureNoteDeleted,
} from "./literature-note";
import { promptExistingLiteratureNote } from "./literature-note-update-modal";
import {
  DEFAULT_SETTINGS,
  type ItemFileMapEntry,
  type PersistedAuthSession,
  type StratumSettings,
  StratumSettingTab,
} from "./settings";
import { PLUGIN_WEB_APP_URL } from "./build-config";
import { StratumView } from "./view";
import {
  IDENTITY_FRONTMATTER_KEY,
  ITEM_KEY_FRONTMATTER_KEY,
} from "./literature-note-content";
import {
  AUTO_SYNC_FOCUS_COOLDOWN_MS,
  findAffectedPathsForDeletedChildKeys,
  getSyncStatusLabel,
  shouldSkipFocusSync,
} from "./zotero-sync";
const LIBRARY_SEARCH_DEBOUNCE_MS = 150;
const LIBRARY_PICKER_CLOSE_DELAY_MS = 120;
const AUTO_SYNC_STATUS_REFRESH_MS = 60_000;

type StoredSettingsData = Partial<
  Pick<
    StratumSettings,
    | "notesFolder"
    | "filenameFormat"
    | "autoSyncEnabled"
    | "autoSyncIntervalMinutes"
    | "lastDeviceCode"
    | "accountEmail"
    | "accountLinkedAt"
    | "authSessionExpiresAt"
  >
> & {
  authSession?: PersistedAuthSession | null;
  itemFileMap?: Record<string, ItemFileMapEntry>;
  zoteroAutoSync?: Partial<StratumSettings["zoteroAutoSync"]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiteratureNoteFilenameFormat(
  value: unknown
): value is StratumSettings["filenameFormat"] {
  return value === "readable" || value === "citekey";
}

function isPersistedAuthSession(value: unknown): value is PersistedAuthSession {
  return (
    isRecord(value) &&
    typeof value.accessToken === "string" &&
    typeof value.refreshToken === "string" &&
    (value.expiresAt === null ||
      (typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)))
  );
}

function isItemFileMapEntry(value: unknown): value is ItemFileMapEntry {
  return (
    isRecord(value) &&
    typeof value.filePath === "string" &&
    typeof value.zoteroItemKey === "string" &&
    typeof value.zoteroVersion === "number" &&
    Number.isFinite(value.zoteroVersion)
  );
}

function readItemFileMap(value: unknown): Record<string, ItemFileMapEntry> {
  if (!isRecord(value)) {
    return {};
  }

  const nextMap: Record<string, ItemFileMapEntry> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (isItemFileMapEntry(entry)) {
      nextMap[key] = entry;
    }
  }

  return nextMap;
}

function readZoteroAutoSyncState(
  value: unknown
): Partial<StratumSettings["zoteroAutoSync"]> {
  if (!isRecord(value)) {
    return {};
  }

  const nextState: Partial<StratumSettings["zoteroAutoSync"]> = {};

  if (
    value.libraryVersion === null ||
    (typeof value.libraryVersion === "number" &&
      Number.isFinite(value.libraryVersion))
  ) {
    nextState.libraryVersion = value.libraryVersion;
  }

  if (typeof value.lastSuccessfulSyncAt === "string" || value.lastSuccessfulSyncAt === null) {
    nextState.lastSuccessfulSyncAt = value.lastSuccessfulSyncAt;
  }

  if (typeof value.lastError === "string" || value.lastError === null) {
    nextState.lastError = value.lastError;
  }

  if (typeof value.initialRefreshCompleted === "boolean") {
    nextState.initialRefreshCompleted = value.initialRefreshCompleted;
  }

  return nextState;
}

function readStoredSettings(
  value: unknown
): Omit<Partial<StratumSettings>, "itemFileMap" | "zoteroAutoSync"> & {
  itemFileMap: Record<string, ItemFileMapEntry>;
  zoteroAutoSync: Partial<StratumSettings["zoteroAutoSync"]>;
} {
  if (!isRecord(value)) {
    return {
      itemFileMap: {},
      zoteroAutoSync: {},
    };
  }

  const nextSettings: Omit<Partial<StratumSettings>, "itemFileMap" | "zoteroAutoSync"> & {
    itemFileMap: Record<string, ItemFileMapEntry>;
    zoteroAutoSync: Partial<StratumSettings["zoteroAutoSync"]>;
  } = {
    itemFileMap: readItemFileMap(value.itemFileMap),
    zoteroAutoSync: readZoteroAutoSyncState(value.zoteroAutoSync),
  };

  if (typeof value.notesFolder === "string") {
    nextSettings.notesFolder = value.notesFolder;
  }
  if (isLiteratureNoteFilenameFormat(value.filenameFormat)) {
    nextSettings.filenameFormat = value.filenameFormat;
  }

  if (typeof value.autoSyncEnabled === "boolean") {
    nextSettings.autoSyncEnabled = value.autoSyncEnabled;
  }
  if (
    typeof value.autoSyncIntervalMinutes === "number" &&
    Number.isFinite(value.autoSyncIntervalMinutes)
  ) {
    nextSettings.autoSyncIntervalMinutes = value.autoSyncIntervalMinutes;
  }
  if (typeof value.lastDeviceCode === "string" || value.lastDeviceCode === null) {
    nextSettings.lastDeviceCode = value.lastDeviceCode;
  }
  if (typeof value.accountEmail === "string" || value.accountEmail === null) {
    nextSettings.accountEmail = value.accountEmail;
  }
  if (typeof value.accountLinkedAt === "string" || value.accountLinkedAt === null) {
    nextSettings.accountLinkedAt = value.accountLinkedAt;
  }
  if (
    typeof value.authSessionExpiresAt === "number" &&
    Number.isFinite(value.authSessionExpiresAt)
  ) {
    nextSettings.authSessionExpiresAt = value.authSessionExpiresAt;
  } else if (value.authSessionExpiresAt === null) {
    nextSettings.authSessionExpiresAt = null;
  }

  return nextSettings;
}

function readLegacyPersistedAuthSession(
  value: unknown
): PersistedAuthSession | null {
  if (!isRecord(value)) {
    return null;
  }

  return isPersistedAuthSession(value.authSession) ? value.authSession : null;
}

export default class StratumPlugin extends Plugin {
  settings: StratumSettings = DEFAULT_SETTINGS;
  settingTab: StratumSettingTab | null = null;
  backend!: BackendClient;
  zoteroConnection: ZoteroConnectionState | null = null;
  isLoadingZoteroConnection = false;
  librarySearchQuery = "";
  librarySearchResults: ZoteroSearchResult[] = [];
  librarySearchMeta: ZoteroSearchMeta | null = null;
  librarySearchError: string | null = null;
  isSearchingLibrary = false;
  isLibraryPickerOpen = false;
  highlightedLibrarySearchIndex = -1;
  selectedLibraryResult: ZoteroSearchResult | null = null;
  isSelectedLibraryAbstractExpanded = false;
  activeNoteActionKey: string | null = null;
  private librarySearchRequestId = 0;
  private librarySearchDebounceTimer: number | null = null;
  private libraryPickerCloseTimer: number | null = null;
  private itemFileMapPersistTimer: number | null = null;
  private autoSyncIntervalTimer: number | null = null;
  private autoSyncStatusTimer: number | null = null;
  private lastFocusSyncAt = 0;
  private isAutoSyncRunning = false;
  private statusBarItemEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.backend = new BackendClient({
      initialSession: this.getStoredAuthSession(),
      onSessionChange: async (session) => {
        this.persistAuthSessionSecrets(session);
        this.settings.authSessionExpiresAt = session?.expiresAt ?? null;
        await this.saveSettings();
      },
      onUserChange: async (user) => {
        const nextEmail = user?.email ?? null;
        let changed = false;

        if (this.settings.accountEmail !== nextEmail) {
          this.settings.accountEmail = nextEmail;
          changed = true;
        }

        if (nextEmail) {
          if (!this.settings.accountLinkedAt) {
            this.settings.accountLinkedAt = new Date().toISOString();
            changed = true;
          }
        } else {
          if (this.settings.accountLinkedAt !== null) {
            this.settings.accountLinkedAt = null;
            changed = true;
          }

          if (this.zoteroConnection !== null) {
            this.zoteroConnection = null;
            changed = true;
          }
        }

        if (changed) {
          await this.saveSettings();
          this.refreshAutoSyncUi();
          this.refreshViews();
          this.refreshSettingTab();
        }
      },
    });

    this.settingTab = new StratumSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerView(
      VIEW_TYPE_STRATUM,
      (leaf) => new StratumView(leaf, this)
    );

    this.addRibbonIcon("search", "Open library view", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-stratum-view",
      name: "Open library view",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "sync-zotero-changes-now",
      name: "Sync Zotero changes now",
      callback: () => {
        void this.runZoteroAutoSync("manual");
      },
    });

    this.registerObsidianProtocolHandler(AUTH_PROTOCOL_ACTION, (params) => {
      void this.handleAuthProtocol(params);
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        this.syncItemFileMapForFile(file, cache);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.handleItemFileRename(file, oldPath);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.handleItemFileDelete(file);
      })
    );
    this.registerDomEvent(window, "focus", () => {
      if (shouldSkipFocusSync(this.lastFocusSyncAt, Date.now(), AUTO_SYNC_FOCUS_COOLDOWN_MS)) {
        return;
      }

      if (!this.settings.autoSyncEnabled) {
        return;
      }

      this.lastFocusSyncAt = Date.now();
      void this.runZoteroAutoSync("focus");
    });

    this.statusBarItemEl = this.addStatusBarItem();
    this.statusBarItemEl.addClass("mod-clickable");
    this.statusBarItemEl.addEventListener("click", () => {
      void this.runZoteroAutoSync("manual");
    });
    this.startAutoSyncStatusRefresh();
    await this.rebuildItemFileMap();
    this.configureAutoSyncInterval();
    this.refreshAutoSyncUi();

    if (this.backend.hasSession()) {
      await this.refreshZoteroConnection();
      if (this.settings.autoSyncEnabled) {
        void this.runZoteroAutoSync("startup");
      }
    }
  }

  onunload(): void {
    this.clearLibrarySearchDebounce();
    this.cancelLibraryPickerClose();
    this.clearAutoSyncInterval();
    this.stopAutoSyncStatusRefresh();
    if (this.itemFileMapPersistTimer !== null) {
      window.clearTimeout(this.itemFileMapPersistTimer);
      this.itemFileMapPersistTimer = null;
    }
  }

  async loadSettings(): Promise<void> {
    const rawData = (await this.loadData()) as StoredSettingsData | null;
    const data = readStoredSettings(rawData);
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      itemFileMap: {
        ...DEFAULT_SETTINGS.itemFileMap,
        ...(data?.itemFileMap ?? {}),
      },
      zoteroAutoSync: {
        ...DEFAULT_SETTINGS.zoteroAutoSync,
        ...(data?.zoteroAutoSync ?? {}),
      },
    };

    let shouldPersist = false;
    const legacySession = readLegacyPersistedAuthSession(rawData);
    if (legacySession && !this.getStoredAuthSession()) {
      this.persistAuthSessionSecrets(legacySession);
      this.settings.authSessionExpiresAt = legacySession.expiresAt;
      shouldPersist = true;
    }

    const storedSession = this.getStoredAuthSession();
    if (!storedSession && this.settings.authSessionExpiresAt !== null) {
      this.settings.authSessionExpiresAt = null;
      shouldPersist = true;
    }

    if (legacySession) {
      shouldPersist = true;
    }

    if (shouldPersist) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private readSecret(id: string): string | null {
    const value = this.app.secretStorage.getSecret(id);
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  }

  private writeSecret(id: string, value: string | null): void {
    this.app.secretStorage.setSecret(id, value ?? "");
  }

  private persistAuthSessionSecrets(
    session: PersistedAuthSession | null
  ): void {
    this.writeSecret(AUTH_ACCESS_TOKEN_SECRET_ID, session?.accessToken ?? null);
    this.writeSecret(AUTH_REFRESH_TOKEN_SECRET_ID, session?.refreshToken ?? null);
  }

  private getStoredAuthSession(): PersistedAuthSession | null {
    const accessToken = this.readSecret(AUTH_ACCESS_TOKEN_SECRET_ID);
    const refreshToken = this.readSecret(AUTH_REFRESH_TOKEN_SECRET_ID);

    if (!accessToken && !refreshToken) {
      return null;
    }

    if (!accessToken || !refreshToken) {
      this.persistAuthSessionSecrets(null);
      return null;
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: this.settings.authSessionExpiresAt,
    };
  }

  getAutoSyncStatusLabel(): string {
    return getSyncStatusLabel({
      isSyncing: this.isAutoSyncRunning,
      autoSyncEnabled: this.settings.autoSyncEnabled,
      state: this.settings.zoteroAutoSync,
    });
  }

  isZoteroAutoSyncRunning(): boolean {
    return this.isAutoSyncRunning;
  }

  private refreshAutoSyncUi(): void {
    if (this.statusBarItemEl) {
      this.statusBarItemEl.setText(this.getAutoSyncStatusLabel());
      this.statusBarItemEl.setAttribute(
        "aria-label",
        this.settings.zoteroAutoSync.lastError
          ? `Zotero sync status: ${this.settings.zoteroAutoSync.lastError}`
          : this.getAutoSyncStatusLabel()
      );
      this.statusBarItemEl.title = this.settings.zoteroAutoSync.lastError
        ? this.settings.zoteroAutoSync.lastError
        : "Click to sync Zotero changes now";
    }
  }

  private clearAutoSyncInterval(): void {
    if (this.autoSyncIntervalTimer === null) {
      return;
    }

    window.clearInterval(this.autoSyncIntervalTimer);
    this.autoSyncIntervalTimer = null;
  }

  configureAutoSyncInterval(): void {
    this.clearAutoSyncInterval();
    if (!this.settings.autoSyncEnabled) {
      this.refreshAutoSyncUi();
      return;
    }

    const intervalMs = Math.max(1, this.settings.autoSyncIntervalMinutes) * 60_000;
    this.autoSyncIntervalTimer = window.setInterval(() => {
      void this.runZoteroAutoSync("interval");
    }, intervalMs);
    this.refreshAutoSyncUi();
  }

  private startAutoSyncStatusRefresh(): void {
    this.stopAutoSyncStatusRefresh();
    this.autoSyncStatusTimer = window.setInterval(() => {
      this.refreshAutoSyncUi();
    }, AUTO_SYNC_STATUS_REFRESH_MS);
  }

  private stopAutoSyncStatusRefresh(): void {
    if (this.autoSyncStatusTimer === null) {
      return;
    }

    window.clearInterval(this.autoSyncStatusTimer);
    this.autoSyncStatusTimer = null;
  }

  private getNormalizedNotesFolder(): string {
    return normalizePath(this.settings.notesFolder.trim()).replace(/\/+$/, "");
  }

  private isPathInsideNotesFolder(path: string): boolean {
    const normalizedFolder = this.getNormalizedNotesFolder();
    const normalizedPath = normalizePath(path);
    if (!normalizedFolder) {
      return !normalizedPath.includes("/");
    }

    return (
      normalizedPath === normalizedFolder ||
      normalizedPath.startsWith(`${normalizedFolder}/`)
    );
  }

  private getIdentityFromFrontmatter(
    frontmatter?: Record<string, unknown> | null
  ): string | null {
    const identity = frontmatter?.[IDENTITY_FRONTMATTER_KEY];
    return typeof identity === "string" && identity.trim() ? identity.trim() : null;
  }

  private getItemKeyFromFrontmatter(
    frontmatter?: Record<string, unknown> | null
  ): string | null {
    const itemKey = frontmatter?.[ITEM_KEY_FRONTMATTER_KEY];
    return typeof itemKey === "string" && itemKey.trim() ? itemKey.trim() : null;
  }

  private getVersionFromFrontmatter(
    frontmatter?: Record<string, unknown> | null
  ): number {
    const values = [
      frontmatter?.zotero_item_version,
      frontmatter?.zotero_version,
    ];

    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return 0;
  }

  private queuePersistItemFileMap(): void {
    if (this.itemFileMapPersistTimer !== null) {
      return;
    }

    this.itemFileMapPersistTimer = window.setTimeout(() => {
      this.itemFileMapPersistTimer = null;
      void this.saveSettings();
    }, 100);
  }

  private setItemFileMapEntry(identity: string, entry: ItemFileMapEntry): void {
    this.settings.itemFileMap[identity] = entry;
    this.queuePersistItemFileMap();
  }

  private removeItemFileMapEntriesForPath(path: string): void {
    let changed = false;
    for (const [identity, entry] of Object.entries(this.settings.itemFileMap)) {
      if (entry.filePath === path) {
        delete this.settings.itemFileMap[identity];
        changed = true;
      }
    }

    if (changed) {
      this.queuePersistItemFileMap();
    }
  }

  private syncItemFileMapForFile(
    file: TFile,
    cache?: CachedMetadata | null
  ): void {
    this.removeItemFileMapEntriesForPath(file.path);

    if (!this.isPathInsideNotesFolder(file.path)) {
      return;
    }

    const frontmatter =
      (cache?.frontmatter as Record<string, unknown> | undefined) ??
      ((this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined) ??
        null);
    const identity = this.getIdentityFromFrontmatter(frontmatter);
    const itemKey = this.getItemKeyFromFrontmatter(frontmatter);
    if (!identity || !itemKey) {
      return;
    }

    this.setItemFileMapEntry(identity, {
      filePath: file.path,
      zoteroItemKey: itemKey,
      zoteroVersion: this.getVersionFromFrontmatter(frontmatter),
    });
  }

  private handleItemFileRename(file: TAbstractFile, oldPath: string): void {
    this.removeItemFileMapEntriesForPath(oldPath);
    if (file instanceof TFile) {
      this.syncItemFileMapForFile(file);
    }
  }

  private handleItemFileDelete(file: TAbstractFile): void {
    this.removeItemFileMapEntriesForPath(file.path);
  }

  async rebuildItemFileMap(): Promise<void> {
    const nextMap: Record<string, ItemFileMapEntry> = {};

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isPathInsideNotesFolder(file.path)) {
        continue;
      }

      const frontmatter =
        (this.app.metadataCache.getFileCache(file)?.frontmatter as
          | Record<string, unknown>
          | undefined) ?? null;
      const identity = this.getIdentityFromFrontmatter(frontmatter);
      const itemKey = this.getItemKeyFromFrontmatter(frontmatter);
      if (!identity || !itemKey) {
        continue;
      }

      nextMap[identity] = {
        filePath: file.path,
        zoteroItemKey: itemKey,
        zoteroVersion: this.getVersionFromFrontmatter(frontmatter),
      };
    }

    this.settings.itemFileMap = nextMap;
    await this.saveSettings();
  }

  private getIdentityCacheKey(identity: {
    libraryType: string;
    libraryId: string;
    itemKey: string;
  }): string {
    return `${identity.libraryType}:${identity.libraryId}:${identity.itemKey}`;
  }

  findExistingLiteratureNoteFile(identity: {
    libraryType: string;
    libraryId: string;
    itemKey: string;
  }): TFile | null {
    const cacheKey = this.getIdentityCacheKey(identity);
    const cachedEntry = this.settings.itemFileMap[cacheKey];
    if (cachedEntry && this.isPathInsideNotesFolder(cachedEntry.filePath)) {
      const cachedFile = this.app.vault.getAbstractFileByPath(cachedEntry.filePath);
      if (cachedFile instanceof TFile) {
        return cachedFile;
      }

      delete this.settings.itemFileMap[cacheKey];
      this.queuePersistItemFileMap();
    }

    const noteFiles = this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isPathInsideNotesFolder(file.path));

    const repaired =
      noteFiles.find((file) => {
        const frontmatter =
          (this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined) ?? null;
        return this.getIdentityFromFrontmatter(frontmatter) === cacheKey;
      }) ??
      noteFiles.find((file) => {
        const frontmatter =
          (this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined) ?? null;
        return this.getItemKeyFromFrontmatter(frontmatter) === identity.itemKey;
      });

    if (!repaired) {
      return null;
    }

    this.syncItemFileMapForFile(repaired);
    return repaired;
  }

  rememberLiteratureNoteFile(detail: {
    library: { type: string; id: string };
    item: { key: string; version: number };
  }, file: TFile): void {
    this.setItemFileMapEntry(this.getIdentityCacheKey({
      libraryType: detail.library.type,
      libraryId: detail.library.id,
      itemKey: detail.item.key,
    }), {
      filePath: file.path,
      zoteroItemKey: detail.item.key,
      zoteroVersion: detail.item.version,
    });
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STRATUM);
    const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      return;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_STRATUM,
      active: true,
    });

    await this.app.workspace.revealLeaf(leaf);
  }

  async startDeviceHandoff(): Promise<void> {
    const deviceCode = crypto.randomUUID();
    this.settings.lastDeviceCode = deviceCode;
    await this.saveSettings();
    this.refreshViews();
    this.refreshSettingTab();

    const url = new URL(`${PLUGIN_WEB_APP_URL}/link`);
    url.searchParams.set("code", deviceCode);

    window.open(url.toString(), "_blank", "noopener,noreferrer");
    new Notice(`${PLUGIN_NAME}: opened browser sign-in for device handoff.`);
  }

  async startZoteroConnect(): Promise<void> {
    const deviceCode = crypto.randomUUID();
    this.settings.lastDeviceCode = deviceCode;
    await this.saveSettings();
    this.refreshViews();
    this.refreshSettingTab();

    const url = new URL(`${PLUGIN_WEB_APP_URL}/link`);
    url.searchParams.set("code", deviceCode);
    url.searchParams.set("flow", "zotero-connect");

    window.open(url.toString(), "_blank", "noopener,noreferrer");
    new Notice(`${PLUGIN_NAME}: opened Zotero connect flow in the browser.`);
  }

  private async handleAuthProtocol(params: ObsidianProtocolData) {
    const handoff = typeof params.handoff === "string" ? params.handoff : null;
    const email = typeof params.email === "string" ? params.email : null;
    const zoteroConnected = params.zotero_connected === "true";
    const zoteroUsername =
      typeof params.zotero_username === "string" ? params.zotero_username : null;
    const accessToken =
      typeof params.access_token === "string" ? params.access_token : null;
    const refreshToken =
      typeof params.refresh_token === "string" ? params.refresh_token : null;
    const expiresAtParam =
      typeof params.expires_at === "string" ? params.expires_at : null;

    if (!handoff) {
      new Notice(`${PLUGIN_NAME}: auth callback received without handoff code.`);
      return;
    }

    const expectedHandoff = this.settings.lastDeviceCode;
    if (!expectedHandoff || handoff !== expectedHandoff) {
      new Notice(`${PLUGIN_NAME}: ignored an unexpected auth callback.`);
      return;
    }

    this.settings.lastDeviceCode = null;
    if (accessToken && refreshToken) {
      const expiresAt = expiresAtParam ? Number(expiresAtParam) : null;
      await this.backend.setSession({
        accessToken,
        refreshToken,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
        email,
      });
    } else if (email) {
      this.settings.accountEmail = email;
      this.settings.accountLinkedAt = new Date().toISOString();
      await this.saveSettings();
    }
    this.refreshViews();
    this.refreshSettingTab();
    await this.refreshZoteroConnection();
    if (this.settings.autoSyncEnabled) {
      void this.runZoteroAutoSync("startup");
    }
    await this.activateView();
    new Notice(
      zoteroConnected
        ? `${PLUGIN_NAME}: Zotero connected${zoteroUsername ? ` as ${zoteroUsername}` : ""}.`
        : email
        ? `${PLUGIN_NAME}: signed in as ${email}.`
        : `${PLUGIN_NAME}: auth callback received for handoff ${handoff}.`
    );
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STRATUM)) {
      const view = leaf.view;
      if (view instanceof StratumView) {
        view.render();
      }
    }
  }

  refreshSettingTab(): void {
    if (this.settingTab?.containerEl?.isConnected) {
      this.settingTab.display();
    }
  }

  private async ensureAuthenticatedSessionState(): Promise<boolean> {
    if (!this.backend.hasSession()) {
      return false;
    }

    try {
      const user = await this.backend.validateSession();
      if (user) {
        return true;
      }
    } catch (error) {
      console.error("stratum: failed to validate app session", error);
      return this.backend.hasSession();
    }

    this.zoteroConnection = null;
    this.refreshAutoSyncUi();
    this.refreshViews();
    this.refreshSettingTab();
    return false;
  }

  async refreshZoteroConnection(): Promise<void> {
    if (!this.backend.hasSession()) {
      this.zoteroConnection = null;
      this.isLoadingZoteroConnection = false;
      this.refreshAutoSyncUi();
      this.refreshViews();
      this.refreshSettingTab();
      return;
    }

    if (!(await this.ensureAuthenticatedSessionState())) {
      this.zoteroConnection = null;
      this.isLoadingZoteroConnection = false;
      this.refreshAutoSyncUi();
      this.refreshViews();
      this.refreshSettingTab();
      return;
    }

    this.isLoadingZoteroConnection = true;
    this.refreshViews();
    this.refreshSettingTab();

    try {
      this.zoteroConnection = await this.backend.getZoteroConnectionStatus();
    } catch (error) {
      console.error("stratum: failed to load Zotero connection state", error);
      this.zoteroConnection = null;
    } finally {
      this.isLoadingZoteroConnection = false;
      this.refreshAutoSyncUi();
      this.refreshViews();
      this.refreshSettingTab();
    }
  }

  private getTrackedLiteratureNotes(): Array<{
    file: TFile;
    frontmatter: Record<string, unknown> | null;
  }> {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isPathInsideNotesFolder(file.path))
      .map((file) => ({
        file,
        frontmatter:
          (this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined) ?? null,
      }))
      .filter(
        (entry) =>
          Boolean(this.getIdentityFromFrontmatter(entry.frontmatter)) &&
          Boolean(this.getItemKeyFromFrontmatter(entry.frontmatter))
      );
  }

  private isMissingZoteroItemError(error: unknown): boolean {
    return (
      error instanceof Error &&
      /zotero item not found|failed to load zotero item detail/i.test(error.message)
    );
  }

  private async ensureZoteroConnectionForSync(): Promise<boolean> {
    if (!this.backend.hasSession()) {
      return false;
    }

    if (this.isLoadingZoteroConnection) {
      return false;
    }

    if (!this.zoteroConnection?.connected) {
      await this.refreshZoteroConnection();
    }

    return Boolean(this.zoteroConnection?.connected);
  }

  private async runInitialLiteratureRefresh(): Promise<{
    updatedCount: number;
    deletedCount: number;
  }> {
    const trackedNotes = this.getTrackedLiteratureNotes();
    if (trackedNotes.length > 0) {
      new Notice(
        `${PLUGIN_NAME}: First sync: refreshing ${trackedNotes.length} literature notes from Zotero…`
      );
    }

    let updatedCount = 0;
    let deletedCount = 0;
    const failures: string[] = [];

    for (const entry of trackedNotes) {
      const itemKey = this.getItemKeyFromFrontmatter(entry.frontmatter);
      if (!itemKey) {
        continue;
      }

      try {
        const detail = await this.backend.getZoteroItemDetail(itemKey);
        const writeResult = await createOrUpdateLiteratureNote({
          app: this.app,
          notesFolder: this.settings.notesFolder,
          filenameFormat: this.settings.filenameFormat,
          detail,
          existingFile: entry.file,
        });
        this.rememberLiteratureNoteFile(detail, writeResult.file);
        updatedCount += 1;
      } catch (error) {
        if (this.isMissingZoteroItemError(error)) {
          const result = await markLiteratureNoteDeleted({
            app: this.app,
            file: entry.file,
          });
          if (result.changed) {
            deletedCount += 1;
          }
          continue;
        }

        failures.push(
          `${entry.file.basename}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Failed to refresh ${failures.length} literature note${
          failures.length === 1 ? "" : "s"
        }: ${failures.join("; ")}`
      );
    }

    return {
      updatedCount,
      deletedCount,
    };
  }

  private async applyZoteroLibraryChanges(
    changes: ZoteroLibraryChangesResponse
  ): Promise<{
    updatedCount: number;
    deletedCount: number;
  }> {
    const trackedNotes = this.getTrackedLiteratureNotes();
    const notesByPath = new Map(
      trackedNotes.map((entry) => [entry.file.path, entry] as const)
    );
    const deletedItemKeys = new Set(changes.deletedItemKeys);
    const deletedParentFiles = new Map<string, TFile>();
    const refreshParentKeys = new Set<string>(changes.changedParentKeys);

    for (const entry of trackedNotes) {
      const itemKey = this.getItemKeyFromFrontmatter(entry.frontmatter);
      if (itemKey && deletedItemKeys.has(itemKey)) {
        deletedParentFiles.set(entry.file.path, entry.file);
      }
    }

    for (const path of findAffectedPathsForDeletedChildKeys(
      trackedNotes.map((entry) => ({
        path: entry.file.path,
        frontmatter: entry.frontmatter,
      })),
      changes.deletedItemKeys
    )) {
      const entry = notesByPath.get(path);
      if (!entry) {
        continue;
      }

      const itemKey = this.getItemKeyFromFrontmatter(entry.frontmatter);
      if (!itemKey || deletedItemKeys.has(itemKey)) {
        continue;
      }

      refreshParentKeys.add(itemKey);
    }

    let updatedCount = 0;
    let deletedCount = 0;
    const failures: string[] = [];

    for (const parentKey of Array.from(refreshParentKeys).sort((left, right) =>
      left.localeCompare(right)
    )) {
      const file = this.findExistingLiteratureNoteFile({
        libraryType: changes.library.type,
        libraryId: changes.library.id,
        itemKey: parentKey,
      });
      if (!file || deletedParentFiles.has(file.path)) {
        continue;
      }

      try {
        const detail = await this.backend.getZoteroItemDetail(parentKey);
        const writeResult = await createOrUpdateLiteratureNote({
          app: this.app,
          notesFolder: this.settings.notesFolder,
          filenameFormat: this.settings.filenameFormat,
          detail,
          existingFile: file,
        });
        this.rememberLiteratureNoteFile(detail, writeResult.file);
        updatedCount += 1;
      } catch (error) {
        if (this.isMissingZoteroItemError(error)) {
          deletedParentFiles.set(file.path, file);
          continue;
        }

        failures.push(
          `${parentKey}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    for (const file of Array.from(deletedParentFiles.values()).sort((left, right) =>
      left.path.localeCompare(right.path)
    )) {
      try {
        const result = await markLiteratureNoteDeleted({
          app: this.app,
          file,
        });
        if (result.changed) {
          deletedCount += 1;
        }
      } catch (error) {
        failures.push(
          `${file.basename}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Failed to sync ${failures.length} literature note${
          failures.length === 1 ? "" : "s"
        }: ${failures.join("; ")}`
      );
    }

    return {
      updatedCount,
      deletedCount,
    };
  }

  async runZoteroAutoSync(
    reason: "startup" | "focus" | "interval" | "manual"
  ): Promise<void> {
    if (this.isAutoSyncRunning) {
      if (reason === "manual") {
        new Notice(`${PLUGIN_NAME}: Zotero sync is already running.`);
      }
      return;
    }

    if (!(await this.ensureZoteroConnectionForSync())) {
      if (reason === "manual") {
        new Notice(`${PLUGIN_NAME}: Connect Zotero before syncing changes.`);
      }
      return;
    }

    this.isAutoSyncRunning = true;
    this.refreshAutoSyncUi();

    try {
      if (!this.settings.zoteroAutoSync.initialRefreshCompleted) {
        const baseline = await this.backend.getZoteroLibraryChanges(null);
        const result = await this.runInitialLiteratureRefresh();
        this.settings.zoteroAutoSync.libraryVersion = baseline.latestLibraryVersion;
        this.settings.zoteroAutoSync.initialRefreshCompleted = true;
        this.settings.zoteroAutoSync.lastSuccessfulSyncAt = new Date().toISOString();
        this.settings.zoteroAutoSync.lastError = null;
        await this.saveSettings();

        if (result.updatedCount > 0 || result.deletedCount > 0) {
          new Notice(
            `${PLUGIN_NAME}: First sync updated ${result.updatedCount} literature note${
              result.updatedCount === 1 ? "" : "s"
            }${
              result.deletedCount > 0
                ? ` and marked ${result.deletedCount} as removed from Zotero`
                : ""
            }.`
          );
        }

        return;
      }

      const changes = await this.backend.getZoteroLibraryChanges(
        this.settings.zoteroAutoSync.libraryVersion
      );
      const result = await this.applyZoteroLibraryChanges(changes);
      this.settings.zoteroAutoSync.libraryVersion = changes.latestLibraryVersion;
      this.settings.zoteroAutoSync.lastSuccessfulSyncAt = new Date().toISOString();
      this.settings.zoteroAutoSync.lastError = null;
      await this.saveSettings();

      if (result.updatedCount > 0 || result.deletedCount > 0) {
        new Notice(
          `${PLUGIN_NAME}: Updated ${result.updatedCount} literature note${
            result.updatedCount === 1 ? "" : "s"
          } from Zotero${
            result.deletedCount > 0
              ? ` and marked ${result.deletedCount} removed item${
                  result.deletedCount === 1 ? "" : "s"
                }`
              : ""
          }.`
        );
      } else if (reason === "manual") {
        new Notice(`${PLUGIN_NAME}: Zotero is already in sync.`);
      }
    } catch (error) {
      this.settings.zoteroAutoSync.lastError =
        error instanceof Error ? error.message : String(error);
      await this.saveSettings();
      console.error("stratum: auto-sync failed", error);

      if (reason !== "focus" && reason !== "interval") {
        new Notice(
          `${PLUGIN_NAME}: ${
            error instanceof Error ? error.message : "Zotero sync failed."
          }`
        );
      }
    } finally {
      this.isAutoSyncRunning = false;
      this.refreshAutoSyncUi();
    }
  }

  async searchLibrary(query: string): Promise<void> {
    this.queueLibrarySearch(query);
  }

  setLibrarySearchQuery(query: string): void {
    if (this.selectedLibraryResult && query !== this.selectedLibraryResult.title) {
      this.selectedLibraryResult = null;
      this.isSelectedLibraryAbstractExpanded = false;
    }
    this.queueLibrarySearch(query);
  }

  openLibraryPicker(): void {
    if (!this.backend.hasSession()) {
      this.librarySearchError = "Sign in first before searching your library.";
      this.refreshViews();
      return;
    }

    const shouldFetch =
      !this.isSearchingLibrary && this.librarySearchResults.length === 0;
    this.cancelLibraryPickerClose();

    if (this.isLibraryPickerOpen) {
      if (shouldFetch) {
        this.queueLibrarySearch(this.librarySearchQuery);
      }
      return;
    }

    this.isLibraryPickerOpen = true;
    if (shouldFetch) {
      this.queueLibrarySearch(this.librarySearchQuery);
      return;
    }

    this.refreshViews();
  }

  closeLibraryPicker(): void {
    this.cancelLibraryPickerClose();
    this.isLibraryPickerOpen = false;
    this.highlightedLibrarySearchIndex = -1;
    this.refreshViews();
  }

  scheduleLibraryPickerClose(): void {
    this.cancelLibraryPickerClose();
    this.libraryPickerCloseTimer = window.setTimeout(() => {
      this.libraryPickerCloseTimer = null;
      this.isLibraryPickerOpen = false;
      this.highlightedLibrarySearchIndex = -1;
      this.refreshViews();
    }, LIBRARY_PICKER_CLOSE_DELAY_MS);
  }

  cancelLibraryPickerClose(): void {
    if (this.libraryPickerCloseTimer === null) {
      return;
    }

    window.clearTimeout(this.libraryPickerCloseTimer);
    this.libraryPickerCloseTimer = null;
  }

  moveLibrarySearchHighlight(direction: 1 | -1): void {
    if (!this.librarySearchResults.length) {
      return;
    }

    this.cancelLibraryPickerClose();
    this.isLibraryPickerOpen = true;
    const nextIndex =
      this.highlightedLibrarySearchIndex < 0
        ? direction > 0
          ? 0
          : this.librarySearchResults.length - 1
        : (this.highlightedLibrarySearchIndex +
            direction +
            this.librarySearchResults.length) %
          this.librarySearchResults.length;
    this.highlightedLibrarySearchIndex = nextIndex;
    this.refreshViews();
  }

  async selectHighlightedLibraryResult(): Promise<void> {
    const result =
      this.librarySearchResults[
        this.highlightedLibrarySearchIndex >= 0
          ? this.highlightedLibrarySearchIndex
          : 0
      ];

    if (!result) {
      return;
    }

    await this.selectLibrarySearchResult(result);
  }

  async selectLibrarySearchResult(result: ZoteroSearchResult): Promise<void> {
    this.cancelLibraryPickerClose();
    this.librarySearchQuery = result.title;
    this.isLibraryPickerOpen = false;
    this.highlightedLibrarySearchIndex = -1;
    this.selectedLibraryResult = result;
    this.isSelectedLibraryAbstractExpanded = false;
    this.refreshViews();
  }

  clearSelectedLibraryResult(options?: { resetQuery?: boolean }): void {
    this.selectedLibraryResult = null;
    this.isSelectedLibraryAbstractExpanded = false;
    if (options?.resetQuery) {
      this.librarySearchQuery = "";
      this.librarySearchResults = [];
      this.librarySearchMeta = null;
      this.highlightedLibrarySearchIndex = -1;
    }
    this.refreshViews();
  }

  toggleSelectedLibraryAbstract(): void {
    if (!this.selectedLibraryResult?.abstract) {
      return;
    }

    this.isSelectedLibraryAbstractExpanded = !this.isSelectedLibraryAbstractExpanded;
    this.refreshViews();
  }

  async refreshLibrarySearch(): Promise<void> {
    await this.fetchLibrarySuggestions(this.librarySearchQuery, { refresh: true });
    this.refreshViews();
  }

  async fetchLibrarySuggestions(
    query: string,
    options?: { refresh?: boolean }
  ): Promise<ZoteroSearchResult[]> {
    this.clearLibrarySearchDebounce();
    const previousQuery = this.librarySearchQuery;
    this.librarySearchQuery = query;

    const canReuseCachedResults =
      !options?.refresh &&
      query === previousQuery &&
      !this.isSearchingLibrary &&
      (this.librarySearchMeta !== null ||
        this.librarySearchResults.length > 0 ||
        this.librarySearchError !== null);

    if (canReuseCachedResults) {
      return this.librarySearchResults;
    }

    if (!this.backend.hasSession()) {
      this.librarySearchResults = [];
      this.librarySearchMeta = null;
      this.librarySearchError = "Sign in first before searching your library.";
      this.isSearchingLibrary = false;
      return [];
    }

    const requestId = ++this.librarySearchRequestId;
    this.librarySearchError = null;
    this.isSearchingLibrary = true;

    try {
      const response = await this.backend.searchZoteroLibrary(query, {
        refresh: options?.refresh,
      });
      if (requestId !== this.librarySearchRequestId) {
        return this.librarySearchResults;
      }

      this.librarySearchResults = response.results;
      this.librarySearchMeta = response.meta;
      this.syncSelectedLibraryResult(response.results);
      return response.results;
    } catch (error) {
      if (requestId !== this.librarySearchRequestId) {
        return this.librarySearchResults;
      }

      this.librarySearchResults = [];
      this.librarySearchMeta = null;
      this.librarySearchError =
        error instanceof Error ? error.message : "Library search failed.";
      return [];
    } finally {
      if (requestId === this.librarySearchRequestId) {
        this.isSearchingLibrary = false;
      }
    }
  }

  private queueLibrarySearch(query: string): void {
    this.librarySearchQuery = query;
    this.librarySearchError = null;
    this.isLibraryPickerOpen = true;
    this.clearLibrarySearchDebounce();

    if (!this.backend.hasSession()) {
      this.librarySearchResults = [];
      this.librarySearchMeta = null;
      this.librarySearchError = "Sign in first before searching your library.";
      this.isSearchingLibrary = false;
      this.highlightedLibrarySearchIndex = -1;
      this.refreshViews();
      return;
    }

    const requestId = ++this.librarySearchRequestId;
    this.librarySearchResults = [];
    this.librarySearchMeta = null;
    this.highlightedLibrarySearchIndex = -1;
    this.isSearchingLibrary = true;
    this.refreshViews();

    const delay = query.trim() ? LIBRARY_SEARCH_DEBOUNCE_MS : 0;
    this.librarySearchDebounceTimer = window.setTimeout(() => {
      this.librarySearchDebounceTimer = null;
      void this.performLibrarySearch(query, requestId);
    }, delay);
  }

  private clearLibrarySearchDebounce(): void {
    if (this.librarySearchDebounceTimer === null) {
      return;
    }

    window.clearTimeout(this.librarySearchDebounceTimer);
    this.librarySearchDebounceTimer = null;
  }

  private async performLibrarySearch(
    query: string,
    requestId: number
  ): Promise<void> {
    let shouldRefresh = true;

    try {
      const response = await this.backend.searchZoteroLibrary(query);
      if (requestId !== this.librarySearchRequestId) {
        shouldRefresh = false;
        return;
      }

      this.librarySearchResults = response.results;
      this.librarySearchMeta = response.meta;
      this.syncSelectedLibraryResult(response.results);
      this.highlightedLibrarySearchIndex = -1;
    } catch (error) {
      if (requestId !== this.librarySearchRequestId) {
        shouldRefresh = false;
        return;
      }

      this.librarySearchResults = [];
      this.librarySearchMeta = null;
      this.highlightedLibrarySearchIndex = -1;
      this.librarySearchError =
        error instanceof Error ? error.message : "Library search failed.";
    } finally {
      if (shouldRefresh) {
        this.isSearchingLibrary = false;
        this.refreshViews();
      }
    }
  }

  private syncSelectedLibraryResult(results: ZoteroSearchResult[]): void {
    if (!this.selectedLibraryResult) {
      return;
    }

    const refreshedSelection = results.find(
      (result) => result.key === this.selectedLibraryResult?.key
    );
    if (refreshedSelection) {
      this.selectedLibraryResult = refreshedSelection;
    }
  }

  async createLiteratureNote(result: ZoteroSearchResult): Promise<void> {
    if (this.activeNoteActionKey) {
      return;
    }

    if (!this.backend.hasSession()) {
      new Notice(`${PLUGIN_NAME}: sign in before creating a literature note.`);
      return;
    }

    this.activeNoteActionKey = result.key;
    this.isLibraryPickerOpen = false;
    this.highlightedLibrarySearchIndex = -1;
    this.refreshViews();

    try {
      const detail = await this.backend.getZoteroItemDetail(result.key);
      const existingFile = this.findExistingLiteratureNoteFile({
        libraryType: detail.library.type,
        libraryId: detail.library.id,
        itemKey: result.key,
      });
      const summary = getLiteratureNoteSummary(detail);

      if (existingFile) {
        const action = await promptExistingLiteratureNote({
          app: this.app,
          file: existingFile,
          title: detail.item.title,
          summary,
        });

        if (action === "cancel") {
          return;
        }

        if (action === "open") {
          await this.app.workspace.getLeaf(true).openFile(existingFile);
          return;
        }
      }

      const writeResult = await createOrUpdateLiteratureNote({
        app: this.app,
        notesFolder: this.settings.notesFolder,
        filenameFormat: this.settings.filenameFormat,
        detail,
        existingFile,
      });

      this.rememberLiteratureNoteFile(detail, writeResult.file);

      await this.app.workspace.getLeaf(true).openFile(writeResult.file);
      new Notice(
        writeResult.created
          ? `${PLUGIN_NAME}: created literature note for ${detail.item.title}.`
          : `${PLUGIN_NAME}: updated literature note for ${detail.item.title}.`
      );
    } catch (error) {
      console.error("stratum: failed to create literature note", error);
      new Notice(
        `${PLUGIN_NAME}: ${
          error instanceof Error
            ? error.message
            : "Literature note creation failed."
        }`
      );
    } finally {
      this.activeNoteActionKey = null;
      this.refreshViews();
    }
  }
}
