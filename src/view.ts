import {
  Component,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  parseYaml,
  SearchComponent,
  TFile,
  WorkspaceLeaf,
  type EventRef,
  parseLinktext,
} from "obsidian";
import { PLUGIN_NAME, VIEW_TYPE_STRATUM } from "./constants";
import {
  buildLiteratureNoteEntries,
  type LiteratureNoteEntry,
} from "./library-search-modal";
import { isLibrarySearchQueryReady } from "./library-search-query";
import type StratumPlugin from "./plugin";
import {
  ReaderLiteratureNoteInputSuggest,
  filterReaderLiteratureNoteEntries,
} from "./view-reader-input-suggest";
import {
  buildReaderFrontmatterMarkdown,
  parseReaderFrontmatter,
  stripLeadingFrontmatter,
} from "./view-reader-frontmatter";
import {
  getActiveBulkSyncLibrary,
  getLibraryBulkSyncState,
  getSelectedSearchLibrary,
  setSelectedSearchLibrary,
} from "./plugin-libraries";
import {
  ABSTRACT_TEASER_LENGTH,
  getAbstractTeaser,
  getSettingsManager,
} from "./view-helpers";
import { LibraryPaperInputSuggest } from "./view-library-input-suggest";
import {
  type BulkLibrarySyncState,
  getBulkLibrarySyncStatusMessage as getBulkSyncStatusMessage,
} from "./zotero-sync";

const BULK_SYNC_COMPLETION_STATUS_DELAY_MS = 4_000;
const BULK_SYNC_COMPLETION_STATUS_FADE_MS = 250;
const READER_REFRESH_DEBOUNCE_MS = 100;

function getBulkSyncCompletionFadeState(
  state: BulkLibrarySyncState,
  now = Date.now(),
): { fadeInMs: number; removeInMs: number; startFaded: boolean } | null {
  if (state.phase !== "completed") {
    return null;
  }

  const completedAt = state.completedAt
    ? Date.parse(state.completedAt)
    : Number.NaN;
  if (!Number.isFinite(completedAt)) {
    return {
      fadeInMs: BULK_SYNC_COMPLETION_STATUS_DELAY_MS,
      removeInMs:
        BULK_SYNC_COMPLETION_STATUS_DELAY_MS +
        BULK_SYNC_COMPLETION_STATUS_FADE_MS,
      startFaded: false,
    };
  }

  const elapsedMs = Math.max(0, now - completedAt);
  const removeAfterMs =
    BULK_SYNC_COMPLETION_STATUS_DELAY_MS + BULK_SYNC_COMPLETION_STATUS_FADE_MS;
  if (elapsedMs >= removeAfterMs) {
    return null;
  }

  return {
    fadeInMs: Math.max(0, BULK_SYNC_COMPLETION_STATUS_DELAY_MS - elapsedMs),
    removeInMs: Math.max(0, removeAfterMs - elapsedMs),
    startFaded: elapsedMs >= BULK_SYNC_COMPLETION_STATUS_DELAY_MS,
  };
}

function getScopedBulkSyncButtonLabel(
  libraryName: string,
  state: BulkLibrarySyncState,
): string {
  if (state.phase === "running") {
    return `Syncing ${libraryName}...`;
  }

  if (state.phase === "paused-rate-limit" || state.phase === "paused-error") {
    return `Resume sync in ${libraryName}`;
  }

  return `Sync all papers in ${libraryName}`;
}

export class StratumView extends ItemView {
  plugin: StratumPlugin;
  private paperSuggest: LibraryPaperInputSuggest | null = null;
  private readerSuggest: ReaderLiteratureNoteInputSuggest | null = null;
  private bulkSyncStatusFadeTimer: number | null = null;
  private bulkSyncStatusRemoveTimer: number | null = null;
  private readerFileWatcher: EventRef | null = null;
  private watchedReaderFilePath: string | null = null;
  private readerSearchQuery = "";
  private readerScrollTop = 0;
  private lastRenderedReaderFilePath: string | null = null;
  private readerRenderVersion = 0;
  private readerMarkdownComponent: Component | null = null;
  private readerRefreshTimer: number | null = null;
  private readonly tabIdPrefix = `stratum-tabs-${crypto.randomUUID()}`;

  constructor(leaf: WorkspaceLeaf, plugin: StratumPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.register(() => {
      this.clearReaderFileWatcher();
      this.clearReaderMarkdownComponent();
      this.clearReaderRefreshTimer();
    });
  }

