import { renderSourceHealth, sourceNeedsAttention } from "./view-source-health";
import { Component, SearchComponent, setIcon } from "obsidian";
import type { SourcesController } from "./sources-controller";
import type { SourceRow } from "./document-sources";
import { SourceColumnsModal } from "./source-columns-modal";
import {
  sourceColumnLabel,
  sourceColumnValue,
  sortSourceTable,
  type SourceTableState,
} from "./source-table";
import type { App } from "obsidian";

export interface SourcesViewState extends SourceTableState {
  query: string;
  sort: string;
  expanded: Set<string>;
  scroll: number;
}
export class SourcesPanel extends Component {
  private list!: HTMLElement;
  private documentButton!: HTMLButtonElement;
  private pin!: HTMLButtonElement;
  private summary!: HTMLElement;
  private citationStatus!: HTMLElement;
  private citationRevision = 0;
  private recovering = new Set<string>();
  private recoveryErrors = new Map<string, string>();
  private active = false;
  private columnsModal: SourceColumnsModal | null = null;
  private sortMenu!: HTMLSelectElement;
  private columnOrder!: HTMLOptionElement;
  constructor(
    private container: HTMLElement,
    private sources: SourcesController,
    private state: SourcesViewState,
    private app: App,
    private saveState: () => void,
  ) {
    super();
  }
  onload(): void {
    this.active = true;
    this.container.addClass("stratum-sources");
    const header = this.container.createDiv({ cls: "stratum-sources-header" });
    header.createEl("h3", { text: "Sources" });
    this.pin = header.createEl("button", { cls: "clickable-icon" });
    this.pin.type = "button";
    setIcon(this.pin, "pin");
    this.pin.addEventListener("click", () => this.sources.togglePin());
    this.documentButton = this.container.createEl("button", {
      cls: "stratum-sources-document",
    });
    this.documentButton.type = "button";
    this.documentButton.addEventListener("click", () => {
      void this.sources.returnToDocument();
    });
    this.citationStatus = this.container.createDiv({
      cls: "stratum-citation-status",
    });
    this.register(
      this.sources.subscribeCitationChanges(() => {
        void this.renderCitationStatus();
      }),
    );
    this.summary = this.container.createDiv({ cls: "stratum-sources-summary" });
    this.summary.setAttr("role", "status");
    const tools = this.container.createDiv({ cls: "stratum-sources-tools" });
    const search = new SearchComponent(tools);
    search
      .setPlaceholder("Search sources…")
      .setValue(this.state.query)
      .onChange((value) => {
        this.state.query = value;
        this.renderRows();
      });
    search.inputEl.setAttr("aria-label", "Search sources");
    const sort = tools.createEl("select");
    this.sortMenu = sort;
    sort.setAttr("aria-label", "Sort sources");
    for (const [value, text] of [
      ["appearance", "First appearance"],
      ["author", "Author"],
      ["title", "Title"],
    ])
      sort.createEl("option", { value, text });
    this.columnOrder = sort.createEl("option", {
      value: "column",
      text: "Column order",
    });
    this.columnOrder.disabled = true;
    this.columnOrder.hidden = true;
    sort.value = this.state.sort;
    sort.addEventListener("change", () => {
      this.state.sort = sort.value;
      this.state.columnSort = null;
      this.saveState();
      this.renderRows();
    });
    const layout = tools.createEl("select");
    layout.setAttr("aria-label", "Sources layout");
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
          if (!this.active) return;
          this.state.columns = selected;
          if (
            this.state.columnSort !== "source" &&
            !selected.includes(this.state.columnSort ?? "")
          )
            this.state.columnSort = null;
          this.saveState();
          this.renderRows();
        },
      );
      this.columnsModal.open();
    });
    layout.addEventListener("change", () => {
      this.state.layout = layout.value === "table" ? "table" : "list";
      this.state.columnSort = null;
      this.state.scroll = 0;
      columns.hidden = this.state.layout !== "table";
      this.saveState();
      this.renderRows();
    });
    this.list = this.container.createDiv({ cls: "stratum-sources-results" });
    this.list.tabIndex = 0;
    this.list.setAttr(
      "aria-label",
      "Source results; scroll to see additional columns",
    );
    this.list.addEventListener("scroll", () => {
      this.state.scroll = this.list.scrollTop;
    });
    this.register(this.sources.subscribe(() => this.renderRows()));
    this.renderRows();
  }
  onunload(): void {
    this.active = false;
    this.columnsModal?.close();
    this.citationRevision++;
  }
  private async renderCitationStatus(): Promise<void> {
    const revision = ++this.citationRevision;
    try {
      const label = await this.sources.citationStatus();
      if (
        revision !== this.citationRevision ||
        !this.citationStatus.isConnected
      )
        return;
      this.citationStatus.empty();
      if (!label) return;
      const button = this.citationStatus.createEl("button", { text: label });
      button.title = "Change citation style for this paper";
      button.addEventListener("click", () => {
        void this.sources.changeCitationStyle();
      });
    } catch (error) {
      if (revision !== this.citationRevision) return;
      this.citationStatus.setText(
        error instanceof Error
          ? error.message
          : "Citation preview unavailable.",
      );
      const button = this.citationStatus.createEl("button", {
        text: "Change citation style",
      });
      button.addEventListener("click", () => {
        void this.sources.changeCitationStyle();
      });
    }
  }
  private renderRows(): void {
    this.columnOrder.hidden = !this.state.columnSort;
    this.columnOrder.text = this.state.columnSort
      ? `Column: ${this.state.columnSort === "source" ? "Source" : sourceColumnLabel(this.state.columnSort)}`
      : "Column order";
    this.sortMenu.value = this.state.columnSort ? "column" : this.state.sort;
    void this.renderCitationStatus();
    const active = this.container.doc.activeElement;
    const focus =
      active instanceof HTMLElement && this.list.contains(active)
        ? active.dataset.sourceAction
        : undefined;
    const file = this.sources.document;
    this.documentButton.textContent = file
      ? `Sources for: ${file.basename}`
      : "";
    this.documentButton.hidden = !this.sources.showDocumentLink;
    this.documentButton.disabled = !file;
    this.documentButton.title = file
      ? "Return to this note"
      : "Open a note to see its sources";
    this.pin.disabled = !file;
    this.pin.setAttr("aria-pressed", String(this.sources.pinned));
    this.pin.setAttr(
      "aria-label",
      this.sources.pinned
        ? "Unpin sources from this note"
        : "Pin sources to this note",
    );
    this.pin.title = this.sources.pinned
      ? "Unpin sources from this note"
      : "Pin sources to this note";
    const rows = this.sources.rows;
    for (const row of rows)
      if (row.health?.reference && !row.health.problem)
        this.recoveryErrors.delete(row.id);
    const problems = rows.filter(sourceNeedsAttention).length;
    this.summary.textContent = `${rows.length} ${rows.length === 1 ? "source" : "sources"}${problems ? ` · ${problems} ${problems === 1 ? "needs" : "need"} attention` : ""}${this.sources.pinned ? " · Pinned" : ""}`;
    this.list.empty();
    if (this.sources.referenceError)
      this.list.createEl("p", {
        cls: "stratum-sources-issue",
        text: `Citation data could not be read: ${this.sources.referenceError} No reference files have been replaced.`,
      });
    if (!file || this.sources.error || !rows.length) {
      this.list.createEl("p", {
        cls: "stratum-sources-empty",
        text:
          this.sources.error ??
          (file
            ? "Citations and links to literature notes will appear here as you write."
            : "Open a writing note, then choose Show sources for current note."),
      });
      return;
    }
    const query = this.state.query.trim().toLocaleLowerCase();
    const filtered = rows.filter((row) =>
      [
        row.entry?.title,
        row.entry?.authors.join(" "),
        row.entry?.year,
        ...row.keys,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
    if (this.state.sort !== "appearance")
      filtered.sort((a, b) => {
        const value = (row: SourceRow) =>
          this.state.sort === "author"
            ? (row.entry?.authors.join(" ") ?? row.keys[0])
            : (row.entry?.title ?? row.keys[0]);
        return (value(a) ?? "").localeCompare(value(b) ?? "");
      });
    if (this.state.layout === "table") this.renderTable(filtered);
    else {
      const list = this.list.createEl("ul", { cls: "stratum-sources-list" });
      for (const row of filtered) this.renderRow(list, row);
    }
    if (!filtered.length)
      this.list.createEl("p", {
        text: "No matching sources.",
        cls: "stratum-sources-empty",
      });
    this.list.scrollTop = this.state.scroll;
    if (focus)
      this.list
        .querySelectorAll<HTMLElement>("[data-source-action]")
        .forEach((element) => {
          if (element.dataset.sourceAction === focus)
            element.focus({ preventScroll: true });
        });
  }
  private renderTable(rows: SourceRow[]): void {
    const table = this.list.createEl("table", { cls: "stratum-source-table" });
    table.createEl("caption", { text: "Sources for this note" });
    const header = table.createEl("thead").createEl("tr");
    for (const key of ["source", ...this.state.columns]) {
      const cell = header.createEl("th", { attr: { scope: "col" } });
      cell.setAttr(
        "aria-sort",
        this.state.columnSort === key
          ? this.state.descending
            ? "descending"
            : "ascending"
          : "none",
      );
      const label = key === "source" ? "Source" : sourceColumnLabel(key);
      const button = cell.createEl("button", { text: label });
      button.type = "button";
      button.dataset.sourceAction = `sort:${key}`;
      button.title = `Sort by ${label.toLocaleLowerCase()}`;
      button.addEventListener("click", () => {
        this.state.descending =
          this.state.columnSort === key ? !this.state.descending : false;
        this.state.columnSort = key;
        this.saveState();
        this.renderRows();
        this.list
          .querySelectorAll<HTMLElement>("[data-source-action]")
          .forEach((element) => {
            if (element.dataset.sourceAction === `sort:${key}`)
              element.focus({ preventScroll: true });
          });
      });
    }
    const body = table.createEl("tbody");
    for (const row of sortSourceTable(rows, this.state, (source) =>
      this.sources.properties(source),
    )) {
      const tr = body.createEl("tr");
      this.renderRow(tr.createEl("td"), row, true);
      const properties = this.sources.properties(row);
      for (const key of this.state.columns)
        tr.createEl("td", {
          text: sourceColumnValue(row, key, properties) || "—",
        });
    }
  }
  private async recover(row: SourceRow): Promise<void> {
    if (!this.active || this.recovering.has(row.id)) return;
    this.recovering.add(row.id);
    this.recoveryErrors.delete(row.id);
    this.renderRows();
    try {
      await this.sources.recoverSource(row);
    } catch (error) {
      if (this.active)
        this.recoveryErrors.set(
          row.id,
          error instanceof Error
            ? error.message
            : "Could not fetch citation data. Check Zotero and retry.",
        );
    } finally {
      this.recovering.delete(row.id);
      if (this.active) this.renderRows();
    }
  }
  private renderRow(list: HTMLElement, row: SourceRow, compact = false): void {
    const item = list.createEl(compact ? "div" : "li");
    const entry = row.entry;
    if (entry) {
      if (!compact)
        item.createDiv({
          cls: "stratum-sources-meta",
          text: [entry.authors.join(", ") || "Unknown author", entry.year]
            .filter(Boolean)
            .join(" · "),
        });
      const title = item.createEl("button", {
        cls: "stratum-sources-title",
        text: entry.title,
      });
      title.type = "button";
      title.dataset.sourceAction = `${row.id}:open`;
      title.title = "Open literature note in a main tab";
      title.addEventListener("click", () => {
        void this.sources.openSource(entry.file);
      });
    }
    const keys = item.createDiv({ cls: "stratum-sources-keys" });
    for (const key of row.keys) {
      keys.createEl("code", {
        cls: "stratum-sources-key",
        text: `@${key}`,
      });
    }
    renderSourceHealth(item, row, {
      busy: this.recovering.has(row.id),
      error: this.recoveryErrors.get(row.id),
      repair: () => {
        void this.sources.repairSource(row);
      },
      recover: () => {
        void this.recover(row);
      },
      show: () => {
        void this.sources.returnToDocument(
          row.occurrences.find((o) => o.kind === "citation"),
        );
      },
    });
    const citations = row.occurrences.filter(
      (o) => o.kind === "citation",
    ).length;
    const links = row.occurrences.length - citations;
    const details = item.createEl("details");
    details.open = this.state.expanded.has(row.id);
    const summary = details.createEl("summary", {
      text: [
        citations
          ? `${citations} ${citations === 1 ? "citation" : "citations"}`
          : "",
        links ? `${links} ${links === 1 ? "link" : "links"}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
    summary.dataset.sourceAction = `${row.id}:occurrences`;
    details.addEventListener("toggle", () => {
      if (details.open) this.state.expanded.add(row.id);
      else this.state.expanded.delete(row.id);
    });
    row.occurrences.forEach((occurrence, index) => {
      const button = details.createEl("button", {
        cls: "stratum-sources-excerpt",
        text: occurrence.excerpt,
      });
      button.type = "button";
      button.dataset.sourceAction = `${row.id}:occurrence:${index}`;
      button.title = "Show this occurrence in your note";
      button.addEventListener("click", () => {
        void this.sources.returnToDocument(occurrence);
      });
    });
  }
}
