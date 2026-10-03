import type { FormattedDocument } from "./citation-format";
export interface DisplayEdit {
  from: number;
  to: number;
  html: string;
}
export function noteId(path: string, number: number): string {
  return `stratum-note-${Array.from(path, (char) => char.codePointAt(0)!.toString(16)).join("-")}-${number}`;
}
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function citationDisplayEdits(
  text: string,
  path: string,
  result: FormattedDocument,
): DisplayEdit[] {
  return result.model.citations.map((citation, index) => {
    let { from, to } = citation;
    let html = result.citations[index];
    if (citation.generatedNote) {
      html = `<sup><a class="stratum-note-ref footnote-link" data-footnote-id="${escapeHtml(noteId(path, citation.noteIndex))}-citation-ref" id="${escapeHtml(noteId(path, citation.noteIndex))}-citation-ref" href="#${escapeHtml(noteId(path, citation.noteIndex))}" aria-label="Citation note ${citation.noteIndex}">${citation.noteIndex}</a></sup>`;
      // Match Pandoc's default placement after punctuation, without modifying Markdown.
      const punctuation = /^[.,;:!?]+/.exec(text.slice(to));
      if (punctuation) {
        html = escapeHtml(punctuation[0]) + html;
        to += punctuation[0].length;
      }
      if (citation.draft.narrative)
        html = result.narrativeAuthors[index] + html;
      else if (text[from - 1] === " ") from--;
    }
    if (result.noteStyle && !citation.generatedNote && citation.noteIndex > 0) {
      // Inside a user-written note, a parenthetical citation stays parenthetical.
      // The surrounding prose owns terminal punctuation, as in Pandoc citeproc.
      html = html.replace(/\.(<\/[^>]+>)*$/, "$1");
      if (!citation.draft.narrative) html = `(${html})`;
    }
    return { from, to, html };
  });
}
export function replaceRangeText(
  text: string,
  from: number,
  to: number,
  edits: DisplayEdit[],
): string {
  let output = text.slice(from, to);
  for (const edit of edits
    .filter((edit) => edit.from >= from && edit.to <= to)
    .sort((a, b) => b.from - a.from))
    output =
      output.slice(0, edit.from - from) +
      edit.html +
      output.slice(edit.to - from);
  return output;
}

const viewScopes = new WeakMap<Element, string>();
let nextScope = 0;
/** Separate fragment targets when the same paper is open in multiple panes. */
export function citationScope(el: HTMLElement, fallback: string): string {
  const root = el.closest(
    ".cm-editor, .markdown-preview-view, .markdown-embed-content",
  );
  if (!root) return fallback;
  let scope = viewScopes.get(root);
  if (!scope) {
    scope = `view-${++nextScope}`;
    viewScopes.set(root, scope);
  }
  return scope;
}
