import { SourceColumnsModal } from "./source-columns-modal";
import { renderCollectionTable, sortCollectionTable } from "./collection-table";
import {
  ItemView,
  Keymap,
  SearchComponent,
  ToggleComponent,
  debounce,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type StratumPlugin from "./plugin";
import { getCollectionPapers } from "./collection-browser-data";
import {
  buildCollectionChoices,
  DEFAULT_BROWSER_STATE,
  filterCollectionPapers,
  readBrowserState,
  type CollectionBrowserState,
  type CollectionPaper,
} from "./collection-browser-model";
import { onCollectionCatalogChange } from "./collection-catalog-store";

export const COLLECTION_BROWSER_VIEW = "stratum-collection-browser";

export function browseCollections(plugin: StratumPlugin): void {
  void (async () => {
    const existing = plugin.app.workspace.getLeavesOfType(
      COLLECTION_BROWSER_VIEW,
    )[0];
    const leaf = existing ?? plugin.app.workspace.getLeaf("tab");
    if (!existing) {
      await leaf.setViewState({
        type: COLLECTION_BROWSER_VIEW,
        state: { ...readBrowserState(DEFAULT_BROWSER_STATE) },
        active: true,
      });
    }
    await plugin.app.workspace.revealLeaf(leaf);
  })();
}

export class CollectionBrowserView extends ItemView {
  navigation = true;
  private state: CollectionBrowserState = readBrowserState(
    DEFAULT_BROWSER_STATE,
  );
  private columnsModal: SourceColumnsModal | null = null;
  private papers: CollectionPaper[] = [];
  private results!: HTMLElement;
  private count!: HTMLElement;
  private message!: HTMLElement;
  private contentReady = false;
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: StratumPlugin,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return COLLECTION_BROWSER_VIEW;
  }
  getDisplayText(): string {
    return "Collections";
  }
  getIcon(): string {
    return "library";
  }
  getState(): Record<string, unknown> {
    return { ...this.state, columns: [...this.state.columns] };
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.state = readBrowserState(state);
    if (this.contentReady) this.render();
    await super.setState(state, result);
  }
  onOpen(): Promise<void> {
    this.contentReady = true;
    const refresh = debounce(() => this.render(), 200, true);
    this.register(onCollectionCatalogChange(this.plugin, refresh));
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.metadataCache.on("resolved", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.register(() => refresh.cancel());
    this.render();
    return Promise.resolve();
  }
  onClose(): Promise<void> {
    this.contentReady = false;
    this.columnsModal?.close();
    return Promise.resolve();
  }
  private saveState(): void {
    this.app.workspace.requestSaveLayout();
  }
  private render(): void {
    if (!this.contentReady) return;
    const focused = this.contentEl.doc.activeElement;
    const searchInput = this.contentEl.querySelector<HTMLInputElement>(
      'input[aria-label="Search imported papers"]',
    );
    const sortFocus =
      focused instanceof HTMLElement
        ? focused.dataset.collectionSort
        : undefined;
    const hadSearchFocus = focused === searchInput && searchInput !== null;
    const selection = hadSearchFocus
      ? ([searchInput.selectionStart, searchInput.selectionEnd] as const)
      : null;
    this.papers = getCollectionPapers(this.plugin);
    const choices = buildCollectionChoices(
      this.papers,
      this.plugin.settings.collectionCatalogs,
    );
    const choice = choices.find((entry) => entry.id === this.state.collection);
    this.contentEl.empty();
    this.contentEl.addClass("stratum-collection-browser");
    const header = this.contentEl.createDiv({
      cls: "stratum-collection-header",
    });
    const collectionLabel = header.createEl("label", {
      text: "Collection",
      cls: "stratum-collection-select",
    });
    const switcher = collectionLabel.createEl("select", {
      attr: { "aria-label": "Choose collection" },
    });
    if (!choice) {
      const unavailable = switcher.createEl("option", {
        value: this.state.collection,
        text: "Collection unavailable",
      });
      unavailable.disabled = true;
    }
    for (const option of choices) {
      switcher.createEl("option", {
        value: option.id,
        text: option.key ? option.context : option.name,
      });
    }
    switcher.value = this.state.collection;
    switcher.addEventListener("change", () => {
      this.state = {
        ...this.state,
        collection: switcher.value,
        query: "",
        scrollTop: 0,
        visibleCount: 100,
      };
      this.saveState();
      this.render();
      this.contentEl
        .querySelector<HTMLSelectElement>(
          'select[aria-label="Choose collection"]',
        )
        ?.focus();
    });
    header.createDiv({
      cls: "stratum-collection-context",
      text: choice?.context ?? "Choose another collection to continue.",
    });
    const catalog = choice?.libraryIdentity
      ? this.plugin.settings.collectionCatalogs[choice.libraryIdentity]
      : null;
    if (
      choice?.key &&
      catalog?.collections.some((c) => c.parentCollectionKey === choice.key)
    ) {
      const label = header.createEl("label", {
        cls: "stratum-collection-toggle",
      });
      label.createSpan({ text: "Include subcollections" });
      new ToggleComponent(label)
        .setValue(this.state.includeSubcollections)
        .setTooltip("Include subcollections")
        .onChange((value) => {
          this.state.includeSubcollections = value;
          this.state.scrollTop = 0;
          this.saveState();
          this.renderResults();
        });
    }
    const search = new SearchComponent(header)
      .setPlaceholder("Search papers…")
      .setValue(this.state.query)
      .onChange((query) => {
        this.state.query = query;
        this.state.visibleCount = 100;
        this.state.scrollTop = 0;
        this.saveState();
        this.renderResults();
      });
    search.inputEl.setAttribute("aria-label", "Search imported papers");
    if (hadSearchFocus) {
      search.inputEl.focus();
      if (selection) search.inputEl.setSelectionRange(...selection);
    }
    const tools = header.createDiv({ cls: "stratum-collection-tools" });
    const layout = tools.createEl("select", {
      attr: { "aria-label": "Literature browser layout" },
    });
    layout.createEl("option", { value: "list", text: "List" });
    layout.createEl("option", { value: "table", text: "Table" });
    layout.value = this.state.layout;
    const columns = tools.createEl("button", { text: "Columns" });
    columns.type = "button";
    columns.hidden = this.state.layout !== "table";
    columns.addEventListener("click", () => {
      this.columnsModal?.close();
      this.columnsModal = new SourceColumnsModal(
        this.app,
        this.state.columns,
        (selected) => {
          if (!this.contentReady) return;
          this.state.columns = selected;
          if (
            this.state.columnSort !== "source" &&
            !selected.includes(this.state.columnSort ?? "")
          )
            this.state.columnSort = null;
          this.saveState();
          this.renderResults();
        },
      );
      this.columnsModal.open();
    });
    layout.addEventListener("change", () => {
      this.state.layout = layout.value === "table" ? "table" : "list";
      this.state.scrollTop = 0;
      columns.hidden = this.state.layout !== "table";
      this.saveState();
      this.renderResults();
    });
    this.count = header.createDiv({
      cls: "stratum-collection-count",
      attr: { "aria-live": "polite", role: "status" },
    });
    this.message = header.createDiv({ cls: "stratum-collection-context" });
    this.results = this.contentEl.createDiv({
      cls: "stratum-collection-results",
      attr: { "aria-label": "Imported papers" },
    });
    this.results.tabIndex = 0;
    this.results.addEventListener("scroll", () => {
      this.state.scrollTop = this.results.scrollTop;
      this.saveState();
    });
    search.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.results.querySelector<HTMLAnchorElement>("a")?.focus();
      }
    });
    this.results.addEventListener("keydown", (event) => {
      const links = Array.from(
        this.results.querySelectorAll<HTMLAnchorElement>("a"),
      );
      const index = links.indexOf(
        this.contentEl.doc.activeElement as HTMLAnchorElement,
      );
      if (index < 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        links[
          Math.max(
            0,
            Math.min(
              links.length - 1,
              index + (event.key === "ArrowDown" ? 1 : -1),
            ),
          )
        ]?.focus();
      }
    });
    this.renderResults();
    if (sortFocus) this.focusSort(sortFocus);
  }
  private focusSort(key: string): void {
    this.results
      .querySelectorAll<HTMLElement>("[data-collection-sort]")
      .forEach((element) => {
        if (element.dataset.collectionSort === key)
          element.focus({ preventScroll: true });
      });
  }
  private renderResults(): void {
    const catalogs = this.plugin.settings.collectionCatalogs;
    const choice = buildCollectionChoices(this.papers, catalogs).find(
      (c) => c.id === this.state.collection,
    );
    const filtered = filterCollectionPapers(
      this.papers,
      choice,
      catalogs,
      this.state,
    );
    const papers =
      this.state.layout === "table"
        ? sortCollectionTable(filtered, this.state)
        : filtered;
    this.count.setText(
      `${papers.length} imported ${papers.length === 1 ? "paper" : "papers"}`,
    );
    const unknown = this.papers.filter((p) => p.keys === null).length;
    this.message.setText(
      unknown
        ? `${unknown} older ${unknown === 1 ? "note needs" : "notes need"} a sync to appear in collections. All imported papers includes these notes.`
        : choice?.key &&
            !catalogs[choice.libraryIdentity!]?.collections.some(
              (c) => c.key === choice.key,
            )
          ? "Collection hierarchy unavailable. Sync to refresh collection information."
          : "",
    );
    this.results.empty();
    if (!papers.length)
      this.results.createEl("p", {
        text:
          this.papers.length === 0
            ? "No imported papers yet. Import papers using Stratum’s Search or Sync tab."
            : this.state.query
              ? "No papers match this search."
              : "No imported papers in this collection.",
      });
    if (this.state.layout === "table") {
      renderCollectionTable(
        this.results,
        papers.slice(0, this.state.visibleCount),
        this.state,
        (cell, paper) => this.renderTitle(cell, paper),
        (key) => {
          this.state.descending =
            this.state.columnSort === key ? !this.state.descending : false;
          this.state.columnSort = key;
          this.state.scrollTop = 0;
          this.saveState();
          this.renderResults();
          this.focusSort(key);
        },
      );
    } else {
      const list = this.results.createEl("ul", {
        cls: "stratum-collection-list",
      });
      for (const paper of papers.slice(0, this.state.visibleCount)) {
        const row = list.createEl("li");
        this.renderTitle(row, paper);
        row.createDiv({
          cls: "stratum-collection-meta",
          text: [paper.authors.join(", "), paper.year]
            .filter(Boolean)
            .join(" · "),
        });
      }
    }
    if (papers.length > this.state.visibleCount) {
      const more = this.results.createEl("button", {
        text: "Show more papers",
      });
      more.addEventListener("click", () => {
        const previousCount = this.state.visibleCount;
        this.state.visibleCount += 100;
        this.saveState();
        this.renderResults();
        const links = this.results.querySelectorAll<HTMLAnchorElement>("a");
        links[previousCount]?.focus();
      });
    }
    this.results.scrollTop = this.state.scrollTop;
  }
  private renderTitle(row: HTMLElement, paper: CollectionPaper): void {
    const link = row.createEl("a", {
      cls: "internal-link stratum-collection-title",
      text: paper.title,
      href: paper.path,
    });
    const open = (event: MouseEvent) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(
        paper.path,
        "",
        Keymap.isModEvent(event) || "tab",
      );
    };
    link.addEventListener("click", open);
    link.addEventListener("auxclick", (event) => {
      if (event.button === 1) open(event);
    });
  }
}
