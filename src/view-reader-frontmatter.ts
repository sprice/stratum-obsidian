const LEADING_FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/;

const READER_VISIBLE_ZOTERO_FRONTMATTER_KEYS = new Set([
  "zotero_group_name",
  "zotero_link",
  "zotero_status",
]);

const READER_FRONTMATTER_LABELS = new Map<string, string>([
  ["arxiv", "arXiv"],
  ["citation_key", "Citation key"],
  ["citation_percentile", "Citation percentile"],
  ["cited_by_count", "Cited by"],
  ["date_added", "Date added"],
  ["doi", "DOI"],
  ["fwci", "FWCI"],
  ["is_open_access", "Open access"],
  ["is_retracted", "Retracted"],
  ["isbn", "ISBN"],
  ["issn", "ISSN"],
  ["oa_status", "OA status"],
  ["oa_url", "Open access PDF"],
  ["openalex_id", "OpenAlex"],
  ["openalex_language", "OpenAlex language"],
  ["openalex_status", "OpenAlex status"],
  ["openalex_topics", "OpenAlex topics"],
  ["openalex_type", "OpenAlex type"],
  ["pmcid", "PMCID"],
  ["pmid", "PMID"],
  ["reference_type", "Reference type"],
  ["short_title", "Short title"],
  ["zotero_group_name", "Zotero group"],
  ["zotero_link", "Zotero"],
  ["zotero_status", "Zotero status"],
]);

function isVisibleFrontmatterKey(key: string): boolean {
  if (key.startsWith("stratum_")) {
    return false;
  }

  if (
    key.startsWith("zotero_") &&
    !READER_VISIBLE_ZOTERO_FRONTMATTER_KEYS.has(key)
  ) {
    return false;
  }

  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractDoi(value: string): string {
  const trimmed = value.trim().replace(/^doi:\s*/i, "");
  const doiUrlMatch = trimmed.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
  return doiUrlMatch ? decodeURIComponent(doiUrlMatch[1]) : trimmed;
}

function humanizeFrontmatterKey(key: string): string {
  const directLabel = READER_FRONTMATTER_LABELS.get(key);
  if (directLabel) {
    return directLabel;
  }

  return key
    .split("_")
    .map((part) => {
      return part ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
    })
    .join(" ");
}

function formatPercent(value: number): string {
  const percent = value * 100;
  if (Math.abs(percent - Math.round(percent)) < 0.000001) {
    return `${Math.round(percent)}%`;
  }

  return `${percent.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : `${value}`;
}

function formatIsoDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : value;
}

function formatGenericString(value: string): string {
  return value.replace(/\n+/g, " ").trim();
}

function formatUrlMarkdown(label: string, href: string): string {
  const escapedHref = href.replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${label}](${escapedHref})`;
}

function formatStringValue(key: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (key === "doi") {
    const doi = extractDoi(trimmed);
    return formatUrlMarkdown(doi, `https://doi.org/${doi}`);
  }

  if (key === "source") {
    return /^https?:\/\//i.test(trimmed)
      ? formatUrlMarkdown("Source", trimmed)
      : formatGenericString(trimmed);
  }

  if (key === "oa_url") {
    return /^https?:\/\//i.test(trimmed)
      ? formatUrlMarkdown("Open access PDF", trimmed)
      : formatGenericString(trimmed);
  }

  if (key === "openalex_id") {
    if (/^https?:\/\/openalex\.org\//i.test(trimmed)) {
      const shortId = trimmed.replace(/^https?:\/\/openalex\.org\//i, "");
      return formatUrlMarkdown(shortId, trimmed);
    }

    return formatGenericString(trimmed);
  }

  if (key === "zotero_link") {
    return formatUrlMarkdown("Open in Zotero", trimmed);
  }

  if (key === "citation_key") {
    return `\`${formatGenericString(trimmed)}\``;
  }

  if (
    key === "is_open_access" ||
    key === "is_retracted" ||
    key === "oa_status" ||
    key === "openalex_status" ||
    key === "openalex_type" ||
    key === "zotero_status"
  ) {
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  }

  if (key === "date_added") {
    return formatIsoDate(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return formatUrlMarkdown(trimmed, trimmed);
  }

  return formatGenericString(trimmed);
}

function formatArrayValue(key: string, value: unknown[]): string | null {
  const parts = value
    .map((entry) => {
      if (typeof entry === "string") {
        if (key === "tags") {
          const tag = entry.trim();
          return tag ? `#${tag}` : null;
        }

        return formatStringValue(key, entry);
      }

      if (typeof entry === "number") {
        return formatNumber(entry);
      }

      if (typeof entry === "boolean") {
        return entry ? "Yes" : "No";
      }

      if (isPlainObject(entry)) {
        return `\`${JSON.stringify(entry)}\``;
      }

      return null;
    })
    .filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? parts.join(", ") : null;
}

function formatFrontmatterValue(key: string, value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return formatStringValue(key, value);
  }

  if (typeof value === "number") {
    return key === "citation_percentile"
      ? formatPercent(value)
      : formatNumber(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return formatArrayValue(key, value);
  }

  if (isPlainObject(value)) {
    return `\`${JSON.stringify(value)}\``;
  }

  return null;
}

export function parseReaderFrontmatter(
  markdown: string,
  parseYaml: (yaml: string) => unknown,
): Record<string, unknown> {
  const match = markdown.match(LEADING_FRONTMATTER_REGEX);
  if (!match) {
    return {};
  }

  try {
    const parsed: unknown = parseYaml(match[1]);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function stripLeadingFrontmatter(markdown: string): string {
  return markdown.replace(LEADING_FRONTMATTER_REGEX, "");
}

export function buildReaderFrontmatterMarkdown(
  frontmatter?: Record<string, unknown> | null,
): string {
  if (!frontmatter) {
    return "";
  }

  const lines = Object.entries(frontmatter)
    .filter(([key]) => isVisibleFrontmatterKey(key))
    .map(([key, value]) => {
      const formattedValue = formatFrontmatterValue(key, value);
      if (!formattedValue) {
        return null;
      }

      return `> **${humanizeFrontmatterKey(key)}**: ${formattedValue}`;
    })
    .filter((line): line is string => Boolean(line));

  if (lines.length === 0) {
    return "";
  }

  return ["> [!info]+ Metadata", ...lines].join("\n");
}
