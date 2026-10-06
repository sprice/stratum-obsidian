export type DocumentType = "general" | "academic";
export interface PublishOptions {
  bodyFont: string;
  titleFont: string;
  bodySize: number;
  titleSize: number;
  paperSize: "a4" | "letter";
  margin: number;
  lineSpacing: number;
  numberSections: boolean;
}
export interface AcademicDefaults {
  authors: string[];
  affiliations: string[];
  date: string;
  keywords: string[];
}
export interface NotePublishPreferences {
  documentType: DocumentType;
  opening: "properties" | "body";
  format: "pdf" | "docx" | "";
  pdf: PublishOptions;
  docx: PublishOptions;
}
export const DEFAULT_WORD_FONT = "Times New Roman";
export const DEFAULT_PUBLISH_OPTIONS: PublishOptions = {
  bodyFont: "",
  titleFont: "",
  bodySize: 12,
  titleSize: 24,
  paperSize: "letter",
  margin: 1,
  lineSpacing: 1.15,
  numberSections: false,
};
export const DEFAULT_ACADEMIC_OPTIONS: PublishOptions = {
  ...DEFAULT_PUBLISH_OPTIONS,
  lineSpacing: 1.5,
};
export const DEFAULT_ACADEMIC_PROPERTIES: AcademicDefaults = {
  authors: [],
  affiliations: [],
  date: "",
  keywords: [],
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export function textList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}
export function fontName(value: unknown, fallback = ""): string {
  return typeof value === "string" &&
    value.length <= 120 &&
    // Font names reach LaTeX unescaped, so reject TeX special characters.
    !/[\\{}<>%#$^~&_]/.test(value) &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
    ? value.trim()
    : fallback;
}
export function readPublishOptions(
  value: unknown,
  defaults = DEFAULT_PUBLISH_OPTIONS,
): PublishOptions {
  const v = record(value);
  const number = (key: keyof PublishOptions, min: number, max: number) =>
    typeof v[key] === "number" &&
    Number.isFinite(v[key]) &&
    v[key] >= min &&
    v[key] <= max
      ? v[key]
      : (defaults[key] as number);
  return {
    bodyFont: fontName(v.bodyFont, defaults.bodyFont),
    titleFont: fontName(v.titleFont, defaults.titleFont),
    bodySize: number("bodySize", 8, 24),
    titleSize: number("titleSize", 12, 48),
    paperSize:
      v.paperSize === "a4" || v.paperSize === "letter"
        ? v.paperSize
        : defaults.paperSize,
    margin: number("margin", 0.4, 2),
    lineSpacing: number("lineSpacing", 1, 2.5),
    numberSections:
      typeof v.numberSections === "boolean"
        ? v.numberSections
        : defaults.numberSections,
  };
}
export function readAcademicDefaults(value: unknown): AcademicDefaults {
  const v = record(value);
  return {
    authors: textList(v.authors),
    affiliations: textList(v.affiliations),
    keywords: textList(v.keywords),
    date:
      typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date)
        ? v.date
        : "",
  };
}
export function readNotePreferences(
  value: unknown,
  defaults = DEFAULT_PUBLISH_OPTIONS,
  academic = DEFAULT_ACADEMIC_OPTIONS,
): NotePublishPreferences {
  const v = record(value),
    documentType = v.documentType === "academic" ? "academic" : "general";
  const base = documentType === "academic" ? academic : defaults;
  return {
    documentType,
    opening: v.opening === "body" ? "body" : "properties",
    format: v.format === "pdf" || v.format === "docx" ? v.format : "",
    pdf: readPublishOptions(v.pdf, base),
    docx: readPublishOptions(v.docx, base),
  };
}
