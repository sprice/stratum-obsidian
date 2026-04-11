import { MarkdownView, Platform, Plugin, TFile } from "obsidian";
import {
  AUTH_PROTOCOL_ACTION,
  PLUGIN_NAME,
  VIEW_TYPE_STRATUM,
} from "./constants";
import {
  type ZoteroConnectionState,
  type ZoteroCollectionSummary,
  type ZoteroGroupSummary,
  type ZoteroSearchMeta,
  type ZoteroSearchResult,
  BackendClient,
} from "./backend-client";
import {
  DEFAULT_SETTINGS,
  type EnabledLibrary,
  type StratumSettings,
  StratumSettingTab,
} from "./settings";
import { StratumView } from "./view";
import {
  bootstrapRemoteState,
  createBackendClient,
  handleAuthProtocol,
  hydrateZoteroConnectionFromCache,
  refreshZoteroConnection,
  signOutFromPlugin,
  startDeviceHandoff,
  startZoteroConnect,
} from "./plugin-auth";
import {
  clearLibrarySearchDebounce,
  getLibrarySuggestions,
  searchLibrary,
  setLibrarySearchQuery,
  openLibraryPicker,
  refreshLibrarySearch,
} from "./plugin-library-search";
import {
  cancelLibraryPickerClose,
  clearSelectedLibraryResult,
  closeLibraryPicker,
  moveLibrarySearchHighlight,
  scheduleLibraryPickerClose,
  selectHighlightedLibraryResult,
  selectLibrarySearchResult,
  toggleSelectedLibraryAbstract,
} from "./plugin-library-selection";
import {
  createLiteratureNote,
  insertLiteratureNoteLink,
  insertPandocCitation,
  openLiteratureNoteInPanel,
  openLiteratureNoteFromModal,
} from "./plugin-note-actions";
import {
  findExistingLiteratureNoteFile,
  handleItemFileDelete,
  handleItemFileRename,
  rememberLiteratureNoteFile,
  rebuildItemFileMap,
  syncItemFileMapForFile,
} from "./plugin-note-index";
import { loadPluginSettings, savePluginSettings } from "./plugin-persistence";
import {
  getBulkLibrarySyncProcessedCount,
  runBulkLibrarySync,
} from "./plugin-bulk-sync";
import {
  getAutoSyncStatusLabel,
  refreshAutoSyncUi,
  startAutoSyncStatusRefresh,
  stopAutoSyncStatusRefresh,
} from "./plugin-sync-status";
import {
  reconcileEnabledLocalSyncLibraries,
  setSelectedSearchLibrary,
} from "./plugin-libraries";
import {
  ensureLibraryCollectionsLoaded,
  refreshLibraryCollections,
  getSelectedSearchCollection,
  setSelectedSearchCollection,
} from "./plugin-collections";
import {
  ensureLocalSyncLibrariesLoaded,
  ensureSyncCollectionsLoaded,
  getSelectedSyncCollection,
  getSelectedSyncLibrary,
  refreshLocalSyncLibraries,
  refreshSyncCollections,
  setSelectedSyncCollection,
  setSelectedSyncLibrary,
} from "./plugin-local-sync";
import { refreshOpenedLiteratureNote } from "./plugin-note-refresh";
type LocalLiveSyncWatcher = {
  close(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

export default class StratumPlugin extends Plugin {
  settings: StratumSettings = DEFAULT_SETTINGS;
  settingTab: StratumSettingTab | null = null;
  backend!: BackendClient;
  zoteroConnection: ZoteroConnectionState | null = null;
  availableGroups: ZoteroGroupSummary[] = [];
  isLoadingZoteroConnection = false;
  selectedSearchLibrary: EnabledLibrary | null = null;
  selectedSearchCollection: ZoteroCollectionSummary | null = null;
  libraryCollectionsLibraryIdentity: string | null = null;
  libraryCollections: ZoteroCollectionSummary[] = [];
  libraryCollectionsError: string | null = null;
  isLoadingLibraryCollections = false;
  libraryCollectionsRequestId = 0;
  libraryCollectionsPendingPromise: Promise<ZoteroCollectionSummary[]> | null =
    null;
  localZoteroUserId: string | null = null;
  discoveredLocalSyncLibraries: EnabledLibrary[] = [];
  localSyncLibraries: EnabledLibrary[] = [];
  localSyncLibrariesError: string | null = null;
  bulkSyncSettingsError: string | null = null;
  isLoadingLocalSyncLibraries = false;
  isCheckingBulkSyncReadiness = false;
  hasLoadedLocalSyncLibraries = false;
  localSyncLibrariesRequestId = 0;
  localSyncLibrariesPendingPromise: Promise<EnabledLibrary[]> | null = null;
  selectedSyncLibrary: EnabledLibrary | null = null;
  selectedSyncCollection: ZoteroCollectionSummary | null = null;
  syncCollectionsLibraryIdentity: string | null = null;
  syncCollections: ZoteroCollectionSummary[] = [];
  syncCollectionsError: string | null = null;
  isLoadingSyncCollections = false;
  hasLoadedSyncCollections = false;
  syncCollectionsRequestId = 0;
  syncCollectionsPendingPromise: Promise<ZoteroCollectionSummary[]> | null =
    null;
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
  activeViewTab: "search" | "sync" | "reader" = "search";
  readerNoteFile: TFile | null = null;
  librarySearchRequestId = 0;
  librarySearchDebounceTimer: number | null = null;
  librarySearchPendingPromise: Promise<ZoteroSearchResult[]> | null = null;
  librarySearchPendingQuery: string | null = null;
  librarySearchCache = new Map<
    string,
    {
      query: string;
      results: ZoteroSearchResult[];
      meta: ZoteroSearchMeta;
    }
  >();
  libraryPickerCloseTimer: number | null = null;
  itemFileMapPersistTimer: number | null = null;
  autoSyncStatusTimer: number | null = null;
  noteRefreshPromises = new Map<string, Promise<void>>();
  bulkLibrarySyncRunPromise: Promise<void> | null = null;
  bulkLibrarySyncStage: "catalog" | "enrichment" | null = null;
  bulkLibrarySyncCurrentPageProcessedCount = 0;
  bulkLibrarySyncCurrentPageTotalCount = 0;
  bulkLibrarySyncUiRefreshTimer: number | null = null;
  localLiveSyncWatcher: LocalLiveSyncWatcher | null = null;
  localLiveSyncWatchDir: string | null = null;
  localLiveSyncDebounceTimer: number | null = null;
  localLiveSyncRunPromise: Promise<void> | null = null;
  localLiveSyncDirty = false;
  localLiveSyncQueuedAfterBulkSync = false;
  localLiveSyncWatching = false;
  localLiveSyncError: string | null = null;
  localLiveSyncLibraryVersions = new Map<string, number | null>();
  localLiveSyncLibraryItemVersions = new Map<string, Record<string, number>>();
  statusBarItemEl: HTMLElement | null = null;
  readonly library = {
    search: (query: string) => searchLibrary(this, query),
    setQuery: (query: string) => setLibrarySearchQuery(this, query),
    openPicker: () => openLibraryPicker(this),
    closePicker: () => closeLibraryPicker(this),
    scheduleClose: () => scheduleLibraryPickerClose(this),
    cancelClose: () => cancelLibraryPickerClose(this),
    moveHighlight: (direction: 1 | -1) =>
      moveLibrarySearchHighlight(this, direction),
    selectHighlighted: () => selectHighlightedLibraryResult(this),
    selectResult: (result: ZoteroSearchResult) =>
      selectLibrarySearchResult(this, result),
    clearSelection: (options?: { resetQuery?: boolean }) =>
      clearSelectedLibraryResult(this, options),
    toggleAbstract: () => toggleSelectedLibraryAbstract(this),
    refreshSearch: () => refreshLibrarySearch(this),
    fetchSuggestions: (query: string) => getLibrarySuggestions(this, query),
    createNote: (result: ZoteroSearchResult) =>
      createLiteratureNote(this, result),
  };
  readonly collections = {
    ensureLoaded: (library: EnabledLibrary | null) =>
      ensureLibraryCollectionsLoaded(this, library),
    refresh: (library: EnabledLibrary | null) =>
      refreshLibraryCollections(this, library),
    select: (collection: ZoteroCollectionSummary | null) =>
      setSelectedSearchCollection(this, collection),
    getSelected: () => getSelectedSearchCollection(this),
  };
  readonly localSync = {
    ensureLibrariesLoaded: () => ensureLocalSyncLibrariesLoaded(this),
    refreshLibraries: () => refreshLocalSyncLibraries(this),
    reconcileEnabledLibraries: () => reconcileEnabledLocalSyncLibraries(this),
    ensureCollectionsLoaded: (library: EnabledLibrary | null) =>
      ensureSyncCollectionsLoaded(this, library),
    refreshCollections: (library: EnabledLibrary | null) =>
      refreshSyncCollections(this, library),
    selectLibrary: (library: EnabledLibrary | null) =>
      setSelectedSyncLibrary(this, library),
    selectCollection: (collection: ZoteroCollectionSummary | null) =>
      setSelectedSyncCollection(this, collection),
    getSelectedLibrary: () => getSelectedSyncLibrary(this),
    getSelectedCollection: () => getSelectedSyncCollection(this),
  };

  async onload(): Promise<void> {
    console.debug("stratum: Loading Stratum plugin");
    await loadPluginSettings(this);
    this.backend = createBackendClient(this);
    hydrateZoteroConnectionFromCache(this);
    setSelectedSearchLibrary(this, this.selectedSearchLibrary);
    const openStratumRibbonLabel = `Open ${PLUGIN_NAME}`;

    this.settingTab = new StratumSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerView(VIEW_TYPE_STRATUM, (leaf) => new StratumView(leaf, this));

    this.addRibbonIcon("book-open-text", openStratumRibbonLabel, () => {
      this.activeViewTab = "search";
      void this.activateView().then(() => {
        this.refreshViews();
      });
    });

    this.addCommand({
      id: "open-library-view",
      name: "Open library view",
      callback: () => {
        this.activeViewTab = "search";
        void this.activateView().then(() => {
          this.refreshViews();
        });
      },
    });

    this.addCommand({
      id: "open-literature-note",
      name: "Open literature note",
      callback: () => openLiteratureNoteFromModal(this),
    });

    this.addCommand({
      id: "open-literature-note-in-panel",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Open literature note in Reader panel",
      callback: () => openLiteratureNoteInPanel(this),
    });

    this.addCommand({
      id: "insert-literature-note-link",
      name: "Insert literature note link",
      editorCallback: (editor) => insertLiteratureNoteLink(this, editor),
    });

    this.addCommand({
      id: "insert-pandoc-citation",
      name: "Insert pandoc citation",
      editorCallback: (editor) => insertPandocCitation(this, editor),
    });

    this.registerObsidianProtocolHandler(AUTH_PROTOCOL_ACTION, (params) => {
      void handleAuthProtocol(this, params);
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        syncItemFileMapForFile(this, file, cache);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        handleItemFileRename(this, file, oldPath);
        if (file instanceof TFile && this.readerNoteFile?.path === oldPath) {
          this.readerNoteFile = file;
          if (this.activeViewTab === "reader") {
            this.refreshViews();
          }
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        handleItemFileDelete(this, file);
        if (file instanceof TFile && this.readerNoteFile?.path === file.path) {
          this.readerNoteFile = null;
          if (this.activeViewTab === "reader") {
            this.refreshViews();
          }
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!(leaf?.view instanceof MarkdownView)) {
          return;
        }

        const file = leaf.view.file;
        if (!(file instanceof TFile)) {
          return;
        }

        void refreshOpenedLiteratureNote(this, file);
      }),
    );

    this.statusBarItemEl = this.addStatusBarItem();
    startAutoSyncStatusRefresh(this);
    refreshAutoSyncUi(this);

    this.app.workspace.onLayoutReady(() => {
      void bootstrapRemoteState(this);
    });
  }

  onunload(): void {
    clearLibrarySearchDebounce(this);
    cancelLibraryPickerClose(this);
    stopAutoSyncStatusRefresh(this);
    if (this.itemFileMapPersistTimer !== null) {
      window.clearTimeout(this.itemFileMapPersistTimer);
      this.itemFileMapPersistTimer = null;
    }
    if (this.bulkLibrarySyncUiRefreshTimer !== null) {
      window.clearTimeout(this.bulkLibrarySyncUiRefreshTimer);
      this.bulkLibrarySyncUiRefreshTimer = null;
    }
    if (this.localLiveSyncDebounceTimer !== null) {
      window.clearTimeout(this.localLiveSyncDebounceTimer);
      this.localLiveSyncDebounceTimer = null;
    }
    this.localLiveSyncWatcher?.close();
    this.localLiveSyncWatcher = null;
    this.localLiveSyncWatchDir = null;
    this.localLiveSyncWatching = false;
    this.localLiveSyncDirty = false;
    this.localLiveSyncQueuedAfterBulkSync = false;
    this.localLiveSyncLibraryVersions.clear();
    this.localLiveSyncLibraryItemVersions.clear();
  }

  async loadSettings(): Promise<void> {
    await loadPluginSettings(this);
  }

  async saveSettings(): Promise<void> {
    await savePluginSettings(this);
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

  getAutoSyncStatusLabel(): string {
    return getAutoSyncStatusLabel(this);
  }

  isZoteroAutoSyncRunning(): boolean {
    return this.noteRefreshPromises.size > 0;
  }

  isBulkLibrarySyncRunning(): boolean {
    return this.bulkLibrarySyncRunPromise !== null;
  }

  getBulkLibrarySyncProcessedCount(): number {
    return getBulkLibrarySyncProcessedCount(this);
  }

  refreshAutoSyncUi(): void {
    refreshAutoSyncUi(this);
  }

  async rebuildItemFileMap(): Promise<void> {
    await rebuildItemFileMap(this);
  }

  findExistingLiteratureNoteFile(identity: {
    libraryType: string;
    libraryId: string;
    itemKey: string;
  }): TFile | null {
    return findExistingLiteratureNoteFile(this, identity);
  }

  rememberLiteratureNoteFile(
    detail: {
      library: { type: string; id: string };
      item: { key: string; version: number };
    },
    file: TFile,
  ): void {
    rememberLiteratureNoteFile(this, detail, file);
  }

  async startDeviceHandoff(): Promise<void> {
    await startDeviceHandoff(this);
  }

  async signOutFromPlugin(): Promise<void> {
    await signOutFromPlugin(this);
  }

  async startZoteroConnect(): Promise<void> {
    await startZoteroConnect(this);
  }

  async refreshZoteroConnection(): Promise<void> {
    await refreshZoteroConnection(this);
  }

  async runBulkLibrarySync(): Promise<void> {
    await this.localSync.refreshLibraries();

    const selectedLibrary = getSelectedSyncLibrary(this);
    if (!selectedLibrary) {
      this.refreshViews();
      return;
    }

    await runBulkLibrarySync(
      this,
      selectedLibrary,
      getSelectedSyncCollection(this),
    );
  }

  async reconcileLocalLiveSync(): Promise<void> {
    if (Platform.isDesktopApp) {
      const { reconcileLocalLiveSync } =
        await import("./plugin-local-live-sync");
      await reconcileLocalLiveSync(this);
    }
  }

  notifyLocalLiveSyncAfterBulkSync(): void {
    if (Platform.isDesktopApp) {
      void import("./plugin-local-live-sync").then(
        ({ notifyLocalLiveSyncAfterBulkSync }) => {
          notifyLocalLiveSyncAfterBulkSync(this);
        },
      );
    }
  }
}
