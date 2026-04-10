import type { ZoteroItemDetail, OpenAlexEnrichment } from "./backend-client";
import { normalizeDoi } from "./doi";
import { preprocessZoteroNoteHtml } from "./literature-note-content-html";
import {
  getColorCategory,
  getHighlightCalloutType,
  getZoteroNoteCalloutTitle,
  toCalloutBlock,
  toFoldableCalloutBlock,
} from "./literature-note-section-helpers";

function extractNoteAnnotationColor(
  html: string,
  annotations: ZoteroItemDetail["annotations"],
): string | null {
  // Try background-color in the HTML first
  const bgMatch = html.match(/background-color:\s*(#[0-9a-fA-F]{6})/);
  if (bgMatch) return bgMatch[1];

  // Fall back to matching annotation keys referenced in the note
  const keyPattern = /annotation=([A-Z0-9]+)/g;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(html)) !== null) {
    const annotation = annotations.find((a) => a.key === match![1]);
    if (annotation?.color) return annotation.color;
  }

  return null;
}

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
  const doi = normalizeDoi(detail.item.doi);

  if (itemType === "book" || itemType === "bookSection") {
    if (detail.item.isbn) return `**ISBN**: ${detail.item.isbn}`;
    if (doi) return `**DOI**: [${doi}](https://doi.org/${doi})`;
    return null;
  }

  if (itemType === "preprint") {
    if (detail.item.arxivId)
      return `**arXiv**: [${detail.item.arxivId}](https://arxiv.org/abs/${detail.item.arxivId})`;
    if (doi) return `**DOI**: [${doi}](https://doi.org/${doi})`;
    return null;
  }

  if (doi) return `**DOI**: [${doi}](https://doi.org/${doi})`;
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
    detail.item.citationKey
      ? `**Cite key**: \`${detail.item.citationKey}\``
      : null,
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
  const citation = detail.item.citation.replace(
    /(https?:\/\/doi\.org\/[^\s)]+)/g,
    (url) => `[${url}](${url})`,
  );
  return toFoldableCalloutBlock("quote", "Citation", [citation], false);
}

function renderDetailsCallout(detail: ZoteroItemDetail): string | null {
  const lines: string[] = [];
  const doi = normalizeDoi(detail.item.doi);

  const locationParts: string[] = [];
  if (detail.item.volume) locationParts.push(`Vol. ${detail.item.volume}`);
  if (detail.item.issue) locationParts.push(`No. ${detail.item.issue}`);
  if (detail.item.pages)
    locationParts.push(`pp. ${formatPageRange(detail.item.pages)}`);
  if (locationParts.length > 0) {
    lines.push(`**Location**: ${locationParts.join(" · ")}`);
  }

  if (
    detail.item.edition &&
    (detail.item.itemType === "book" || detail.item.itemType === "bookSection")
  ) {
    lines.push(`**Edition**: ${detail.item.edition}`);
  }

  const publisherNotInCite =
    detail.item.itemType !== "book" && detail.item.itemType !== "report";
  if (publisherNotInCite && detail.item.publisher) {
    const publisherDisplay = detail.item.place
      ? `${detail.item.publisher}, ${detail.item.place}`
      : detail.item.publisher;
    lines.push(`**Publisher**: ${publisherDisplay}`);
  }

  if (detail.item.series || detail.item.seriesTitle) {
    const seriesParts: string[] = [];
    seriesParts.push(
      renderWikiList([detail.item.series || detail.item.seriesTitle!]),
    );
    if (detail.item.seriesNumber)
      seriesParts.push(`No. ${detail.item.seriesNumber}`);
    lines.push(`**Series**: ${seriesParts.join(" · ")}`);
  }

  if (detail.item.issn) {
    lines.push(`**ISSN**: ${detail.item.issn}`);
  }

  const identifierNotInCite = renderPrimaryIdentifier(detail);
  if (!identifierNotInCite) {
    if (detail.item.isbn) lines.push(`**ISBN**: ${detail.item.isbn}`);
  } else {
    if (doi && !identifierNotInCite.includes("DOI")) {
      lines.push(`**DOI**: [${doi}](https://doi.org/${doi})`);
    }
    if (detail.item.isbn && !identifierNotInCite.includes("ISBN")) {
      lines.push(`**ISBN**: ${detail.item.isbn}`);
    }
    if (detail.item.arxivId && !identifierNotInCite.includes("arXiv")) {
      lines.push(
        `**arXiv**: [${detail.item.arxivId}](https://arxiv.org/abs/${detail.item.arxivId})`,
      );
    }
  }

  if (detail.item.pmid) {
    lines.push(
      `**PMID**: [${detail.item.pmid}](https://pubmed.ncbi.nlm.nih.gov/${detail.item.pmid}/)`,
    );
  }
  if (detail.item.pmcid) {
    lines.push(
      `**PMCID**: [${detail.item.pmcid}](https://www.ncbi.nlm.nih.gov/pmc/articles/${detail.item.pmcid}/)`,
    );
  }

  if (detail.item.language) {
    lines.push(`**Language**: ${detail.item.language}`);
  }

  if (detail.item.collections.length > 0) {
    lines.push(
      `**Collections**: ${renderWikiList(detail.item.collections.map((c) => c.name))}`,
    );
  }

  if (detail.item.tags.length > 0) {
    lines.push(
      `**Topics**: ${buildInlineTopicTags(detail.item.tags).join(" ")}`,
    );
  }

  const dateParts: string[] = [];
  if (detail.item.dateAdded)
    dateParts.push(`Added: ${detail.item.dateAdded.slice(0, 10)}`);
  if (detail.item.dateModified)
    dateParts.push(`Modified: ${detail.item.dateModified.slice(0, 10)}`);
  if (dateParts.length > 0) {
    lines.push(`**Zotero**: ${dateParts.join(" · ")}`);
  }

  if (lines.length === 0) return null;

  return toFoldableCalloutBlock("example", "Details", lines, false);
}

