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
  getLibraryBulkSyncState,
  getSelectedSearchLibrary,
  setSelectedSearchLibrary,
} from "./plugin-libraries";
import { getSelectedSearchCollection } from "./plugin-collections";
import {
  getSelectedSyncCollection,
  getSelectedSyncLibrary,
  isLocalSyncSupported,
} from "./plugin-local-sync";
import {
  ABSTRACT_TEASER_LENGTH,
  getAbstractTeaser,
  getSettingsManager,
} from "./view-helpers";
import { LibraryPaperInputSuggest } from "./view-library-input-suggest";
import {
  type BulkLibrarySyncState,
  buildDefaultBulkLibrarySyncState,
  getBulkLibrarySyncButtonLabel,
  getBulkLibrarySyncStatusMessage as getBulkSyncStatusMessage,
} from "./zotero-sync";
import { normalizeDoi } from "./doi";
import { refreshReaderLiteratureNote } from "./plugin-note-refresh";

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

  private setActiveTab(tab: "search" | "sync" | "reader"): void {
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

  private focusTab(tab: "search" | "sync" | "reader"): void {
    const tabId = `${this.tabIdPrefix}-tab-${tab}`;
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
    const isReadyForSearch =
      Boolean(this.plugin.settings.accountEmail) &&
      Boolean(this.plugin.zoteroConnection?.connected);
    const visibleTabs: Array<{
      id: "search" | "sync" | "reader";
      label: string;
    }> = [
      { id: "search", label: "Search" },
      ...(isLocalSyncSupported() &&
      this.plugin.settings.bulkSyncEnabled &&
      isReadyForSearch
        ? [{ id: "sync" as const, label: "Sync" }]
        : []),
      { id: "reader", label: "Reader" },
    ];
    if (!visibleTabs.some((tab) => tab.id === this.plugin.activeViewTab)) {
      this.plugin.activeViewTab = "search";
    }

    this.renderTabBar(shell, visibleTabs);

    const tabContent = shell.createDiv({ cls: "stratum-tab-content" });
    for (const tab of visibleTabs) {
      const panel = tabContent.createDiv({
        cls:
          tab.id === "reader"
            ? "stratum-reader-tab"
            : tab.id === "sync"
              ? "stratum-sync-tab"
              : "stratum-search-tab",
      });
      panel.id = `${this.tabIdPrefix}-panel-${tab.id}`;
      panel.setAttr("role", "tabpanel");
      panel.setAttr("aria-labelledby", `${this.tabIdPrefix}-tab-${tab.id}`);
      panel.hidden = this.plugin.activeViewTab !== tab.id;

      if (panel.hidden) {
        continue;
      }

      if (tab.id === "search") {
        this.renderSearchTab(panel);
      } else if (tab.id === "sync") {
        this.renderSyncTab(panel);
      } else {
        this.renderReaderTab(panel);
      }
    }
  }

  private renderTabBar(
    container: HTMLElement,
    tabs: Array<{ id: "search" | "sync" | "reader"; label: string }>,
  ): void {
    const tabBar = container.createDiv({ cls: "stratum-tab-bar" });
    tabBar.setAttr("role", "tablist");
    tabBar.setAttr("aria-label", `${PLUGIN_NAME} panels`);

    tabs.forEach((tab, index) => {
      const button = tabBar.createEl("button", {
        cls: this.plugin.activeViewTab === tab.id ? "is-active" : "",
        text: tab.label,
      });
      button.type = "button";
      button.id = `${this.tabIdPrefix}-tab-${tab.id}`;
      button.setAttr("role", "tab");
      button.setAttr("aria-controls", `${this.tabIdPrefix}-panel-${tab.id}`);
      button.setAttr(
        "aria-selected",
        this.plugin.activeViewTab === tab.id ? "true" : "false",
      );
      button.tabIndex = this.plugin.activeViewTab === tab.id ? 0 : -1;
      button.addEventListener("click", () => {
        this.setActiveTab(tab.id);
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const nextIndex = (index + direction + tabs.length) % tabs.length;
          this.setActiveTab(tabs[nextIndex].id);
          this.focusTab(tabs[nextIndex].id);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          this.setActiveTab(tabs[0].id);
          this.focusTab(tabs[0].id);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          this.setActiveTab(tabs[tabs.length - 1].id);
          this.focusTab(tabs[tabs.length - 1].id);
        }
      });
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
    const selectedSearchCollection = getSelectedSearchCollection(this.plugin);
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

    void this.plugin.collections.ensureLoaded(selectedSearchLibrary);

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

    const collectionPicker = searchSection.createDiv({
      cls: "stratum-search-control",
    });
    const collectionLabel = collectionPicker.createEl("label", {
      cls: "stratum-search-label",
      text: "Collection",
    });
    const collectionId = "stratum-collection-picker";
    const collectionSelect = collectionPicker.createEl("select");
    collectionSelect.id = collectionId;
    collectionLabel.setAttr("for", collectionId);
    collectionSelect.disabled =
      this.plugin.activeNoteActionKey !== null ||
      this.plugin.isBulkLibrarySyncRunning() ||
      this.plugin.isLoadingLibraryCollections;

    const allCollectionsOption = collectionSelect.createEl("option", {
      text: "All collections",
      value: "",
    });
    allCollectionsOption.selected = !selectedSearchCollection;

    for (const collection of this.plugin.libraryCollections) {
      const option = collectionSelect.createEl("option", {
        text: collection.displayName,
        value: collection.key,
      });
      option.selected = collection.key === selectedSearchCollection?.key;
    }

    collectionSelect.addEventListener("change", () => {
      const collection =
        this.plugin.libraryCollections.find((entry) => {
          return entry.key === collectionSelect.value;
        }) ?? null;
      this.plugin.collections.select(collection);
      this.render();
    });

    if (this.plugin.libraryCollectionsError) {
      const collectionErrorRow = collectionPicker.createDiv({
        cls: "stratum-cache-row",
      });
      collectionErrorRow.createEl("p", {
        cls: "stratum-error",
        text: this.plugin.libraryCollectionsError,
      });
      const retryCollectionsButton = collectionErrorRow.createEl("button", {
        cls: "stratum-inline-action",
        text: this.plugin.isLoadingLibraryCollections ? "Retrying..." : "Retry",
      });
      if (
        this.plugin.isLoadingLibraryCollections ||
        this.plugin.activeNoteActionKey !== null
      ) {
        retryCollectionsButton.disabled = true;
      }
      retryCollectionsButton.addEventListener("click", () => {
        void this.plugin.collections.refresh(selectedSearchLibrary);
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
          text: selectedSearchCollection
            ? `No matching papers in ${selectedSearchCollection.displayName}.`
            : selectedSearchLibrary
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
          text: `DOI: ${normalizeDoi(selected.doi) ?? selected.doi}`,
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
  }

  private renderSyncTab(container: HTMLElement): void {
    const syncTab = container;
    const zoteroConnected = Boolean(this.plugin.zoteroConnection?.connected);
    const openSettings = () => {
      const settingsManager = getSettingsManager(this.app);
      if (!settingsManager) {
        return;
      }

      settingsManager.open();
      settingsManager.openTabById(this.plugin.manifest.id);
    };

    if (!this.plugin.backend.hasSession() || !zoteroConnected) {
      const emptyState = syncTab.createDiv({
        cls: "stratum-empty-state",
      });
      emptyState.createEl("p", {
        cls: "stratum-eyebrow",
        text: PLUGIN_NAME,
      });
      emptyState.createEl("h2", {
        text: "Finish Zotero setup in plugin settings.",
      });
      emptyState.createEl("p", {
        cls: "stratum-meta",
        text: "Bulk sync uses your local Zotero app for paper data, but it still depends on your connected account.",
      });
      const settingsButton = emptyState.createEl("button", {
        text: "Open plugin settings",
      });
      settingsButton.addEventListener("click", openSettings);
      return;
    }

    void this.plugin.localSync.ensureLibrariesLoaded();

    if (
      this.plugin.isLoadingLocalSyncLibraries &&
      this.plugin.localSyncLibraries.length === 0
    ) {
      const emptyState = syncTab.createDiv({
        cls: "stratum-empty-state",
      });
      emptyState.createEl("p", {
        cls: "stratum-eyebrow",
        text: PLUGIN_NAME,
      });
      emptyState.createEl("h2", {
        text: "Checking local Zotero...",
      });
      emptyState.createEl("p", {
        cls: "stratum-meta",
        text: "Looking for the Zotero desktop API on this machine.",
      });
      return;
    }

    if (
      this.plugin.localSyncLibrariesError &&
      this.plugin.localSyncLibraries.length === 0
    ) {
      const emptyState = syncTab.createDiv({
        cls: "stratum-empty-state",
      });
      emptyState.createEl("p", {
        cls: "stratum-eyebrow",
        text: PLUGIN_NAME,
      });
      emptyState.createEl("h2", {
        text: "Local Zotero is not ready.",
      });
      emptyState.createEl("p", {
        cls: "stratum-meta",
        text: this.plugin.localSyncLibrariesError,
      });
      const settingsButton = emptyState.createEl("button", {
        text: "Open plugin settings",
      });
      settingsButton.addEventListener("click", openSettings);
      return;
    }

    const selectedSyncLibrary = getSelectedSyncLibrary(this.plugin);
    if (!selectedSyncLibrary) {
      const emptyState = syncTab.createDiv({
        cls: "stratum-empty-state",
      });
      emptyState.createEl("p", {
        cls: "stratum-eyebrow",
        text: PLUGIN_NAME,
      });
      emptyState.createEl("h2", {
        text: "No local Zotero libraries found.",
      });
      emptyState.createEl("p", {
        cls: "stratum-meta",
        text: "Open Zotero on this desktop, then return here to bulk sync a library or collection.",
      });
      return;
    }

    void this.plugin.localSync.ensureCollectionsLoaded(selectedSyncLibrary);
    const selectedSyncCollection = getSelectedSyncCollection(this.plugin);
    const bulkSyncState = getLibraryBulkSyncState(
      this.plugin,
      selectedSyncLibrary,
    );
    const scopedBulkSyncState =
      bulkSyncState.collectionKey === (selectedSyncCollection?.key ?? null)
        ? bulkSyncState
        : buildDefaultBulkLibrarySyncState();
    const scopedCollectionName =
      scopedBulkSyncState.collectionName ??
      selectedSyncCollection?.displayName ??
      null;

    const syncSection = syncTab.createDiv({
      cls: "stratum-search-section",
    });
    syncSection.createEl("h3", { text: "Bulk sync" });
    syncSection.createEl("p", {
      cls: "stratum-placeholder",
      text: "Choose a local Zotero library and collection, then sync all matching papers from your local Zotero app.",
    });

    if (this.plugin.localSyncLibraries.length > 1) {
      const libraryPicker = syncSection.createDiv({
        cls: "stratum-search-control",
      });
      const pickerLabel = libraryPicker.createEl("label", {
        cls: "stratum-search-label",
        text: "Library",
      });
      const pickerId = "stratum-sync-library-picker";
      const picker = libraryPicker.createEl("select");
      picker.id = pickerId;
      pickerLabel.setAttr("for", pickerId);
      picker.disabled =
        this.plugin.isBulkLibrarySyncRunning() ||
        this.plugin.isZoteroAutoSyncRunning() ||
        this.plugin.isLoadingLocalSyncLibraries;

      for (const library of this.plugin.localSyncLibraries) {
        const option = picker.createEl("option", {
          text: library.name,
          value: library.identity,
        });
        option.selected = library.identity === selectedSyncLibrary.identity;
      }

      picker.addEventListener("change", () => {
        const library =
          this.plugin.localSyncLibraries.find(
            (entry) => entry.identity === picker.value,
          ) ?? null;
        void this.plugin.localSync.selectLibrary(library).then(() => {
          void this.plugin.localSync.ensureCollectionsLoaded(library);
          this.render();
        });
      });
    }

    const collectionPicker = syncSection.createDiv({
      cls: "stratum-search-control",
    });
    const collectionLabel = collectionPicker.createEl("label", {
      cls: "stratum-search-label",
      text: "Collection",
    });
    const collectionId = "stratum-sync-collection-picker";
    const collectionSelect = collectionPicker.createEl("select");
    collectionSelect.id = collectionId;
    collectionLabel.setAttr("for", collectionId);
    collectionSelect.disabled =
      this.plugin.isBulkLibrarySyncRunning() ||
      this.plugin.isZoteroAutoSyncRunning() ||
      this.plugin.isLoadingSyncCollections ||
      Boolean(this.plugin.syncCollectionsError);

    const allCollectionsOption = collectionSelect.createEl("option", {
      text: "All collections",
      value: "",
    });
    allCollectionsOption.selected = !selectedSyncCollection;

    for (const collection of this.plugin.syncCollections) {
      const option = collectionSelect.createEl("option", {
        text: collection.displayName,
        value: collection.key,
      });
      option.selected = collection.key === selectedSyncCollection?.key;
    }

    collectionSelect.addEventListener("change", () => {
      const collection =
        this.plugin.syncCollections.find(
          (entry) => entry.key === collectionSelect.value,
        ) ?? null;
      void this.plugin.localSync.selectCollection(collection).then(() => {
        this.render();
      });
    });

    if (this.plugin.syncCollectionsError) {
      const collectionErrorRow = collectionPicker.createDiv({
        cls: "stratum-cache-row",
      });
      collectionErrorRow.createEl("p", {
        cls: "stratum-error",
        text: this.plugin.syncCollectionsError,
      });
      const retryCollectionsButton = collectionErrorRow.createEl("button", {
        cls: "stratum-inline-action",
        text: this.plugin.isLoadingSyncCollections ? "Retrying..." : "Retry",
      });
      if (this.plugin.isLoadingSyncCollections) {
        retryCollectionsButton.disabled = true;
      }
      retryCollectionsButton.addEventListener("click", () => {
        void this.plugin.localSync.refreshCollections(selectedSyncLibrary);
      });
    }

    const actions = syncSection.createDiv({
      cls: "stratum-actions",
    });
    const bulkSyncButton = actions.createEl("button", {
      cls: "mod-cta",
      text: getBulkLibrarySyncButtonLabel(scopedBulkSyncState, {
        libraryName: selectedSyncLibrary.name,
        collectionName: scopedCollectionName,
      }),
    });
    bulkSyncButton.disabled =
      this.plugin.isBulkLibrarySyncRunning() ||
      this.plugin.isZoteroAutoSyncRunning() ||
      this.plugin.isLoadingLocalSyncLibraries ||
      this.plugin.isLoadingSyncCollections ||
      Boolean(this.plugin.syncCollectionsError);
    bulkSyncButton.addEventListener("click", () => {
      void this.plugin.runBulkLibrarySync();
    });

    const scopedNounPhrase = scopedCollectionName
      ? `papers from ${scopedCollectionName}`
      : `papers in ${selectedSyncLibrary.name}`;
    const bulkSyncStatus =
      scopedBulkSyncState.phase === "idle"
        ? null
        : this.plugin.isBulkLibrarySyncRunning() &&
            this.plugin.bulkLibrarySyncStage === "enrichment"
          ? this.plugin.bulkLibrarySyncCurrentPageTotalCount > 0
            ? `Enriching ${Math.min(
                this.plugin.bulkLibrarySyncCurrentPageProcessedCount,
                this.plugin.bulkLibrarySyncCurrentPageTotalCount,
              )} of ${this.plugin.bulkLibrarySyncCurrentPageTotalCount} ${scopedNounPhrase}.`
            : `Finishing enrichment for ${scopedNounPhrase}.`
          : getBulkSyncStatusMessage({
              state: scopedBulkSyncState,
              processedCount: this.plugin.isBulkLibrarySyncRunning()
                ? this.plugin.getBulkLibrarySyncProcessedCount()
                : scopedBulkSyncState.processedCount,
              libraryName: selectedSyncLibrary.name,
              collectionName: scopedCollectionName,
            });
    const bulkSyncCompletionFade =
      getBulkSyncCompletionFadeState(scopedBulkSyncState);
    const shouldRenderBulkSyncStatus =
      Boolean(bulkSyncStatus) &&
      (scopedBulkSyncState.phase !== "completed" ||
        bulkSyncCompletionFade !== null);
    if (shouldRenderBulkSyncStatus && bulkSyncCompletionFade !== null) {
      const bulkSyncStatusEl = syncSection.createEl("p", {
        cls: "stratum-meta stratum-bulk-sync-status",
        text: bulkSyncStatus ?? "",
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
      syncSection.createEl("p", {
        cls: "stratum-meta stratum-bulk-sync-status",
        text: bulkSyncStatus ?? "",
      });
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
    const shouldRefreshReaderNote =
      this.lastRenderedReaderFilePath !== readerFile.path;
    const savedScrollTop =
      this.lastRenderedReaderFilePath === readerFile.path
        ? this.readerScrollTop
        : 0;
    this.lastRenderedReaderFilePath = readerFile.path;
    if (shouldRefreshReaderNote) {
      void refreshReaderLiteratureNote(this.plugin, readerFile);
    }

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
