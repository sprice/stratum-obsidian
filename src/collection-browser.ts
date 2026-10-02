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
import { CollectionPicker } from "./collection-picker";

export const COLLECTION_BROWSER_VIEW = "stratum-collection-browser";

export function browseCollections(plugin: StratumPlugin): void {
  const choices = buildCollectionChoices(
    getCollectionPapers(plugin),
    plugin.settings.collectionCatalogs,
  );
  new CollectionPicker(plugin.app, choices, (choice) => {
    void (async () => {
      const leaf =
        plugin.app.workspace.getLeavesOfType(COLLECTION_BROWSER_VIEW)[0] ??
        plugin.app.workspace.getLeaf("tab");
      await leaf.setViewState({
        type: COLLECTION_BROWSER_VIEW,
        state: {
          ...leaf.getViewState().state,
          collection: choice.id,
          query: "",
          scrollTop: 0,
          visibleCount: 100,
        },
        active: true,
      });
      await plugin.app.workspace.revealLeaf(leaf);
    })();
  }).open();
}

export class CollectionBrowserView extends ItemView {
  navigation = true;
  private state: CollectionBrowserState = { ...DEFAULT_BROWSER_STATE };
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
    return { ...this.state };
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.state = readBrowserState(state);
    if (this.contentReady) this.render();
    await super.setState(state, result);
  }
  onOpen(): Promise<void> {
    this.contentReady = true;
    const refresh = debounce(() => this.render(), 200, true);
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
    return Promise.resolve();
  }
  private saveState(): void {
    this.app.workspace.requestSaveLayout();
  }
  private render(): void {
    if (!this.contentReady) return;
    const focused = this.contentEl.doc.activeElement;
    const hadSearchFocus =
      focused?.tagName === "INPUT" &&
      focused.getAttribute("aria-label") === "Search imported papers";
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
    const switcher = header.createEl("button", {
      text: `${choice?.name ?? "Collection unavailable"} ▾`,
      attr: { "aria-label": "Choose collection" },
    });
    switcher.addEventListener("click", () =>
      new CollectionPicker(
        this.app,
        buildCollectionChoices(
          getCollectionPapers(this.plugin),
          this.plugin.settings.collectionCatalogs,
        ),
        (next) => {
          this.state = {
            ...this.state,
            collection: next.id,
            query: "",
            scrollTop: 0,
            visibleCount: 100,
          };
          this.saveState();
          this.render();
          this.contentEl.querySelector<HTMLButtonElement>("button")?.focus();
        },
      ).open(),
    );
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
    if (hadSearchFocus) search.inputEl.focus();
    this.count = header.createDiv({
      cls: "stratum-collection-count",
      attr: { "aria-live": "polite", role: "status" },
    });
    this.message = header.createDiv({ cls: "stratum-collection-context" });
    this.results = this.contentEl.createDiv({
      cls: "stratum-collection-results",
      attr: { "aria-label": "Imported papers" },
    });
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
  }
  private renderResults(): void {
    const catalogs = this.plugin.settings.collectionCatalogs;
    const choice = buildCollectionChoices(this.papers, catalogs).find(
      (c) => c.id === this.state.collection,
    );
    const papers = filterCollectionPapers(
      this.papers,
      choice,
      catalogs,
      this.state,
    );
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
    const list = this.results.createEl("ul", {
      cls: "stratum-collection-list",
    });
    for (const paper of papers.slice(0, this.state.visibleCount)) {
      const row = list.createEl("li");
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
          Keymap.isModEvent(event),
        );
      };
      link.addEventListener("click", open);
      link.addEventListener("auxclick", (event) => {
        if (event.button === 1) open(event);
      });
      row.createDiv({
        cls: "stratum-collection-meta",
        text: [paper.authors.join(", "), paper.year]
          .filter(Boolean)
          .join(" · "),
      });
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
}
