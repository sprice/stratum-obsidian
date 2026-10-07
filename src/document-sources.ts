import {
  citationResolver,
  type CitationResolution,
} from "./citation-resolution";
import { buildCitekey } from "./bibtex-format";
import type { LiteratureNoteEntry } from "./library-search-modal";
import {
  parseSourceOccurrences,
  type SourceOccurrence,
} from "./source-occurrences";

export interface SourceRow {
  id: string;
  entry?: LiteratureNoteEntry;
  keys: string[];
  issue?: "unresolved" | "ambiguous" | "missing-note";
  occurrences: SourceOccurrence[];
  health?: CitationResolution;
}
export interface BibliographyBinding {
  key: string;
  identity: string;
}

/** Read ownership markers only when their key agrees with the actual entry. */
export function readBibliographyBindings(text: string): BibliographyBinding[] {
  const result: BibliographyBinding[] = [];
  const owned =
    /^% stratum:begin (\S+) (\S+) (\S+)\r?\n([\s\S]*?)\r?\n% stratum:end(?=\r?$)/gm;
  for (const match of text.matchAll(owned)) {
    try {
      const identity = decodeURIComponent(match[1]);
      const key = decodeURIComponent(match[2]);
      const bodyKey = /^\s*@\w+\s*[({]\s*([^\s,]+)\s*,/.exec(match[4])?.[1];
      if (/^(user|group)\/[^/]+\/[^/]+$/.test(identity) && bodyKey === key)
        result.push({ identity, key });
    } catch {
      /* Invalid markers do not establish ownership. */
    }
  }
  // Duplicate BibTeX definitions make a key unsafe even if one has a marker.
  const counts = new Map<string, number>();
  const withoutComments = text.replace(/^\s*%.*$/gm, "");
  for (const match of withoutComments.matchAll(
    /@\w+\s*[{(]\s*([^\s,]+)\s*,/g,
  )) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count > 1) result.push({ key, identity: `ambiguous:${key}` });
  }
  return result;
}

function sourceIdentity(entry: LiteratureNoteEntry): string {
  return entry.identity || `file:${entry.file.path}`;
}

export function collectDocumentSources(
  text: string,
  entries: LiteratureNoteEntry[],
  bindings: BibliographyBinding[],
  resolveLink: (
    target: string,
    format?: SourceOccurrence["linkFormat"],
  ) => string | null,
): SourceRow[] {
  const resolve = citationResolver(entries, bindings);
  const rows = new Map<string, SourceRow>();
  for (const occurrence of parseSourceOccurrences(text)) {
    let identity: string;
    let issue: SourceRow["issue"];
    let entry: LiteratureNoteEntry | undefined;
    if (occurrence.kind === "link") {
      const path = resolveLink(occurrence.target, occurrence.linkFormat);
      entry = entries.find((candidate) => candidate.file.path === path);
      if (!entry) continue; // Ordinary links are not literature references.
      identity = sourceIdentity(entry);
    } else {
      const resolution = resolve(occurrence.target);
      identity = resolution.identity ?? `key:${occurrence.target}`;
      if (
        resolution.problem === "conflicting-key" ||
        resolution.notes.length > 1
      )
        issue = "ambiguous";
      else if (resolution.problem === "unknown-key") issue = "unresolved";
      else if (!resolution.notes.length) issue = "missing-note";
      else entry = resolution.notes[0];
    }
    const row = rows.get(identity) ?? {
      id: identity,
      entry,
      issue,
      keys: [],
      occurrences: [],
    };
    if (issue) {
      row.issue = issue;
      row.entry = undefined;
    }
    row.occurrences.push(occurrence);
    if (occurrence.kind === "citation" && !row.keys.includes(occurrence.target))
      row.keys.push(occurrence.target);
    rows.set(identity, row);
  }
  for (const row of rows.values()) {
    if (!row.keys.length && row.entry) {
      const existing = bindings.filter(
        (binding) => binding.identity === sourceIdentity(row.entry!),
      );
      row.keys = [
        ...new Set(
          existing.length
            ? existing.map((b) => b.key)
            : [buildCitekey(row.entry)],
        ),
      ];
    }
  }
  return [...rows.values()];
}