  getViewType(): string {
    return VIEW_TYPE_STRATUM;
  }

  getDisplayText(): string {
    return PLUGIN_NAME;
  }

  getIcon(): string {
    return "book-open-text";
  }

  onOpen(): Promise<void> {
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.clearBulkSyncStatusTimers();
    this.clearReaderFileWatcher();
    this.clearReaderMarkdownComponent();
    this.clearReaderRefreshTimer();
    return Promise.resolve();
  }

  private clearBulkSyncStatusTimers(): void {
    if (this.bulkSyncStatusFadeTimer !== null) {
      window.clearTimeout(this.bulkSyncStatusFadeTimer);
      this.bulkSyncStatusFadeTimer = null;
    }
    if (this.bulkSyncStatusRemoveTimer !== null) {
      window.clearTimeout(this.bulkSyncStatusRemoveTimer);
      this.bulkSyncStatusRemoveTimer = null;
    }
  }

  private clearReaderFileWatcher(): void {
    if (this.readerFileWatcher !== null) {
      this.app.vault.offref(this.readerFileWatcher);
      this.readerFileWatcher = null;
    }
    this.watchedReaderFilePath = null;
  }

  private clearReaderMarkdownComponent(): void {
    if (this.readerMarkdownComponent !== null) {
      this.removeChild(this.readerMarkdownComponent);
      this.readerMarkdownComponent = null;
    }
  }

  private clearReaderRefreshTimer(): void {
    if (this.readerRefreshTimer !== null) {
      window.clearTimeout(this.readerRefreshTimer);
      this.readerRefreshTimer = null;
    }
  }

  private scheduleReaderRefresh(): void {
    if (this.readerRefreshTimer !== null) {
      return;
    }

    this.readerRefreshTimer = window.setTimeout(() => {
      this.readerRefreshTimer = null;
      if (
        this.plugin.activeViewTab === "reader" &&
        this.plugin.readerNoteFile !== null
      ) {
        this.plugin.refreshViews();
      }
    }, READER_REFRESH_DEBOUNCE_MS);
  }

  private ensureReaderFileWatcher(file: TFile): void {
    if (this.watchedReaderFilePath === file.path && this.readerFileWatcher) {
      return;
    }

    this.clearReaderFileWatcher();
    this.watchedReaderFilePath = file.path;
    this.readerFileWatcher = this.app.vault.on("modify", (modifiedFile) => {
      if (modifiedFile.path !== file.path) {
        return;
      }
      if (this.plugin.activeViewTab !== "reader") {
        return;
      }
      if (this.plugin.readerNoteFile?.path !== file.path) {
        return;
      }

      this.scheduleReaderRefresh();
    });
  }

  private setActiveTab(tab: "search" | "reader"): void {
    if (this.plugin.activeViewTab === tab) {
      return;
    }

    this.plugin.activeViewTab = tab;
    this.plugin.refreshViews();
  }

  private getReaderEntries(): LiteratureNoteEntry[] {
    return buildLiteratureNoteEntries(this.plugin).sort((a, b) => {
      return a.title.localeCompare(b.title);
    });
  }

  private getReaderTitle(file: TFile, entries: LiteratureNoteEntry[]): string {
    const entry = entries.find((candidate) => {
      return candidate.file.path === file.path;
    });

    return entry?.title ?? file.basename;
  }

  private focusTab(tab: "search" | "reader"): void {
    const tabId =
      tab === "search"
        ? `${this.tabIdPrefix}-tab-search`
        : `${this.tabIdPrefix}-tab-reader`;
    window.requestAnimationFrame(() => {
      this.contentEl.querySelector<HTMLElement>(`#${tabId}`)?.focus();
    });
  }

  private getPrimaryEditorLeaf(forceNew = false): WorkspaceLeaf {
    if (forceNew) {
      return this.app.workspace.getLeaf("tab");
    }

    const activeFile = this.app.workspace.getActiveFile();
    const rootMarkdownLeaves: WorkspaceLeaf[] = [];
    let matchingActiveFileLeaf: WorkspaceLeaf | null = null;
    this.app.workspace.iterateRootLeaves((leaf) => {
      if (leaf === this.leaf || !(leaf.view instanceof MarkdownView)) {
        return;
      }

      rootMarkdownLeaves.push(leaf);
      if (
        activeFile &&
        leaf.view.file instanceof TFile &&
        leaf.view.file.path === activeFile.path
      ) {
        matchingActiveFileLeaf = leaf;
      }
    });

    if (matchingActiveFileLeaf) {
      return matchingActiveFileLeaf;
    }

    const recentRootLeaf = this.app.workspace.getMostRecentLeaf(
      this.app.workspace.rootSplit,
    );
    if (
      recentRootLeaf &&
      recentRootLeaf !== this.leaf &&
      recentRootLeaf.view instanceof MarkdownView
    ) {
      return recentRootLeaf;
    }

    if (rootMarkdownLeaves.length > 0) {
      return rootMarkdownLeaves[0];
    }

    return this.app.workspace.getLeaf("tab");
  }

