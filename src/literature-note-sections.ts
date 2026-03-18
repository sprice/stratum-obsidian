import type { ZoteroItemDetail } from "./backend-client";
import { preprocessZoteroNoteHtml } from "./literature-note-content-html";
import {
  getColorCategory,
  getHighlightGroupCalloutTitle,
  getZoteroNoteCalloutTitle,
  toCalloutBlock,
  toFoldableCalloutBlock,
} from "./literature-note-section-helpers";
import {
  MANAGED_END,
  MANAGED_START,
  type HtmlToMarkdownTransformer,
  type LiteratureNoteSummary,
  type ZoteroSyncStatus,
} from "./literature-note-content-types";
import {
  buildInlineTopicTags,
  buildSourceUrl,
  humanizeItemType,
  renderWikiList,
} from "./literature-note-frontmatter";

function renderVenueLine(detail: ZoteroItemDetail): string | null {
  const itemType = detail.item.itemType;

  switch (itemType) {
    case "book":
      return detail.item.publisher
        ? `**Publisher**: ${detail.item.publisher}`
        : null;
    case "bookSection":
      return detail.item.publicationTitle || detail.item.bookTitle
        ? `**Book**: ${renderWikiList([detail.item.publicationTitle || detail.item.bookTitle!])}`
        : null;
    case "conferencePaper":
      return detail.item.conferenceName || detail.item.publicationTitle
        ? `**Conference**: ${renderWikiList([detail.item.conferenceName || detail.item.publicationTitle!])}`
        : null;
    case "thesis":
      return detail.item.university
        ? `**University**: ${renderWikiList([detail.item.university])}`
        : null;
    case "report":
      return detail.item.publisher
        ? `**Institution**: ${detail.item.publisher}`
        : null;
    default:
      return detail.item.publicationTitle
        ? `**Publication**: ${renderWikiList([detail.item.publicationTitle])}`
        : null;
  }
}

function renderPrimaryIdentifier(detail: ZoteroItemDetail): string | null {
  const itemType = detail.item.itemType;

  if (itemType === "book" || itemType === "bookSection") {
    if (detail.item.isbn) return `**ISBN**: ${detail.item.isbn}`;
    if (detail.item.doi)
      return `**DOI**: [${detail.item.doi}](https://doi.org/${detail.item.doi})`;
    return null;
  }

  if (itemType === "preprint") {
    if (detail.item.arxivId)
      return `**arXiv**: [${detail.item.arxivId}](https://arxiv.org/abs/${detail.item.arxivId})`;
    if (detail.item.doi)
      return `**DOI**: [${detail.item.doi}](https://doi.org/${detail.item.doi})`;
    return null;
  }

  if (detail.item.doi)
    return `**DOI**: [${detail.item.doi}](https://doi.org/${detail.item.doi})`;
  if (detail.item.isbn) return `**ISBN**: ${detail.item.isbn}`;
  if (detail.item.arxivId)
    return `**arXiv**: [${detail.item.arxivId}](https://arxiv.org/abs/${detail.item.arxivId})`;
  return null;
}

function formatPageRange(pages: string): string {
  return pages.replace(/(\d)\s*-\s*(\d)/g, "$1\u2013$2");
}

function renderCiteCallout(detail: ZoteroItemDetail): string {
  const sourceUrl = buildSourceUrl(detail);
  const referenceLines = [
    `**Authors**: ${detail.item.creators.length > 0 ? renderWikiList(detail.item.creators) : "_Unknown_"}`,
    `**Year**: ${detail.item.year ?? "_Unknown_"}`,
    `**Type**: ${humanizeItemType(detail.item.itemType) ?? "_Unknown_"}`,
    renderVenueLine(detail),
    renderPrimaryIdentifier(detail),
    detail.item.citationKey ? `**Cite key**: \`${detail.item.citationKey}\`` : null,
  ].filter((line): line is string => Boolean(line));

  const openLinks = [
    `[Zotero](${detail.item.zoteroSelectUri})`,
    sourceUrl ? `[Source](${sourceUrl})` : null,
    ...detail.attachments.map((attachment) => {
      const href = attachment.zoteroOpenPdfUri ?? attachment.zoteroSelectUri;
      const label = attachment.zoteroOpenPdfUri
        ? attachment.title
        : `Zotero: ${attachment.title}`;
      return `[${label}](${href})`;
    }),
  ].filter((link): link is string => Boolean(link));

  referenceLines.push(`**Open**: ${openLinks.join(" · ")}`);

  return toCalloutBlock("cite", "Reference", referenceLines);
}

