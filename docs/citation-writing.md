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

The preview is portable Pandoc Markdown, not a formatted CSL preview. Citation
styles, formatted bibliographies, and document export are separate stages of the
citation roadmap. This feature does not install Pandoc or modify Zotero data.
