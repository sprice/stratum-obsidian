import {
  textList,
  type PublishOptions,
  type AcademicDefaults,
} from "./publish-options";

export type PublishedUse =
  "metadata" | "title" | "authors" | "affiliations" | "date" | "keywords";
export interface PublishingProperty {
  key: string;
  type: "text" | "list" | "date";
  required: boolean;
  defaultValue: string;
  use: PublishedUse;
}
const safeKey = (key: unknown): key is string =>
  typeof key === "string" &&
  /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(key) &&
  !["constructor", "prototype", "__proto__"].includes(key);
export function readPublishingProperties(value: unknown): PublishingProperty[] {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  const uses = new Set<string>();
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const v = item as Record<string, unknown>;
    if (!safeKey(v.key) || keys.has(v.key)) return [];
    keys.add(v.key);
    const use =
      ["title", "authors", "affiliations", "date", "keywords"].includes(
        String(v.use),
      ) && !uses.has(String(v.use))
        ? (v.use as PublishedUse)
        : "metadata";
    uses.add(use);
    return [
      {
        key: v.key,
        type: v.type === "list" || v.type === "date" ? v.type : "text",
        required: v.required === true,
        defaultValue: typeof v.defaultValue === "string" ? v.defaultValue : "",
        use,
      },
    ];
  });
}
function present(value: unknown): boolean {
  return Array.isArray(value)
    ? value.length > 0
    : value !== undefined && value !== null && value !== "";
}
function validDate(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validValue(field: PublishingProperty, value: unknown): boolean {
  return field.type === "list"
    ? Array.isArray(value) && value.every((item) => typeof item === "string")
    : field.type === "date"
      ? validDate(value)
      : typeof value === "string";
}
export function publishingPropertyProblem(
  properties: Record<string, unknown>,
  definitions: PublishingProperty[],
): string {
  for (const field of definitions) {
    const value = properties[field.key];
    const empty =
      !present(value) ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && !textList(value).length);
    if (empty) {
      if (field.required)
        return `Add a value for the required “${field.key}” property.`;
      continue;
    }
    if (field.required && !validValue(field, value))
      return `The “${field.key}” property must be ${field.type === "list" ? "a list of text values" : field.type === "date" ? "a valid date" : "text"}.`;
  }
  return "";
}
export function addPublishingProperties(
  properties: Record<string, unknown>,
  filename: string,
  definitions: PublishingProperty[],
): void {
  for (const field of definitions) {
    if (Object.hasOwn(properties, field.key)) continue;
    properties[field.key] =
      field.type === "list"
        ? textList(field.defaultValue.split(/\r?\n/))
        : field.defaultValue || (field.use === "title" ? filename : "");
  }
}
/** Only explicitly mapped fields may supply published metadata. */
export function mappedPublishingProperties(
  properties: Record<string, unknown>,
  definitions: PublishingProperty[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of definitions)
    if (field.use !== "metadata" && validValue(field, properties[field.key]))
      result[field.use] = properties[field.key];
  if (
    definitions.some((field) => field.use === "authors") &&
    Object.hasOwn(properties, "stratum_publish")
  )
    result.stratum_publish = properties.stratum_publish;
  return result;
}

/** Content requirements follow supported opening choices, not user-defined schemas. */
export function publicationProperties(
  options: PublishOptions,
  prefill?: AcademicDefaults,
): PublishingProperty[] {
  const fields: PublishingProperty[] = [];
  if (options.titleSource === "properties")
    fields.push({
      key: "title",
      type: "text",
      required: true,
      defaultValue: "",
      use: "title",
    });
  for (const [key, enabled] of [
    ["authors", options.showAuthors],
    ["affiliations", options.showAffiliations],
  ] as const)
    if (enabled)
      fields.push({
        key,
        type: "list",
        required: false,
        defaultValue: prefill?.[key].join("\n") ?? "",
        use: key,
      });
  if (options.showDate)
    fields.push({
      key: "date",
      type: "date",
      required: false,
      defaultValue: prefill?.date ?? "",
      use: "date",
    });
  // Keywords usually differ for each paper, so templates do not prefill them.
  if (options.showKeywords)
    fields.push({
      key: "keywords",
      type: "list",
      required: false,
      defaultValue: "",
      use: "keywords",
    });
  return fields;
}
