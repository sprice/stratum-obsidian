const DOI_PREFIX_PATTERNS = [
  /^doi:\s*/i,
  /^https?:\/\/(?:dx\.)?doi\.org\//i,
  /^doi\.org\//i,
];

export function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  let normalized = value.trim();
  if (!normalized) {
    return null;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of DOI_PREFIX_PATTERNS) {
      const next = normalized.replace(pattern, "").trim();
      if (next !== normalized) {
        normalized = next;
        changed = true;
      }
    }
  }

  normalized = normalized.replace(/\s+/g, "");
  return normalized || null;
}

export function getNormalizedDoiLookupKey(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeDoi(value);
  return normalized ? normalized.toLowerCase() : null;
}
