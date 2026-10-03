import { CSL_INPUT_FIELDS } from "./csl-input-fields.ts";
/** Zotero supplies CSL JSON. Do not reconstruct reference data from display text. */
export interface CslItem {
  id: string;
  type: string;
  [field: string]: unknown;
}
export function readCslItem(value: unknown, identity: string): CslItem | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) value = value.length === 1 ? value[0] : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.type !== "string" ||
    !CSL_INPUT_FIELDS.types.includes(record.type)
  )
    return null;
  for (const field of CSL_INPUT_FIELDS.names) {
    const names = record[field];
    if (
      names !== undefined &&
      (!Array.isArray(names) ||
        names.some(
          (name) =>
            !name ||
            typeof name !== "object" ||
            Array.isArray(name) ||
            Object.values(name as Record<string, unknown>).some(
              (value) =>
                typeof value !== "string" && typeof value !== "boolean",
            ),
        ))
    )
      return null;
  }
  for (const field of CSL_INPUT_FIELDS.dates) {
    const date = record[field];
    if (date === undefined) continue;
    if (!date || typeof date !== "object" || Array.isArray(date)) return null;
    const parts = (date as Record<string, unknown>)["date-parts"];
    if (
      parts !== undefined &&
      (!Array.isArray(parts) ||
        parts.some(
          (part) =>
            !Array.isArray(part) ||
            part.some(
              (value) => typeof value !== "number" && typeof value !== "string",
            ),
        ))
    )
      return null;
  }
  let copy: Record<string, unknown>;
  try {
    copy = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  } catch {
    return null;
  }
  for (const key of ["__proto__", "constructor", "prototype"])
    Reflect.deleteProperty(copy, key);
  return { ...copy, id: identity, type: record.type };
}
