import { citationDocument } from "./citation-document";
import { escapeHtml } from "./citation-display";
import { escapeLatex } from "./publication-manuscript";
import type { CslItem } from "./csl-data";
import type { FormattedDocument } from "./citation-format";
import type { CitationDraft } from "./citation-model";

export function publicationCitationKeys(text: string): string[] {
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
export function publicationReferences(
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
export function publicationCitation(
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
export function publicationFormattedDocument(
  text: string,
  ids: Map<string, string>,
): FormattedDocument {
  const model = citationDocument(text, false);
  if (model.problems.length) throw new Error(model.problems.join("\n"));
  return {
    model,
    citations: model.citations.map(
      (citation) =>
        `<span class="stratum-publication-citation" data-tex="${escapeHtml(publicationCitation(citation.draft, ids))}">Citation</span>`,
    ),
    narrativeAuthors: model.citations.map(() => ""),
    bibliography: "",
    noteStyle: false,
  };
}

/** Numeric profiles cannot rely on author labels in publisher-specific BST files. */
export function journalFormattedDocument(
  text: string,
  ids: Map<string, string>,
  references: CslItem[],
  numeric: boolean,
): FormattedDocument {
  if (!numeric) {
    const formatted = publicationFormattedDocument(text, ids);
    formatted.citations = formatted.model.citations.map(({ draft }) => {
      const tex =
        draft.narrative && draft.items.length > 1
          ? draft.items
              .map((item) =>
                publicationCitation({ ...draft, items: [item] }, ids),
              )
              .join("; ")
          : publicationCitation(draft, ids);
      return `<span class="stratum-publication-citation" data-tex="${escapeHtml(tex)}">Citation</span>`;
    });
    return formatted;
  }
  const model = citationDocument(text, false);
  if (model.problems.length) throw new Error(model.problems.join("\n"));
  const authorName = (key: string) => {
    const reference = references.find((r) => r.id === ids.get(key));
    const authors = reference?.author;
    if (!Array.isArray(authors) || !authors.length)
      throw new Error(`Narrative author data is unavailable for @${key}.`);
    const names = authors.map((a: Record<string, unknown>) =>
      typeof a.literal === "string"
        ? a.literal
        : typeof a.family === "string"
          ? [a["non-dropping-particle"], a.family]
              .filter((part) => typeof part === "string" && part)
              .join(" ")
          : "",
    );
    if (names.some((name) => !name))
      throw new Error(`Narrative author data is unavailable for @${key}.`);
    return escapeLatex(
      names.length > 2 ? names[0] + " et al." : names.join(" and "),
    );
  };
  return {
    model,
    narrativeAuthors: model.citations.map(() => ""),
    bibliography: "",
    noteStyle: false,
    citations: model.citations.map(({ draft }) => {
      if (draft.items.some((item) => item.suppressAuthor))
        throw new Error(
          "Suppress-author citations require an author-year journal profile.",
        );
      const simple =
        !draft.narrative &&
        draft.items.every(
          (item) => !item.prefix && !item.suffix && !item.locator,
        );
      const command = (item: CitationDraft["items"][number]) => {
        const id = ids.get(item.key);
        if (!id)
          throw new Error(`Citation data is unavailable for @${item.key}.`);
        const suffix = [
          item.locator ? `${item.label} ${item.locator}` : "",
          item.suffix,
        ]
          .filter(Boolean)
          .join(", ");
        // Native numeric citations work with both LaTeX and natbib.
        // Put the prefix in prose; the single optional argument is the locator/suffix.
        return (
          (draft.narrative ? authorName(item.key) + "~" : "") +
          (item.prefix ? escapeLatex(item.prefix) + "~" : "") +
          `\\cite${suffix ? `[{${escapeLatex(suffix)}}]` : ""}{${id}}`
        );
      };
      const tex = simple
        ? `\\cite{${draft.items
            .map((item) => {
              const id = ids.get(item.key);
              if (!id)
                throw new Error(
                  `Citation data is unavailable for @${item.key}.`,
                );
              return id;
            })
            .join(",")}}`
        : draft.items.map(command).join("; ");
      return `<span class="stratum-publication-citation" data-tex="${escapeHtml(tex)}">Citation</span>`;
    }),
  };
}