  private async openFileInPrimaryEditor(
    file: TFile,
    options?: {
      subpath?: string;
      forceNewLeaf?: boolean;
    },
  ): Promise<void> {
    const leaf = this.getPrimaryEditorLeaf(options?.forceNewLeaf ?? false);
    await leaf.openFile(file, {
      active: true,
      eState: options?.subpath ? { subpath: options.subpath } : undefined,
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async openReaderLink(
    linkEl: HTMLAnchorElement,
    sourceFile: TFile,
    openInNewLeaf: boolean,
  ): Promise<void> {
    const linkText =
      linkEl.dataset.href ?? linkEl.getAttribute("href") ?? undefined;
    if (!linkText) {
      return;
    }

    const { path, subpath } = parseLinktext(linkText);
    const targetFile = path.trim()
      ? this.app.metadataCache.getFirstLinkpathDest(path, sourceFile.path)
      : sourceFile;

    if (!targetFile) {
      await this.app.workspace.openLinkText(linkText, sourceFile.path, "tab");
      return;
    }

    await this.openFileInPrimaryEditor(targetFile, {
      subpath: subpath || undefined,
      forceNewLeaf: openInNewLeaf,
    });
  }

  render(): void {
    this.clearBulkSyncStatusTimers();
    this.paperSuggest?.close();
    this.paperSuggest = null;
    this.readerSuggest?.close();
    this.readerSuggest = null;
    this.clearReaderMarkdownComponent();

    if (this.plugin.activeViewTab !== "reader") {
      this.clearReaderFileWatcher();
      this.clearReaderRefreshTimer();
      this.readerRenderVersion += 1;
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("stratum-view");

    const shell = contentEl.createDiv({ cls: "stratum-shell" });
    const searchTabId = `${this.tabIdPrefix}-tab-search`;
    const searchPanelId = `${this.tabIdPrefix}-panel-search`;
    const readerTabId = `${this.tabIdPrefix}-tab-reader`;
    const readerPanelId = `${this.tabIdPrefix}-panel-reader`;
    this.renderTabBar(shell, {
      searchTabId,
      searchPanelId,
      readerTabId,
      readerPanelId,
    });

    const tabContent = shell.createDiv({ cls: "stratum-tab-content" });
    const searchPanel = tabContent.createDiv({ cls: "stratum-search-tab" });
    searchPanel.id = searchPanelId;
    searchPanel.setAttr("role", "tabpanel");
    searchPanel.setAttr("aria-labelledby", searchTabId);
    searchPanel.hidden = this.plugin.activeViewTab !== "search";

    const readerPanel = tabContent.createDiv({ cls: "stratum-reader-tab" });
    readerPanel.id = readerPanelId;
    readerPanel.setAttr("role", "tabpanel");
    readerPanel.setAttr("aria-labelledby", readerTabId);
    readerPanel.hidden = this.plugin.activeViewTab !== "reader";

    if (this.plugin.activeViewTab === "reader") {
      this.renderReaderTab(readerPanel);
      return;
    }

    this.renderSearchTab(searchPanel);
  }

  private renderTabBar(
    container: HTMLElement,
    ids: {
      searchTabId: string;
      searchPanelId: string;
      readerTabId: string;
      readerPanelId: string;
    },
  ): void {
    const tabBar = container.createDiv({ cls: "stratum-tab-bar" });
    tabBar.setAttr("role", "tablist");
    tabBar.setAttr("aria-label", `${PLUGIN_NAME} panels`);

    const searchButton = tabBar.createEl("button", {
      cls: this.plugin.activeViewTab === "search" ? "is-active" : "",
      text: "Search",
    });
    searchButton.type = "button";
    searchButton.id = ids.searchTabId;
    searchButton.setAttr("role", "tab");
    searchButton.setAttr("aria-controls", ids.searchPanelId);
    searchButton.setAttr(
      "aria-selected",
      this.plugin.activeViewTab === "search" ? "true" : "false",
    );
    searchButton.tabIndex = this.plugin.activeViewTab === "search" ? 0 : -1;
    searchButton.addEventListener("click", () => {
      this.setActiveTab("search");
    });
    searchButton.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        this.setActiveTab("reader");
        this.focusTab("reader");
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        this.setActiveTab("search");
        this.focusTab("search");
      }
    });

    const readerButton = tabBar.createEl("button", {
      cls: this.plugin.activeViewTab === "reader" ? "is-active" : "",
      text: "Reader",
    });
    readerButton.type = "button";
    readerButton.id = ids.readerTabId;
    readerButton.setAttr("role", "tab");
    readerButton.setAttr("aria-controls", ids.readerPanelId);
    readerButton.setAttr(
      "aria-selected",
      this.plugin.activeViewTab === "reader" ? "true" : "false",
    );
    readerButton.tabIndex = this.plugin.activeViewTab === "reader" ? 0 : -1;
    readerButton.addEventListener("click", () => {
      this.setActiveTab("reader");
    });
    readerButton.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        this.setActiveTab("search");
        this.focusTab("search");
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        this.setActiveTab("search");
        this.focusTab("search");
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        this.setActiveTab("reader");
        this.focusTab("reader");
      }
    });
  }

  private renderSearchTab(container: HTMLElement): void {
    const searchTab = container;
    const signedInEmail = this.plugin.settings.accountEmail;
    const zoteroConnection = this.plugin.zoteroConnection;
    const isAppConnected = Boolean(signedInEmail);
    const isZoteroConnected = Boolean(zoteroConnection?.connected);
    const lastKnownZoteroUsername =
      zoteroConnection?.zoteroUsername ??
      this.plugin.settings.lastKnownZoteroUsername;
    const isReadyForSearch = isAppConnected && isZoteroConnected;
    const selectedSearchLibrary = getSelectedSearchLibrary(this.plugin);
    const activeBulkSyncLibrary = getActiveBulkSyncLibrary(this.plugin);
    const visibleBulkSyncLibrary =
      activeBulkSyncLibrary ?? selectedSearchLibrary;
    const visibleBulkSyncState = visibleBulkSyncLibrary
      ? getLibraryBulkSyncState(this.plugin, visibleBulkSyncLibrary)
      : null;
    const openSettings = () => {
      const settingsManager = getSettingsManager(this.app);
      if (!settingsManager) {
        return;
      }

      settingsManager.open();
      settingsManager.openTabById(this.plugin.manifest.id);
    };

    if (!isReadyForSearch) {
      const emptyState = searchTab.createDiv({
        cls: "stratum-empty-state",
      });
      emptyState.createEl("p", {
        cls: "stratum-eyebrow",
        text: PLUGIN_NAME,
      });
      emptyState.createEl("h2", {
        text: "Finish setup in plugin settings.",
      });
      emptyState.createEl("p", {
        cls: "stratum-meta",
        text: !isAppConnected
          ? "Sign in to your Stratum account in settings, then connect Zotero to search your library and create literature notes."
          : lastKnownZoteroUsername
            ? `Reconnect Zotero in settings to keep searching and syncing your library. Last connected as ${lastKnownZoteroUsername}.`
            : "Connect Zotero in settings to search your library and create literature notes.",
      });
      const settingsButton = emptyState.createEl("button", {
        text: "Open plugin settings",
      });
      settingsButton.addEventListener("click", openSettings);
      return;
    }

    const searchSection = searchTab.createDiv({
      cls: "stratum-search-section",
    });
    searchSection.createEl("h3", { text: "Find a paper" });
    searchSection.createEl("p", {
      cls: "stratum-placeholder",
      text: "Search your Zotero library by title, author, or year, then choose a paper to create or update its literature note.",
    });

    if (
      this.plugin.settings.enabledLibraries.length > 1 &&
      selectedSearchLibrary
    ) {
      const libraryPicker = searchSection.createDiv({
        cls: "stratum-search-control",
      });
      const pickerLabel = libraryPicker.createEl("label", {
        cls: "stratum-search-label",
        text: "Library",
      });
      const pickerId = "stratum-library-picker";
      const picker = libraryPicker.createEl("select");
      picker.id = pickerId;
      pickerLabel.setAttr("for", pickerId);
      picker.disabled =
        this.plugin.activeNoteActionKey !== null ||
        this.plugin.isBulkLibrarySyncRunning();

      for (const library of this.plugin.settings.enabledLibraries) {
        const option = picker.createEl("option", {
          text: library.name,
          value: library.identity,
        });
        option.selected = library.identity === selectedSearchLibrary.identity;
      }

      picker.addEventListener("change", () => {
        const library =
          this.plugin.settings.enabledLibraries.find((entry) => {
            return entry.identity === picker.value;
          }) ?? null;
        setSelectedSearchLibrary(this.plugin, library);
        this.render();
      });
    }

    const searchBox = searchSection.createDiv({
      cls: "stratum-search-control",
    });
    const searchLabel = searchBox.createEl("label", {
      cls: "stratum-search-label",
      text: "Search your library",
    });
    const searchId = "stratum-paper-search";
    const searchComponent = new SearchComponent(searchBox);
    searchComponent.setPlaceholder("Type a paper title, author, or year");
    searchComponent.setValue(this.plugin.librarySearchQuery);
    searchComponent.inputEl.id = searchId;
    searchLabel.setAttr("for", searchId);
    if (this.plugin.activeNoteActionKey) {
      searchComponent.setDisabled(true);
    }
    const searchInputContainer = searchBox.querySelector(
      ".search-input-container",
    );
    const loadingSpinner = searchInputContainer?.createDiv({
      cls: "stratum-search-spinner",
    });
    loadingSpinner?.setAttr("aria-hidden", "true");

    const feedbackContainer = searchSection.createDiv({
      cls: "stratum-search-feedback",
    });
    let cacheContainer: HTMLElement | null = null;
    const renderSearchFeedback = () => {
      const isReadyQuery = isLibrarySearchQueryReady(
        this.plugin.librarySearchQuery,
      );
      const showSpinner = this.plugin.isSearchingLibrary && isReadyQuery;
      searchBox.classList.toggle("is-loading", showSpinner);
      loadingSpinner?.classList.toggle("is-visible", showSpinner);

      feedbackContainer.empty();
      cacheContainer?.empty();

      if (this.plugin.librarySearchError) {
        feedbackContainer.createEl("p", {
          cls: "stratum-error",
          text: this.plugin.librarySearchError,
        });
        return;
      }

      if (this.plugin.activeNoteActionKey) {
        feedbackContainer.createEl("p", {
          cls: "stratum-meta stratum-combobox-status",
          text: "Creating or updating the selected literature note...",
        });
        return;
      }

      if (this.plugin.librarySearchQuery.trim() && !isReadyQuery) {
        feedbackContainer.createEl("p", {
          cls: "stratum-meta stratum-combobox-status",
          text: "Keep typing to search your Zotero library.",
        });
        return;
      }

      if (
        !this.plugin.isSearchingLibrary &&
        this.plugin.librarySearchMeta &&
        this.plugin.librarySearchResults.length === 0
      ) {
        feedbackContainer.createEl("p", {
          cls: "stratum-meta stratum-combobox-status",
          text: selectedSearchLibrary
            ? `No matching papers in ${selectedSearchLibrary.name}.`
            : "No matching papers in your Zotero library.",
        });
        return;
      }

      if (!this.plugin.librarySearchMeta?.stale || !cacheContainer) {
        return;
      }

      const cacheRow = cacheContainer.createDiv({
        cls: "stratum-cache-row",
      });
      cacheRow.createEl("p", {
        cls: "stratum-meta stratum-combobox-status",
        text: this.plugin.librarySearchMeta.retryAfterSeconds
          ? `Showing cached papers while Zotero asks us to slow down. Live refresh should resume in about ${this.plugin.librarySearchMeta.retryAfterSeconds} seconds.`
          : "Showing cached papers while Zotero asks us to slow down.",
      });
      const refreshButton = cacheRow.createEl("button", {
        cls: "stratum-inline-action",
        text: this.plugin.isSearchingLibrary ? "Refreshing..." : "Fetch fresh",
      });
      if (this.plugin.isSearchingLibrary || this.plugin.activeNoteActionKey) {
        refreshButton.disabled = true;
      }
      refreshButton.addEventListener("click", () => {
        void this.plugin.library.refreshSearch().then(() => {
          renderSearchFeedback();
          searchComponent.inputEl.dispatchEvent(new Event("input"));
        });
      });
    };

    this.paperSuggest = new LibraryPaperInputSuggest(
      this,
      searchComponent,
      renderSearchFeedback,
    );
    searchComponent.onChange((value) => {
      if (!value.trim() && this.plugin.selectedLibraryResult) {
        this.plugin.library.clearSelection({
          resetQuery: true,
        });
        return;
      }

      this.plugin.library.setQuery(value);
      if (!isLibrarySearchQueryReady(value)) {
        this.paperSuggest?.close();
      }
      renderSearchFeedback();
    });

    const openSuggestions = () => {
      if (this.plugin.activeNoteActionKey) {
        return;
      }

      renderSearchFeedback();
      if (!isLibrarySearchQueryReady(searchComponent.getValue())) {
        this.paperSuggest?.close();
        return;
      }

      this.paperSuggest?.open();
      searchComponent.inputEl.dispatchEvent(new Event("input"));
    };

    searchComponent.inputEl.addEventListener("focus", openSuggestions);
    searchComponent.inputEl.addEventListener("click", openSuggestions);

    cacheContainer = searchSection.createDiv({
      cls: "stratum-search-cache",
    });
    renderSearchFeedback();

    if (this.plugin.selectedLibraryResult) {
      const selected = this.plugin.selectedLibraryResult;
      const selectedCard = searchSection.createDiv({
        cls: "stratum-selected-paper",
      });
      selectedCard.createEl("p", {
        cls: "stratum-selected-label",
        text: "Selected paper",
      });
      selectedCard.createEl("p", {
        cls: "stratum-selected-title",
        text: selected.title,
      });
      selectedCard.createEl("p", {
        cls: "stratum-combobox-meta",
        text: [selected.creators.join(", "), selected.year, selected.itemType]
          .filter(Boolean)
          .join(" · "),
      });

      if (selected.doi) {
        selectedCard.createEl("p", {
          cls: "stratum-meta",
          text: `DOI: ${selected.doi}`,
        });
      }

      if (selected.abstract) {
        const abstractPreview = selectedCard.createDiv({
          cls: "stratum-selected-abstract",
        });
        abstractPreview.createEl("p", {
          cls: "stratum-selected-abstract-label",
          text: "Abstract",
        });
        abstractPreview.createEl("p", {
          cls: "stratum-meta",
          text: this.plugin.isSelectedLibraryAbstractExpanded
            ? selected.abstract
            : getAbstractTeaser(selected.abstract),
        });

        if (selected.abstract.length > ABSTRACT_TEASER_LENGTH) {
          const toggleAbstractButton = abstractPreview.createEl("button", {
            cls: "stratum-inline-button",
            text: this.plugin.isSelectedLibraryAbstractExpanded
              ? "Hide full abstract"
              : "Show full abstract",
          });
          toggleAbstractButton.addEventListener("click", () => {
            this.plugin.library.toggleAbstract();
          });
        }
      }

      const selectedActions = selectedCard.createDiv({
        cls: "stratum-actions",
      });
      const createButton = selectedActions.createEl("button", {
        cls: "mod-cta",
        text:
          this.plugin.activeNoteActionKey === selected.key
            ? "Working..."
            : this.plugin.isBulkLibrarySyncRunning()
              ? "Bulk sync running..."
              : "Create or update literature note",
      });
      if (
        this.plugin.activeNoteActionKey ||
        this.plugin.isBulkLibrarySyncRunning()
      ) {
        createButton.disabled = true;
      }
      createButton.addEventListener("click", () => {
        void this.plugin.library.createNote(selected);
      });

      selectedCard.createEl("p", {
        cls: "stratum-meta stratum-selected-note",
        text: "Safe updates rewrite only managed sections and leave your own notes alone.",
      });
    }

    const bulkSyncSection = searchSection.createDiv({
      cls: "stratum-bulk-sync",
    });
    if (visibleBulkSyncLibrary && visibleBulkSyncState) {
      const bulkSyncButton = bulkSyncSection.createEl("button", {
        cls: "mod-cta",
        text: getScopedBulkSyncButtonLabel(
          visibleBulkSyncLibrary.name,
          visibleBulkSyncState,
        ),
      });
      if (
        this.plugin.activeNoteActionKey ||
        this.plugin.isBulkLibrarySyncRunning() ||
        this.plugin.isZoteroAutoSyncRunning() ||
        !selectedSearchLibrary
      ) {
        bulkSyncButton.disabled = true;
      }
      bulkSyncButton.addEventListener("click", () => {
        void this.plugin.runBulkLibrarySync();
      });

      const bulkSyncStatus =
        visibleBulkSyncState.phase === "idle"
          ? null
          : getBulkSyncStatusMessage({
              state: visibleBulkSyncState,
              processedCount: this.plugin.isBulkLibrarySyncRunning()
                ? this.plugin.getBulkLibrarySyncProcessedCount()
                : visibleBulkSyncState.processedCount,
            });
      const bulkSyncCompletionFade =
        getBulkSyncCompletionFadeState(visibleBulkSyncState);
      const shouldRenderBulkSyncStatus =
        Boolean(bulkSyncStatus) &&
        (visibleBulkSyncState.phase !== "completed" ||
          bulkSyncCompletionFade !== null);
      const bulkSyncStatusText = bulkSyncStatus ?? "";
      if (shouldRenderBulkSyncStatus && bulkSyncCompletionFade !== null) {
        const bulkSyncStatusEl = bulkSyncSection.createEl("p", {
          cls: "stratum-meta stratum-bulk-sync-status",
          text: bulkSyncStatusText,
        });
        bulkSyncStatusEl.addClass("is-auto-fade");
        if (bulkSyncCompletionFade.startFaded) {
          bulkSyncStatusEl.addClass("is-faded");
        } else {
          this.bulkSyncStatusFadeTimer = window.setTimeout(() => {
            if (bulkSyncStatusEl.isConnected) {
              bulkSyncStatusEl.addClass("is-faded");
            }
          }, bulkSyncCompletionFade.fadeInMs);
        }
        this.bulkSyncStatusRemoveTimer = window.setTimeout(() => {
          if (bulkSyncStatusEl.isConnected) {
            bulkSyncStatusEl.remove();
          }
        }, bulkSyncCompletionFade.removeInMs);
      } else if (shouldRenderBulkSyncStatus) {
        bulkSyncSection.createEl("p", {
          cls: "stratum-meta stratum-bulk-sync-status",
          text: bulkSyncStatusText,
        });
      }
    }
  }

  private renderReaderTab(container: HTMLElement): void {
    const readerTab = container;
    const readerFile = this.plugin.readerNoteFile;
    const entries = this.getReaderEntries();

    if (!readerFile) {
      this.clearReaderFileWatcher();
      this.clearReaderRefreshTimer();
      this.readerRenderVersion += 1;
      this.lastRenderedReaderFilePath = null;
      this.readerScrollTop = 0;
      this.renderReaderPicker(readerTab, entries);
      return;
    }

    this.ensureReaderFileWatcher(readerFile);
    const savedScrollTop =
      this.lastRenderedReaderFilePath === readerFile.path
        ? this.readerScrollTop
        : 0;
    this.lastRenderedReaderFilePath = readerFile.path;

    const header = readerTab.createDiv({ cls: "stratum-reader-header" });
    const actions = header.createDiv({ cls: "stratum-reader-actions" });
    const openButton = actions.createEl("button", {
      text: "Open in editor",
    });
    openButton.type = "button";
    openButton.addEventListener("click", () => {
      void this.openFileInPrimaryEditor(readerFile);
    });

    const closeButton = actions.createEl("button", {
      text: "Close",
    });
    closeButton.type = "button";
    closeButton.addEventListener("click", () => {
      this.plugin.readerNoteFile = null;
      this.plugin.refreshViews();
    });

    const title = this.getReaderTitle(readerFile, entries);
    const titleEl = header.createEl("div", {
      cls: "stratum-reader-title",
      text: title,
    });
    titleEl.setAttr("title", title);

    const readerContent = readerTab.createDiv({
      cls: "stratum-reader-content",
    });
    readerContent.createEl("p", {
      cls: "stratum-meta",
      text: "Loading note...",
    });
    readerContent.addEventListener("scroll", () => {
      this.readerScrollTop = readerContent.scrollTop;
    });
    readerContent.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }

        const linkEl = target.closest("a");
        if (!(linkEl instanceof HTMLAnchorElement)) {
          return;
        }
        if (!linkEl.classList.contains("internal-link")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void this.openReaderLink(
          linkEl,
          readerFile,
          event.metaKey || event.ctrlKey,
        );
      },
      { capture: true },
    );

    const renderVersion = ++this.readerRenderVersion;
    const readerMarkdownComponent = this.addChild(new Component());
    this.readerMarkdownComponent = readerMarkdownComponent;
    void (async () => {
      try {
        const rawMarkdown = await this.app.vault.cachedRead(readerFile);
        const frontmatter = parseReaderFrontmatter(rawMarkdown, parseYaml);
        const metadataMarkdown = buildReaderFrontmatterMarkdown(frontmatter);
        const bodyMarkdown = stripLeadingFrontmatter(rawMarkdown);
        const markdown = metadataMarkdown
          ? `${metadataMarkdown}\n\n${bodyMarkdown}`
          : bodyMarkdown;
        if (
          renderVersion !== this.readerRenderVersion ||
          !readerContent.isConnected ||
          this.plugin.activeViewTab !== "reader" ||
          this.plugin.readerNoteFile?.path !== readerFile.path ||
          this.readerMarkdownComponent !== readerMarkdownComponent
        ) {
          return;
        }

        readerContent.empty();
        await MarkdownRenderer.render(
          this.app,
          markdown,
          readerContent,
          readerFile.path,
          readerMarkdownComponent,
        );
        if (
          renderVersion !== this.readerRenderVersion ||
          !readerContent.isConnected ||
          this.readerMarkdownComponent !== readerMarkdownComponent
        ) {
          return;
        }

        window.requestAnimationFrame(() => {
          if (!readerContent.isConnected) {
            return;
          }

          readerContent.scrollTop = savedScrollTop;
        });
      } catch (error) {
        if (
          renderVersion !== this.readerRenderVersion ||
          !readerContent.isConnected ||
          this.readerMarkdownComponent !== readerMarkdownComponent
        ) {
          return;
        }

        readerContent.empty();
        readerContent.createEl("p", {
          cls: "stratum-error",
          text:
            error instanceof Error
              ? error.message
              : "Failed to load the literature note.",
        });
      }
    })();
  }

  private renderReaderPicker(
    container: HTMLElement,
    entries: LiteratureNoteEntry[],
  ): void {
    const picker = container.createDiv({ cls: "stratum-search-section" });
    picker.createEl("h3", { text: "Read a literature note" });
    picker.createEl("p", {
      cls: "stratum-placeholder",
      text: "Search your local literature notes by title, author, year, or citation key.",
    });

    const searchBox = picker.createDiv({
      cls: "stratum-search-control",
    });
    const searchLabel = searchBox.createEl("label", {
      cls: "stratum-search-label",
      text: "Search your literature notes",
    });
    const searchId = "stratum-reader-search";
    const searchComponent = new SearchComponent(searchBox);
    searchComponent.setPlaceholder("Type a note title, author, or year");
    searchComponent.setValue(this.readerSearchQuery);
    searchComponent.inputEl.id = searchId;
    searchLabel.setAttr("for", searchId);

    const feedbackContainer = picker.createDiv({
      cls: "stratum-search-feedback",
    });
    const renderReaderFeedback = () => {
      feedbackContainer.empty();

      if (entries.length === 0) {
        feedbackContainer.createEl("p", {
          cls: "stratum-meta",
          text: "No literature notes found. Use the search tab to create some.",
        });
        return;
      }

      const query = this.readerSearchQuery.trim();
      if (!query) {
        return;
      }

      const matches = filterReaderLiteratureNoteEntries(entries, query);
      if (matches.length === 0) {
        feedbackContainer.createEl("p", {
          cls: "stratum-meta stratum-combobox-status",
          text: "No matching literature notes found.",
        });
      }
    };

    this.readerSuggest = new ReaderLiteratureNoteInputSuggest(
      this,
      searchComponent,
      entries,
      (entry) => {
        this.readerSearchQuery = "";
        this.readerScrollTop = 0;
        this.lastRenderedReaderFilePath = null;
        this.plugin.readerNoteFile = entry.file;
        this.plugin.refreshViews();
      },
    );

    searchComponent.onChange((value) => {
      this.readerSearchQuery = value;
      renderReaderFeedback();
      if (!value.trim()) {
        this.readerSuggest?.close();
        return;
      }

      this.readerSuggest?.open();
      searchComponent.inputEl.dispatchEvent(new Event("input"));
    });

    const openSuggestions = () => {
      renderReaderFeedback();
      if (!searchComponent.getValue().trim()) {
        this.readerSuggest?.close();
        return;
      }

      this.readerSuggest?.open();
      searchComponent.inputEl.dispatchEvent(new Event("input"));
    };

    searchComponent.inputEl.addEventListener("focus", openSuggestions);
    searchComponent.inputEl.addEventListener("click", openSuggestions);

    renderReaderFeedback();
  }
}
