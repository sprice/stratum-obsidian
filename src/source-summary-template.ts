import { validateNotesTemplate } from "./literature-note-template";
import type { LiteratureNoteEntry } from "./library-search-modal";

export const PREVIOUS_SOURCE_SUMMARY_TEMPLATE = `### {{source_link}}

{{authors}}
{{year}}

**Why it matters:**

**How I might use it:**

**Questions:**`;

export const DEFAULT_SOURCE_SUMMARY_TEMPLATE = `### {{title_with_link}}
{{authors}} · {{year}}

**Main argument:**

**Evidence and limits:**

**Connection to my work:**`;

export const DIVIDED_SOURCE_SUMMARY_TEMPLATE = `---\n\n${DEFAULT_SOURCE_SUMMARY_TEMPLATE.replaceAll("{{title_with_link}}", "{{source_link}}")}\n\n---`;

export const SOURCE_SUMMARY_VARIABLES = {
  title_with_link: "Paper title linked to its literature note",
  title: "Paper title",
  authors: "Authors",
  year: "Publication year",
} as const;

export function validateSourceSummaryTemplate(template: string): string | null {
  if (!template.trim()) return "Enter a template before saving.";
  if (template.length > 100000 || template.includes("\0"))
    return "Use a template under 100,000 characters without null characters.";
  if (/\{\{\{|\}\}\}/.test(template))
    return "Malformed variable. Use exactly two opening and closing braces.";
  const boundaryError = validateNotesTemplate(template);
  if (boundaryError) return boundaryError;
  let error: string | null = null;
  const remaining = template.replace(/\{\{([^{}]*)\}\}/g, (_, name: string) => {
    if (!Object.hasOwn(SOURCE_SUMMARY_VARIABLES, name)) {
      error ??=
        name === "author"
          ? "Unknown variable {{author}}. Use {{authors}}."
          : `Unknown variable {{${name}}}.`;
    }
    return "";
  });
  if (error) return error;
  if (/\{\{|\}\}/.test(remaining))
    return "Malformed variable. Use two opening and closing braces, for example {{title}}.";
  return null;
}

export function escapeSummaryText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]<>#|]/g, "\\$&");
}

export function renderSourceSummary(
  template: string,
  entry: LiteratureNoteEntry,
  sourceLink: string,
): string {
  const error = validateSourceSummaryTemplate(template);
  if (error) throw new Error(error);
  const values: Record<string, string> = {
    title_with_link: sourceLink,
    title: escapeSummaryText(entry.title),
    authors: entry.authors.map(escapeSummaryText).join(", "),
    year: escapeSummaryText(entry.year ?? ""),
  };
  // Substitute once: source metadata is never interpreted as template syntax.
  const renderedTemplate =
    template === DEFAULT_SOURCE_SUMMARY_TEMPLATE
      ? template.replace(
          "{{authors}} · {{year}}",
          [values.authors, values.year].filter(Boolean).join(" · "),
        )
      : template;
  return renderedTemplate.replace(
    /\{\{([^{}]*)\}\}/g,
    (_, name: string) => values[name],
  );
}
