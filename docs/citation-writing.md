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

The composer previews portable Pandoc Markdown. Reading view formats those
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

Live Preview always shows stable citation keys, locators, and affixes in the theme's
link color, independent of the publication style. Select a citation to edit its
Markdown directly, or click it and choose **Edit citation**. It needs no downloaded
style or cached source data to display these authoring labels. Ordinary explanatory
footnotes retain Obsidian's native editing behavior.

Reading view formats supported Pandoc citations using the whole paper's citation
order and the selected style. Source mode shows unmodified Markdown. Generated
citation notes and reference lists appear only in Reading view.

Reading view automatically adds a reference list after the paper when the selected
style supplies one. It includes only formally cited sources and updates with the
style and citation order. No heading, marker, or formatted references are written
to the Markdown. In-text styles use the heading **References**; note-based styles
use **Bibliography**, after their generated Notes section.

An existing `<div id="refs"></div>` marker still controls explicit placement and
suppresses the automatic list. **Insert bibliography** remains available for this
optional placement, but formatting stays in Reading view. Live Preview does not generate a reference
list or citation notes.

Note-based styles generate a numbered Notes section. Ordinary `[^note]`
explanatory footnotes share its sequence and may contain citations. Their
Markdown remains editable; citation-generated notes disappear or change when
switching styles. Nested explanatory footnotes and inline `^[note text]` notes
are not supported for citation formatting; use named `[^note]` definitions.
Unsupported notes keep the original Reading output and show a formatting error.

## Source health and recovery

Sources reports problems beside the affected citation while keeping the style
control available. **Show citation in paper** returns to the exact occurrence.

- **Citation data missing:** choose **Fetch citation data** to retrieve the known
  source through the existing Zotero connection. This updates cached reference
  data only; it does not edit the paper or create a literature note. Disabled
  libraries and connection failures show guidance and a retry action.
- **Unknown key:** check the citation or import its source. Stratum does not guess
  which Zotero item you intended.
- **Conflicting ownership:** expand **Review matching sources** to inspect the
  candidates. This list makes no ownership or manuscript changes.
- **Missing literature note:** cached reference data can still format a known
  citation. Sync the library to restore navigation to its note.
- **Duplicate notes for one source:** inspect the duplicates; they do not make
  the source's citation identity ambiguous or block formatting when data exists.

Previously recorded Zotero unavailability is shown without deleting cached data.
A failed network request is not treated as proof that a source was deleted.
Unreadable reference files and unavailable styles remain document-level errors.
Unsupported citation groups remain raw while supported groups still format.
For note-based styles, ambiguous or unsupported explanatory footnotes stop
formatting so Obsidian's native notes and their content remain visible;
recovery never replaces an unreadable reference file with an empty one.

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
Downloaded and imported style/language XML is cached in
`citation-resources.json` within the plugin directory. Bundled resources are used
from the current plugin version. Back up or sync the plugin directory to retain
additional styles on other devices.

These requests contain resource identifiers, not manuscript text or reference
data. Formatting runs locally using citeproc-js; attribution and licenses are in
[Third-party notices](../THIRD_PARTY_NOTICES.md).

This milestone does not add publishing or document export and does not require
Pandoc to be installed. Publishing will need to carry these preferences and the
same citation metadata into the export pipeline.

## Consistent keys and repairs

Citation suggestions and the composer show the established insertion key from
`stratum.bib`, even if Zotero now supplies a different key. Existing historical
keys remain valid. Sources shows the keys actually used in the paper. The
literature note's `citation_key` records the supplied metadata; it does not
replace established bibliography ownership. Already-cited sources are preferred
in citation suggestions. Filename preferences do not determine citation identity.

For an unknown or conflicting key, choose **Repair citation** in Sources:

1. Choose the intended imported source.
2. Select one occurrence (the default) or all matching occurrences in this paper.
3. Review the source identity, replacement key, and exact changed tokens.
4. Choose **Apply repair**. One undo restores the manuscript edit.

The repair changes only citation-key tokens, retaining locators, prefixes,
suffixes, and prose. It reuses a safe established key or adds a unique managed
key for the chosen source. It never reassigns the ambiguous old key, edits other
papers, or replaces manual bibliography content. Other papers may still require
separate repairs. Unsupported citation syntax needs manual editing.

If the paper, sources, or bibliography changes during the preview, reopen it.
Cancellation or a failed reference write leaves the manuscript unchanged. An
interruption after a completed reference write, or undoing the manuscript edit,
may leave an unused bibliography entry; it is safe to keep. Repairs do not create
literature notes, rename files, or fetch missing citation data automatically.

## Reading the evidence while writing

In Live Preview, click a citation and choose **Open in reader**. Reading view
provides an arrow beside formatted citations and **Open in reader** beside
citation notes. Footnote numbers still navigate to their notes.

A single resolved source opens its literature note in the sidebar Reader. A group
or multiple notes for one source opens a searchable chooser; choose the exact
source or note. Unknown keys, conflicting ownership, and missing notes lead to
Sources for recovery instead of opening a guessed match.

The manuscript stays in its main tab. **Return to writing** returns to that tab
and restores its selection and scroll when the text and view mode still match.
If the text changed, Stratum focuses the editor without restoring stale offsets.
If the original tab was closed or changed to another file, it explains why it
cannot return. This navigation state lasts until the plugin unloads.

Desktop keyboard and narrow-sidebar interactions have been checked. Mobile
interaction remains untested. Representative CSL checks do not guarantee every
custom style or every Pandoc syntax extension.
