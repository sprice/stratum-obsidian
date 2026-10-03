import assert from "node:assert/strict";
import test from "node:test";
import type { LiteratureNoteEntry } from "../library-search-modal";
import {
  buildBibtexEntry,
  formatPandocCitation,
  escapeBibtex,
  referenceTypeToBibtex,
} from "../bibtex-format";
import {
  resolveBibliographyCitekey,
  updateManagedBibliography,
} from "../bibtex-managed";
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
  assert.throws(
    () => updateManagedBibliography(manual, entry, true),
    /unambiguous ownership/,
  );
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
      read: () => Promise.resolve(contents),
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
    /unambiguous ownership/,
  );
});

test("changed source citation keys reuse established bibliography keys without duplicates", () => {
  const initial = updateManagedBibliography("", entry, true);
  const changed = { ...entry, citationKey: "ChangedKey", title: "New title" };
  const result = updateManagedBibliography(initial, changed, true);
  assert.equal(resolveBibliographyCitekey(result, changed), "Linden2023");
  assert.equal((result.match(/^@book/gm) ?? []).length, 1);
  assert.match(result, /title = \{New title\}/);
  const editedKey = initial.replace("@book{Linden2023,", "@book{ManualKey,");
  assert.throws(
    () => resolveBibliographyCitekey(editedKey, entry),
    /manually changed/,
  );
  assert.throws(
    () =>
      resolveBibliographyCitekey(
        initial + "\n@book{Linden2023, title={Other}}",
        entry,
      ),
    /unambiguous ownership/,
  );
});

test("bibliography writes return the actual stored key and respect cancellation at atomic update", async () => {
  class File {}
  const bib = loadRuntime<typeof import("../bibtex")>("bibtex.ts", {
    TFile: File,
  });
  let contents = updateManagedBibliography("", entry, true);
  let active = true;
  let cancelBeforeWrite = false;
  const file = new File();
  const app = {
    vault: {
      getAbstractFileByPath: () => file,
      read: () => Promise.resolve(contents),
      process: async (_file: File, transform: (text: string) => string) => {
        await Promise.resolve();
        if (cancelBeforeWrite) active = false;
        contents = transform(contents);
      },
    },
  } as never;
  assert.equal(
    await bib.ensureBibEntry(app, { ...entry, citationKey: "Changed" }),
    "Linden2023",
  );
  const original = contents;
  cancelBeforeWrite = true;
  await bib.refreshManagedBibEntry(
    app,
    { ...entry, title: "Cancelled" },
    () => active,
  );
  assert.equal(contents, original);
  await bib.refreshManagedBibEntry(
    app,
    { ...entry, title: "Still cancelled" },
    () => active,
  );
  assert.equal(contents, original);
});

test("plain metadata and escaped wiki-target pipes survive bibliography export", () => {
  const { literatureNoteEntryFromFrontmatter } = loadRuntime<
    typeof import("../library-search-modal")
  >("library-search-modal.ts", { FuzzySuggestModal: class {} });
  for (const value of ["Research | Media", "[[Research \\| Media]]"]) {
    const result = literatureNoteEntryFromFrontmatter(entry.file, {
      publisher: value,
    });
    assert.equal(result.publisher, "Research | Media");
  }
  assert.equal(
    referenceTypeToBibtex({ ...entry, itemType: "constructor" }),
    "misc",
  );
});

test("inline unmarked bibliography entries also block conflicting citation keys", () => {
  assert.throws(
    () =>
      resolveBibliographyCitekey(
        "@book{Other, title={Other}} @book{Linden2023, title={Wrong work}}",
        entry,
      ),
    /unambiguous ownership/,
  );
});

test("group bibliography writes are atomic and preserve established keys", async () => {
  class File {}
  const file = new File();
  const runtime = loadRuntime<typeof import("../bibtex")>("bibtex.ts", {
    TFile: File,
  });
  let content = updateManagedBibliography("", entry, true);
  const app = {
    vault: {
      getAbstractFileByPath: () => file,
      process: async (_file: File, transform: (text: string) => string) => {
        content = transform(content);
        await Promise.resolve();
      },
    },
  };
  assert.deepEqual(
    Array.from(
      await runtime.ensureBibEntries(
        app as never,
        [{ ...entry, citationKey: "NewKey" }],
        () => true,
      ),
    ),
    ["Linden2023"],
  );
  const before = content;
  await assert.rejects(
    runtime.ensureBibEntries(
      app as never,
      [
        { ...entry, identity: "user/1/SECOND", citationKey: "second" },
        { ...entry, identity: "user/1/THIRD" },
      ],
      () => true,
    ),
    /ownership|belongs/,
  );
  assert.equal(content, before);
  await assert.rejects(
    runtime.ensureBibEntries(app as never, [entry], () => false),
    /changed/,
  );
  assert.equal(content, before);
});

test("citation keys cannot escape Pandoc citation delimiters", () => {
  for (const citationKey of ["bad]key", "bad;@other", "bad[key"]) {
    const invalid = { ...entry, citationKey };
    assert.throws(() => resolveBibliographyCitekey("", invalid), /unsupported/);
    assert.throws(() => buildBibtexEntry(invalid), /unsupported/);
  }
});

test("Pandoc insertion preserves punctuation-heavy bibliography keys", () => {
  assert.equal(formatPandocCitation("example2026"), "[@example2026]");
  assert.equal(formatPandocCitation("example!"), "[@{example!}]");
  assert.equal(formatPandocCitation("example."), "[@{example.}]");
  assert.equal(formatPandocCitation("-example"), "[@{-example}]");
  assert.throws(() => formatPandocCitation("invalid key"));
});

test("unchanged managed bibliography refresh avoids a vault write", async () => {
  class File {}
  const runtime = loadRuntime<typeof import("../bibtex")>("bibtex.ts", {
    TFile: File,
  });
  const file = new File();
  let content = updateManagedBibliography("", entry, true);
  let writes = 0;
  const app = {
    vault: {
      getAbstractFileByPath: () => file,
      read: () => Promise.resolve(content),
      process: async (_file: File, transform: (text: string) => string) => {
        writes++;
        content = transform(content);
        await Promise.resolve();
      },
    },
  };
  await runtime.refreshManagedBibEntry(app as never, entry);
  assert.equal(writes, 0);
  await runtime.refreshManagedBibEntry(app as never, {
    ...entry,
    title: "Changed title",
  });
  assert.equal(writes, 1);
  assert.match(content, /Changed title/);
});
