import { Plugin, type TFile } from "obsidian";
import {
  AUTH_PROTOCOL_ACTION,
  PLUGIN_NAME,
  VIEW_TYPE_STRATUM,
} from "./constants";
import {
  type ZoteroConnectionState,
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
  AUTO_SYNC_FOCUS_COOLDOWN_MS,
  shouldSkipFocusSync,
} from "./zotero-sync";
import { runZoteroAutoSync } from "./plugin-sync";
import {
  getBulkLibrarySyncProcessedCount,
  runBulkLibrarySync,
} from "./plugin-bulk-sync";
import {
  clearAutoSyncInterval,
  configureAutoSyncInterval,
  getAutoSyncStatusLabel,
  refreshAutoSyncUi,
  startAutoSyncStatusRefresh,
  stopAutoSyncStatusRefresh,
} from "./plugin-sync-status";
import {
  getSelectedSearchLibrary,
  setSelectedSearchLibrary,
} from "./plugin-libraries";

export default class StratumPlugin extends Plugin {
  settings: StratumSettings = DEFAULT_SETTINGS;
  settingTab: StratumSettingTab | null = null;
  backend!: BackendClient;
  zoteroConnection: ZoteroConnectionState | null = null;
  availableGroups: ZoteroGroupSummary[] = [];
  isLoadingZoteroConnection = false;
  selectedSearchLibrary: EnabledLibrary | null = null;
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
  autoSyncIntervalTimer: number | null = null;
  autoSyncStatusTimer: number | null = null;
  lastFocusSyncAt = 0;
  isAutoSyncRunning = false;
  bulkLibrarySyncRunPromise: Promise<void> | null = null;
  bulkLibrarySyncCurrentPageProcessedCount = 0;
  bulkLibrarySyncCurrentPageTotalCount = 0;
  bulkLibrarySyncUiRefreshTimer: number | null = null;
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

  async onload(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log("stratum: loading Stratum plugin");
    await loadPluginSettings(this);
    this.backend = createBackendClient(this);
    hydrateZoteroConnectionFromCache(this);
    setSelectedSearchLibrary(this, this.selectedSearchLibrary);
    const openStratumRibbonLabel = `Open ${PLUGIN_NAME}`;

    this.settingTab = new StratumSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerView(VIEW_TYPE_STRATUM, (leaf) => new StratumView(leaf, this));

    this.addRibbonIcon("book-open-text", openStratumRibbonLabel, () => {
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

    this.addCommand({
      id: "open-literature-note",
      name: "Open literature note",
      callback: () => openLiteratureNoteFromModal(this),
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
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        handleItemFileDelete(this, file);
      }),
    );
    this.registerDomEvent(window, "focus", () => {
      if (
        shouldSkipFocusSync(
          this.lastFocusSyncAt,
          Date.now(),
          AUTO_SYNC_FOCUS_COOLDOWN_MS,
        )
      ) {
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
    this.registerDomEvent(this.statusBarItemEl, "click", () => {
      void this.runZoteroAutoSync("manual");
    });
    startAutoSyncStatusRefresh(this);
    configureAutoSyncInterval(this);
    refreshAutoSyncUi(this);

    this.app.workspace.onLayoutReady(() => {
      void bootstrapRemoteState(this);
    });
  }

  onunload(): void {
    clearLibrarySearchDebounce(this);
    cancelLibraryPickerClose(this);
    clearAutoSyncInterval(this);
    stopAutoSyncStatusRefresh(this);
    if (this.itemFileMapPersistTimer !== null) {
      window.clearTimeout(this.itemFileMapPersistTimer);
      this.itemFileMapPersistTimer = null;
    }
    if (this.bulkLibrarySyncUiRefreshTimer !== null) {
      window.clearTimeout(this.bulkLibrarySyncUiRefreshTimer);
      this.bulkLibrarySyncUiRefreshTimer = null;
    }
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
    return this.isAutoSyncRunning;
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

  configureAutoSyncInterval(): void {
    configureAutoSyncInterval(this);
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

  async runZoteroAutoSync(
    reason: "startup" | "focus" | "interval" | "manual",
  ): Promise<void> {
    await runZoteroAutoSync(this, reason);
  }

  async runBulkLibrarySync(): Promise<void> {
    const selectedLibrary = getSelectedSearchLibrary(this);
    if (!selectedLibrary) {
      return;
    }

    await runBulkLibrarySync(this, selectedLibrary);
  }
}
