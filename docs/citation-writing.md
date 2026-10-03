# Writing with citations

Run **Stratum: Insert or edit citation** in a Markdown editor, or type `@` and
choose a source. Search imported literature notes by title, author, year, or
citation key. No connection is required to search imported notes.

In the composer:

- Add one or more sources. Use **Move up** or **Remove** to adjust the group.
- Enter an optional published page number, range, chapter, section, paragraph,
  or volume. PDF file positions are not citation page numbers.
- Expand **More options** for a prefix, suffix, or author suppression.
- Choose **Narrative** for one source whose author belongs in the sentence.
  Write any introductory prose in the manuscript; narrative citations cannot
  also suppress the author.
- Review the Markdown preview, then save. One undo restores the previous text.

Place the cursor anywhere in a supported citation, including its locator, and
run the same command to edit it. Unsupported syntax or unresolved/ambiguous keys
are left unchanged, with an explanation. Code, comments, and ordinary links are
not treated as citations. Edit complex Pandoc constructs directly in Markdown.

Saving updates `stratum.bib` before changing the manuscript. Established managed
keys survive source metadata changes. A conflicting bibliography key blocks the
whole group. Closing the composer or changing/closing the original note prevents
insertion; reopen the command to use the new text. If cancellation occurs after
a bibliography write has completed, its reference entries may remain, but the
manuscript is not changed.

Examples (synthetic):

```markdown
[see @example2026, pp. 42–44; -@sample2025, chap. 3]
@example2026 [p. xiv]
```

**Insert literature note link** remains separate: it links a note for navigation,
without creating a formal citation. The composer currently searches imported
notes; direct citation of unsynced Zotero items is not included.

The composer previews portable Pandoc Markdown. The document views format those
citations using your selected style. Stratum does not modify Zotero data.

## Citation styles and previews

Choose the default style in **Settings → Stratum → Default citation style**.
Papers inherit this choice. APA, IEEE, and Chicago Notes are bundled; **Find more
styles** searches Zotero's CSL repository. Selected styles and formatting
languages are downloaded once and saved locally. You can also import a `.csl`
file already in the vault. The dialog shows a synthetic citation and reference
example for installed styles.

**Change citation style for this paper**, also available from the style button
in Sources, creates an explicit override. **Use default style** removes it.
Overrides use `stratum_citation_style` and `stratum_citation_language` frontmatter.
Changing styles never rewrites citation keys, locators, or manuscript prose.

Live Preview and Reading view format supported Pandoc citations using the whole
paper's citation order. Put the cursor inside a citation to edit its Markdown,
or select a formatted citation in Live Preview and choose **Edit citation**.
Source mode always shows the underlying Markdown.

Run **Insert bibliography** to add a heading and `<div id="refs"></div>` at the
cursor. Keep this marker on its own line. Its preview contains only formally
cited sources and updates as citations change; literature-note links do not add
references. The formatted text is a view, not content written into the note.

Note-based styles generate a numbered Notes section. Ordinary `[^note]`
explanatory footnotes share its sequence and may contain citations. Their
Markdown remains editable; citation-generated notes disappear or change when
switching styles. Nested explanatory footnotes are not supported.

## Reference data and offline use

Sync now requests Zotero's structured CSL data, preserving source types, creator
roles, dates, and publication details. It retains this data in the vault-root
`stratum-references.json`, independently of the literature-note folder. Keep this
file along with `stratum.bib` when backing up the vault. Older imported notes can
be backfilled with **Refresh citation data**; this requires a Zotero connection
and fetches only missing references. Normal sync updates cached references.

Once reference data, a style, and its language are available locally, formatting
works without Zotero running or an internet connection. Missing or conflicting
sources leave citations as Markdown and show an explanation in Sources rather
than silently producing an incomplete bibliography.

Downloading more styles contacts `www.zotero.org`; additional language resources
come from the Citation Style Language project on `raw.githubusercontent.com`.
These requests contain resource identifiers, not manuscript text or reference
data. Formatting runs locally using citeproc-js; attribution and licenses are in
[Third-party notices](../THIRD_PARTY_NOTICES.md).

This milestone does not add publishing or document export and does not require
Pandoc to be installed. Publishing will need to carry these preferences and the
same citation metadata into the export pipeline.
