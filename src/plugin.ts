import type { SourceSummaries } from "./source-summary";
import { readAvailableCitationStyles } from "./citation-style-defaults";
import type { PublishController } from "./publish-controller";
import { selectStratumTab } from "./plugin-tabs";
import {
  readEnabledTabs,
  resolveActiveTab,
  type StratumTab,
} from "./stratum-tabs";
import type { CitationService } from "./citation-service";
import { CitationSuggest } from "./citation-suggest";
import { registerZoteroOpenCommands } from "./zotero-open-commands";
import { SourcesController } from "./sources-controller";
import {
  browseCollections,
  CollectionBrowserView,
  COLLECTION_BROWSER_VIEW,
} from "./collection-browser";
import { MarkdownView, Notice, Platform, Plugin, TFile } from "obsidian";
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
  refreshSelectedLibraryNoteForFile,
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
  isUnloaded = false;
  settings: StratumSettings = DEFAULT_SETTINGS;
  settingTab: StratumSettingTab | null = null;
  sourceSummaries: SourceSummaries | null = null;
  backend!: BackendClient;
  zoteroConnection: ZoteroConnectionState | null = null;
  availableGroups: ZoteroGroupSummary[] = [];
  isLoadingZoteroConnection = false;
  zoteroConnectionRequestId = 0;
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
  selectedLibraryNoteFile: TFile | null = null;
  libraryNoteActionError: {
    key: string;
    libraryIdentity: string;
    message: string;
  } | null = null;
  activeNoteActionKey: string | null = null;
  publish: PublishController | null = null;
  sources!: SourcesController;
  citations!: CitationService;
  activeViewTab: StratumTab | null = "search";
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
    // Obsidian's newer callout CSS uses full colors instead of RGB channels.
    // Detect the format rather than excluding older supported app versions.
    const defaultCalloutColor = getComputedStyle(document.body)
      .getPropertyValue("--callout-default")
      .trim();
    if (CSS.supports("color", defaultCalloutColor)) {
      document.body.addClass("stratum-full-callout-colors");
      this.register(() =>
        document.body.removeClass("stratum-full-callout-colors"),
      );
    }
    await loadPluginSettings(this);
    this.activeViewTab = resolveActiveTab(
      this.settings.lastActiveTab,
      readEnabledTabs(this.settings.enabledTabs),
      Platform.isDesktopApp,
    );
    this.backend = createBackendClient(this);
    hydrateZoteroConnectionFromCache(this);
    setSelectedSearchLibrary(this, this.selectedSearchLibrary);
    const openStratumRibbonLabel = `Open ${PLUGIN_NAME}`;

    const { CitationService } = await import("./citation-service");
    const { citationEditor } = await import("./citation-editor");
    const { literatureNoteEditor } = await import("./literature-note-editor");
    const { registerCitationReading } = await import("./citation-reading");
    if (this.isUnloaded) return;
    const { refreshCitationData } = await import("./citation-refresh");
    const { citationDocument } = await import("./citation-document");
    const { SourceSummaries } = await import("./source-summary");
    if (this.isUnloaded) return;
    this.citations = new CitationService(this);
    this.addChild(this.citations);
    this.registerEditorExtension(citationEditor(this.citations));
    this.registerEditorExtension(literatureNoteEditor());
    registerCitationReading(this.citations);
    this.sourceSummaries = this.addChild(new SourceSummaries(this));
    this.registerEditorExtension(this.sourceSummaries.editorExtension());
    this.addCommand({
      id: "insert-source-summary",
      name: "Insert source summary",
      editorCallback: (editor) => this.sourceSummaries?.openPicker(editor),
    });

    this.sources = this.addChild(new SourcesController(this));
    if (Platform.isDesktopApp) {
      const { PublishController } = await import("./publish-controller");
      if (this.isUnloaded) return;
      this.publish = this.addChild(new PublishController(this));
      const { PublishPreviewView } = await import("./publish-preview");
      const { VIEW_TYPE_PUBLISH_PREVIEW } = await import("./publish-model");
      if (this.isUnloaded) return;
      this.registerView(
        VIEW_TYPE_PUBLISH_PREVIEW,
        (leaf) => new PublishPreviewView(leaf, this.publish!),
      );
    }
    this.settingTab = new StratumSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerView(VIEW_TYPE_STRATUM, (leaf) => new StratumView(leaf, this));

    this.addRibbonIcon("book-open-text", openStratumRibbonLabel, () => {
      this.activeViewTab = resolveActiveTab(
        this.activeViewTab,
        readEnabledTabs(this.settings.enabledTabs),
        Platform.isDesktopApp,
      );
      void this.activateView().then(() => {
        this.refreshViews();
      });
    });

    this.addCommand({
      id: "open-library-view",
      name: "Open library view",
      callback: () => {
        this.activeViewTab = resolveActiveTab(
          this.activeViewTab,
          readEnabledTabs(this.settings.enabledTabs),
          Platform.isDesktopApp,
        );
        void this.activateView().then(() => {
          this.refreshViews();
        });
      },
    });

    this.registerView(
      COLLECTION_BROWSER_VIEW,
      (leaf) => new CollectionBrowserView(leaf, this),
    );
    this.addCommand({
      id: "browse-papers-by-collection",
      name: "Browse papers by collection",
      callback: () => {
        void browseCollections(this);
      },
    });

    this.addCommand({
      id: "open-literature-note",
      name: "Open literature note",
      callback: () => openLiteratureNoteFromModal(this),
    });
    registerZoteroOpenCommands(this);

    this.addCommand({
      id: "open-literature-note-in-panel",
      name: "Open literature note in reader panel",
      callback: () => openLiteratureNoteInPanel(this),
    });

    this.addCommand({
      id: "insert-literature-note-link",
      name: "Insert literature note link",
      editorCallback: (editor) => insertLiteratureNoteLink(this, editor),
    });

    this.addCommand({
      id: "citation-preferences",
      name: "Change citation style for this paper",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking)
          void import("./citation-controls").then(({ CitationPreferences }) => {
            if (!this.isUnloaded) new CitationPreferences(this, file).open();
          });
        return true;
      },
    });
    this.addCommand({
      id: "refresh-citation-data",
      name: "Refresh citation data",
      callback: () => {
        void refreshCitationData(this).catch(
          () => new Notice("Could not refresh citation data."),
        );
      },
    });
    this.addCommand({
      id: "insert-bibliography",
      name: "Insert bibliography here",
      editorCallback: (editor) => {
        if (citationDocument(editor.getValue(), false).bibliographies.length) {
          new Notice("This paper already has a bibliography location.");
          return;
        }
        editor.replaceSelection('\n\n## References\n\n<div id="refs"></div>\n');
      },
    });
    this.registerEditorSuggest(new CitationSuggest(this));

    this.addCommand({
      id: "insert-pandoc-citation",
      name: "Insert or edit citation",
      editorCallback: (editor) => insertPandocCitation(this, editor),
    });

    this.addCommand({
      id: "show-document-sources",
      name: "Show citations for current note",
      callback: () => {
        if (!selectStratumTab(this, "sources")) return;
        this.sources.showCurrent();
        void this.activateView().then(() => this.refreshViews());
      },
    });

    this.registerObsidianProtocolHandler(AUTH_PROTOCOL_ACTION, (params) => {
      void handleAuthProtocol(this, params).catch(
        () => new Notice("Sign-in could not be completed. Please try again."),
      );
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        syncItemFileMapForFile(this, file, cache);
        if (
          refreshSelectedLibraryNoteForFile(this, file, cache) &&
          this.activeViewTab === "search"
        )
          this.refreshViews();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        handleItemFileRename(this, file, oldPath);
        if (
          file instanceof TFile &&
          refreshSelectedLibraryNoteForFile(this, file) &&
          this.activeViewTab === "search"
        )
          this.refreshViews();
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
        if (
          file instanceof TFile &&
          refreshSelectedLibraryNoteForFile(this, file) &&
          this.activeViewTab === "search"
        )
          this.refreshViews();
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

    if (Platform.isDesktopApp) {
      this.statusBarItemEl = this.addStatusBarItem();
      startAutoSyncStatusRefresh(this);
    }
    refreshAutoSyncUi(this);

    this.app.workspace.onLayoutReady(() => {
      void bootstrapRemoteState(this);
    });
  }

  async onExternalSettingsChange(): Promise<void> {
    const { changeCitationPreferences } =
      await import("./citation-style-collection");
    if (this.isUnloaded) return;
    try {
      await changeCitationPreferences(this, async () => {
        const data = (await this.loadData()) as Record<string, unknown> | null;
        if (this.isUnloaded || !data) return;
        if (
          typeof data.citationStyle === "string" &&
          /^[a-z0-9-]+$/.test(data.citationStyle)
        )
          this.settings.citationStyle = data.citationStyle;
        this.settings.availableCitationStyles = readAvailableCitationStyles(
          data.availableCitationStyles,
          this.settings.citationStyle,
        );
        if (
          typeof data.citationLanguage === "string" &&
          /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(data.citationLanguage)
        )
          this.settings.citationLanguage = data.citationLanguage;
        const titles = data.citationStyleTitles;
        if (titles && typeof titles === "object" && !Array.isArray(titles))
          this.settings.citationStyleTitles = Object.fromEntries(
            Object.entries(titles).filter(
              (pair): pair is [string, string] =>
                /^[a-zA-Z0-9-]+$/.test(pair[0]) &&
                typeof pair[1] === "string" &&
                pair[1].length < 2000000,
            ),
          );
        try {
          const { loadCitationResources } =
            await import("./citation-resources");
          await loadCitationResources(this);
        } catch {
          new Notice(
            "Synced citation resources could not be loaded. Your current resources are retained.",
          );
        }
        this.citations?.invalidate();
        this.refreshSettingTab();
      });
    } catch (error) {
      if (!this.isUnloaded) throw error;
    }
  }

  onunload(): void {
    this.isUnloaded = true;
    this.backend?.invalidatePendingRequests();
    this.zoteroConnectionRequestId += 1;
    this.localSyncLibrariesRequestId += 1;
    this.syncCollectionsRequestId += 1;
    this.libraryCollectionsRequestId += 1;
    this.librarySearchRequestId += 1;
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
    if (!this.isUnloaded) await savePluginSettings(this);
  }

  async activateView(): Promise<void> {
    if (this.isUnloaded) return;
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STRATUM);
    const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      return;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_STRATUM,
      active: true,
    });

    if (this.isUnloaded) return;
    await this.app.workspace.revealLeaf(leaf);
  }

  refreshViews(): void {
    if (this.isUnloaded) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STRATUM)) {
      const view = leaf.view;
      if (view instanceof StratumView) {
        view.render();
      }
    }
  }

  refreshSettingTab(): void {
    if (this.isUnloaded) return;
    this.settingTab?.refresh();
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
    if (!this.isUnloaded && Platform.isDesktopApp) {
      const { reconcileLocalLiveSync } =
        await import("./plugin-local-live-sync");
      await reconcileLocalLiveSync(this);
    }
  }

  notifyLocalLiveSyncAfterBulkSync(): void {
    if (!this.isUnloaded && Platform.isDesktopApp) {
      void import("./plugin-local-live-sync").then(
        ({ notifyLocalLiveSyncAfterBulkSync }) => {
          notifyLocalLiveSyncAfterBulkSync(this);
        },
      );
    }
  }
}
