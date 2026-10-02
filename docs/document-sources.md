# Sources for the current note

Run **Stratum: Show sources for current note**, or select **Sources** in the
Stratum sidebar. No Pandoc installation, network connection, or additional
settings are needed. The panel reads local notes and the managed bibliography;
it does not modify the manuscript.

## Reading and navigation

Each source appears once with its authors, year, title, selectable `@citekey`,
and separate counts for formal citations and literature-note links. Search
by title, author, year, or key, and sort by first appearance, author, or title.

- Select a title to open its literature note in a main-area tab. Existing tabs
  are reused, and the writing note stays open.
- Expand the occurrence count to see excerpts. Selecting one returns to the
  writing note and selects the reference. Reading view switches to editing mode
  for this action. If the text changed since the list was built, the panel
  refreshes instead of navigating to an outdated position.
- Select the document name to return to it without selecting a reference.
- Pin the panel to keep its document while switching to another writing note.
  Without a pin, the panel follows writing notes but keeps the manuscript
  context when inspecting Stratum literature notes.

## Recognized references

The panel recognizes Pandoc keys, including narrative citations, grouped
citations, suppressed authors, and braced keys. For example, `@example2024`
and `[see @example2024, p. 8; -@sample2023]` reference two sources. Locators
remain visible in occurrence excerpts; this feature does not edit them.

Obsidian wikilinks, embeds, and Markdown links count when they resolve to a
Stratum literature note. Ordinary links do not count. Embedded notes are not
recursively scanned. The current note's footnote text is included; frontmatter,
comments, and code are excluded. This is source navigation, not a bibliography
formatter or a complete Pandoc document processor.

Citation keys match local literature-note metadata and established ownership
markers in `stratum.bib`. Older owned keys remain usable after metadata updates.
Multiple references to one source are grouped by its Zotero library and item
identity. Missing keys, conflicting identities, duplicate notes, and recognized
sources without a literature note are reported rather than guessed. Older
unmarked bibliography entries do not establish source identity by themselves.

**Insert citation** retains the previous `insert-pandoc-citation` command ID,
so keyboard shortcuts keep working. **Insert literature note link** remains a
separate action. Both pickers display citation keys.

## Validation boundaries

Automated tests use synthetic fixtures for parsing, identity matching, editor
updates, document following, pinning, stale reads, and occurrence navigation.
Visual layout and host-specific interactions still need an Obsidian smoke test:
open a synthetic draft, insert both reference forms, edit citations, inspect
sources, switch drafts, pin/unpin, and navigate occurrences in editing and
Reading views. Check narrow sidebars, keyboard navigation, and light/dark themes.
