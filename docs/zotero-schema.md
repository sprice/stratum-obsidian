# Zotero metadata contract

Stratum imports Zotero items, including books, cases, statutes, reports, media,
web pages and academic articles. The shared normalizer is used by local note
sync, cloud item detail and cloud library search.

## Schema source

`src/zotero-schema-data.ts` is a data-only projection of the official
[Zotero schema](https://github.com/zotero/zotero-schema). The initial snapshot is
version 44, extracted from Zotero's installed `resource/schema/global/schema.json`.
It covers 40 item types, including internal attachment/note/annotation types.
Its header records the source hash. There are no runtime schema downloads.

To update, obtain an upstream `schema.json`, review its provenance and run:

```sh
pnpm exec node scripts/generate-zotero-schema.mjs /path/to/schema.json
pnpm check
```

Review the generated diff and add examples for new fields or types. The tests
exercise every declared base-field mapping as well as independent cases drawn
from real import bugs. Unknown or missing item types are not imported. Attachment, note and annotation
items are handled as children of supported items, never as literature notes.

## Normalization and ownership

- Type-specific fields map to Zotero's canonical base fields. For example,
  `caseName` becomes title and `dateDecided` becomes date. A nonempty specific
  field wins over a generic one; an empty specific field does not erase it.
- Creator roles and first/last/literal names are retained. Display names and
  filenames use the type's primary creator, falling back to editors. Translators
  remain translators. Institutional names and compound family names stay intact.
- `zotero_title`, `zotero_item_type`, `zotero_date`, `zotero_creators` and
  `zotero_fields` retain canonical metadata and populated source-schema fields.
  These are plugin-managed properties; custom properties remain user-owned.
- Existing files keep their paths, including previously incorrect generated
  names. Current metadata appears in note content, aliases and the collection
  browser. Previous aliases and personal writing below the managed boundary
  survive refresh. New files use the corrected metadata for naming.

Keeping existing paths protects established links. This change does not solve
historical target recovery after deleting notes, collision ownership during
recreation, or moving the configured root. See the
[literature note link contract](literature-note-link-contract.md).

## Unsupported items

Import checks the bundled schema before enrichment or any vault writes. A known
item type with missing title, date or creators is still supported. Unknown types
are skipped; existing notes remain unchanged. Bulk sync continues, counts skips
separately from failures and retains a per-run list in the Sync panel, including
item titles, types and links to Zotero. The list survives plugin restarts and is
replaced on the next bulk run. Manual import and opened-note refresh explain the
skip in a notice. Updating the bundled schema can enable new Zotero types later.

## Bibliographies

Export uses full titles, structured creators, type-appropriate BibTeX entries
and plain metadata without Obsidian link delimiters. Types without a standard
BibTeX equivalent use `misc`; unknown thesis degrees are not guessed.

New entries carry a Stratum ownership marker and an encoded generated baseline.
Sync refreshes only entries whose bodies still match that baseline and preserves
their citation keys. Citation insertion reuses the established key even when
Zotero metadata changes. Ambiguous collisions with unmarked entries are reported
instead of silently citing an unverified work. Manually edited entries, unrelated entries and old unmarked
entries are left untouched. Legacy entries cannot safely be auto-adopted because
there is no evidence that the user has not edited them. Refresh never creates a
bibliography by itself; inserting a citation does.