function renderCitationBlockquote(detail: ZoteroItemDetail): string | null {
  if (!detail.item.citation) return null;
  return `> ${detail.item.citation}`;
}

function renderDetailsCallout(detail: ZoteroItemDetail): string | null {
  const lines: string[] = [];

  const locationParts: string[] = [];
  if (detail.item.volume) locationParts.push(`Vol. ${detail.item.volume}`);
  if (detail.item.issue) locationParts.push(`No. ${detail.item.issue}`);
  if (detail.item.pages) locationParts.push(`pp. ${formatPageRange(detail.item.pages)}`);
  if (locationParts.length > 0) {
    lines.push(`**Location**: ${locationParts.join(" · ")}`);
  }

  if (detail.item.edition && (detail.item.itemType === "book" || detail.item.itemType === "bookSection")) {
    lines.push(`**Edition**: ${detail.item.edition}`);
  }

  const publisherNotInCite =
    detail.item.itemType !== "book" &&
    detail.item.itemType !== "report";
  if (publisherNotInCite && detail.item.publisher) {
    const publisherDisplay = detail.item.place
      ? `${detail.item.publisher}, ${detail.item.place}`
      : detail.item.publisher;
    lines.push(`**Publisher**: ${publisherDisplay}`);
  }

  if (detail.item.series || detail.item.seriesTitle) {
    const seriesParts: string[] = [];
    seriesParts.push(renderWikiList([detail.item.series || detail.item.seriesTitle!]));
    if (detail.item.seriesNumber) seriesParts.push(`No. ${detail.item.seriesNumber}`);
    lines.push(`**Series**: ${seriesParts.join(" · ")}`);
  }

  if (detail.item.issn) {
    lines.push(`**ISSN**: ${detail.item.issn}`);
  }

  const identifierNotInCite = renderPrimaryIdentifier(detail);
  if (!identifierNotInCite) {
    if (detail.item.isbn) lines.push(`**ISBN**: ${detail.item.isbn}`);
  } else {
    if (detail.item.doi && !identifierNotInCite.includes("DOI")) {
      lines.push(`**DOI**: [${detail.item.doi}](https://doi.org/${detail.item.doi})`);
    }
    if (detail.item.isbn && !identifierNotInCite.includes("ISBN")) {
      lines.push(`**ISBN**: ${detail.item.isbn}`);
    }
    if (detail.item.arxivId && !identifierNotInCite.includes("arXiv")) {
      lines.push(`**arXiv**: [${detail.item.arxivId}](https://arxiv.org/abs/${detail.item.arxivId})`);
    }
  }

  if (detail.item.pmid) {
    lines.push(`**PMID**: [${detail.item.pmid}](https://pubmed.ncbi.nlm.nih.gov/${detail.item.pmid}/)`);
  }
  if (detail.item.pmcid) {
    lines.push(`**PMCID**: [${detail.item.pmcid}](https://www.ncbi.nlm.nih.gov/pmc/articles/${detail.item.pmcid}/)`);
  }

  if (detail.item.language) {
    lines.push(`**Language**: ${detail.item.language}`);
  }

  if (detail.item.collections.length > 0) {
    lines.push(
      `**Collections**: ${renderWikiList(detail.item.collections.map((c) => c.name))}`
    );
  }

  if (detail.item.tags.length > 0) {
    lines.push(`**Topics**: ${buildInlineTopicTags(detail.item.tags).join(" ")}`);
  }

  const dateParts: string[] = [];
  if (detail.item.dateAdded) dateParts.push(`Added: ${detail.item.dateAdded.slice(0, 10)}`);
  if (detail.item.dateModified) dateParts.push(`Modified: ${detail.item.dateModified.slice(0, 10)}`);
  if (dateParts.length > 0) {
    lines.push(`**Zotero**: ${dateParts.join(" · ")}`);
  }

  if (lines.length === 0) return null;

  return toFoldableCalloutBlock("example", "Details", lines, true);
}