function renderAbstractSection(
  detail: ZoteroItemDetail,
  enrichment?: OpenAlexEnrichment | null,
): string | null {
  const abstract =
    detail.item.abstract?.trim() ||
    enrichment?.abstractFromOpenAlex?.trim() ||
    null;
  if (!abstract) {
    return null;
  }

  return toFoldableCalloutBlock(
    "abstract",
    "Abstract",
    abstract.split("\n"),
    false,
  );
}

function renderZoteroNotesSection(
  detail: ZoteroItemDetail,
  htmlToMarkdown: HtmlToMarkdownTransformer,
): string | null {
  if (detail.zoteroNotes.length === 0) {
    return null;
  }

  const notes = detail.zoteroNotes.map((note, index) => {
    const processedHtml = preprocessZoteroNoteHtml(note.html);
    const markdown =
      htmlToMarkdown(processedHtml).trim() || "_Empty Zotero note._";
    const metadataLine = [
      `[Open in Zotero](${note.zoteroSelectUri})`,
      note.dateModified ? `Last modified: ${note.dateModified}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" · ");

    const noteColor = extractNoteAnnotationColor(
      processedHtml,
      detail.annotations,
    );
    const calloutType = noteColor
      ? getHighlightCalloutType(getColorCategory(noteColor))
      : "note";

    return toFoldableCalloutBlock(
      calloutType,
      getZoteroNoteCalloutTitle(markdown, index),
      [metadataLine, "", ...markdown.split("\n")],
      false,
    );
  });

  return ["## Zotero Notes", ...notes].join("\n\n");
}

function safeWikiLink(value: string): string {
  return `[[${value.replace(/[|\]]/g, "\\$&")}]]`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function renderOpenAlexMetricsCallout(
  enrichment: OpenAlexEnrichment | null,
): string | null {
  if (!enrichment) return null;

  const lines: string[] = [];

  const citedParts: string[] = [
    `**Cited by**: ${formatNumber(enrichment.citedByCount)}`,
  ];
  if (enrichment.citationPercentile) {
    if (enrichment.citationPercentile.isInTop1Percent) {
      citedParts.push("Top 1%");
    } else if (enrichment.citationPercentile.isInTop10Percent) {
      citedParts.push("Top 10%");
    }
  }
  if (enrichment.fwci != null) {
    citedParts.push(`FWCI: ${enrichment.fwci.toFixed(1)}`);
  }
  lines.push(citedParts.join(" \u00B7 "));

  const recentYears = enrichment.countsByYear
    .slice(0, 5)
    .filter((entry) => entry.citedByCount > 0);
  if (recentYears.length > 0) {
    const trend = recentYears
      .map((entry) => `${entry.year}: ${formatNumber(entry.citedByCount)}`)
      .join(" \u00B7 ");
    lines.push(`**Citation trend**: ${trend}`);
  }

  const oaParts: string[] = [];
  if (enrichment.oaStatus) {
    oaParts.push(
      enrichment.oaStatus.charAt(0).toUpperCase() +
        enrichment.oaStatus.slice(1),
    );
  } else {
    oaParts.push(enrichment.isOpenAccess ? "Yes" : "No");
  }
  if (enrichment.oaUrl) {
    oaParts.push(`[PDF](${enrichment.oaUrl})`);
  }
  lines.push(`**Open access**: ${oaParts.join(" \u00B7 ")}`);

  if (enrichment.apc) {
    try {
      const formatted = enrichment.apc.value.toLocaleString("en-US", {
        style: "currency",
        currency: enrichment.apc.currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
      lines.push(`**APC**: ${formatted}`);
    } catch {
      lines.push(
        `**APC**: ${formatNumber(enrichment.apc.value)} ${enrichment.apc.currency}`,
      );
    }
  }

  if (enrichment.isRetracted) {
    lines.push("**Retracted**: **RETRACTED**");
  }

  if (enrichment.type) {
    lines.push(`**Type**: ${enrichment.type}`);
  }

  const openAlexUrl = enrichment.openAlexId.startsWith("http")
    ? enrichment.openAlexId
    : `https://openalex.org/${enrichment.openAlexId}`;
  const shortId = enrichment.openAlexId.replace("https://openalex.org/", "");
  lines.push(`**Enrichment**: [${shortId}](${openAlexUrl})`);

  return toFoldableCalloutBlock("bar-chart", "Impact", lines, false);
}

function renderOpenAlexDetailsCallout(
  enrichment: OpenAlexEnrichment | null,
): string | null {
  if (!enrichment) return null;

  const sections: string[][] = [];

  const affiliations = enrichment.authorships.map((a) => {
    const orcidLink = a.orcid ? ` [ORCID](${a.orcid})` : "";
    const inst =
      a.institutions.length > 0
        ? ` (${a.institutions.map((i) => safeWikiLink(i)).join(", ")})`
        : "";
    return `${safeWikiLink(a.authorName)}${orcidLink}${inst}`;
  });
  if (affiliations.length > 0) {
    sections.push([`**Affiliations**: ${affiliations.join(", ")}`]);
  }

  const topTopics = enrichment.topics.slice(0, 5);
  if (topTopics.length > 0) {
    const formatted = topTopics.map((t) => {
      const hierarchy = [t.field, t.subfield]
        .filter(Boolean)
        .map((h) => safeWikiLink(h as string))
        .join(" > ");
      return hierarchy
        ? `${safeWikiLink(t.name)} (${hierarchy})`
        : safeWikiLink(t.name);
    });
    sections.push([`**Topics**: ${formatted.join(", ")}`]);
  }

  const topKeywords = enrichment.keywords.slice(0, 10);
  if (topKeywords.length > 0) {
    sections.push([
      `**Keywords**: ${topKeywords.map((k) => safeWikiLink(k.keyword)).join(", ")}`,
    ]);
  }

  if (enrichment.funders.length > 0) {
    const formatted = enrichment.funders.map((f) =>
      f.awardId ? `${f.name} (${f.awardId})` : f.name,
    );
    sections.push([`**Funders**: ${formatted.join(", ")}`]);
  }

  const sdgs = enrichment.sustainableDevelopmentGoals.filter(
    (g) => g.score >= 0.5,
  );
  if (sdgs.length > 0) {
    const formatted = sdgs.map((g) => `${g.name} (${g.score.toFixed(2)})`);
    sections.push([`**SDGs**: ${formatted.join(", ")}`]);
  }

  if (enrichment.primaryLocation) {
    const loc = enrichment.primaryLocation;
    const parts: string[] = [];
    if (loc.sourceName) parts.push(loc.sourceName);
    if (loc.landingPageUrl) parts.push(`[Landing page](${loc.landingPageUrl})`);
    if (loc.pdfUrl) parts.push(`[PDF](${loc.pdfUrl})`);
    if (parts.length > 0) {
      sections.push([`**Source**: ${parts.join(" \u00B7 ")}`]);
    }
  }

  const countParts: string[] = [];
  if (enrichment.referencedWorksCount > 0) {
    countParts.push(`**Referenced works**: ${enrichment.referencedWorksCount}`);
  }
  if (enrichment.relatedWorksCount > 0) {
    countParts.push(`**Related works**: ${enrichment.relatedWorksCount}`);
  }
  if (countParts.length > 0) {
    sections.push([countParts.join(" \u00B7 ")]);
  }

  const lines = sections.flatMap((section, i) =>
    i < sections.length - 1 ? [...section, ""] : section,
  );

  if (lines.length === 0) return null;

  return toFoldableCalloutBlock("globe", "Enrichment", lines, false);
}

export type PreservedManagedSections = {
  impact?: string | null;
  openAlex?: string | null;
  abstract?: string | null;
};

export function renderManagedBlock(
  detail: ZoteroItemDetail,
  htmlToMarkdown: HtmlToMarkdownTransformer,
  zoteroStatus: ZoteroSyncStatus,
  enrichment?: OpenAlexEnrichment | null,
  preservedSections?: PreservedManagedSections,
): string {
  const abstractSection = detail.item.abstract
    ? renderAbstractSection(detail, enrichment)
    : enrichment === undefined
      ? (preservedSections?.abstract ?? null)
      : renderAbstractSection(detail, enrichment);
  const sections = [
    renderCiteCallout(detail),
    renderCitationBlockquote(detail),
    enrichment === undefined
      ? (preservedSections?.impact ?? null)
      : renderOpenAlexMetricsCallout(enrichment ?? null),
    renderDetailsCallout(detail),
    enrichment === undefined
      ? (preservedSections?.openAlex ?? null)
      : renderOpenAlexDetailsCallout(enrichment ?? null),
    abstractSection,
    renderZoteroNotesSection(detail, htmlToMarkdown),
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
    ...deletedWarning,
    ...sections.flatMap((section, index) =>
      index === sections.length - 1 ? [section] : [section, ""],
    ),
    MANAGED_END,
  ].join("\n");
}

export function getLiteratureNoteSummary(
  detail: ZoteroItemDetail,
): LiteratureNoteSummary {
  return {
    zoteroNoteCount: detail.zoteroNotes.length,
    annotationCount: detail.annotations.length,
    attachmentCount: detail.attachments.length,
  };
}
