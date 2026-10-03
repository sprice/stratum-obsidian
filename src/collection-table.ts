import type { CollectionPaper } from "./collection-browser-model";
import {
  compareSourceValues,
  sourceColumnLabel,
  sourcePropertyText,
  type SourceTableState,
} from "./source-table";

export function collectionColumnValue(
  paper: CollectionPaper,
  key: string,
): string {
  if (key === "source") return paper.title;
  if (paper.properties && Object.hasOwn(paper.properties, key))
    return sourcePropertyText(paper.properties[key]);
  switch (key) {
    case "authors":
      return paper.authors.join("; ");
    case "year":
      return paper.year ?? "";
    case "collections":
      return paper.collectionNames.join("; ");
    default:
      return "";
  }
}

export function sortCollectionTable(
  papers: CollectionPaper[],
  state: SourceTableState,
): CollectionPaper[] {
  const key = state.columnSort;
  if (!key) return papers;
  const values = new Map(
    papers.map((paper) => [paper, collectionColumnValue(paper, key)]),
  );
  return [...papers].sort((a, b) =>
    compareSourceValues(values.get(a)!, values.get(b)!, state.descending),
  );
}

export function renderCollectionTable(
  container: HTMLElement,
  papers: CollectionPaper[],
  state: SourceTableState,
  renderTitle: (cell: HTMLElement, paper: CollectionPaper) => void,
  sort: (key: string) => void,
): void {
  const table = container.createEl("table", { cls: "stratum-source-table" });
  table.createEl("caption", { text: "Imported literature notes" });
  const header = table.createEl("thead").createEl("tr");
  for (const key of ["source", ...state.columns]) {
    const cell = header.createEl("th", { attr: { scope: "col" } });
    cell.setAttr(
      "aria-sort",
      state.columnSort === key
        ? state.descending
          ? "descending"
          : "ascending"
        : "none",
    );
    const label = key === "source" ? "Source" : sourceColumnLabel(key);
    const button = cell.createEl("button", { text: label });
    button.type = "button";
    button.dataset.collectionSort = key;
    button.title = `Sort by ${label.toLocaleLowerCase()}`;
    button.addEventListener("click", () => sort(key));
  }
  const body = table.createEl("tbody");
  for (const paper of papers) {
    const row = body.createEl("tr");
    renderTitle(row.createEl("td"), paper);
    for (const key of state.columns)
      row.createEl("td", { text: collectionColumnValue(paper, key) || "—" });
  }
}
