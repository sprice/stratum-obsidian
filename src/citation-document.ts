import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { citationAt, type CitationDraft } from "./citation-model";
import { parseSourceOccurrences, sourceProse } from "./source-occurrences";
interface Node {
  type: string;
  identifier?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
export interface DocumentCitation {
  from: number;
  to: number;
  draft: CitationDraft;
  noteIndex: number;
  generatedNote: boolean;
}
export interface DocumentFootnote {
  identifier: string;
  number: number;
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
}
export interface CitationDocument {
  citations: DocumentCitation[];
  notes: DocumentFootnote[];
  references: {
    from: number;
    to: number;
    number: number;
    identifier: string;
  }[];
  bibliographies: { from: number; to: number }[];
  problems: string[];
}
const parser = unified().use(remarkParse).use(remarkGfm);
/** Resolve footnote references before formatting: definition order is not reading order. */
export function citationDocument(
  text: string,
  noteStyle: boolean,
): CitationDocument {
  const prose = sourceProse(text);
  const tree = parser.parse(text) as Node;
  const result: CitationDocument = {
    citations: [],
    notes: [],
    references: [],
    problems: [],
    bibliographies: [],
  };
  const globalOccurrences = new Set(
    parseSourceOccurrences(text)
      .filter((o) => o.kind === "citation")
      .map((o) => o.from),
  );
  const definitions = new Map<string, Node>();
  const footnotes = new Map<string, number>();
  let nextNote = 0;
  const start = (node: Node) => node.position?.start.offset ?? 0;
  const end = (node: Node) => node.position?.end.offset ?? 0;
  const collect = (node: Node) => {
    if (node.type !== "root" && !prose.slice(start(node), end(node)).trim())
      return;
    if (
      node.type === "html" &&
      /^<div\s+id=["']refs["']\s*>\s*<\/div>\s*$/.test(
        text.slice(start(node), end(node)),
      )
    )
      result.bibliographies.push({ from: start(node), to: end(node) });
    if (node.type === "footnoteDefinition" && node.identifier) {
      if (definitions.has(node.identifier))
        result.problems.push("Duplicate footnote definition.");
      definitions.set(node.identifier, node);
    }
    node.children?.forEach(collect);
  };
  collect(tree);
  // Obsidian supports inline footnotes, but remark-gfm does not model them.
  // Refuse publication formatting instead of hiding native notes and silently
  // dropping their content or assigning their references to the wrong note.
  if (/(^|[^\\])(?:\\\\)*\^\[/.test(prose))
    result.problems.push(
      "Inline explanatory footnotes are not supported for citation formatting. Use a named [^note] reference and a [^note]: definition instead.",
    );
  const visit = (node: Node, noteIndex = 0) => {
    if (
      node.type === "footnoteDefinition" ||
      !prose.slice(start(node), end(node)).trim()
    )
      return;
    if (node.type === "footnoteReference" && node.identifier) {
      if (noteIndex) {
        result.problems.push(
          "Nested explanatory footnotes are not supported. Move the note reference into the main text.",
        );
        return;
      }
      const definition = definitions.get(node.identifier);
      if (!definition) {
        result.problems.push("Missing footnote definition.");
        return;
      }
      let number = footnotes.get(node.identifier);
      const first = number === undefined;
      if (first) {
        number = ++nextNote;
        footnotes.set(node.identifier, number);
      }
      result.references.push({
        from: start(node),
        to: end(node),
        number: number!,
        identifier: node.identifier,
      });
      if (first) {
        result.notes.push({
          identifier: node.identifier,
          number: number!,
          from: start(definition),
          to: end(definition),
          bodyFrom: definition.children?.length
            ? start(definition.children[0])
            : end(definition),
          bodyTo: end(definition),
        });
        definition.children?.forEach((child) => visit(child, number));
      }
      return;
    }
    if (["paragraph", "heading", "tableCell"].includes(node.type)) {
      const from = start(node),
        raw = text.slice(from, end(node));
      const events: (
        | {
            kind: "citation";
            from: number;
            to: number;
            draft: CitationDraft | null;
          }
        | { kind: "note"; from: number; node: Node }
      )[] = [];
      let until = -1;
      for (const occurrence of parseSourceOccurrences(raw)) {
        if (
          occurrence.kind !== "citation" ||
          occurrence.from < until ||
          !globalOccurrences.has(from + occurrence.from)
        )
          continue;
        const match = citationAt(raw, occurrence.from);
        if (!match) continue;
        until = match.to;
        events.push({
          kind: "citation",
          ...match,
          from: from + match.from,
          to: from + match.to,
        });
      }
      const refs = (child: Node) => {
        if (
          child.type === "footnoteReference" &&
          prose.slice(start(child), end(child)).trim()
        )
          events.push({ kind: "note", from: start(child), node: child });
        else child.children?.forEach(refs);
      };
      node.children?.forEach(refs);
      events.sort((a, b) => a.from - b.from);
      for (const event of events) {
        if (event.kind === "note") {
          visit(event.node, noteIndex);
          continue;
        }
        if (!event.draft) {
          result.problems.push(
            `Unsupported citation near character ${event.from + 1}.`,
          );
          continue;
        }
        const generatedNote = noteStyle && noteIndex === 0;
        result.citations.push({
          from: event.from,
          to: event.to,
          draft: event.draft,
          noteIndex: generatedNote ? ++nextNote : noteIndex,
          generatedNote,
        });
      }
      return;
    }
    if (!["code", "inlineCode", "html", "link", "image"].includes(node.type))
      node.children?.forEach((child) => visit(child, noteIndex));
  };
  visit(tree);
  return result;
}
