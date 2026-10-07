import { parseYaml } from "obsidian";
import { escapeHtml } from "./citation-display";
import { textList, type AcademicDefaults } from "./publish-options";

interface AcademicMetadata {
  title: string;
  authors: string[];
  affiliations: string[];
  date: string;
  keywords: string[];
  duplicateTitle: boolean;
  bothAuthors: boolean;
}
export function publicationFrontmatter(text: string): {
  properties: Record<string, unknown>;
  body: string;
} {
  const match =
    /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  if (!match) return { properties: {}, body: text };
  let value: unknown;
  try {
    value = parseYaml(match[1]);
  } catch {
    throw new Error(
      "Publishing properties could not be read. Correct the note's YAML properties and try again.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Publishing properties must be a YAML mapping.");
  return {
    properties: value as Record<string, unknown>,
    body: text.slice(match[0].length),
  };
}
export function academicMetadata(
  properties: Record<string, unknown>,
  body = "",
): AcademicMetadata {
  const title =
    typeof properties.title === "string" ? properties.title.trim() : "";
  const firstHeading = /^\s*#{1,6}\s+(.+?)(?:\s+#+)?\s*(?:\r?\n|$)/
    .exec(body)?.[1]
    ?.trim();
  return {
    title,
    authors: textList(properties.authors ?? properties.author),
    affiliations: textList(properties.affiliations),
    keywords: textList(properties.keywords),
    date:
      typeof properties.date === "string"
        ? properties.date
        : properties.date instanceof Date
          ? properties.date.toISOString().slice(0, 10)
          : "",
    duplicateTitle:
      !!title &&
      firstHeading?.toLocaleLowerCase() === title.toLocaleLowerCase(),
    bothAuthors:
      Object.hasOwn(properties, "authors") &&
      Object.hasOwn(properties, "author"),
  };
}
/** Only absent properties are initialized. Obsidian owns frontmatter serialization. */
export function addAcademicProperties(
  properties: Record<string, unknown>,
  filename: string,
  defaults: AcademicDefaults,
): void {
  if (!Object.hasOwn(properties, "title")) properties.title = filename;
  if (
    !Object.hasOwn(properties, "authors") &&
    !Object.hasOwn(properties, "author") &&
    defaults.authors.length
  )
    properties.authors = [...defaults.authors];
  for (const key of ["affiliations", "keywords"] as const)
    if (!Object.hasOwn(properties, key) && defaults[key].length)
      properties[key] = [...defaults[key]];
  if (!Object.hasOwn(properties, "date") && defaults.date)
    properties.date = defaults.date;
}
export function academicOpening(
  metadata: AcademicMetadata,
  requireTitle = true,
): string {
  if (requireTitle && !metadata.title)
    throw new Error(
      "Add a nonempty title property before publishing an academic paper.",
    );
  const block = (cls: string, text: string) =>
    `<div class="stratum-publish-${cls}"><p>${escapeHtml(text)}</p></div>`;
  return (
    (metadata.title ? block("title", metadata.title) : "") +
    (metadata.authors.length
      ? block("authors", metadata.authors.join(", "))
      : "") +
    metadata.affiliations.map((value) => block("affiliation", value)).join("") +
    (metadata.date ? block("date", metadata.date) : "")
  );
}
