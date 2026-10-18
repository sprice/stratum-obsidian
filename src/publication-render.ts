import { journalProblems, type JournalProfile } from "./journal-profiles";
import type { App } from "obsidian";
import {
  publicationCitationKeys,
  publicationReferences,
  journalFormattedDocument,
} from "./publication-citations";
import { renderPublication } from "./publish-render";
import type { CitationService } from "./citation-service";
import type { NotePublishPreferences } from "./publish-options";

/** Prepared journal content shared by rendering, orchestration and PDF conversion. */
export type JournalPublication = Awaited<
  ReturnType<typeof renderJournalPublication>
>["journal"];

export async function renderJournalPublication(
  app: App,
  service: CitationService,
  text: string,
  path: string,
  title: string,
  preferences: NotePublishPreferences,
  signal: AbortSignal,
  journal: JournalProfile,
) {
  if (!journal?.installation)
    throw new Error(
      "Install this template from the registry before publishing.",
    );
  const { manuscript, issues } = journalProblems(
    text,
    preferences.pdf.titleSource,
    journal,
    preferences.pdf.showKeywords,
  );
  const errors = issues.filter((issue) => issue.blocking);
  if (errors.length)
    throw new Error(errors.map((issue) => issue.message).join("\n"));
  const keys = publicationCitationKeys(
    manuscript.body + "\n\n" + manuscript.abstract,
  );
  const resolved = await service.diagnose(keys);
  for (const source of resolved)
    if (source.problem || !source.reference)
      throw new Error(
        `Citation data is unavailable or ambiguous for @${source.key}. Review Citations before publishing.`,
      );
  const { ids, references } = publicationReferences(
    keys,
    resolved.map((source) => source.reference!),
  );
  const bodyPreferences = {
    ...preferences,
    documentType: "general" as const,
    pdf: { ...preferences.pdf, showAbstract: false },
  };
  const renderSection = (markdown: string, assetOffset = 0) =>
    renderPublication(
      app,
      markdown,
      path,
      title,
      journalFormattedDocument(
        markdown,
        ids,
        references,
        journal.citations === "numeric",
      ),
      signal,
      bodyPreferences,
      [],
      assetOffset,
    );
  const body = await renderSection(manuscript.body);
  // Keep image names distinct across the two rendered sections.
  const abstract = await renderSection(manuscript.abstract, body.assets.length);
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
    journal: {
      manuscript,
      journal,
      abstractHtml: abstract.html,
      references,
    },
  };
}
