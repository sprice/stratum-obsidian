export const INITIAL_CITATION_STYLES = [
  "apa",
  "modern-language-association",
  "chicago-notes-bibliography",
  "ieee",
  "nlm-citation-sequence",
];

export function readAvailableCitationStyles(
  value: unknown,
  defaultStyle: string,
): string[] {
  const values = Array.isArray(value) ? value : INITIAL_CITATION_STYLES;
  return Array.from(
    new Set([
      ...values.filter(
        (id): id is string => typeof id === "string" && /^[a-z0-9-]+$/.test(id),
      ),
      defaultStyle,
    ]),
  );
}
