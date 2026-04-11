export interface ZoteroItemDetail {
  zoteroUserId: string;
  library: {
    type: "user" | "group";
    id: string;
    zoteroUriSegment: "library" | "groups";
    identity: string;
    groupName?: string | null;
  };
  item: {
    key: string;
    version: number;
    title: string;
    creators: string[];
    year: string | null;
    date: string | null;
    itemType: string | null;
    abstract: string | null;
    doi: string | null;
    url: string | null;
    publicationTitle: string | null;
    collections: Array<{
      key: string;
      name: string;
    }>;
    tags: string[];
    zoteroSelectUri: string;
    isbn: string | null;
    issn: string | null;
    volume: string | null;
    issue: string | null;
    pages: string | null;
    publisher: string | null;
    place: string | null;
    language: string | null;
    shortTitle: string | null;
    citationKey: string | null;
    edition: string | null;
    numPages: string | null;
    series: string | null;
    seriesTitle: string | null;
    seriesNumber: string | null;
    journalAbbreviation: string | null;
    conferenceName: string | null;
    university: string | null;
    bookTitle: string | null;
    reportNumber: string | null;
    reportType: string | null;
    thesisType: string | null;
    pmid: string | null;
    pmcid: string | null;
    arxivId: string | null;
    dateAdded: string | null;
    dateModified: string | null;
    citation: string | null;
  };
  attachments: Array<{
    key: string;
    title: string;
    itemType: string;
    contentType: string | null;
    linkMode: string | null;
    filename: string | null;
    url: string | null;
    zoteroSelectUri: string;
    zoteroOpenPdfUri: string | null;
  }>;
  zoteroNotes: Array<{
    key: string;
    parentItemKey: string | null;
    html: string;
    dateAdded: string | null;
    dateModified: string | null;
    zoteroSelectUri: string;
  }>;
  annotations: Array<{
    key: string;
    attachmentKey: string;
    type: string | null;
    color: string | null;
    pageLabel: string | null;
    text: string | null;
    comment: string | null;
    dateModified: string | null;
    zoteroOpenPdfUri: string | null;
  }>;
}

export type RawZoteroCreator = {
  firstName?: string;
  lastName?: string;
  name?: string;
};

export type RawZoteroTag = {
  tag?: string;
};

export type RawZoteroItemData = {
  itemType?: string;
  parentItem?: string;
  title?: string;
  creators?: RawZoteroCreator[];
  date?: string;
  abstractNote?: string;
  DOI?: string;
  url?: string;
  name?: string;
  publicationTitle?: string;
  collections?: string[];
  tags?: RawZoteroTag[];
  note?: string;
  contentType?: string;
  linkMode?: string;
  filename?: string;
  dateAdded?: string;
  dateModified?: string;
  citationKey?: string;
  ISBN?: string;
  ISSN?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  language?: string;
  shortTitle?: string;
  extra?: string;
  edition?: string;
  numPages?: string;
  series?: string;
  seriesTitle?: string;
  seriesNumber?: string;
  journalAbbreviation?: string;
  conferenceName?: string;
  university?: string;
  bookTitle?: string;
  reportNumber?: string;
  reportType?: string;
  thesisType?: string;
  archiveID?: string;
  annotationType?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationText?: string;
  annotationComment?: string;
};

export type RawZoteroItem = {
  key: string;
  version: number;
  bib?: string;
  data: RawZoteroItemData;
};

export type RawZoteroCollectionName = {
  key: string;
  name: string;
};

function normalizeDoi(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const withoutPrefix = trimmed.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  return withoutPrefix.trim() || null;
}

function buildSelectUri(
  library: ZoteroItemDetail["library"],
  itemKey: string,
): string {
  if (library.zoteroUriSegment === "library") {
    return `zotero://select/library/items/${itemKey}`;
  }

  return `zotero://select/groups/${library.id}/items/${itemKey}`;
}

