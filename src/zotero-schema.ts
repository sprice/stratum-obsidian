import { ZOTERO_SCHEMA } from "./zotero-schema-data.ts";

export interface ZoteroCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

/** Validate both API creators and stored frontmatter; preserve roles and literal names. */
export function readCreators(value: unknown): ZoteroCreator[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown): ZoteroCreator[] => {
    if (!raw || typeof raw !== "object") return [];
    const c = raw as Record<string, unknown>;
    const text = (key: string) =>
      typeof c[key] === "string" ? c[key].trim() : "";
    const creatorType = text("creatorType") || "author";
    if (text("name")) return [{ creatorType, name: text("name") }];
    if (!text("firstName") && !text("lastName")) return [];
    return [
      { creatorType, firstName: text("firstName"), lastName: text("lastName") },
    ];
  });
}

export function creatorName(c: ZoteroCreator): string {
  return c.name || [c.firstName, c.lastName].filter(Boolean).join(" ");
}

export function primaryCreators(
  creators: ZoteroCreator[],
  itemType: string | null,
): ZoteroCreator[] {
  const role = ZOTERO_SCHEMA[itemType ?? ""]?.primaryCreator ?? "author";
  const primary = creators.filter((c) => c.creatorType === role);
  if (primary.length) return primary;
  // Edited works can lack an author. Other contributors remain in structured
  // metadata rather than being silently relabeled as authors.
  return creators.filter((c) => c.creatorType === "editor");
}

export function creatorFamilyName(c: ZoteroCreator): string {
  return c.name || c.lastName || c.firstName || "";
}

/** Zotero's type-specific field takes precedence over a generic base field. */
export function resolveZoteroFields(
  raw: Record<string, unknown>,
): Record<string, string> {
  const schema =
    ZOTERO_SCHEMA[typeof raw.itemType === "string" ? raw.itemType : ""];
  const output: Record<string, string> = {};
  for (const [base, field] of Object.entries(schema?.baseFields ?? {})) {
    const value = raw[field];
    if (typeof value === "string" && value.trim()) output[base] = value.trim();
  }
  return output;
}

function zoteroSourceFields(
  raw: Record<string, unknown>,
): Record<string, string> {
  const schema =
    ZOTERO_SCHEMA[typeof raw.itemType === "string" ? raw.itemType : ""];
  return Object.fromEntries(
    (schema?.fields ?? []).flatMap((field) => {
      const value = raw[field];
      return typeof value === "string" && value.trim() ? [[field, value]] : [];
    }),
  );
}

export function normalizeZoteroMetadata(raw: Record<string, unknown>) {
  const fields = { ...raw, ...resolveZoteroFields(raw) };
  const text = (field: string) =>
    typeof fields[field] === "string" && fields[field].trim()
      ? fields[field].trim()
      : null;
  const itemType = text("itemType");
  const creatorDetails = readCreators(raw.creators);
  const date = text("date");
  return {
    title: text("title") ?? "Untitled",
    date,
    year: date?.match(/\b\d{4}\b/)?.[0] ?? null,
    itemType,
    creators: primaryCreators(creatorDetails, itemType).map(creatorName),
    creatorDetails,
    sourceFields: zoteroSourceFields(raw),
  };
}
