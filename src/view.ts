import {
  AbstractInputSuggest,
  ItemView,
  SearchComponent,
  WorkspaceLeaf,
} from "obsidian";
import type { App } from "obsidian";
import { PLUGIN_NAME, VIEW_TYPE_STRATUM } from "./constants";
import type StratumPlugin from "./main";
import type { ZoteroSearchResult } from "./backend-client";

const ABSTRACT_TEASER_LENGTH = 220;

interface SettingsManager {
  open(): void;
  openTabById(id: string): void;
}

function getSettingsManager(app: App): SettingsManager | null {
  return (app as App & { setting?: SettingsManager }).setting ?? null;
}

function getAbstractTeaser(text: string): string {
  if (text.length <= ABSTRACT_TEASER_LENGTH) {
    return text;
  }

  const teaser = text.slice(0, ABSTRACT_TEASER_LENGTH);
  const lastSpaceIndex = teaser.lastIndexOf(" ");
  const trimmedTeaser =
    lastSpaceIndex > ABSTRACT_TEASER_LENGTH * 0.6
      ? teaser.slice(0, lastSpaceIndex)
      : teaser;

  return `${trimmedTeaser.trimEnd()}...`;
}

class LibraryPaperInputSuggest extends AbstractInputSuggest<ZoteroSearchResult> {
  plugin: StratumPlugin;
  private onStateChange: () => void;

  constructor(
    view: StratumView,
    component: SearchComponent,
    onStateChange: () => void
  ) {
    super(view.app, component.inputEl);
    this.plugin = view.plugin;
    this.onStateChange = onStateChange;
    this.limit = 24;
  }

  protected async getSuggestions(query: string): Promise<ZoteroSearchResult[]> {
    const results = await this.plugin.fetchLibrarySuggestions(query);
    this.onStateChange();
    return results;
  }

  renderSuggestion(value: ZoteroSearchResult, el: HTMLElement): void {
    el.addClass("stratum-native-suggestion");
    el.createDiv({
      cls: "stratum-native-suggestion-label",
      text: value.title,
    });
  }

  selectSuggestion(value: ZoteroSearchResult): void {
    this.setValue(value.title);
    this.close();
    this.onStateChange();
    void this.plugin.selectLibrarySearchResult(value);
  }
}

export class StratumView extends ItemView {
  plugin: StratumPlugin;
  private paperSuggest: LibraryPaperInputSuggest | null = null;

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
    return "search";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    this.paperSuggest?.close();
    this.paperSuggest = null;

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("stratum-view");

    const signedInEmail = this.plugin.settings.accountEmail;
    const zoteroConnection = this.plugin.zoteroConnection;
    const isAppConnected = Boolean(signedInEmail);
    const isZoteroConnected = Boolean(zoteroConnection?.connected);
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
          "Connect your account and library in settings. Once setup is complete, this view stays focused on creating and updating literature notes.",
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
        "Click to browse recent papers, or type to narrow by title, creator, or year.",
    });

    {
      const searchBox = searchSection.createDiv({
        cls: "stratum-search-control",
      });
      const searchLabel = searchBox.createEl("label", {
        cls: "stratum-search-label",
        text: "Search by title, author, or year",
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

      const feedbackContainer = searchSection.createDiv({
        cls: "stratum-search-feedback",
      });
      let cacheContainer: HTMLElement | null = null;
      const renderSearchFeedback = () => {
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
          !this.plugin.isSearchingLibrary &&
          this.plugin.librarySearchMeta &&
          this.plugin.librarySearchResults.length === 0
        ) {
          feedbackContainer.createEl("p", {
            cls: "stratum-meta stratum-combobox-status",
            text: this.plugin.librarySearchQuery.trim()
              ? "No matching papers in your Zotero library."
              : "No recent papers available yet.",
          });
          return;
        }

        const isCachedSearch =
          this.plugin.librarySearchMeta?.source === "cache" ||
          this.plugin.librarySearchMeta?.stale;
        if (!isCachedSearch || !cacheContainer) {
          return;
        }

        const cacheRow = cacheContainer.createDiv({
          cls: "stratum-cache-row",
        });
        cacheRow.createEl("p", {
          cls: "stratum-meta stratum-combobox-status",
          text: this.plugin.librarySearchMeta?.stale
            ? this.plugin.librarySearchMeta.retryAfterSeconds
              ? `Showing cached papers while Zotero asks us to slow down. Live refresh should resume in about ${this.plugin.librarySearchMeta.retryAfterSeconds} seconds.`
              : "Showing cached papers while Zotero asks us to slow down."
            : this.plugin.librarySearchQuery.trim()
            ? "Showing cached matches from the last validated Zotero search."
            : "Showing cached recent papers to avoid unnecessary API requests.",
        });
        const refreshButton = cacheRow.createEl("button", {
          cls: "stratum-inline-action",
          text: this.plugin.isSearchingLibrary ? "Refreshing..." : "Fetch fresh",
        });
        if (this.plugin.isSearchingLibrary || this.plugin.activeNoteActionKey) {
          refreshButton.disabled = true;
        }
        refreshButton.addEventListener("click", () => {
          void this.plugin.refreshLibrarySearch();
        });
      };

      this.paperSuggest = new LibraryPaperInputSuggest(
        this,
        searchComponent,
        renderSearchFeedback
      );
      searchComponent.onChange((value) => {
        if (!value.trim() && this.plugin.selectedLibraryResult) {
          this.plugin.clearSelectedLibraryResult({
            resetQuery: true,
          });
          return;
        }

        this.plugin.librarySearchQuery = value;
        renderSearchFeedback();
      });

      const openSuggestions = () => {
        if (this.plugin.activeNoteActionKey) {
          return;
        }

        this.paperSuggest?.open();
        searchComponent.inputEl.dispatchEvent(new Event("input"));
      };

      searchComponent.inputEl.addEventListener("focus", openSuggestions);
      searchComponent.inputEl.addEventListener("click", openSuggestions);

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
              this.plugin.toggleSelectedLibraryAbstract();
            });
          }
        }

        const selectedActions = selectedCard.createDiv({
          cls: "stratum-actions",
        });
        const clearSelectionButton = selectedActions.createEl("button", {
          text: "Choose another paper",
        });
        clearSelectionButton.addEventListener("click", () => {
          this.plugin.clearSelectedLibraryResult({
            resetQuery: true,
          });
        });
        const createButton = selectedActions.createEl("button", {
          cls: "mod-cta",
          text:
            this.plugin.activeNoteActionKey === selected.key
              ? "Working..."
              : "Create or update literature note",
        });
        if (this.plugin.activeNoteActionKey) {
          createButton.disabled = true;
        }
        createButton.addEventListener("click", () => {
          void this.plugin.createLiteratureNote(selected);
        });

        selectedCard.createEl("p", {
          cls: "stratum-meta stratum-selected-note",
          text:
            "Safe updates rewrite only managed sections and leave your own notes alone.",
        });
      }

      cacheContainer = searchSection.createDiv({
        cls: "stratum-search-cache",
      });
      renderSearchFeedback();
    }

  }
}