function renderAbstractSection(detail: ZoteroItemDetail): string | null {
  const abstract = detail.item.abstract?.trim();
  if (!abstract) {
    return null;
  }

  return toFoldableCalloutBlock("abstract", "Abstract", abstract.split("\n"), false);
}

function renderZoteroNotesSection(
  detail: ZoteroItemDetail,
  htmlToMarkdown: HtmlToMarkdownTransformer
): string | null {
  if (detail.zoteroNotes.length === 0) {
    return null;
  }

  const notes = detail.zoteroNotes.map((note, index) => {
    const markdown =
      htmlToMarkdown(preprocessZoteroNoteHtml(note.html)).trim() ||
      "_Empty Zotero note._";
    const metadataLine = [
      `[Open in Zotero](${note.zoteroSelectUri})`,
      note.dateModified ? `Last modified: ${note.dateModified}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" · ");

    return toFoldableCalloutBlock(
      "note",
      getZoteroNoteCalloutTitle(markdown, index),
      [metadataLine, "", ...markdown.split("\n")],
      false
    );
  });

  return ["## Zotero Notes", ...notes].join("\n\n");
}

function renderAnnotationsSection(detail: ZoteroItemDetail): string | null {
  if (detail.annotations.length === 0) {
    return null;
  }

  const groups = new Map<string, ZoteroItemDetail["annotations"]>();
  detail.annotations.forEach((annotation) => {
    const key = getColorCategory(annotation.color);
    const existing = groups.get(key) ?? [];
    existing.push(annotation);
    groups.set(key, existing);
  });

  const sections = Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, annotations]) => {
      const bodyLines = annotations.flatMap((annotation, index) => {
        const itemLines = [
          `**${annotation.pageLabel ? `Page ${annotation.pageLabel}` : "Page unknown"}**${annotation.type ? ` · ${annotation.type}` : ""}`,
          annotation.text ? annotation.text.replace(/\n+/g, " ").trim() : null,
          annotation.comment ? `Comment: ${annotation.comment}` : null,
          annotation.zoteroOpenPdfUri
            ? `[Open annotation in Zotero](${annotation.zoteroOpenPdfUri})`
            : null,
        ].filter((line): line is string => Boolean(line));

        return index === annotations.length - 1 ? itemLines : [...itemLines, ""];
      });

      return toFoldableCalloutBlock(
        "quote",
        getHighlightGroupCalloutTitle(label, annotations),
        bodyLines,
        false
      );
    });

  return ["## Highlights", ...sections].join("\n\n");
}

export function renderManagedBlock(
  detail: ZoteroItemDetail,
  htmlToMarkdown: HtmlToMarkdownTransformer,
  zoteroStatus: ZoteroSyncStatus
): string {
  const sections = [
    renderCiteCallout(detail),
    renderCitationBlockquote(detail),
    renderDetailsCallout(detail),
    renderAbstractSection(detail),
    renderZoteroNotesSection(detail, htmlToMarkdown),
    renderAnnotationsSection(detail),
  ].filter((section): section is string => Boolean(section));
  const deletedWarning =
    zoteroStatus === "deleted"
      ? [
          "> [!warning] This item was removed from Zotero",
          "> The source item is no longer in your Zotero library. This note is preserved but will no longer receive updates.",
          "",
        ]
      : [];

  return [
    MANAGED_START,
    `# ${detail.item.title}`,
    "",
    ...deletedWarning,
    "> [!info] Stratum managed content",
    "> Stratum refreshes this reference block, Zotero notes, and PDF highlights.",
    "> Write your own thoughts anywhere else in the note. The `## My Notes` section is never rewritten.",
    "",
    ...sections.flatMap((section, index) =>
      index === sections.length - 1 ? [section] : [section, ""]
    ),
    MANAGED_END,
  ].join("\n");
}

export function getLiteratureNoteSummary(
  detail: ZoteroItemDetail
): LiteratureNoteSummary {
  return {
    zoteroNoteCount: detail.zoteroNotes.length,
    annotationCount: detail.annotations.length,
    attachmentCount: detail.attachments.length,
  };
}
