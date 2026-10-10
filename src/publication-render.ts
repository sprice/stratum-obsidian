import type { App } from "obsidian";
import { aastexProblems } from "./publication-package";
import {
  aastexCitationKeys,
  aastexFormattedDocument,
  aastexReferences,
} from "./publication-citations";
import { renderPublication } from "./publish-render";
import type { CitationService } from "./citation-service";
import type { NotePublishPreferences } from "./publish-options";

export async function renderAastexPublication(
  app: App,
  service: CitationService,
  text: string,
  path: string,
  title: string,
  preferences: NotePublishPreferences,
  signal: AbortSignal,
) {
  const { manuscript, errors } = aastexProblems(
    text,
    preferences.pdf.titleSource,
    "pdf",
  );
  if (errors.length) throw new Error(errors.join("\n"));
  const keys = aastexCitationKeys(
    manuscript.body + "\n\n" + manuscript.abstract,
  );
  const resolved = await service.diagnose(keys);
  for (const source of resolved)
    if (source.problem || !source.reference)
      throw new Error(
        `Citation data is unavailable or ambiguous for @${source.key}. Review Citations before publishing.`,
      );
  const { ids, references } = aastexReferences(
    keys,
    resolved.map((source) => source.reference!),
  );
  const bodyPreferences = {
    ...preferences,
    documentType: "general" as const,
    pdf: { ...preferences.pdf, showAbstract: false },
  };
  const body = await renderPublication(
    app,
    manuscript.body,
    path,
    title,
    aastexFormattedDocument(manuscript.body, ids),
    signal,
    bodyPreferences,
    [],
  );
  const abstract = await renderPublication(
    app,
    manuscript.abstract,
    path,
    title,
    aastexFormattedDocument(manuscript.abstract, ids),
    signal,
    bodyPreferences,
    [],
    body.assets.length,
  );
  // With the title extracted, a note's level-two headings become paper sections.
  const bodyHtml = /<h1\b/i.test(body.html)
    ? body.html
    : body.html.replace(
        /(<\/?h)([2-6])(\b)/gi,
        (_match, prefix: string, level: string, boundary: string) =>
          `${prefix}${Number(level) - 1}${boundary}`,
      );
  return {
    html: bodyHtml,
    assets: [...body.assets, ...abstract.assets],
    aastex: { manuscript, abstractHtml: abstract.html, references },
  };
}
