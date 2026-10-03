import assert from "node:assert/strict";
import test from "node:test";
import type { SourceRow } from "../document-sources";
import {
  readSourceColumns,
  readSourceTableState,
  sourceColumnLabel,
  sourceColumnValue,
  sourcePropertyText,
  sortSourceTable,
} from "../source-table";

function source(title: string, year: string | null = null): SourceRow {
  return {
    id: title,
    keys: [],
    occurrences: [],
    entry: {
      title,
      authors: ["Synthetic author"],
      year,
      referenceType: "Book",
    } as SourceRow["entry"],
  };
}

test("source table restores only valid layout, columns, and sort state", () => {
  assert.equal(readSourceTableState(null).layout, "list");
  assert.deepEqual(
    readSourceColumns(["year", "year", null, "source", "\n", "method"]),
    ["year", "method"],
  );
  assert.equal(
    readSourceColumns(Array.from({ length: 15 }, (_, i) => `field${i}`)).length,
    8,
  );
  assert.deepEqual(
    readSourceTableState({
      layout: "table",
      columns: [],
      columnSort: "source",
      descending: true,
    }),
    { layout: "table", columns: [], columnSort: "source", descending: true },
  );
  assert.equal(
    readSourceTableState({ columns: ["year"], columnSort: "removed" })
      .columnSort,
    null,
  );
  assert.equal(sourceColumnLabel("__proto__"), "__proto__");
});

test("property values remain text and retain useful lists, false, and zero", () => {
  assert.equal(
    sourcePropertyText(["[[A person]]", "[[Notes/Example|Label]]", 0, false]),
    "A person; Label; 0; false",
  );
  assert.equal(
    sourcePropertyText("<script>example</script>"),
    "<script>example</script>",
  );
  assert.equal(sourcePropertyText({ nested: "not a scalar" }), "");
  const cycle: unknown[] = [];
  cycle.push(cycle);
  assert.equal(sourcePropertyText(cycle), "");
});

test("custom properties are read without treating source prose as an assessment", () => {
  const row = source("Synthetic work", "2024");
  const properties = {
    method: "Interviews",
    findings: ["Observation A", "Observation B"],
    sample_size: 0,
  };
  assert.equal(sourceColumnValue(row, "method", properties), "Interviews");
  assert.equal(
    sourceColumnValue(row, "findings", properties),
    "Observation A; Observation B",
  );
  assert.equal(sourceColumnValue(row, "sample_size", properties), "0");
  assert.equal(sourceColumnValue(row, "limitations", properties), "");
  assert.equal(sourceColumnValue(row, "year", properties), "2024");
  assert.equal(sourceColumnValue(row, "reference_type", properties), "Book");
  assert.equal(sourceColumnValue(row, "toString", properties), "");
  assert.deepEqual(properties, {
    method: "Interviews",
    findings: ["Observation A", "Observation B"],
    sample_size: 0,
  });
});

test("sorting handles numeric values, missing assessments, and stable ties without mutating sources", () => {
  const rows = [source("A"), source("B"), source("C"), source("D")];
  const properties = new Map([
    [rows[0], { sample_size: 100 }],
    [rows[1], { sample_size: 9 }],
    [rows[3], { sample_size: 9 }],
  ]);
  const state = {
    ...readSourceTableState(null),
    columns: ["sample_size"],
    columnSort: "sample_size",
  };
  assert.deepEqual(
    sortSourceTable(rows, state, (row) => properties.get(row)).map(
      (row) => row.id,
    ),
    ["B", "D", "A", "C"],
  );
  assert.deepEqual(
    sortSourceTable(rows, { ...state, descending: true }, (row) =>
      properties.get(row),
    ).map((row) => row.id),
    ["A", "B", "D", "C"],
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ["A", "B", "C", "D"],
  );
});

test("unresolved sources remain sortable and present without a literature note", () => {
  const unknown: SourceRow = {
    id: "unknown",
    keys: ["synthetic2026"],
    issue: "unresolved",
    occurrences: [],
  };
  assert.equal(
    sourceColumnValue(unknown, "source", undefined),
    "synthetic2026",
  );
  assert.equal(sourceColumnValue(unknown, "year", undefined), "");
  const rows = [unknown, source("A work", "2026")];
  assert.equal(
    sortSourceTable(
      rows,
      { ...readSourceTableState(null), columnSort: "source" },
      () => undefined,
    )[0].id,
    "A work",
  );
});

test("sorting compares signed and decimal numeric properties by value", () => {
  const rows = [source("A"), source("B"), source("C")];
  const values = new Map([
    [rows[0], -100],
    [rows[1], -9],
    [rows[2], 0.5],
  ]);
  const sorted = sortSourceTable(
    rows,
    { ...readSourceTableState(null), columnSort: "effect_size" },
    (row) => ({ effect_size: values.get(row) }),
  );
  assert.deepEqual(
    sorted.map((row) => row.id),
    ["A", "B", "C"],
  );
});
