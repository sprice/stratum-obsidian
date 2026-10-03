# Native source tables

Research checked on 2026-10-03. This feature supports comparing a working
note's sources without adding query blocks to the manuscript or depending on
another community plugin.

## Evidence and decisions

- [Dataview's metadata documentation](https://blacksmithgu.github.io/obsidian-dataview/annotation/add-metadata/)
  distinguishes indexed properties from prose. Research columns therefore read
  recorded properties; they do not infer findings or limitations.
- [Obsidian Bases](https://obsidian.md/help/bases) already provides file/property
  views. Stratum's contribution is its document-source resolution, which also
  recognizes Pandoc citations and reports missing or conflicting references.
- [A firsthand literature-review workflow](https://forum.obsidian.md/t/how-to-use-dataview-to-extract-data-from-bullet-points/96091)
  asks to compare methods, findings, limitations, and critiques. This supports
  optional research columns, rather than only another bibliographic catalogue.
  It is qualitative evidence, not a measure of demand across all users.
- [Obsidian's official API guidance](https://github.com/obsidianmd/obsidian-api)
  identifies MetadataCache and Workspace as the host interfaces and documents
  lifecycle registration. The table uses these APIs and the existing Sources
  controller's subscriptions, debouncing, and ownership checks.

## Implementation boundaries

The table is an optional Sources layout, not a general vault query language.
It reuses citation and link parsing, diagnostics, pinning, and navigation.
Metadata is read from the host cache when rendering. Sorting changes a copy of
the displayed rows; it does not reorder or rewrite a manuscript. User values
are rendered as text, never HTML or executable expressions.

Column choices and sorting belong to the view's workspace state, not synced
literature-note metadata. Restored state is validated and bounded to eight
optional columns. Missing values sort last in both directions. Native table
headers expose sorting state, and the results container supports keyboard and
horizontal scrolling in narrow panes.

No dependencies, network requests, source normalization, sync behavior, or
managed-note schemas are added. Property editing, block-level extraction,
general filters, and inferred assessments are outside this first version.
