import {
  MANAGED_START,
  MANAGED_END,
  SYNC_BOUNDARY,
  SYNC_NOTICE,
  USER_BOUNDARY_PATTERN,
} from "./literature-note-content-types";

export const NOTE_LAYOUT_VERSION = 2;
export const NOTE_LAYOUT_KEY = "stratum_note_layout";
// Recognize existing notices independently of changes to their explanatory copy.
const SYNC_NOTICE_HEADER = `${SYNC_BOUNDARY}\n> [!warning] Synced source content\n`;

interface LiteratureNoteLayout {
  /** Includes the My Notes heading and all personal text, without normalization. */
  personal: string;
  managed: string;
  legacy: boolean;
}

/** Locate reserved boundaries outside fenced code examples. */
export function boundaryLines(
  body: string,
): { text: string; from: number; to: number }[] {
  const lines: { text: string; from: number; to: number }[] = [];
  let fence: { char: string; length: number } | null = null;
  let from = 0;
  for (const raw of body.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!raw[0]) continue;
    const text = raw[0].replace(/\r?\n$/, "");
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (fence) {
      if (
        delimiter &&
        delimiter[1][0] === fence.char &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = null;
    } else if (delimiter) {
      fence = { char: delimiter[1][0], length: delimiter[1].length };
    } else {
      lines.push({ text, from, to: from + raw[0].length });
    }
    from += raw[0].length;
  }
  return lines;
}

export function readLiteratureNoteLayout(
  body: string,
  version: unknown,
): LiteratureNoteLayout | null {
  const lines = boundaryLines(body);
  const synced = lines.filter((line) => line.text === SYNC_BOUNDARY);
  const legacyBoundaries = lines.filter((line) =>
    USER_BOUNDARY_PATTERN.test(line.text),
  );
  const activeSyncBoundary = synced.find(
    (line) =>
      Number(version) === NOTE_LAYOUT_VERSION ||
      ((!legacyBoundaries[0] || line.from < legacyBoundaries[0].from) &&
        body
          .slice(line.from)
          .replace(/\r\n/g, "\n")
          .startsWith(SYNC_NOTICE_HEADER)),
  );
  const sourceStart = lines.find(
    (line) =>
      line.text === MANAGED_START &&
      (!activeSyncBoundary || line.from > activeSyncBoundary.from),
  );
  const sourceEnd =
    sourceStart &&
    lines.find(
      (line) => line.from > sourceStart.from && line.text === MANAGED_END,
    );
  // Source text can contain callout syntax. Prefer the boundary after the
  // generated block, while retaining migration of notes with damaged markers.
  const trailingLegacyBoundary =
    sourceEnd && legacyBoundaries.find((line) => line.from > sourceEnd.from);
  const legacyBoundary = trailingLegacyBoundary ?? legacyBoundaries[0];
  // Recognize the new notice without cached metadata, but never promote an
  // example below the old personal boundary to a writable boundary.
  const newLayout =
    Number(version) === NOTE_LAYOUT_VERSION ||
    synced.some(
      (line) =>
        (!legacyBoundary || line.from < legacyBoundary.from) &&
        body
          .slice(line.from)
          .replace(/\r\n/g, "\n")
          .startsWith(SYNC_NOTICE_HEADER),
    );
  // Master can retain version 2 and the new notice while appending its old
  // callout after the managed block. That intact callout still owns the
  // boundary: only its personal suffix is stable, regardless of metadata.
  if (newLayout && !trailingLegacyBoundary) {
    if (synced.length !== 1) return null;
    const boundary = synced[0];
    const tail = body.slice(boundary.to);
    const managedStart = tail.indexOf(MANAGED_START);
    if (managedStart < 0) return null;
    return {
      personal: body.slice(0, boundary.from),
      managed: tail.slice(managedStart),
      legacy: false,
    };
  }
  const boundary = legacyBoundary;
  if (!boundary) return null;
  // The complete old callout is Stratum-owned. The first non-quoted line is
  // the beginning of user content; slice the original bytes from there.
  let end = boundary.to;
  while (end < body.length) {
    const next = /^[^\n]*(?:\n|$)/.exec(body.slice(end))![0];
    if (!/^ {0,3}>/.test(next)) break;
    end += next.length;
  }
  return {
    personal: `## My Notes\n${body.slice(end)}`,
    managed: body.slice(
      newLayout && sourceStart ? sourceStart.from : 0,
      boundary.from,
    ),
    legacy: true,
  };
}

export function composeLiteratureNoteBody(
  personal: string,
  managed: string,
): string {
  const separator = personal.endsWith("\n\n")
    ? ""
    : personal.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${personal}${separator}${SYNC_NOTICE}\n\n${managed.trimEnd()}\n`;
}

export function requireLiteratureNoteLayout(
  body: string,
  version: unknown,
): LiteratureNoteLayout {
  const layout = readLiteratureNoteLayout(body, version);
  if (!layout)
    throw new Error(
      "The literature note's Stratum boundary is missing or damaged. Restore it before syncing; the note was not changed.",
    );
  return layout;
}
