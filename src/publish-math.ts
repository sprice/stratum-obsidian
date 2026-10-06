import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { escapeHtml } from "./citation-display";
interface Node {
  type: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
/**
 * Pandoc reads \( and \[ as math anywhere in HTML text, including inline code.
 * Split them in content that did not come from an equation placeholder.
 */
export function protectTexDelimiters(html: string): string {
  return html.replace(
    /(^|>)([^<]*)/g,
    (_match, end: string, text: string) =>
      end + text.replace(/\\(?=[[(])/g, "\\<span></span>"),
  );
}
/** Preserve TeX before Obsidian turns it into a MathJax rendering. */
export function preparePublishMath(text: string): {
  markdown: string;
  restore(html: string): string;
} {
  const protectedRanges: [number, number][] = [];
  const walk = (node: Node) => {
    if (["code", "inlineCode", "html", "image", "link"].includes(node.type)) {
      protectedRanges.push([
        node.position?.start.offset ?? 0,
        node.position?.end.offset ?? 0,
      ]);
      return;
    }
    node.children?.forEach(walk);
  };
  walk(unified().use(remarkParse).use(remarkGfm).parse(text));
  const escaped = (i: number) => {
    let count = 0;
    while (i > 0 && text[--i] === "\\") count++;
    return count % 2 === 1;
  };
  const math: { from: number; to: number; tex: string; display: boolean }[] =
    [];
  // Pre-order traversal yields non-overlapping ranges in source order.
  let range = 0;
  for (let i = 0; i < text.length; i++) {
    while (range < protectedRanges.length && protectedRanges[range][1] <= i)
      range++;
    if (range < protectedRanges.length && i >= protectedRanges[range][0]) {
      i = protectedRanges[range][1] - 1;
      continue;
    }
    if (escaped(i)) continue;
    // Obsidian renders only dollar delimiters; \[ and \( are Markdown escapes.
    const open = text.startsWith("$$", i) ? "$$" : text[i] === "$" ? "$" : "";
    if (!open || (open === "$" && /\s/.test(text[i + 1] ?? " "))) continue;
    const close = open;
    let end = i + open.length;
    while (end < text.length) {
      if (open === "$" && text[end] === "\n") break;
      if (
        text.startsWith(close, end) &&
        !escaped(end) &&
        (open !== "$" ||
          (!/\s/.test(text[end - 1]) && !/\d/.test(text[end + 1] ?? "")))
      )
        break;
      end++;
    }
    if (!text.startsWith(close, end)) {
      if (open === "$$")
        throw new Error(
          `An equation near line ${text.slice(0, i).split("\n").length} has no closing delimiter.`,
        );
      continue;
    }
    const tex = text.slice(i + open.length, end).trim();
    if (
      // Best-effort guard: also block name construction and ^^ character codes that reassemble commands.
      /\\(?:input|include|write|openout|read|openin|catcode|usepackage|documentclass|special|href|url|csname|scantokens)\b|\^\^/.test(
        tex,
      )
    )
      throw new Error(
        `An equation near line ${text.slice(0, i).split("\n").length} contains a command unsupported for publishing. Use mathematical notation only.`,
      );
    math.push({
      from: i,
      to: end + close.length,
      tex,
      display: open === "$$",
    });
    i = end + close.length - 1;
  }
  let markdown = text;
  for (let index = math.length - 1; index >= 0; index--) {
    const item = math[index];
    const placeholder = `<span class="stratum-publish-math" data-equation="${index}"></span>`;
    markdown =
      markdown.slice(0, item.from) + placeholder + markdown.slice(item.to);
  }
  return {
    markdown,
    restore(html) {
      html = protectTexDelimiters(html);
      for (let index = 0; index < math.length; index++) {
        const item = math[index],
          delimiters = item.display ? ["\\[", "\\]"] : ["\\(", "\\)"];
        const pattern = new RegExp(
          `<span\\b(?=[^>]*class="stratum-publish-math")(?=[^>]*data-equation="${index}")[^>]*>\\s*</span>`,
          "g",
        );
        if (!pattern.test(html))
          throw new Error(
            `Equation ${index + 1} could not be prepared. Use standard inline or display math delimiters.`,
          );
        html = html.replace(
          pattern,
          () =>
            `<span class="math ${item.display ? "display" : "inline"}">${delimiters[0]}${escapeHtml(item.tex)}${delimiters[1]}</span>`,
        );
      }
      return html;
    },
  };
}
