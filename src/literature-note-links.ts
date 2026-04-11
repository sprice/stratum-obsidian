function normalizeLinkText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getLeadingAlias(value: unknown, basename: string): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const alias = normalizeLinkText(value[0]);
  if (!alias || alias === basename || alias.startsWith("@")) {
    return null;
  }

  return alias;
}

export function extractPreferredLinkText(
  frontmatter: Record<string, unknown>,
  basename: string,
): string | null {
  return (
    getLeadingAlias(frontmatter.stratum_managed_aliases, basename) ??
    getLeadingAlias(frontmatter.aliases, basename)
  );
}

function escapeWikiLinkValue(value: string): string {
  return value.replace(/[|\]]/g, "\\$&");
}

export function buildLiteratureNoteWikiLink(input: {
  basename: string;
  preferredLinkText: string | null;
}): string {
  const basename = input.basename.trim();
  const preferredLinkText = normalizeLinkText(input.preferredLinkText);
  const escapedBasename = escapeWikiLinkValue(basename);

  if (!preferredLinkText || preferredLinkText === basename) {
    return `[[${escapedBasename}]]`;
  }

  return `[[${escapedBasename}|${escapeWikiLinkValue(preferredLinkText)}]]`;
}
