import assert from "node:assert/strict";
import test from "node:test";
import type { LiteratureNoteEntry } from "../library-search-modal";
import {
  buildBibtexEntry,
  escapeBibtex,
  referenceTypeToBibtex,
} from "../bibtex-format";
import { updateManagedBibliography } from "../bibtex-managed";
import { loadRuntime } from "./runtime-harness";

const entry: LiteratureNoteEntry = {
  file: { basename: "Old abbreviated name" } as never,
  title: "Full title: including subtitle",
  displayTitle: "Full title",
  preferredLinkText: null,
  authors: ["Sander van der Linden"],
  year: "2023",
  citationKey: "Linden2023",
  doi: null,
  publication: null,
  volume: null,
  issue: null,
  pages: null,
  publisher: "Publisher",
  referenceType: "Book",
  itemType: "book",
  identity: "user/1/ITEM",
  creatorDetails: [
    { creatorType: "author", firstName: "Sander", lastName: "van der Linden" },
    { creatorType: "translator", firstName: "Erik", lastName: "Butler" },
  ],
};
test("BibTeX preserves full titles, name parts, roles and institutions", () => {
  const bib = buildBibtexEntry(entry);
  assert.match(bib, /@book\{Linden2023/);
  assert.match(bib, /title = \{Full title: including subtitle\}/);
  assert.match(bib, /author = \{van der Linden, Sander\}/);
  assert.match(bib, /translator = \{Butler, Erik\}/);
  assert.match(
    buildBibtexEntry({
      ...entry,
      creatorDetails: [
        { creatorType: "author", name: "Supreme Court of Canada" },
      ],
    }),
    /author = \{\{Supreme Court of Canada\}\}/,
  );
  assert.equal(escapeBibtex("a\\b & {c}"), "a\\textbackslash{}b \\& \\{c\\}");
  assert.equal(
    referenceTypeToBibtex({ ...entry, itemType: "thesis", sourceFields: {} }),
    "misc",
  );
  assert.match(
    buildBibtexEntry({ ...entry, itemType: "report" }),
    /institution = \{Publisher\}/,
  );
  assert.match(
    buildBibtexEntry({
      ...entry,
      itemType: "conferencePaper",
      publication: "Proceedings",
    }),
    /booktitle = \{Proceedings\}/,
  );
});
test("frontmatter export uses canonical title and removes Obsidian link markup", () => {
  const { literatureNoteEntryFromFrontmatter } = loadRuntime<
    typeof import("../library-search-modal")
  >("library-search-modal.ts", { FuzzySuggestModal: class {} });
  const result = literatureNoteEntryFromFrontmatter(entry.file, {
    aliases: ["Author 2023", "Short title"],
    zotero_title: entry.title,
    publisher: "[[Publisher]]",
    publication: "[[Proceedings|Display]]",
    year: 2023,
    volume: 3,
    zotero_creators: entry.creatorDetails,
    zotero_item_type: "book",
  });
  assert.equal(result.title, entry.title);
  assert.equal(result.publisher, "Publisher");
  assert.equal(result.publication, "Proceedings");
  assert.equal(result.volume, "3");
  assert.equal(result.year, "2023");
});
test("managed bibliography refresh is idempotent and retains existing citation keys", () => {
  const initial = updateManagedBibliography("", entry, true);
  assert.equal(updateManagedBibliography(initial, entry, true), initial);
  const corrected = { ...entry, title: "Corrected", citationKey: "NewKey" };
  const refreshed = updateManagedBibliography(initial, corrected, false);
  assert.match(refreshed, /@book\{Linden2023,/);
  assert.match(refreshed, /title = \{Corrected\}/);
  assert.equal(
    updateManagedBibliography(refreshed, corrected, false),
    refreshed,
  );
});
test("manual, unmarked and unrelated bibliography entries remain byte-for-byte intact", () => {
  const manual = "@book{Linden2023,\n title={Personal edit}\n}\n";
  assert.equal(updateManagedBibliography(manual, entry, true), manual);
  assert.equal(updateManagedBibliography(manual, entry, false), manual);
  const managed = updateManagedBibliography("", entry, true);
  const edited = managed.replace(
    "title = {Full title: including subtitle}",
    "title = {Manual title}",
  );
  assert.equal(
    updateManagedBibliography(edited, { ...entry, title: "Changed" }, false),
    edited,
  );
  assert.equal(
    updateManagedBibliography(
      managed,
      { ...entry, identity: "group/1/ITEM" },
      false,
    ),
    managed,
  );
  assert.equal(updateManagedBibliography("", entry, false), "");
});
test("simultaneous citations serialize bibliography creation and refresh never creates a file", async () => {
  class File {}
  const bib = loadRuntime<typeof import("../bibtex")>("bibtex.ts", {
    TFile: File,
  });
  let file: File | null = null;
  let contents = "";
  let creates = 0;
  const app = {
    vault: {
      getAbstractFileByPath: () => file,
      create: async (_path: string, value: string) => {
        await Promise.resolve();
        creates++;
        contents = value;
        file = new File();
      },
      process: async (_file: File, transform: (text: string) => string) => {
        await Promise.resolve();
        contents = transform(contents);
      },
    },
  } as never;
  await bib.refreshManagedBibEntry(app, entry);
  assert.equal(creates, 0);
  await Promise.all([
    bib.ensureBibEntry(app, entry),
    bib.ensureBibEntry(app, {
      ...entry,
      identity: "user/1/SECOND",
      citationKey: "Second",
    }),
  ]);
  assert.equal(creates, 1);
  assert.match(contents, /@book\{Linden2023,/);
  assert.match(contents, /@book\{Second,/);
});

test("a citation key owned by another item cannot silently cite the wrong work", () => {
  const initial = updateManagedBibliography("", entry, true);
  assert.throws(
    () =>
      updateManagedBibliography(
        initial,
        { ...entry, identity: "group/2/OTHER" },
        true,
      ),
    /another Zotero item/,
  );
});
