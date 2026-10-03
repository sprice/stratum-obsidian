import type { SourceRow } from "./document-sources";

export const SOURCE_COLUMNS: Record<string, string> = {
  authors: "Authors",
  year: "Year",
  reference_type: "Type",
  publication: "Publication",
  collections: "Collections",
  method: "Method",
  findings: "Findings",
  limitations: "Limitations",
};
export const DEFAULT_SOURCE_COLUMNS = ["authors", "year", "reference_type"];
export const MAX_SOURCE_COLUMNS = 8;
export interface SourceTableState {
  layout: "list" | "table";
  columns: string[];
  columnSort: string | null;
  descending: boolean;
}

export function sourceColumnLabel(key: string): string {
  return Object.hasOwn(SOURCE_COLUMNS, key) ? SOURCE_COLUMNS[key] : key;
}

export function readSourceColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_SOURCE_COLUMNS];
  return [
    ...new Set(
      value.filter(
        (key): key is string =>
          typeof key === "string" &&
          key.trim() === key &&
          key.length > 0 &&
          key !== "source" &&
          key.length <= 80 &&
          !/[\r\n\t]/.test(key),
      ),
    ),
  ].slice(0, MAX_SOURCE_COLUMNS);
}

export function readSourceTableState(value: unknown): SourceTableState {
  const state =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const columns = readSourceColumns(state.columns);
  return {
    layout: state.layout === "table" ? "table" : "list",
    columns,
    columnSort:
      typeof state.columnSort === "string" &&
      (state.columnSort === "source" || columns.includes(state.columnSort))
        ? state.columnSort
        : null,
    descending: state.descending === true,
  };
}

/** Display metadata as text; never interpret user properties as HTML or code. */
export function sourcePropertyText(value: unknown, depth = 0): string {
  if (value == null || depth > 2) return "";
  if (typeof value === "string")
    return value.replace(
      /\[\[([^\]]+)\]\]/g,
      (_match, target: string) => target.split("|").pop() ?? target,
    );
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value
      .map((item: unknown) => sourcePropertyText(item, depth + 1))
      .filter(Boolean)
      .join("; ");
  return "";
}

export function sourceColumnValue(
  row: SourceRow,
  key: string,
  properties: Record<string, unknown> | undefined,
): string {
  if (key === "source") return row.entry?.title ?? row.keys.join("; ");
  if (properties && Object.hasOwn(properties, key))
    return sourcePropertyText(properties[key]);
  const entry = row.entry;
  if (!entry) return "";
  switch (key) {
    case "authors":
      return entry.authors.join("; ");
    case "year":
      return entry.year ?? "";
    case "reference_type":
      return entry.referenceType ?? "";
    case "publication":
      return entry.publication ?? "";
    default:
      return "";
  }
}

export function sortSourceTable(
  rows: SourceRow[],
  state: SourceTableState,
  properties: (row: SourceRow) => Record<string, unknown> | undefined,
): SourceRow[] {
  const key = state.columnSort;
  if (!key) return rows;
  const values = new Map(
    rows.map((row) => [row, sourceColumnValue(row, key, properties(row))]),
  );
  return [...rows].sort((a, b) => {
    const left = values.get(a)!;
    const right = values.get(b)!;
    return compareSourceValues(left, right, state.descending);
  });
}

/** Keep missing values last and compare numeric properties by their value. */
export function compareSourceValues(
  left: string,
  right: string,
  descending: boolean,
): number {
  if (!left || !right) return !left && !right ? 0 : !left ? 1 : -1;
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const comparison =
    numeric.test(left) &&
    numeric.test(right) &&
    Number.isFinite(Number(left)) &&
    Number.isFinite(Number(right))
      ? Number(left) - Number(right)
      : left.localeCompare(right, undefined, {
          numeric: true,
          sensitivity: "base",
        });
  return comparison * (descending ? -1 : 1);
}
