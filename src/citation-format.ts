import CSL, { type Citation } from "citeproc";
import { citationDocument, type CitationDocument } from "./citation-document";
import type { CslItem } from "./csl-data";
export interface FormattedDocument {
  model: CitationDocument;
  citations: string[];
  narrativeAuthors: string[];
  bibliography: string;
  noteStyle: boolean;
}
const labels = {
  "p.": "page",
  "pp.": "page",
  "chap.": "chapter",
  "sec.": "section",
  "para.": "paragraph",
  "vol.": "volume",
};
export function formatCitationDocument(
  text: string,
  style: string,
  language: string,
  locales: Record<string, string>,
  references: Map<string, CslItem>,
): FormattedDocument {
  return createCitationFormatter(style, language, locales, references)(text);
}
export function createCitationFormatter(
  style: string,
  language: string,
  locales: Record<string, string>,
  references: Map<string, CslItem>,
): (text: string) => FormattedDocument {
  // Numeric CSL styles often omit author-in-text formatting. Supply citeproc's
  // documented intext extension so narrative citations retain their author.
  if (!/<intext[ >]/.test(style)) {
    const citationTag = /<citation\b[^>]*>/.exec(style)?.[0] ?? "";
    const etAl = [
      "et-al-min",
      "et-al-use-first",
      "et-al-subsequent-min",
      "et-al-subsequent-use-first",
    ]
      .map((name) => {
        const value = new RegExp(`${name}=["'](\\d+)["']`).exec(
          citationTag,
        )?.[1];
        return value ? ` ${name}="${value}"` : "";
      })
      .join("");
    style = style.replace(
      /<\/style>\s*$/,
      `<intext><layout><names variable="author"><name form="short" and="text" delimiter=", "${etAl}/><substitute><names variable="editor"/><text variable="title" form="short"/></substitute></names></layout></intext></style>`,
    );
  }
  const byIdentity = new Map(
    [...references.values()].map((item) => [item.id, item]),
  );
  const resolve = (key: string) => {
    const item = references.get(key);
    if (!item)
      throw new Error(
        `Missing citation data for @${key}. Refresh citation data or resolve this source in Sources.`,
      );
    return item.id;
  };
  const engine = new CSL.Engine(
    {
      retrieveLocale: (lang) => locales[lang] || false,
      retrieveItem: (id) => {
        const item = byIdentity.get(id);
        if (!item)
          throw new Error(
            `Missing citation data for @${id}. Refresh citation data or resolve this source in Sources.`,
          );
        return JSON.parse(JSON.stringify({ ...item, id })) as CslItem;
      },
    },
    style,
    language,
  );
  engine.setOutputFormat("html");
  const noteStyle = engine.opt.xclass === "note";
  let last: { signature: string; value: FormattedDocument } | null = null;
  return (text: string) => {
    const model = citationDocument(text, noteStyle);
    const signature = JSON.stringify(
      model.citations.map((c) => [c.draft, c.noteIndex]),
    );
    if (last?.signature === signature && !model.problems.length)
      return { ...last.value, model };
    if (model.problems.length) throw new Error(model.problems[0]);
    const clusters: Citation[] = [];
    model.citations.forEach((citation, index) => {
      const citationID = `stratum-${index}`;
      const properties: { noteIndex: number; mode?: string; infix?: string } = {
        noteIndex: citation.noteIndex,
      };
      // Narrative form is an author-in-text request, not a style-specific string.
      if (citation.draft.narrative && !noteStyle) {
        properties.mode = "composite";
        properties.infix = "";
      }
      if (citation.generatedNote && citation.draft.narrative) {
        clusters.push({
          citationID: `author-${index}`,
          properties: { noteIndex: 0, mode: "author-only" },
          citationItems: citation.draft.items.map((item) => ({
            id: resolve(item.key),
          })),
        });
      }
      clusters.push({
        citationID,
        properties,
        citationItems: citation.draft.items.map((item) => ({
          id: resolve(item.key),
          ...(item.locator
            ? { locator: item.locator, label: labels[item.label] }
            : {}),
          ...(item.prefix ? { prefix: item.prefix + " " } : {}),
          ...(item.suffix ? { suffix: ", " + item.suffix } : {}),
          ...(item.suppressAuthor ||
          (citation.generatedNote && citation.draft.narrative)
            ? { "suppress-author": true }
            : {}),
        })),
      });
    });
    const rendered = new Map(
      engine
        .rebuildProcessorState(clusters, "html", [])
        .map(([id, , html]) => [id, html]),
    );
    const citations = model.citations.map(
      (_, i) => rendered.get(`stratum-${i}`) ?? "",
    );
    const narrativeAuthors = model.citations.map(
      (_, i) => rendered.get(`author-${i}`) ?? "",
    );
    const bibliography = engine.makeBibliography();
    if (bibliography && bibliography[0].bibliography_errors.length)
      throw new Error(
        "Some references could not be formatted. Check source metadata.",
      );
    const value = {
      model,
      citations,
      narrativeAuthors,
      bibliography:
        bibliography && bibliography[1].length
          ? bibliography[0].bibstart.replace(
              'class="csl-bib-body"',
              `class="csl-bib-body${bibliography[0].hangingindent ? " stratum-csl-hanging" : ""}"`,
            ) +
            bibliography[1].join("") +
            bibliography[0].bibend
          : "",
      noteStyle,
    };
    last = { signature, value };
    return value;
  };
}