function buildOpenPdfUri(
  library: ZoteroItemDetail["library"],
  attachmentKey: string,
  params?: Record<string, string>,
): string {
  const base =
    library.zoteroUriSegment === "library"
      ? `zotero://open-pdf/library/items/${attachmentKey}`
      : `zotero://open-pdf/groups/${library.id}/items/${attachmentKey}`;
  const url = new URL(base);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function formatCreators(creators: RawZoteroCreator[] | undefined): string[] {
  return (creators ?? [])
    .map((creator) => {
      if (creator.name) {
        return creator.name;
      }

      return [creator.firstName, creator.lastName].filter(Boolean).join(" ");
    })
    .filter((creator) => creator.length > 0);
}

function extractYear(date: string | undefined): string | null {
  if (!date) {
    return null;
  }

  const match = date.match(/\b\d{4}\b/);
  return match?.[0] ?? null;
}

function formatTags(tags: RawZoteroTag[] | undefined): string[] {
  return (tags ?? [])
    .map((tag) => tag.tag?.trim() ?? "")
    .filter((tag) => tag.length > 0);
}

function parseExtraIdentifiers(extra: string | undefined): {
  pmid: string | null;
  pmcid: string | null;
  arxivId: string | null;
  citationKey: string | null;
} {
  if (!extra) {
    return { pmid: null, pmcid: null, arxivId: null, citationKey: null };
  }

  return {
    pmid: extra.match(/^PMID:\s*(\d+)/m)?.[1] ?? null,
    pmcid: extra.match(/^PMCID:\s*(PMC\d+)/m)?.[1] ?? null,
    arxivId: extra.match(/^arXiv:\s*(\S+)/m)?.[1] ?? null,
    citationKey: extra.match(/^Citation Key:\s*(\S+)/m)?.[1] ?? null,
  };
}

function extractArxivFromArchiveId(
  archiveID: string | undefined,
): string | null {
  if (!archiveID) {
    return null;
  }

  return archiveID.match(/^arXiv:\s*(\S+)/)?.[1] ?? null;
}

function safeFromCodePoint(codePoint: number, fallback: string): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(
      /&#x([0-9a-fA-F]+);/g,
      (match: string, hex: string) =>
        safeFromCodePoint(Number.parseInt(hex, 16), match),
    )
    .replace(
      /&#(\d+);/g,
      (match: string, dec: string) =>
        safeFromCodePoint(Number.parseInt(dec, 10), match),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripCitationHtml(html: string | undefined): string | null {
  if (!html) {
    return null;
  }

  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim() || null;
}

function normalizeAnnotations(params: {
  library: ZoteroItemDetail["library"];
  attachments: RawZoteroItem[];
  annotationItems: RawZoteroItem[];
}): ZoteroItemDetail["annotations"] {
  const attachmentsByKey = new Map(
    params.attachments.map((attachment) => [attachment.key, attachment] as const),
  );

  return params.annotationItems
    .flatMap((annotation) => {
      if (annotation.data.itemType !== "annotation") {
        return [];
      }

      const attachmentKey = annotation.data.parentItem?.trim() || "";
      const attachment = attachmentsByKey.get(attachmentKey);
      if (!attachment) {
        return [];
      }

      const pageLabel = annotation.data.annotationPageLabel?.trim() || null;
      return [
        {
          key: annotation.key,
          attachmentKey,
          type: annotation.data.annotationType ?? null,
          color: annotation.data.annotationColor ?? null,
          pageLabel,
          text: annotation.data.annotationText ?? null,
          comment: annotation.data.annotationComment?.trim() || null,
          dateModified: annotation.data.dateModified ?? null,
          zoteroOpenPdfUri:
            attachment.data.contentType === "application/pdf"
              ? buildOpenPdfUri(params.library, attachmentKey, {
                  page: pageLabel ?? "",
                  annotation: annotation.key,
                })
              : null,
        } satisfies ZoteroItemDetail["annotations"][number],
      ];
    })
    .sort((left, right) => {
      const leftPage = Number(left.pageLabel ?? "");
      const rightPage = Number(right.pageLabel ?? "");
      if (
        Number.isFinite(leftPage) &&
        Number.isFinite(rightPage) &&
        leftPage !== rightPage
      ) {
        return leftPage - rightPage;
      }

      return (left.dateModified ?? "").localeCompare(right.dateModified ?? "");
    });
}

export function normalizeZoteroItemDetail(params: {
  zoteroUserId: string;
  library: ZoteroItemDetail["library"];
  parentItem: RawZoteroItem;
  childItems: RawZoteroItem[];
  collections: RawZoteroCollectionName[];
  annotationItems?: RawZoteroItem[];
}): ZoteroItemDetail {
  const attachments = params.childItems.filter(
    (child) => child.data.itemType === "attachment",
  );
  const zoteroNotes = params.childItems.filter(
    (child) => child.data.itemType === "note",
  );
  const annotationItems =
    params.annotationItems ??
    params.childItems.filter((child) => child.data.itemType === "annotation");
  const extraIds = parseExtraIdentifiers(params.parentItem.data.extra);

  return {
    zoteroUserId: params.zoteroUserId,
    library: params.library,
    item: {
      key: params.parentItem.key,
      version: params.parentItem.version,
      title: params.parentItem.data.title ?? "Untitled",
      creators: formatCreators(params.parentItem.data.creators),
      year: extractYear(params.parentItem.data.date),
      date: params.parentItem.data.date ?? null,
      itemType: params.parentItem.data.itemType ?? null,
      abstract: params.parentItem.data.abstractNote ?? null,
      doi: normalizeDoi(params.parentItem.data.DOI),
      url: params.parentItem.data.url ?? null,
      publicationTitle: params.parentItem.data.publicationTitle ?? null,
      collections: params.collections,
      tags: formatTags(params.parentItem.data.tags),
      zoteroSelectUri: buildSelectUri(params.library, params.parentItem.key),
      isbn: params.parentItem.data.ISBN ?? null,
      issn: params.parentItem.data.ISSN ?? null,
      volume: params.parentItem.data.volume ?? null,
      issue: params.parentItem.data.issue ?? null,
      pages: params.parentItem.data.pages ?? null,
      publisher: params.parentItem.data.publisher ?? null,
      place: params.parentItem.data.place ?? null,
      language: params.parentItem.data.language ?? null,
      shortTitle: params.parentItem.data.shortTitle ?? null,
      citationKey:
        params.parentItem.data.citationKey ?? extraIds.citationKey ?? null,
      edition: params.parentItem.data.edition ?? null,
      numPages: params.parentItem.data.numPages ?? null,
      series: params.parentItem.data.series ?? null,
      seriesTitle: params.parentItem.data.seriesTitle ?? null,
      seriesNumber: params.parentItem.data.seriesNumber ?? null,
      journalAbbreviation: params.parentItem.data.journalAbbreviation ?? null,
      conferenceName: params.parentItem.data.conferenceName ?? null,
      university: params.parentItem.data.university ?? null,
      bookTitle: params.parentItem.data.bookTitle ?? null,
      reportNumber: params.parentItem.data.reportNumber ?? null,
      reportType: params.parentItem.data.reportType ?? null,
      thesisType: params.parentItem.data.thesisType ?? null,
      pmid: extraIds.pmid,
      pmcid: extraIds.pmcid,
      arxivId:
        extraIds.arxivId ??
        extractArxivFromArchiveId(params.parentItem.data.archiveID),
      dateAdded: params.parentItem.data.dateAdded ?? null,
      dateModified: params.parentItem.data.dateModified ?? null,
      citation: stripCitationHtml(params.parentItem.bib),
    },
    attachments: attachments.map((attachment) => ({
      key: attachment.key,
      title: attachment.data.title ?? attachment.data.filename ?? "Attachment",
      itemType: attachment.data.itemType ?? "attachment",
      contentType: attachment.data.contentType ?? null,
      linkMode: attachment.data.linkMode ?? null,
      filename: attachment.data.filename ?? null,
      url: attachment.data.url ?? null,
      zoteroSelectUri: buildSelectUri(params.library, attachment.key),
      zoteroOpenPdfUri:
        attachment.data.contentType === "application/pdf"
          ? buildOpenPdfUri(params.library, attachment.key)
          : null,
    })),
    zoteroNotes: zoteroNotes.map((note) => ({
      key: note.key,
      parentItemKey: note.data.parentItem ?? null,
      html: note.data.note ?? "",
      dateAdded: note.data.dateAdded ?? null,
      dateModified: note.data.dateModified ?? null,
      zoteroSelectUri: buildSelectUri(params.library, note.key),
    })),
    annotations: normalizeAnnotations({
      library: params.library,
      attachments,
      annotationItems,
    }),
  };
}
