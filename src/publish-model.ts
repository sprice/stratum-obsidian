import {
  readNotePreferences,
  readPublishOptions,
  type NotePublishPreferences,
  type PublishOptions,
  type DocumentType,
} from "./publish-options";
export const VIEW_TYPE_PUBLISH_PREVIEW = "stratum-publish-preview";

export type PublishFormat = "pdf" | "docx";
export const formatLabel = (format: PublishFormat): string =>
  format === "pdf" ? "PDF" : "Word";
export interface PublishedDocument {
  id: string;
  noteId: string;
  filename: string;
  format: PublishFormat;
  createdAt: string;
  citationStyle: string;
  citationLanguage: string;
  publishing?: {
    template?: { id: string; version: string; upstreamVersion: string };
    documentType: DocumentType;
    opening: "body" | "properties";
    layout: PublishOptions;
    metadata?: {
      title: string;
      authors: string[];
      affiliations: string[];
      date: string;
      keywords: string[];
    };
  };
}
export interface PublishedNote {
  id: string;
  path: string | null;
  title: string;
  ctime: number;
  preferences?: NotePublishPreferences;
}
export interface PublishCatalog {
  version: 1;
  notes: PublishedNote[];
  documents: PublishedDocument[];
}
export function emptyCatalog(): PublishCatalog {
  return { version: 1, notes: [], documents: [] };
}
export function readCatalog(text: string): PublishCatalog {
  const value: unknown = JSON.parse(text);
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const id = (v: unknown) =>
    typeof v === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(v);
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.notes) ||
    !Array.isArray(value.documents)
  )
    throw new Error(
      "The published document catalog could not be read. Restore it from a backup before publishing.",
    );
  if (
    !value.notes.every(
      (n: unknown) =>
        record(n) &&
        id(n.id) &&
        (n.path === null || typeof n.path === "string") &&
        typeof n.title === "string" &&
        typeof n.ctime === "number",
    ) ||
    !value.documents.every(
      (d: unknown) =>
        record(d) &&
        id(d.id) &&
        id(d.noteId) &&
        (d.format === "pdf" || d.format === "docx") &&
        typeof d.filename === "string" &&
        /^[^/\\]+\.(pdf|docx)$/.test(d.filename) &&
        !Array.from(d.filename).some((c) => c.charCodeAt(0) < 32) &&
        d.filename.endsWith(`.${d.format}`) &&
        typeof d.createdAt === "string" &&
        Number.isFinite(Date.parse(d.createdAt)) &&
        typeof d.citationStyle === "string" &&
        typeof d.citationLanguage === "string",
    )
  )
    throw new Error(
      "The published document catalog contains invalid entries. Restore it from a backup before publishing.",
    );
  const catalog = value as unknown as PublishCatalog;
  for (const note of catalog.notes)
    if (note.preferences)
      note.preferences = readNotePreferences(note.preferences);
  for (const document of catalog.documents)
    if (document.publishing) {
      if (!record(document.publishing) || !record(document.publishing.layout))
        throw new Error("Published document formatting could not be read.");
      document.publishing.layout = readPublishOptions(
        document.publishing.layout,
      );
    }
  if (
    new Set(catalog.notes.map((n) => n.id)).size !== catalog.notes.length ||
    new Set(catalog.documents.map((d) => d.id)).size !==
      catalog.documents.length ||
    new Set(catalog.documents.map((d) => d.filename)).size !==
      catalog.documents.length ||
    catalog.documents.some((d) => !catalog.notes.some((n) => n.id === d.noteId))
  )
    throw new Error(
      "The published document catalog contains conflicting entries.",
    );
  return catalog;
}
export function publishFilename(
  title: string,
  format: PublishFormat,
  number = 1,
): string {
  const cleaned =
    title
      .normalize("NFC")
      .replace(/[<>:"/\\|?*]/g, "-")
      .split("")
      .map((c) => (c.charCodeAt(0) < 32 ? "-" : c))
      .join("")
      .replace(/[. ]+$/g, "") || "Document";
  let safe = "";
  const encoder = new TextEncoder();
  for (const character of cleaned) {
    if (safe.length >= 90 || encoder.encode(safe + character).length > 160)
      break;
    safe += character;
  }
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? "Document-" : ""}${safe}${number > 1 ? `(${number})` : ""}.${format}`;
}
export function movePublishedNotes(
  catalog: PublishCatalog,
  oldPath: string,
  newPath: string | null,
): void {
  for (const note of catalog.notes)
    if (note.path === oldPath || note.path?.startsWith(`${oldPath}/`)) {
      note.path =
        newPath === null ? null : newPath + note.path.slice(oldPath.length);
      if (note.path)
        note.title = note.path.split("/").at(-1)!.replace(/\.md$/, "");
    }
}
