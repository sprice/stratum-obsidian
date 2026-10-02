import type { LiteratureNoteEntry } from "./library-search-modal";
import { primaryCreators, type ZoteroCreator } from "./zotero-schema";
import { normalizeDoi } from "./doi";

export function escapeBibtex(value: string): string {
  return value
    .replace(/[\\{}&%$#_]/g, (char) =>
      char === "\\" ? "\\textbackslash{}" : `\\${char}`,
    )
    .replace(/[\r\n]+/g, " ");
}
function creator(c: ZoteroCreator): string {
  if (c.name) return `{${escapeBibtex(c.name)}}`;
  return [c.lastName, c.firstName]
    .filter((value): value is string => Boolean(value))
    .map(escapeBibtex)
    .join(", ");
}
function legacyAuthor(name: string): string {
  // A legacy plain string does not tell us which words belong to the family
  // name, or whether this is an institution. Keep the literal rather than guess.
  return `{${escapeBibtex(name)}}`;
}
export function referenceTypeToBibtex(entry: LiteratureNoteEntry): string {
  const type = (entry.itemType ?? entry.referenceType ?? "")
    .replace(/\s/g, "")
    .toLowerCase();
  const types: Record<string, string> = {
    book: "book",
    booksection: "incollection",
    dictionaryentry: "incollection",
    encyclopediaarticle: "incollection",
    conferencepaper: "inproceedings",
    report: "techreport",
    preprint: "unpublished",
    manuscript: "unpublished",
    journalarticle: "article",
    newspaperarticle: "article",
    magazinearticle: "article",
  };
  if (type === "thesis")
    return /ph\.?d|doctor/i.test(entry.sourceFields?.thesisType ?? "")
      ? "phdthesis"
      : /master/i.test(entry.sourceFields?.thesisType ?? "")
        ? "mastersthesis"
        : "misc";
  return Object.prototype.hasOwnProperty.call(types, type)
    ? types[type]
    : "misc";
}
export function buildCitekey(entry: LiteratureNoteEntry): string {
  if (entry.citationKey) return entry.citationKey;
  // Stable identity avoids collisions and changes after metadata corrections.
  if (entry.identity)
    return `stratum-${entry.identity.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  return `${
    entry.authors[0]
      ?.split(/\s+/)
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z]/g, "") || "unknown"
  }${entry.year ?? ""}`;
}
export function assertValidCitationKey(citekey: string): void {
  // The same key is emitted into both BibTeX and Pandoc [@key] syntax.
  if (!/^[^\s{},()=\\%#"[\];@]+$/.test(citekey))
    throw new Error(
      "Citation key contains unsupported BibTeX or Pandoc characters.",
    );
}

/** Braces keep punctuation-heavy keys intact in Pandoc citation syntax. */
export function formatPandocCitation(citekey: string): string {
  assertValidCitationKey(citekey);
  const bare =
    /^[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[.:$&+?~/-](?=[\p{L}\p{N}_]))*$/u;
  return bare.test(citekey) ? `[@${citekey}]` : `[@{${citekey}}]`;
}

export function buildBibtexEntry(
  entry: LiteratureNoteEntry,
  citekey = buildCitekey(entry),
): string {
  assertValidCitationKey(citekey);
  const type = referenceTypeToBibtex(entry);
  const fields: string[] = [];
  const add = (key: string, value: string | null | undefined) => {
    if (value) fields.push(`  ${key} = {${escapeBibtex(value)}}`);
  };
  add("title", entry.title);
  const details = entry.creatorDetails;
  if (details) {
    const authors = details.filter((c) => c.creatorType === "author");
    const primary = primaryCreators(details, entry.itemType ?? null).filter(
      (c) => c.creatorType !== "editor",
    );
    const names = authors.length ? authors : primary;
    if (names.length)
      fields.push(`  author = {${names.map(creator).join(" and ")}}`);
    for (const role of ["editor", "translator"]) {
      const names = details.filter((c) => c.creatorType === role);
      if (names.length)
        fields.push(`  ${role} = {${names.map(creator).join(" and ")}}`);
    }
  } else if (entry.authors.length)
    fields.push(
      `  author = {${entry.authors.map(legacyAuthor).join(" and ")}}`,
    );
  add("year", entry.year);
  const containerField = ["inproceedings", "incollection"].includes(type)
    ? "booktitle"
    : type === "article"
      ? "journal"
      : "howpublished";
  add(containerField, entry.publication);
  add("doi", normalizeDoi(entry.doi));
  add("url", entry.url);
  add("volume", entry.volume);
  add("number", entry.issue);
  add("pages", entry.pages?.replace(/\u2013/g, "--"));
  add(
    type === "techreport"
      ? "institution"
      : ["phdthesis", "mastersthesis"].includes(type)
        ? "school"
        : "publisher",
    entry.publisher,
  );
  const source = entry.sourceFields ?? {};
  add("edition", source.edition);
  add("address", source.place);
  if (type === "techreport") {
    add("number", source.reportNumber);
    add("type", source.reportType);
  }
  if (type === "misc")
    add(
      "note",
      [
        source.court,
        source.reporter,
        source.docketNumber,
        source.patentNumber,
        source.type,
      ]
        .filter(Boolean)
        .join("; "),
    );
  return `@${type}{${citekey},\n${fields.join(",\n")}\n}`;
}
