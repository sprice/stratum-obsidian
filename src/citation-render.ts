import { MarkdownRenderer, sanitizeHTMLToDom, type Component } from "obsidian";
import type { CitationService } from "./citation-service";
import type { FormattedDocument } from "./citation-format";
import {
  citationDisplayEdits,
  noteId,
  replaceRangeText,
} from "./citation-display";
/** Render generated output through Obsidian's sanitizer; source data is untrusted. */
export function renderCsl(el: HTMLElement, html: string): void {
  el.appendChild(sanitizeHTMLToDom(html));
}
export async function renderDocumentNotes(
  el: HTMLElement,
  text: string,
  path: string,
  result: FormattedDocument,
  service: CitationService,
  owner: Component,
  scope = path,
): Promise<void> {
  let active = true;
  owner.register(() => {
    active = false;
  });
  const notes = [
    ...result.model.notes.map((note) => ({ number: note.number, note })),
    ...result.model.citations
      .filter((c) => c.generatedNote)
      .map((c) => ({ number: c.noteIndex, citation: c })),
  ].sort((a, b) => a.number - b.number);
  if (!notes.length) return;
  el.createEl("h3", { text: "Notes" });
  const list = el.createEl("ol", { cls: "stratum-citation-notes" });
  const edits = citationDisplayEdits(text, scope, result);
  for (const item of notes) {
    if (!active) return;
    const li = list.createEl("li");
    li.id = noteId(scope, item.number);
    li.value = item.number;
    if ("citation" in item)
      renderCsl(
        li,
        result.citations[result.model.citations.indexOf(item.citation)],
      );
    else {
      const source = replaceRangeText(
        text,
        item.note.bodyFrom,
        item.note.bodyTo,
        edits,
      ).replace(/\n {4}/g, "\n");
      await MarkdownRenderer.render(
        service.plugin.app,
        source,
        li,
        path,
        owner,
      );
    }
    const citations = result.model.citations.filter(
      (citation) => citation.noteIndex === item.number,
    );
    if (citations.length) {
      const button = li.createEl("button", {
        text: "Open in reader",
        cls: "stratum-citation-evidence",
      });
      button.type = "button";
      button.addEventListener("click", () => {
        void import("./citation-evidence").then(({ openCitationEvidence }) =>
          openCitationEvidence(
            service.plugin,
            citations.flatMap((citation) =>
              citation.draft.items.map((item) => item.key),
            ),
            path,
            text,
          ),
        );
      });
    }
  }
}
