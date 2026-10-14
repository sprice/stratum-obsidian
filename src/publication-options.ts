export interface AastexPdfOptions {
  showLineNumbers: boolean;
  showDraftDateHeader: boolean;
  numberedHeadings: boolean;
}
export interface PublicationPackageReference {
  id: string;
  version: string;
  upstreamVersion: string;
}
export interface AastexPreferences {
  options: AastexPdfOptions;
  package?: PublicationPackageReference;
}
export const DEFAULT_AASTEX_PDF_OPTIONS: AastexPdfOptions = {
  showLineNumbers: true,
  showDraftDateHeader: true,
  numberedHeadings: false,
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function readAastexPdfOptions(value: unknown): AastexPdfOptions {
  const stored = record(value);
  return Object.fromEntries(
    Object.entries(DEFAULT_AASTEX_PDF_OPTIONS).map(([key, fallback]) => [
      key,
      typeof stored[key] === "boolean" ? stored[key] : fallback,
    ]),
  ) as unknown as AastexPdfOptions;
}
export function readPublicationPackageReference(
  value: unknown,
): PublicationPackageReference | undefined {
  const stored = record(value);
  if (
    !["id", "version", "upstreamVersion"].every(
      (key) =>
        typeof stored[key] === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(stored[key]),
    )
  )
    return undefined;
  return {
    id: stored.id as string,
    version: stored.version as string,
    upstreamVersion: stored.upstreamVersion as string,
  };
}
export function readAastexPreferences(value: unknown): AastexPreferences {
  const stored = record(value);
  const pkg = readPublicationPackageReference(stored.package);
  return {
    options: readAastexPdfOptions(stored.options),
    ...(pkg ? { package: pkg } : {}),
  };
}
export function samePublicationPackage(
  left: PublicationPackageReference,
  right: PublicationPackageReference,
): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.upstreamVersion === right.upstreamVersion
  );
}
