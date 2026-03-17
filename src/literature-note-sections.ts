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

function renderReferenceSection(detail: ZoteroItemDetail): string {
  const sourceUrl = buildSourceUrl(detail);
  const referenceLines = [
    `**Authors**: ${detail.item.creators.length > 0 ? renderWikiList(detail.item.creators) : "_Unknown_"}`,
    `**Year**: ${detail.item.year ?? "_Unknown_"}`,
    `**Type**: ${humanizeItemType(detail.item.itemType) ?? "_Unknown_"}`,
    detail.item.publicationTitle
      ? `**Publication**: ${renderWikiList([detail.item.publicationTitle])}`
      : null,
    detail.item.collections.length > 0
      ? `**Collections**: ${renderWikiList(
          detail.item.collections.map((collection) => collection.name)
        )}`
      : null,
    detail.item.tags.length > 0
      ? `**Topics**: ${buildInlineTopicTags(detail.item.tags).join(" ")}`
      : null,
    detail.item.doi
      ? `**DOI**: [${detail.item.doi}](https://doi.org/${detail.item.doi})`
      : null,
  ].filter((line): line is string => Boolean(line));

  const openLinks = [
    `[Open in Zotero](${detail.item.zoteroSelectUri})`,
    sourceUrl ? `[Open source](${sourceUrl})` : null,
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
    renderReferenceSection(detail),
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
