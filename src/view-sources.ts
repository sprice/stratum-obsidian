import { Component, SearchComponent, setIcon } from "obsidian";
import type { SourcesController } from "./sources-controller";
import type { SourceRow } from "./document-sources";

export interface SourcesViewState {
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
  constructor(
    private container: HTMLElement,
    private sources: SourcesController,
    private state: SourcesViewState,
  ) {
    super();
  }
  onload(): void {
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
    sort.setAttr("aria-label", "Sort sources");
    for (const [value, text] of [
      ["appearance", "First appearance"],
      ["author", "Author"],
      ["title", "Title"],
    ])
      sort.createEl("option", { value, text });
    sort.value = this.state.sort;
    sort.addEventListener("change", () => {
      this.state.sort = sort.value;
      this.renderRows();
    });
    this.list = this.container.createDiv({ cls: "stratum-sources-results" });
    this.list.addEventListener("scroll", () => {
      this.state.scroll = this.list.scrollTop;
    });
    this.register(this.sources.subscribe(() => this.renderRows()));
    this.renderRows();
  }
  private renderRows(): void {
    const active = this.container.doc.activeElement;
    const focus =
      active instanceof HTMLElement && this.list.contains(active)
        ? active.dataset.sourceAction
        : undefined;
    const file = this.sources.document;
    this.documentButton.textContent =
      file?.basename ?? "No writing note selected";
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
    const problems = rows.filter((row) => row.issue).length;
    this.summary.textContent = `${rows.length} ${rows.length === 1 ? "source" : "sources"}${problems ? ` · ${problems} need attention` : ""}${this.sources.pinned ? " · Pinned" : ""}`;
    this.list.empty();
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
    const list = this.list.createEl("ul", { cls: "stratum-sources-list" });
    for (const row of filtered) this.renderRow(list, row);
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
  private renderRow(list: HTMLElement, row: SourceRow): void {
    const item = list.createEl("li");
    const entry = row.entry;
    if (entry) {
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
    if (row.issue)
      item.createEl("p", {
        cls: "stratum-sources-issue",
        text: {
          unresolved:
            "Citation key not found. Check the key or import its source.",
          ambiguous:
            "This key matches multiple sources or notes. Resolve the duplicate before opening it.",
          "missing-note":
            "Source recognized, but its literature note is missing. Sync its library to restore the note.",
        }[row.issue],
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
