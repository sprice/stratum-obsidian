function stripHtmlTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDatasetJson<T>(encoded: string): T | null {
  try {
    return JSON.parse(decodeURIComponent(encoded)) as T;
  } catch {
    return null;
  }
}

function buildLocalUri(
  ext: "select" | "open-pdf",
  uri: string,
  params?: Record<string, string>
): string {
  const itemId = uri.split("/").pop();
  if (!itemId) {
    return uri;
  }

  const base = /\/groups\//.test(uri)
    ? uri.replace("http://zotero.org", `zotero://${ext}`)
    : `zotero://${ext}/library/items/${itemId}`;

  if (!params || Object.keys(params).length === 0) {
    return base;
  }

  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
    }
  });

  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

function buildAnnotationUriFromDataset(encoded: string): string | null {
  const json = decodeDatasetJson<{
    attachmentURI?: string;
    pageLabel?: string;
    annotationKey?: string;
  }>(encoded);

  if (!json?.attachmentURI) {
    return null;
  }

  return buildLocalUri("open-pdf", json.attachmentURI, {
    page: json.pageLabel ?? "",
    annotation: json.annotationKey ?? "",
  });
}

function buildCitationUriFromDataset(encoded: string): string | null {
  const json = decodeDatasetJson<{
    citationItems?: Array<{
      uris?: string[];
    }>;
  }>(encoded);

  const uri = json?.citationItems?.[0]?.uris?.[0];
  if (!uri) {
    return null;
  }

  return buildLocalUri("select", uri);
}

function replaceAnnotationBlocks(html: string): string {
  const imagePattern = /<img\b([^>]*\sdata-annotation="([^"]+)"[^>]*)>/gi;
  const nextWithImages = html.replace(
    imagePattern,
    (full: string, _attrs: string, encoded: string): string => {
      const href = buildAnnotationUriFromDataset(encoded);
      if (!href) {
        return full;
      }

      return `${full} <a href="${href}">Go to annotation</a>`;
    }
  );

  const blockPattern =
    /<(?!img\b)([a-z0-9]+)\b([^>]*\sdata-annotation="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
  return nextWithImages.replace(
    blockPattern,
    (
      full: string,
      _tag: string,
      _attrs: string,
      encoded: string
    ): string => {
      const href = buildAnnotationUriFromDataset(encoded);
      if (!href) {
        return full;
      }

      return `${full} <a href="${href}">Go to annotation</a>`;
    }
  );
}

function replaceCitationBlocks(html: string): string {
  const citationPattern =
    /<([a-z0-9]+)\b([^>]*\sdata-citation="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
  return html.replace(
    citationPattern,
    (
      full: string,
      _tag: string,
      _attrs: string,
      encoded: string,
      inner: string
    ): string => {
      const href = buildCitationUriFromDataset(encoded);
      if (!href) {
        return full;
      }

      const text = stripHtmlTags(inner) || "Open citation in Zotero";
      return `<a href="${href}">${text}</a>`;
    }
  );
}

export function preprocessZoteroNoteHtml(html: string): string {
  return replaceCitationBlocks(replaceAnnotationBlocks(html));
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
