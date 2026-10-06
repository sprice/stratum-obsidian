import {
  createStratumSelect,
  createStratumDropdown,
  createStratumSearch,
  createStratumButton,
} from "./ui-controls";
import { renderSourceHealth, sourceNeedsAttention } from "./view-source-health";
import { Component, Notice, setIcon } from "obsidian";
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
  scrollLeft: number;
}
export class SourcesPanel extends Component {
  private list!: HTMLElement;
  private documentButton!: HTMLButtonElement;
  private pin!: HTMLButtonElement;
  private summary!: HTMLElement;
  private context!: HTMLElement;
  private pinStatus!: HTMLElement;
  private attention!: HTMLButtonElement;
  private attentionOnly = false;
  private tools!: HTMLElement;
  private citationStatus!: HTMLElement;
  private citationRevision = 0;
  private citationControlsKey: string | null = null;
  private citationStyleSaving = false;
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
    header.createEl("h3", { text: "Review citations" });
    this.container.createEl("p", {
      cls: "stratum-placeholder",
      text: "Review sources cited or linked in your note",
    });
    this.context = this.container.createDiv({ cls: "stratum-sources-context" });
    this.documentButton = this.context.createEl("button", {
      cls: "stratum-sources-document",
    });
    this.documentButton.type = "button";
    this.documentButton.addEventListener("click", () => {
      void this.sources.returnToDocument();
    });
    this.pinStatus = this.context.createDiv({
      cls: "stratum-sources-pin-status",
    });
    this.pin = this.context.createEl("button", { cls: "clickable-icon" });
    this.pin.type = "button";
    setIcon(this.pin, "pin");
    this.pin.addEventListener("click", () => this.sources.togglePin());
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
    this.attention = createStratumButton(this.summary, {
      text: "Needs attention",
    });
    this.attention.addEventListener("click", () => {
      this.attentionOnly = !this.attentionOnly;
      this.state.scroll = 0;
      this.renderRows();
    });
    const tools = this.container.createDiv({ cls: "stratum-sources-tools" });
    this.tools = tools;
    const display = tools.createDiv({ cls: "stratum-sources-display" });
    const sort = createStratumSelect(display, {
      label: "Sort",
      ariaLabel: "Sort citations",
      value: this.state.sort,
      choices: [],
    });
    this.sortMenu = sort;
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
    const viewGroup = display.createDiv({ cls: "stratum-sources-view-group" });
    viewGroup.createDiv({ text: "View", cls: "stratum-control-label" });
    const viewControls = viewGroup.createDiv({
      cls: "stratum-sources-view-controls",
    });
    const layout = createStratumSelect(viewControls, {
      ariaLabel: "Citations layout",
      value: this.state.layout,
      choices: [],
    });
    layout.createEl("option", { value: "list", text: "List" });
    layout.createEl("option", { value: "table", text: "Table" });
    layout.value = this.state.layout;
    const columns = createStratumButton(viewControls, {
      text: "Columns",
      tooltip: "Choose table columns",
    });
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
      this.state.scrollLeft = 0;
      columns.hidden = this.state.layout !== "table";
      this.saveState();
      this.renderRows();
    });
    createStratumSearch(tools, {
      label: "Search",
      ariaLabel: "Search citations",
      placeholder: "Title, author, year, or citation key",
      value: this.state.query,
      onChange: (value) => {
        this.state.query = value;
        this.renderRows();
      },
    });
    this.list = this.container.createDiv({ cls: "stratum-sources-results" });
    this.list.tabIndex = 0;
    this.list.setAttr(
      "aria-label",
      "Citation results; scroll to see additional columns",
    );
    this.list.addEventListener("scroll", () => {
      this.state.scroll = this.list.scrollTop;
      this.state.scrollLeft = this.list.scrollLeft;
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
      const choices = await this.sources.citationStyleChoices();
      if (
        revision !== this.citationRevision ||
        !this.citationStatus.isConnected
      )
        return;
      const controlsKey = JSON.stringify({
        choices,
        saving: this.citationStyleSaving,
      });
      if (this.citationControlsKey === controlsKey) return;
      this.citationControlsKey = controlsKey;
      this.citationStatus.empty();
      if (!choices) return;
      const dropdown = createStratumDropdown(this.citationStatus, {
        label: "Citation style",
        ariaLabel: "Citation style for this note",
        value: choices.selected,
        choices: choices.options.map((option) => ({
          value: option.id,
          label: option.title,
        })),
      });
      if (choices.inherited)
        this.citationStatus.createDiv({
          cls: "stratum-sources-style-origin",
          text: "Using default",
        });
      let selected = choices.selected;
      dropdown.setDisabled(this.citationStyleSaving);
      dropdown.setValue(selected).onChange(async (value) => {
        if (this.citationStyleSaving) return;
        this.citationStyleSaving = true;
        dropdown.setDisabled(true);
        try {
          await this.sources.changeCitationStyle(value, choices.path);
          selected = value;
        } catch {
          if (dropdown.selectEl.isConnected) dropdown.setValue(selected);
          new Notice("Could not change citation style. Try again.");
        } finally {
          this.citationStyleSaving = false;
          if (dropdown.selectEl.isConnected) dropdown.setDisabled(false);
          if (this.active) await this.renderCitationStatus();
        }
      });
      if (choices.unavailable)
        this.citationStatus.createEl("p", {
          cls: "stratum-meta",
          text: "This style is unavailable. Choose another style or manage citation styles to download it.",
        });
      this.renderCitationSettingsButton();
    } catch (error) {
      if (revision !== this.citationRevision) return;
      this.citationControlsKey = null;
      this.citationStatus.setText(
        error instanceof Error
          ? error.message
          : "Citation preview unavailable.",
      );
      this.renderCitationSettingsButton();
    }
  }
  private renderCitationSettingsButton(): void {
    const button = this.citationStatus.createEl("button", {
      cls: "clickable-icon stratum-citation-settings-button",
      attr: { "aria-label": "Manage citation styles" },
    });
    setIcon(button, "settings");
    button.type = "button";
    button.title = "Open citation settings";
    button.addEventListener("click", () => {
      void this.sources.manageCitationStyles().catch(() => {
        new Notice("Could not open citation settings. Try again.");
      });
    });
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
    this.documentButton.textContent = file ? file.basename : "";
    this.context.hidden = !file;
    this.documentButton.hidden = !file;
    this.pinStatus.setText(this.sources.pinned ? "Pinned" : "");
    this.pinStatus.hidden = !this.sources.pinned;
    this.documentButton.disabled = !file;
    this.documentButton.title = file
      ? "Return to this note"
      : "Open a note to see its citations";
    this.pin.disabled = !file;
    this.pin.setAttr("aria-pressed", String(this.sources.pinned));
    this.pin.setAttr(
      "aria-label",
      this.sources.pinned
        ? "Unpin citations from this note"
        : "Pin citations to this note",
    );
    this.pin.title = this.sources.pinned
      ? "Unpin citations from this note"
      : "Pin citations to this note";
    const rows = this.sources.rows;
    this.tools.hidden = rows.length === 0;
    this.summary.hidden = rows.length === 0;
    this.pin.hidden = rows.length === 0 && !this.sources.pinned;
    for (const row of rows)
      if (row.health?.reference && !row.health.problem)
        this.recoveryErrors.delete(row.id);
    const problems = rows.filter(sourceNeedsAttention).length;
    this.summary.setAttribute(
      "aria-label",
      `${rows.length} ${rows.length === 1 ? "source" : "sources"}${problems ? ` · ${problems} ${problems === 1 ? "needs" : "need"} attention` : ""}${this.sources.pinned ? " · Pinned" : ""}`,
    );
    let count = this.summary.querySelector<HTMLElement>(
      ".stratum-sources-count",
    );
    if (!count)
      count = this.summary.createDiv({ cls: "stratum-sources-count" });
    count.setText(`${rows.length} ${rows.length === 1 ? "source" : "sources"}`);
    if (!problems) this.attentionOnly = false;
    this.attention.hidden = !problems;
    this.attention.setText(
      `${problems} ${problems === 1 ? "needs" : "need"} attention`,
    );
    this.attention.setAttr("aria-pressed", String(this.attentionOnly));
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
            : "Open a note with citations or links to literature notes to see its sources."),
      });
      return;
    }
    const query = this.state.query.trim().toLocaleLowerCase();
    const filtered = rows.filter(
      (row) =>
        (!this.attentionOnly || sourceNeedsAttention(row)) &&
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
        text: this.attentionOnly
          ? "No matching sources need attention."
          : "No matching citations.",
        cls: "stratum-sources-empty",
      });
    this.list.scrollTop = this.state.scroll;
    this.list.scrollLeft = this.state.scrollLeft;
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
    table.createEl("caption", { text: "Citations for this note" });
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
      if (!compact) {
        const authors = item.createDiv({
          cls: "stratum-sources-meta",
          text: [
            entry.authors.length > 3
              ? `${entry.authors.slice(0, 2).join(", ")} et al.`
              : entry.authors.join(", ") || "Unknown author",
            entry.year,
          ]
            .filter(Boolean)
            .join(" · "),
        });
        authors.title = entry.authors.join(", ");
      }
    }
    const renderKeys = (parent: HTMLElement) => {
      const keys = parent.createDiv({ cls: "stratum-sources-keys" });
      for (const key of row.keys)
        keys.createEl("code", { cls: "stratum-sources-key", text: `@${key}` });
    };
    if (sourceNeedsAttention(row)) renderKeys(item);
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
      cls: "stratum-sources-occurrences",
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
    if (!sourceNeedsAttention(row)) renderKeys(details);
    details.addEventListener("toggle", () => {
      if (details.open) this.state.expanded.add(row.id);
      else this.state.expanded.delete(row.id);
    });
    row.occurrences.forEach((occurrence, index) => {
      const button = details.createEl("button", {
        cls: "stratum-sources-excerpt",
      });
      button.type = "button";
      button.dataset.sourceAction = `${row.id}:occurrence:${index}`;
      const excerpt = button.createSpan({ cls: "stratum-sources-passage" });
      const match =
        occurrence.excerptFrom === undefined
          ? -1
          : occurrence.from - occurrence.excerptFrom;
      const end = match + occurrence.to - occurrence.from;
      if (match >= 0 && end > match && end <= occurrence.excerpt.length) {
        excerpt.createSpan({ text: occurrence.excerpt.slice(0, match) });
        excerpt.createEl("mark", {
          text: occurrence.excerpt.slice(match, end),
        });
        excerpt.createSpan({
          text: occurrence.excerpt.slice(end),
        });
      } else excerpt.setText(occurrence.excerpt);
      button.createSpan({
        text: "Go to passage",
        cls: "stratum-sources-passage-action",
      });
      button.title = "Go to passage in your note";
      button.addEventListener("click", () => {
        void this.sources.returnToDocument(occurrence);
      });
    });
  }
}
