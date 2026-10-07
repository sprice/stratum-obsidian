import type { FormattedDocument } from "./citation-format";
import {
  citationDisplayEdits,
  escapeHtml,
  replaceRangeText,
  type DisplayEdit,
} from "./citation-display";
import { citationDocument } from "./citation-document";
import { citationFooter } from "./citation-footer";
import { parseSourceOccurrences } from "./source-occurrences";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

interface PreparedPublication {
  markdown: string;
  notes: { id: string; markdown: string }[];
  bibliography: string;
  heading: string;
}
const noteRef = (id: string) => `<a epub:type="noteref" href="#${id}">*</a>`;
/** Use the same CSL result and punctuation as Reading view, with semantic footnotes for Pandoc. */
export function preparePublication(
  text: string,
  formatted?: FormattedDocument,
): PreparedPublication {
  const model = formatted?.model ?? citationDocument(text, false);
  if (model.problems.length) throw new Error(model.problems.join("\n"));
  const edits: DisplayEdit[] = formatted
    ? citationDisplayEdits(text, "publish", formatted)
    : [];
  const notes: PreparedPublication["notes"] = [];
  // Each footnote is rendered separately, but Markdown reference definitions
  // have document scope. Carry them into each explanatory note's render.
  const definitionSource = stripPublishComments(text).replace(
    /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,
    "",
  );
  const definitions: string[] = [];
  const collectDefinitions = (node: MarkdownNode) => {
    if (node.type === "definition")
      definitions.push(
        definitionSource.slice(
          node.position?.start.offset,
          node.position?.end.offset,
        ),
      );
    node.children?.forEach(collectDefinitions);
  };
  collectDefinitions(parser.parse(definitionSource) as MarkdownNode);
  if (formatted)
    model.citations.forEach((citation, index) => {
      if (!citation.generatedNote) return;
      const edit = edits[index];
      const punctuation = /^[.,;:!?]+/.exec(text.slice(citation.to))?.[0] ?? "";
      const id = `stratum-publish-citation-${index}`;
      edit.html =
        (citation.draft.narrative ? formatted.narrativeAuthors[index] : "") +
        escapeHtml(punctuation) +
        noteRef(id);
      notes.push({ id, markdown: formatted.citations[index] });
    });
  for (const note of model.notes) {
    const id = `stratum-publish-note-${note.number}`;
    notes.push({
      id,
      markdown: [
        stripPublishComments(
          replaceRangeText(text, note.bodyFrom, note.bodyTo, edits).replace(
            /\n {4}/g,
            "\n",
          ),
        ),
        ...definitions,
      ].join("\n\n"),
    });
    edits.push({ from: note.from, to: note.to, html: "" });
    for (const reference of model.references.filter(
      (r) => r.identifier === note.identifier,
    ))
      edits.push({ from: reference.from, to: reference.to, html: noteRef(id) });
  }
  // Drop edits contained in removed definitions; their formatted content is in notes above.
  const outerEdits = edits.filter(
    (e) =>
      !model.notes.some(
        (n) =>
          e.from >= n.from &&
          e.to <= n.to &&
          !(e.from === n.from && e.to === n.to),
      ),
  );
  if (formatted)
    model.bibliographies.forEach((slot, index) => {
      outerEdits.push({
        ...slot,
        html: publishBibliography(formatted.bibliography, String(index)),
      });
    });
  const markdown = replaceRangeText(text, 0, text.length, outerEdits).replace(
    /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,
    "",
  );
  const footer = formatted
    ? citationFooter(text, formatted)
    : { bibliography: "", heading: "" };
  return {
    markdown: stripPublishComments(markdown),
    notes,
    bibliography: publishBibliography(footer.bibliography, "footer"),
    heading: footer.heading,
  };
}
/** Adapt citeproc's HTML to Pandoc's bibliography conventions, only for export. */
function publishBibliography(html: string, section: string): string {
  let entry = 0;
  return (
    html
      .replace(
        'class="csl-bib-body stratum-csl-hanging"',
        'class="csl-bib-body hanging-indent"',
      )
      // Pandoc emits a LaTeX bibliography list for csl-bib-body, but only
      // creates its required \bibitem entries for div IDs starting with ref-.
      .replace(
        /class="csl-entry"/g,
        () =>
          `id="ref-stratum-publish-${section}-${entry++}" class="csl-entry"`,
      )
  );
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  identifier?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
const parser = unified().use(remarkParse).use(remarkGfm);
function stripPublishComments(markdown: string): string {
  const protectedRanges: { from: number; to: number }[] = [];
  const walk = (node: MarkdownNode) => {
    if (node.type === "code" || node.type === "inlineCode")
      protectedRanges.push({
        from: node.position?.start.offset ?? 0,
        to: node.position?.end.offset ?? 0,
      });
    if (node.type === "html") {
      const tag = /^<(pre|code)\b[^>]*>/i.exec(node.value ?? "");
      if (tag) {
        const from = node.position?.start.offset ?? 0;
        const contentFrom = from + tag[0].length;
        const closing = new RegExp(`</${tag[1]}\\s*>`, "i").exec(
          markdown.slice(contentFrom),
        );
        protectedRanges.push({
          from,
          to: closing
            ? contentFrom + closing.index + closing[0].length
            : markdown.length,
        });
      }
    }
    node.children?.forEach(walk);
  };
  walk(parser.parse(markdown) as MarkdownNode);
  const edits: DisplayEdit[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    // Consume both comment forms in source order so a marker inside an HTML
    // comment cannot start an Obsidian comment that swallows later prose.
    const marker = /%%|<!--/g;
    marker.lastIndex = cursor;
    const match = marker.exec(markdown);
    if (!match) break;
    const from = match.index;
    const code = protectedRanges.find(
      (range) => from >= range.from && from < range.to,
    );
    if (code) {
      cursor = code.to;
      continue;
    }
    let slashes = 0;
    for (let index = from - 1; index >= 0 && markdown[index] === "\\"; index--)
      slashes++;
    if (slashes % 2) {
      cursor = from + match[0].length;
      continue;
    }
    const delimiter = match[0] === "<!--" ? "-->" : "%%";
    const close = markdown.indexOf(delimiter, from + match[0].length);
    const to = close < 0 ? markdown.length : close + delimiter.length;
    edits.push({ from, to, html: "" });
    cursor = to;
  }
  return replaceRangeText(markdown, 0, markdown.length, edits);
}
export function hasUnsupportedHtmlMedia(markdown: string): boolean {
  const walk = (node: MarkdownNode): boolean =>
    (node.type === "html" &&
      /<(?:img|iframe|video|audio|object|embed|script|style|link)\b/i.test(
        node.value ?? "",
      )) ||
    (node.children ?? []).some(walk);
  return walk(parser.parse(markdown) as MarkdownNode);
}
const imagePlaceholder = (name: string, alt: string) =>
  `<span class="stratum-publish-image" data-publish-image="${escapeHtml(name)}" data-publish-alt="${escapeHtml(alt)}"></span>`;
/** Resolve all image bytes before conversion and replace wiki links with their visible labels. */
export async function preparePublishLinks(
  markdown: string,
  image: (target: string) => Promise<string>,
): Promise<string> {
  const edits: DisplayEdit[] = [];
  const wiki = parseSourceOccurrences(markdown).filter(
    (o) => o.linkFormat === "wiki",
  );
  for (const link of wiki) {
    const raw = markdown.slice(link.from, link.to);
    const label =
      raw
        .replace(/^!?\[\[|\]\]$/g, "")
        .split(/(?<!\\)\|/)
        .slice(1)
        .join("|") || link.target;
    const html = raw.startsWith("!")
      ? imagePlaceholder(await image(link.target), label)
      : escapeHtml(label);
    edits.push({ from: link.from, to: link.to, html });
  }
  const tree = parser.parse(markdown) as MarkdownNode;
  const definitions = new Map<string, string>();
  const collect = (node: MarkdownNode) => {
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier, node.url);
    node.children?.forEach(collect);
  };
  collect(tree);
  const walk = async (node: MarkdownNode): Promise<void> => {
    if (node.type === "image" || node.type === "imageReference") {
      const from = node.position?.start.offset ?? 0,
        to = node.position?.end.offset ?? from;
      if (wiki.some((w) => from >= w.from && to <= w.to)) return;
      const target = node.url ?? definitions.get(node.identifier ?? "");
      if (!target) throw new Error("An image reference could not be resolved.");
      edits.push({
        from,
        to,
        html: imagePlaceholder(await image(target), node.alt ?? ""),
      });
    }
    for (const child of node.children ?? []) await walk(child);
  };
  await walk(tree);
  return replaceRangeText(markdown, 0, markdown.length, edits);
}
