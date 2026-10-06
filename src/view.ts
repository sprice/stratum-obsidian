import { PublishPanel } from "./view-publish";
import {
  getVisibleTabs,
  readEnabledTabs,
  resolveActiveTab,
  type StratumTab,
} from "./stratum-tabs";
import { selectStratumTab } from "./plugin-tabs";
import { hasWritingPosition, returnToWriting } from "./citation-evidence";
import { SourcesPanel, type SourcesViewState } from "./view-sources";
import { readSourceTableState } from "./source-table";
import {
  browseCollections,
  CollectionBrowserView,
  getCollectionBrowserView,
} from "./collection-browser";
import {
  createStratumButton,
  createStratumSelect,
  createStratumSearch,
} from "./ui-controls";
import {
  Component,
  Notice,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  parseYaml,
  TFile,
  WorkspaceLeaf,
  type EventRef,
  type ViewStateResult,
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
import { getSettingsManager } from "./view-helpers";
import { LibraryPaperInputSuggest } from "./view-library-input-suggest";
import {
  type BulkLibrarySyncState,
  buildDefaultBulkLibrarySyncState,
  getBulkLibrarySyncButtonLabel,
  getBulkLibrarySyncStatusMessage as getBulkSyncStatusMessage,
} from "./zotero-sync";
import { renderSelectedLibraryPaper } from "./view-library-selection";
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
  private unmountBrowseControls: (() => void) | null = null;
  private browseBrowser: CollectionBrowserView | null = null;
  private renderedTabsKey: string | null = null;
  private tabContent: HTMLElement | null = null;
  private syncControls: {
    container: HTMLElement;
    key: string;
    refresh: () => void;
  } | null = null;
  private publishPanel: PublishPanel | null = null;
  private sourcesPanel: SourcesPanel | null = null;
  private sourcesState: SourcesViewState = {
    ...readSourceTableState(undefined),
    query: "",
    sort: "appearance",
    expanded: new Set(),
    scroll: 0,
    scrollLeft: 0,
  };
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

  getState(): Record<string, unknown> {
    const { layout, columns, columnSort, descending } = this.sourcesState;
    return {
      sourcesTable: { layout, columns: [...columns], columnSort, descending },
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved =
      state && typeof state === "object"
        ? (state as Record<string, unknown>).sourcesTable
        : undefined;
    if (saved !== undefined) {
      Object.assign(this.sourcesState, readSourceTableState(saved));
    }
    await super.setState(state, result);
    this.render();
  }

  onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!(leaf?.view instanceof CollectionBrowserView)) return;
        // Track the main-pane target even while another sidebar panel is open.
        const browser = getCollectionBrowserView(this.plugin);
        if (
          this.plugin.activeViewTab === "browse" &&
          browser !== this.browseBrowser
        )
          this.render();
      }),
    );
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.syncControls = null;
    this.unmountBrowseControls?.();
    this.unmountBrowseControls = null;
    this.browseBrowser = null;
    this.renderedTabsKey = null;
    this.tabContent = null;
    if (this.publishPanel) {
      this.removeChild(this.publishPanel);
      this.publishPanel = null;
    }
    if (this.sourcesPanel) {
      this.removeChild(this.sourcesPanel);
      this.sourcesPanel = null;
    }
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

  private setActiveTab(tab: StratumTab, preserveTabFocus = false): void {
    const previous = this.plugin.activeViewTab;
    if (!selectStratumTab(this.plugin, tab)) return;
    if (tab === "browse") {
      const browser = getCollectionBrowserView(this.plugin);
      if (previous !== tab) this.plugin.refreshViews();
      const reveal = browser
        ? this.app.workspace.revealLeaf(browser.leaf)
        : browseCollections(this.plugin);
      void reveal.then(() => {
        if (preserveTabFocus && this.plugin.activeViewTab === tab)
          this.focusTab(tab);
      });
      return;
    }
    if (previous === tab) {
      return;
    }

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

  private focusTab(tab: StratumTab): void {
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

  refreshSyncProgress(): void {
    if (this.plugin.activeViewTab !== "sync") return;
    const panel =
      this.contentEl.querySelector<HTMLElement>(".stratum-sync-tab");
    if (!panel) return;
    this.renderSyncTab(panel);
  }

  render(): void {
    const enabledTabs = readEnabledTabs(this.plugin.settings.enabledTabs);
    enabledTabs.publish = enabledTabs.publish && !!this.plugin.publish;
    this.plugin.activeViewTab = resolveActiveTab(
      this.plugin.activeViewTab,
      enabledTabs,
      isLocalSyncSupported(),
    );
    const visibleTabs = getVisibleTabs(enabledTabs, isLocalSyncSupported());
    const tabsKey = JSON.stringify(visibleTabs);
    const reuseShell = this.renderedTabsKey === tabsKey && !!this.tabContent;
    const keepBrowse =
      reuseShell &&
      !!this.unmountBrowseControls &&
      !!this.browseBrowser?.isReady() &&
      (this.plugin.activeViewTab !== "browse" ||
        this.browseBrowser === getCollectionBrowserView(this.plugin));
    const focused = this.contentEl.doc.activeElement;
    const focusedTabId = focused?.id.startsWith(`${this.tabIdPrefix}-tab-`)
      ? focused.id
      : null;
    const browseSearch = this.contentEl.querySelector<HTMLInputElement>(
      'input[aria-label="Search literature notes"]',
    );
    const browseSelection =
      browseSearch && focused === browseSearch
        ? ([browseSearch.selectionStart, browseSearch.selectionEnd] as const)
        : null;
    if (!keepBrowse) {
      this.unmountBrowseControls?.();
      this.unmountBrowseControls = null;
      this.browseBrowser = null;
    }
    if (this.publishPanel) {
      this.removeChild(this.publishPanel);
      this.publishPanel = null;
    }
    if (this.sourcesPanel) {
      this.removeChild(this.sourcesPanel);
      this.sourcesPanel = null;
    }
    this.clearBulkSyncStatusTimers();
    this.paperSuggest?.close();
    this.paperSuggest = null;
    this.readerSuggest?.close();
    this.readerSuggest = null;
    this.clearReaderMarkdownComponent();

    if (this.plugin.activeViewTab !== "publish" && this.plugin.publish)
      this.plugin.publish.selectedFormat = "";

    if (this.plugin.activeViewTab !== "reader") {
      this.clearReaderFileWatcher();
      this.clearReaderRefreshTimer();
      this.readerRenderVersion += 1;
    }

    const { contentEl } = this;
    contentEl.addClass("stratum-view");
    if (!reuseShell) {
      this.syncControls = null;
      contentEl.empty();
      const shell = contentEl.createDiv({ cls: "stratum-shell" });
      this.renderedTabsKey = tabsKey;
      this.tabContent = null;
      if (visibleTabs.length === 0) {
        const empty = shell.createDiv({ cls: "stratum-empty-state" });
        empty.createEl("h2", { text: `No ${PLUGIN_NAME} tabs enabled` });
        empty.createEl("p", {
          text: `All tabs available on this device are disabled. Enable a tab in ${PLUGIN_NAME} settings to show it here.`,
        });
        this.renderSettingsButton(empty);
        return;
      }
      this.renderTabBar(shell, visibleTabs);
      this.tabContent = shell.createDiv({ cls: "stratum-tab-content" });
    }
    const tabContent = this.tabContent!;
    for (const tab of visibleTabs) {
      const panelId = `${this.tabIdPrefix}-panel-${tab.id}`;
      const panel =
        tabContent.querySelector<HTMLElement>(`#${panelId}`) ??
        tabContent.createDiv({
          cls:
            tab.id === "browse"
              ? "stratum-browse-tab"
              : tab.id === "sources"
                ? "stratum-sources-tab"
                : tab.id === "reader"
                  ? "stratum-reader-tab"
                  : tab.id === "sync"
                    ? "stratum-sync-tab"
                    : "stratum-search-tab",
        });
      panel.id = panelId;
      panel.setAttr("role", "tabpanel");
      panel.setAttr("aria-labelledby", `${this.tabIdPrefix}-tab-${tab.id}`);
      panel.hidden = this.plugin.activeViewTab !== tab.id;

      const button = contentEl.querySelector<HTMLElement>(
        `#${this.tabIdPrefix}-tab-${tab.id}`,
      );
      if (button) {
        button.className = panel.hidden ? "" : "is-active";
        button.setAttr("aria-selected", String(!panel.hidden));
        button.tabIndex = panel.hidden ? -1 : 0;
      }
      // Keep Browse attached, merely hidden, so its controls never go through
      // another initial style/layout pass when returning from another tab.
      if (tab.id !== "sync" && (tab.id !== "browse" || !keepBrowse))
        panel.empty();
      if (panel.hidden) continue;

      if (tab.id === "browse") {
        if (keepBrowse) this.browseBrowser?.refreshControls();
        else this.renderBrowseTab(panel);
      } else if (tab.id === "search") {
        this.renderSearchTab(panel);
      } else if (tab.id === "sync") {
        this.renderSyncTab(panel);
      } else if (tab.id === "sources") {
        this.sourcesPanel = this.addChild(
          new SourcesPanel(
            panel,
            this.plugin.sources,
            this.sourcesState,
            this.app,
            () => this.app.workspace.requestSaveLayout(),
          ),
        );
      } else if (tab.id === "publish" && this.plugin.publish) {
        panel.addClass("stratum-publish-tab");
        this.publishPanel = this.addChild(
          new PublishPanel(panel, this.plugin.publish),
        );
      } else {
        this.renderReaderTab(panel);
      }
    }
    if (focusedTabId) {
      const target =
        this.contentEl.querySelector<HTMLElement>(`#${focusedTabId}`) ??
        this.contentEl.querySelector<HTMLElement>(
          `#${this.tabIdPrefix}-tab-${this.plugin.activeViewTab}`,
        );
      target?.focus();
    }
    if (browseSelection && this.plugin.activeViewTab === "browse") {
      const search = this.contentEl.querySelector<HTMLInputElement>(
        'input[aria-label="Search literature notes"]',
      );
      search?.focus();
      search?.setSelectionRange(...browseSelection);
    }
  }

  private renderTabBar(
    container: HTMLElement,
    tabs: Array<{
      id: StratumTab;
      label: string;
    }>,
  ): void {
    const label = container.createSpan({ text: `${PLUGIN_NAME} panels` });
    label.id = `${this.tabIdPrefix}-tablist-label`;
    label.hidden = true;
    const tabBar = container.createDiv({ cls: "stratum-tab-bar" });
    tabBar.setCssProps({
      "--stratum-tab-count": String(Math.min(3, tabs.length)),
      "--stratum-compact-tab-count": String(Math.min(2, tabs.length)),
    });
    tabBar.setAttr("role", "tablist");
    tabBar.setAttr("aria-labelledby", label.id);

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
          this.setActiveTab(tabs[nextIndex].id, true);
          this.focusTab(tabs[nextIndex].id);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          this.setActiveTab(tabs[0].id, true);
          this.focusTab(tabs[0].id);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          this.setActiveTab(tabs[tabs.length - 1].id, true);
          this.focusTab(tabs[tabs.length - 1].id);
        }
      });
    });
  }

  private renderSettingsButton(container: HTMLElement): void {
    const button = createStratumButton(container, {
      text: `Open ${PLUGIN_NAME} settings`,
    });
    button.type = "button";
    button.addEventListener("click", () => {
      const settings = getSettingsManager(this.app);
      settings?.open();
      settings?.openTabById(this.plugin.manifest.id);
    });
  }

  private renderNoteTemplateButton(container: HTMLElement): void {
    const button = createStratumButton(container, {
      text: "Edit template",
      className: "stratum-note-template-button",
    });
    button.type = "button";
    button.addEventListener("click", () => {
      const settings = getSettingsManager(this.app);
      settings?.open();
      settings?.openTabById(this.plugin.manifest.id);
      void this.plugin.settingTab?.openNoteTemplateEditor().catch(() => {
        new Notice("Could not open the template editor.");
      });
    });
  }

  private renderBrowseTab(container: HTMLElement): void {
    const section = container.createDiv({ cls: "stratum-search-section" });
    section.createEl("h3", { text: "Browse notes" });
    section.createEl("p", {
      cls: "stratum-placeholder",
      text: "Browse literature notes in your vault",
    });
    const controls = section.createDiv();
    const browser = getCollectionBrowserView(this.plugin);
    if (browser) {
      this.browseBrowser = browser;
      this.unmountBrowseControls = browser.mountControls(controls);
      return;
    }
    const open = createStratumButton(controls, {
      text: "Show items",
      primary: true,
      className: "stratum-collection-show-items",
    });
    open.addEventListener("click", () => {
      void browseCollections(this.plugin);
    });
  }

  private renderSearchTab(container: HTMLElement): void {
    const searchTab = container;
    const zoteroConnection = this.plugin.zoteroConnection;
    const isAppConnected = this.plugin.backend.hasSession();
    const isZoteroConnected = Boolean(zoteroConnection?.connected);
    const lastKnownZoteroUsername =
      zoteroConnection?.zoteroUsername ??
      this.plugin.settings.lastKnownZoteroUsername;
    const isReadyForSearch = isAppConnected && isZoteroConnected;
    const selectedSearchLibrary = getSelectedSearchLibrary(this.plugin);
    const selectedSearchCollection = getSelectedSearchCollection(this.plugin);

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
      this.renderSettingsButton(emptyState);
      return;
    }

    void this.plugin.collections.ensureLoaded(selectedSearchLibrary);

    const searchSection = searchTab.createDiv({
      cls: "stratum-search-section",
    });
    searchSection.createEl("h3", { text: "Search Zotero" });
    searchSection.createEl("p", {
      cls: "stratum-placeholder",
      text: "Find Zotero items to create or update literature notes",
    });

    const filters = searchSection.createDiv({ cls: "stratum-library-filters" });
    if (
      this.plugin.settings.enabledLibraries.length > 1 &&
      selectedSearchLibrary
    ) {
      const libraryPicker = filters.createDiv({
        cls: "stratum-search-control",
      });
      const picker = createStratumSelect(libraryPicker, {
        label: "Library",
        ariaLabel: "Choose library",
        value: "",
        choices: [],
      });
      picker.id = "stratum-library-picker";
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

    const collectionPicker = filters.createDiv({
      cls: "stratum-search-control",
    });
    const collectionSelect = createStratumSelect(collectionPicker, {
      label: "Collection",
      ariaLabel: "Choose collection",
      value: "",
      choices: [],
    });
    collectionSelect.id = "stratum-collection-picker";
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
      const retryCollectionsButton = createStratumButton(collectionErrorRow, {
        className: "stratum-inline-action",
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
    const searchComponent = createStratumSearch(searchBox, {
      label: "Search your library",
      ariaLabel: "Search your library",
      placeholder: "Title, author, or year",
      value: this.plugin.librarySearchQuery,
    });
    searchComponent.inputEl.id = "stratum-paper-search";
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

    const templateActions = searchSection.createDiv({ cls: "stratum-actions" });
    this.renderNoteTemplateButton(templateActions);

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
      const refreshButton = createStratumButton(cacheRow, {
        className: "stratum-inline-action",
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
      selectedContainer.empty();
      renderSelectedLibraryPaper(
        this.plugin,
        selectedContainer,
        changeSelection,
      );
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

    const changeSelection = () => {
      this.plugin.library.clearSelection();
      // clearSelection rebuilds this tab. Focus the newly mounted search input.
      this.contentEl
        .querySelector<HTMLInputElement>("#stratum-paper-search")
        ?.focus();
    };
    const selectedContainer = searchSection.createDiv();
    renderSelectedLibraryPaper(this.plugin, selectedContainer, changeSelection);
  }

  private renderSyncTab(container: HTMLElement): void {
    // Progress, busy state, and completion messages update without replacing controls.
    // Rebuild only when the available choices, selected scope, or setup state changes.
    const key = JSON.stringify({
      session: this.plugin.backend.hasSession(),
      connected: this.plugin.zoteroConnection?.connected,
      enabled: this.plugin.settings.bulkSyncEnabled,
      libraries: this.plugin.localSyncLibraries,
      library:
        this.plugin.selectedSyncLibrary?.identity ??
        this.plugin.settings.selectedSyncLibraryIdentity,
      collections: this.plugin.syncCollections,
      collection: this.plugin.selectedSyncCollection,
      librariesError: this.plugin.localSyncLibrariesError,
      collectionsError: this.plugin.syncCollectionsError,
      initialLoading:
        this.plugin.isLoadingLocalSyncLibraries &&
        !this.plugin.localSyncLibraries?.length,
    });
    if (
      this.syncControls?.container === container &&
      this.syncControls.key === key
    ) {
      this.syncControls.refresh();
      return;
    }
    this.syncControls = null;
    this.clearBulkSyncStatusTimers();
    container.empty();
    if (!isLocalSyncSupported()) return;
    const syncTab = container;
    const zoteroConnected = Boolean(this.plugin.zoteroConnection?.connected);

    if (!this.plugin.backend.hasSession() || !zoteroConnected) {
      const emptyState = syncTab.createDiv({
        cls: "stratum-empty-state",
      });
      emptyState.createEl("p", {
        cls: "stratum-eyebrow",
        text: PLUGIN_NAME,
      });
      emptyState.createEl("h2", {
        text: `Finish sync setup in ${PLUGIN_NAME} settings.`,
      });
      emptyState.createEl("p", {
        cls: "stratum-meta",
        text: !this.plugin.backend.hasSession()
          ? "Sign in to Stratum, then connect Zotero in settings to sync from your local Zotero app."
          : "Connect Zotero in settings to sync from your local Zotero app.",
      });
      this.renderSettingsButton(emptyState);
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
      this.renderSettingsButton(emptyState);
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

    if (!this.plugin.settings.bulkSyncEnabled) {
      const emptyState = syncTab.createDiv({
        cls: "stratum-empty-state",
      });
      emptyState.createEl("p", {
        cls: "stratum-eyebrow",
        text: PLUGIN_NAME,
      });
      emptyState.createEl("h2", {
        text: "Bulk sync is off.",
      });
      emptyState.createEl("p", {
        cls: "stratum-meta",
        text: "Local Zotero is ready on this desktop. Turn on bulk sync in plugin settings to sync a full library or collection.",
      });
      this.renderSettingsButton(emptyState);
      return;
    }

    void this.plugin.localSync.ensureCollectionsLoaded(selectedSyncLibrary);
    const selectedSyncCollection = getSelectedSyncCollection(this.plugin);
    const syncSection = syncTab.createDiv({
      cls: "stratum-search-section",
    });
    syncSection.createEl("h3", { text: "Sync Zotero" });
    const reportContainer = syncSection.createDiv();
    syncSection.createEl("p", {
      cls: "stratum-placeholder",
      text: "Create or update literature notes from your Zotero library",
    });

    const filters = syncSection.createDiv({ cls: "stratum-library-filters" });
    let librarySelect: HTMLSelectElement | null = null;
    if (this.plugin.localSyncLibraries.length > 1) {
      const libraryPicker = filters.createDiv({
        cls: "stratum-search-control",
      });
      const picker = createStratumSelect(libraryPicker, {
        label: "Library",
        ariaLabel: "Choose library",
        value: "",
        choices: [],
      });
      librarySelect = picker;
      picker.id = "stratum-sync-library-picker";
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

    const collectionPicker = filters.createDiv({
      cls: "stratum-search-control",
    });
    const collectionSelect = createStratumSelect(collectionPicker, {
      label: "Collection",
      ariaLabel: "Choose collection",
      value: "",
      choices: [],
    });
    collectionSelect.id = "stratum-sync-collection-picker";
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

    let retryCollections: HTMLButtonElement | null = null;
    if (this.plugin.syncCollectionsError) {
      const collectionErrorRow = collectionPicker.createDiv({
        cls: "stratum-cache-row",
      });
      collectionErrorRow.createEl("p", {
        cls: "stratum-error",
        text: this.plugin.syncCollectionsError,
      });
      const retryCollectionsButton = createStratumButton(collectionErrorRow, {
        className: "stratum-inline-action",
        text: this.plugin.isLoadingSyncCollections ? "Retrying..." : "Retry",
      });
      retryCollections = retryCollectionsButton;
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
    const bulkSyncButton = createStratumButton(actions, {
      primary: true,
      text: "Sync",
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

    this.renderNoteTemplateButton(actions);

    const statusContainer = syncSection.createDiv();
    let reportKey = "";
    const refresh = () => {
      this.clearBulkSyncStatusTimers();
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

      if (retryCollections) {
        retryCollections.disabled = this.plugin.isLoadingSyncCollections;
        retryCollections.setText(
          this.plugin.isLoadingSyncCollections ? "Retrying..." : "Retry",
        );
      }
      if (librarySelect)
        librarySelect.disabled =
          this.plugin.isBulkLibrarySyncRunning() ||
          this.plugin.isZoteroAutoSyncRunning() ||
          this.plugin.isLoadingLocalSyncLibraries;
      collectionSelect.disabled =
        this.plugin.isBulkLibrarySyncRunning() ||
        this.plugin.isZoteroAutoSyncRunning() ||
        this.plugin.isLoadingSyncCollections ||
        Boolean(this.plugin.syncCollectionsError);
      bulkSyncButton.disabled =
        this.plugin.isBulkLibrarySyncRunning() ||
        this.plugin.isZoteroAutoSyncRunning() ||
        this.plugin.isLoadingLocalSyncLibraries ||
        this.plugin.isLoadingSyncCollections ||
        Boolean(this.plugin.syncCollectionsError);
      bulkSyncButton.setText(
        getBulkLibrarySyncButtonLabel(scopedBulkSyncState, {
          libraryName: selectedSyncLibrary.name,
          collectionName: scopedCollectionName,
        }),
      );
      const unsupported = scopedBulkSyncState.unsupportedItems ?? [];
      const nextReportKey = JSON.stringify(unsupported);
      reportContainer.hidden = !unsupported.length;
      if (nextReportKey !== reportKey) {
        reportKey = nextReportKey;
        reportContainer.empty();
        if (unsupported.length) {
          const report = reportContainer.createEl("details");
          report.createEl("summary", {
            text: `${unsupported.length} unsupported Zotero items skipped`,
          });
          report.createEl("p", {
            text: "These item types are not supported yet. Existing notes were left unchanged.",
          });
          const list = report.createEl("ul");
          for (const item of unsupported) {
            const row = list.createEl("li");
            row.createSpan({
              text: `${item.title} (${item.itemType ?? "missing type"}) — `,
            });
            // Construct the protocol link from the selected library and item key,
            // rather than trusting a URL restored from plugin settings.
            row.createEl("a", {
              text: "Open in Zotero",
              href: `zotero://select/${selectedSyncLibrary.type === "group" ? `groups/${encodeURIComponent(selectedSyncLibrary.id)}` : "library"}/items/${encodeURIComponent(item.itemKey)}`,
            });
          }
        }
      }
      statusContainer.empty();
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
      statusContainer.hidden = !shouldRenderBulkSyncStatus;
      if (shouldRenderBulkSyncStatus && bulkSyncCompletionFade !== null) {
        const bulkSyncStatusEl = statusContainer.createEl("p", {
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
        statusContainer.createEl("p", {
          cls: "stratum-meta stratum-bulk-sync-status",
          text: bulkSyncStatus ?? "",
        });
      }
    };
    this.syncControls = { container, key, refresh };
    refresh();
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
    if (hasWritingPosition(this.plugin)) {
      const back = createStratumButton(actions, { text: "Return to writing" });
      back.type = "button";
      back.addEventListener("click", () => {
        void returnToWriting(this.plugin).catch(
          () => new Notice("Could not return to the writing tab."),
        );
      });
    }
    const openButton = createStratumButton(actions, {
      text: "Open note",
    });
    openButton.type = "button";
    openButton.addEventListener("click", () => {
      void this.openFileInPrimaryEditor(readerFile);
    });

    const closeButton = createStratumButton(actions, {
      text: "Close",
    });
    closeButton.type = "button";
    closeButton.addEventListener("click", () => {
      this.plugin.readerNoteFile = null;
      this.plugin.refreshViews();
    });

    const title = this.getReaderTitle(readerFile, entries);
    const titleEl = header.createDiv({
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
    picker.createEl("h3", { text: "Read notes" });
    picker.createEl("p", {
      cls: "stratum-placeholder",
      text: "Read literature notes alongside your writing",
    });

    const searchBox = picker.createDiv({
      cls: "stratum-search-control",
    });
    const searchComponent = createStratumSearch(searchBox, {
      label: "Search your literature notes",
      ariaLabel: "Search your literature notes",
      placeholder: "Type a note title, author, or year",
      value: this.readerSearchQuery,
    });
    searchComponent.inputEl.id = "stratum-reader-search";

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
