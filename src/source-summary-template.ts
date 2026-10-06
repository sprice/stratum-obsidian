import { unified } from "unified";
import remarkParse from "remark-parse";
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

const markdown = unified().use(remarkParse);

/** Only top-level thematic breaks count; properties, code, and quotes do not. */
function horizontalRules(
  text: string,
  document = true,
): { from: number; to: number }[] {
  const properties =
    document &&
    /^(?:\uFEFF)?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/.exec(
      text,
    );
  const prose = properties
    ? properties[0].replace(/[^\r\n]/g, " ") + text.slice(properties[0].length)
    : text;
  return markdown.parse(prose).children.flatMap((node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    return node.type === "thematicBreak" &&
      from !== undefined &&
      to !== undefined
      ? [{ from, to }]
      : [];
  });
}

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

export function summaryInsertion(
  text: string,
  offset: number,
  summary: string,
) {
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  // Remove surrounding blank lines, not Markdown-significant indentation.
  let content = summary
    .replace(/\r\n/g, "\n")
    .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "");
  const existingRules = horizontalRules(text);
  const templateRules = horizontalRules(content, false);
  const first = templateRules.find(
    (rule) => !content.slice(0, rule.from).trim(),
  );
  const last = templateRules.find((rule) => !content.slice(rule.to).trim());
  const sharedTop = existingRules.some(
    (rule) => rule.to <= offset && !text.slice(rule.to, offset).trim(),
  );
  const sharedBottom = existingRules.some(
    (rule) => rule.from >= offset && !text.slice(offset, rule.from).trim(),
  );
  // Remove only rules belonging to this insertion; never rewrite existing text.
  if (sharedBottom && last)
    content = content.slice(0, last.from).replace(/(?:\n[ \t]*)+$/, "");
  if (!sharedBottom && !last) content += "\n\n---";
  if (sharedTop && first)
    content = content.slice(first.to).replace(/^(?:[ \t]*\n)+/, "");
  if (!sharedTop && !first)
    content = (/^#{1,6} /.test(content) ? "---\n" : "---\n\n") + content;
  // A Markdown divider at the beginning of a file would open YAML properties.
  const prefix =
    !before && /^---(?:\n|$)/.test(content)
      ? "\n"
      : !before || before.endsWith("\n\n")
        ? ""
        : before.endsWith("\n")
          ? "\n"
          : "\n\n";
  const suffix = after.startsWith("\n\n")
    ? ""
    : after.startsWith("\n")
      ? "\n"
      : "\n\n";
  const insert = prefix + content + suffix;
  const promptLabel = content.includes("**Main argument:**")
    ? "**Main argument:**"
    : "**Why it matters:**";
  const prompt = content.indexOf(promptLabel);
  const endingRule = horizontalRules(content, false).find(
    (rule) => !content.slice(rule.to).trim(),
  );
  const writingEnd = endingRule
    ? content.slice(0, endingRule.from).replace(/(?:\n[ \t]*)+$/, "").length
    : content.length;
  return {
    insert,
    cursor:
      offset +
      prefix.length +
      (prompt < 0 ? writingEnd : prompt + promptLabel.length),
  };
}
