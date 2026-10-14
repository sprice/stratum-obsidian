import { citationDocument } from "./citation-document";
import { escapeHtml } from "./citation-display";
import { escapeLatex } from "./publication-package";
import type { CslItem } from "./csl-data";
import type { FormattedDocument } from "./citation-format";
import type { CitationDraft } from "./citation-model";

export function aastexCitationKeys(text: string): string[] {
  const model = citationDocument(text, false);
  if (model.problems.length) throw new Error(model.problems.join("\n"));
  return [
    ...new Set(
      model.citations.flatMap((citation) =>
        citation.draft.items.map((item) => item.key),
      ),
    ),
  ];
}
/** Safe local BibTeX IDs keep Zotero identities and user citekeys out of TeX commands. */
export function aastexReferences(
  keys: string[],
  references: CslItem[],
): { references: CslItem[]; ids: Map<string, string> } {
  if (references.length !== keys.length)
    throw new Error("Citation data changed. Try publishing again.");
  return {
    ids: new Map(keys.map((key, index) => [key, `stratum${index}`])),
    references: references.map((reference, index) => ({
      ...reference,
      id: `stratum${index}`,
    })),
  };
}
export function aastexCitation(
  draft: CitationDraft,
  ids: Map<string, string>,
): string {
  const command = (item: CitationDraft["items"][number], name: string) => {
    const id = ids.get(item.key);
    if (!id) throw new Error(`Citation data is unavailable for @${item.key}.`);
    const suffix = [
      item.locator ? `${item.label} ${item.locator}` : "",
      item.suffix,
    ]
      .filter(Boolean)
      .join(", ");
    const optional =
      item.prefix || suffix
        ? `[${escapeLatex(item.prefix)}][${escapeLatex(suffix)}]`
        : "";
    return `\\${name}${optional}{${id}}`;
  };
  if (draft.items.length === 1) {
    const item = draft.items[0];
    return command(
      item,
      item.suppressAuthor ? "citeyearpar" : draft.narrative ? "citet" : "citep",
    );
  }
  if (
    draft.items.every(
      (item) =>
        !item.prefix && !item.suffix && !item.locator && !item.suppressAuthor,
    )
  )
    return `\\citep{${draft.items
      .map((item) => {
        const id = ids.get(item.key);
        if (!id)
          throw new Error(`Citation data is unavailable for @${item.key}.`);
        return id;
      })
      .join(",")}}`;
  return `(${draft.items.map((item) => command(item, item.suppressAuthor ? "citeyear" : "citealp")).join("; ")})`;
}
export function aastexFormattedDocument(
  text: string,
  ids: Map<string, string>,
): FormattedDocument {
  const model = citationDocument(text, false);
  if (model.problems.length) throw new Error(model.problems.join("\n"));
  return {
    model,
    citations: model.citations.map(
      (citation) =>
        `<span class="stratum-aastex-citation" data-tex="${escapeHtml(aastexCitation(citation.draft, ids))}">Citation</span>`,
    ),
    narrativeAuthors: model.citations.map(() => ""),
    bibliography: "",
    noteStyle: false,
  };
}
