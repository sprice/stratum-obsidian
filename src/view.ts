import { ItemView, SearchComponent, WorkspaceLeaf } from "obsidian";
import { PLUGIN_NAME, VIEW_TYPE_STRATUM } from "./constants";
import {
  isLibrarySearchQueryReady,
} from "./library-search-query";
import type StratumPlugin from "./plugin";
import {
  ABSTRACT_TEASER_LENGTH,
  getAbstractTeaser,
  getSettingsManager,
} from "./view-helpers";
import { LibraryPaperInputSuggest } from "./view-library-input-suggest";
import {
  type BulkLibrarySyncState,
  getBulkLibrarySyncButtonLabel as getBulkSyncButtonLabel,
  getBulkLibrarySyncStatusMessage as getBulkSyncStatusMessage,
} from "./zotero-sync";

const BULK_SYNC_COMPLETION_STATUS_DELAY_MS = 4_000;
const BULK_SYNC_COMPLETION_STATUS_FADE_MS = 250;

function getBulkSyncCompletionFadeState(
  state: BulkLibrarySyncState,
  now = Date.now()
): { fadeInMs: number; removeInMs: number; startFaded: boolean } | null {
  if (state.phase !== "completed") {
    return null;
  }

  const completedAt = state.completedAt ? Date.parse(state.completedAt) : Number.NaN;
  if (!Number.isFinite(completedAt)) {
    return {
      fadeInMs: BULK_SYNC_COMPLETION_STATUS_DELAY_MS,
      removeInMs:
        BULK_SYNC_COMPLETION_STATUS_DELAY_MS + BULK_SYNC_COMPLETION_STATUS_FADE_MS,
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
  private bulkSyncStatusFadeTimer: number | null = null;
  private bulkSyncStatusRemoveTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: StratumPlugin) {
    super(leaf);
    this.plugin = plugin;
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

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.clearBulkSyncStatusTimers();
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

  render(): void {
    this.clearBulkSyncStatusTimers();
    this.paperSuggest?.close();
    this.paperSuggest = null;

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("stratum-view");

    const signedInEmail = this.plugin.settings.accountEmail;
    const zoteroConnection = this.plugin.zoteroConnection;
    const isAppConnected = Boolean(signedInEmail);
    const isZoteroConnected = Boolean(zoteroConnection?.connected);
    const lastKnownZoteroUsername =
      zoteroConnection?.zoteroUsername ?? this.plugin.settings.lastKnownZoteroUsername;
    const isReadyForSearch = isAppConnected && isZoteroConnected;
    const shell = contentEl.createDiv({ cls: "stratum-shell" });
    const openSettings = () => {
      const settingsManager = getSettingsManager(this.app);
      if (!settingsManager) {
        return;
      }

      settingsManager.open();
      settingsManager.openTabById(this.plugin.manifest.id);
    };

    if (!isReadyForSearch) {
      const emptyState = shell.createDiv({
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
        text:
          !isAppConnected
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

    const searchSection = shell.createDiv({
      cls: "stratum-search-section",
    });
    searchSection.createEl("h3", { text: "Find a paper" });
    searchSection.createEl("p", {
      cls: "stratum-placeholder",
      text:
        "Search your Zotero library by title, author, or year, then choose a paper to create or update its literature note.",
    });

    {
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
      const searchInputContainer = searchBox.querySelector(".search-input-container");
      const loadingSpinner = searchInputContainer?.createDiv({
        cls: "stratum-search-spinner",
      });
      loadingSpinner?.setAttr("aria-hidden", "true");

      const feedbackContainer = searchSection.createDiv({
        cls: "stratum-search-feedback",
      });
      let cacheContainer: HTMLElement | null = null;
      const renderSearchFeedback = () => {
        const isReadyQuery = isLibrarySearchQueryReady(this.plugin.librarySearchQuery);
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

        if (
          this.plugin.librarySearchQuery.trim() &&
          !isReadyQuery
        ) {
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
            text: "No matching papers in your Zotero library.",
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
        renderSearchFeedback
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

      const bulkSyncSection = searchSection.createDiv({
        cls: "stratum-bulk-sync",
      });
      const bulkSyncButton = bulkSyncSection.createEl("button", {
        cls: "mod-cta",
        text: getBulkSyncButtonLabel(this.plugin.settings.bulkLibrarySync),
      });
      if (
        this.plugin.activeNoteActionKey ||
        this.plugin.isBulkLibrarySyncRunning() ||
        this.plugin.isZoteroAutoSyncRunning()
      ) {
        bulkSyncButton.disabled = true;
      }
      bulkSyncButton.addEventListener("click", () => {
        void this.plugin.runBulkLibrarySync();
      });

      const bulkSyncStatus = getBulkSyncStatusMessage({
        state: this.plugin.settings.bulkLibrarySync,
        processedCount: this.plugin.getBulkLibrarySyncProcessedCount(),
      });
      const bulkSyncCompletionFade = getBulkSyncCompletionFadeState(
        this.plugin.settings.bulkLibrarySync
      );
      const shouldRenderBulkSyncStatus =
        Boolean(bulkSyncStatus) &&
        (this.plugin.settings.bulkLibrarySync.phase !== "completed" ||
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
        if (this.plugin.activeNoteActionKey || this.plugin.isBulkLibrarySyncRunning()) {
          createButton.disabled = true;
        }
        createButton.addEventListener("click", () => {
          void this.plugin.library.createNote(selected);
        });

        selectedCard.createEl("p", {
          cls: "stratum-meta stratum-selected-note",
          text:
            "Safe updates rewrite only managed sections and leave your own notes alone.",
        });
      }
    }

  }
}
