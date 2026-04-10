import { TFile, type App } from "obsidian";
import type { LiteratureNoteEntry } from "./library-search-modal";

const BIB_FILENAME = "stratum.bib";

function escapeBibtex(value: string): string {
  return value.replace(/([{}&%$#_])/g, "\\$1");
}

function toBibtexAuthors(authors: string[]): string {
  return authors
    .map((name) => {
      const parts = name.trim().split(/\s+/);
      if (parts.length <= 1) return escapeBibtex(name);
      const last = parts.pop()!;
      return `${escapeBibtex(last)}, ${escapeBibtex(parts.join(" "))}`;
    })
    .join(" and ");
}

function referenceTypeToBibtex(referenceType: string | null): string {
  const normalized = (referenceType ?? "").toLowerCase();
  if (normalized.includes("book section") || normalized.includes("chapter"))
    return "incollection";
  if (normalized.includes("book")) return "book";
  if (normalized.includes("conference")) return "inproceedings";
  if (normalized.includes("thesis")) return "phdthesis";
  if (normalized.includes("report")) return "techreport";
  if (normalized.includes("preprint")) return "unpublished";
  return "article";
}

export function buildCitekey(entry: LiteratureNoteEntry): string {
  if (entry.citationKey) return entry.citationKey;
  const author =
    entry.authors[0]
      ?.split(/\s+/)
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z]/g, "") ?? "unknown";
  const year = entry.year ?? "";
  return `${author}${year}`;
}

function buildBibtexEntry(entry: LiteratureNoteEntry): string {
  const citekey = buildCitekey(entry);
  const type = referenceTypeToBibtex(entry.referenceType);
  const fields: string[] = [];

  fields.push(`  title = {${escapeBibtex(entry.title)}}`);
  if (entry.authors.length > 0) {
    fields.push(`  author = {${toBibtexAuthors(entry.authors)}}`);
  }
  if (entry.year) {
    fields.push(`  year = {${entry.year}}`);
  }
  if (entry.publication) {
    const key = type === "inproceedings" ? "booktitle" : "journal";
    fields.push(`  ${key} = {${escapeBibtex(entry.publication)}}`);
  }
  if (entry.doi) {
    fields.push(`  doi = {${entry.doi}}`);
  }
  if (entry.volume) {
    fields.push(`  volume = {${entry.volume}}`);
  }
  if (entry.issue) {
    fields.push(`  number = {${entry.issue}}`);
  }
  if (entry.pages) {
    fields.push(`  pages = {${entry.pages.replace(/\u2013/g, "--")}}`);
  }
  if (entry.publisher) {
    fields.push(`  publisher = {${escapeBibtex(entry.publisher)}}`);
  }

  return `@${type}{${citekey},\n${fields.join(",\n")}\n}`;
}

export async function ensureBibEntry(
  app: App,
  entry: LiteratureNoteEntry,
): Promise<string> {
  const citekey = buildCitekey(entry);
  const bibPath = BIB_FILENAME;
  const existingFile = app.vault.getAbstractFileByPath(bibPath);
  const bibtexEntry = buildBibtexEntry(entry);

  if (existingFile instanceof TFile) {
    const content = await app.vault.cachedRead(existingFile);
    const keyPattern = new RegExp(
      `@\\w+\\{${citekey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`,
    );
    if (keyPattern.test(content)) {
      return citekey;
    }
    await app.vault.modify(
      existingFile,
      `${content.trimEnd()}\n\n${bibtexEntry}\n`,
    );
  } else if (existingFile) {
    throw new Error(
      `${BIB_FILENAME} already exists and is not a markdown file.`,
    );
  } else {
    await app.vault.create(bibPath, `${bibtexEntry}\n`);
  }

  return citekey;
}
