/** Read-only compatibility for saved bundled-template preferences and publication history.
 * Current registry exports never consult these options. */
import {
  readPublicationPackageReference,
  type PublicationPackageReference,
} from "./publication-options";
export interface AastexPdfOptions {
  showLineNumbers: boolean;
  showDraftDateHeader: boolean;
  numberedHeadings: boolean;
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
export function readAastexPreferences(value: unknown): AastexPreferences {
  const stored = record(value);
  const pkg = readPublicationPackageReference(stored.package);
  return {
    options: readAastexPdfOptions(stored.options),
    ...(pkg ? { package: pkg } : {}),
  };
}
