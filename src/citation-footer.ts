import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { sourceProse } from "./source-occurrences";
import type { FormattedDocument } from "./citation-format";

const parser = unified().use(remarkParse).use(remarkGfm);
const cached = new WeakMap<
  FormattedDocument,
  {
    text: string;
    footer: { line: number; bibliography: string; heading: string };
  }
>();
/** Locate the last rendered block, not a trailing footnote or link definition. */
export function citationFooter(text: string, result: FormattedDocument) {
  const previous = cached.get(result);
  if (previous?.text === text) return previous.footer;
  const footer = {
    line: readingFooterLine(text),
    // Existing explicit placement remains supported, without a second list.
    bibliography:
      result.model.citations.length && !result.model.bibliographies.length
        ? result.bibliography
        : "",
    // CSL formats entries; it does not supply a bibliography section heading.
    heading: result.noteStyle ? "Bibliography" : "References",
  };
  cached.set(result, { text, footer });
  return footer;
}

export function readingFooterLine(text: string): number {
  const prose = sourceProse(text);
  const blocks = parser.parse(text).children.filter((node) => {
    if (node.type === "footnoteDefinition" || node.type === "definition")
      return false;
    if (node.type === "code") return true;
    const from = node.position?.start.offset ?? 0;
    const to = node.position?.end.offset ?? 0;
    return Boolean(prose.slice(from, to).trim());
  });
  return (blocks.at(-1)?.position?.end.line ?? 1) - 1;
}
