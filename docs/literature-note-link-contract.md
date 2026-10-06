# Literature note link stability contract

Stratum literature notes are persistent targets for links from the rest of a
user's Obsidian vault. Users can delete their Literature Notes folder and sync
it again without having to repair those links. Fast recreation is useful only
if each link still resolves to the same Zotero item.

This document defines the plugin’s compatibility contract. Incoming backend
metadata must also preserve these guarantees. The implementation review below
distinguishes existing protections from gaps that still need work. Documenting the contract does not mean those
gaps have been fixed.

## Identity and link targets

The source identity is the tuple `libraryType / libraryId / itemKey`, stored as
`zotero_item_identity`. A personal-library item and a group-library item must
remain distinct even when their item keys match. Titles, authors, years, DOIs,
and citation keys are metadata, not substitutes for that identity.

An Obsidian link targets a filename or path, not Zotero frontmatter. The plugin's
insert-link command delegates to Obsidian to honor the preferred link format
and target-path setting, with optional display text. Changing an alias or display label
does not repair a changed target. Users can also write folder-qualified links,
Markdown links, and embeds themselves.

For example, a note that contains
`[[Smith 2020 - Example Study|Smith 2020]]` must still open the same paper after
the generated folder is deleted and rebuilt. Recreating that filename for a
different paper is a contract violation even though the link no longer appears
broken.

## Required behavior

1. **Recreation restores targets.** With the same source items and configured
   destination, deleting the generated folder and running a full sync must
   restore the previous targets for those items. A retained library version or
   an unchanged Zotero item version must not cause a missing note to be skipped.
2. **Ordering cannot change ownership.** Collection selection, pagination,
   concurrent workers, local versus cloud input, and item arrival order must
   not assign an existing target or collision suffix to a different identity.
   Identical titles and overlapping libraries must remain safe.
3. **Naming changes preserve compatibility.** Metadata corrections, filename
   format changes, sanitization rules, Unicode handling, title truncation, and
   plugin upgrades must not silently invalidate established targets. A change
   needs stable existing names or a migration that preserves old references,
   including reconstruction after deletion.
4. **User naming choices are respected.** Sync must not overwrite a manual
   filename choice while the note exists. For a folder-only rebuild to restore
   that choice, the name must survive outside the deleted folder. Moving the
   configured destination also requires an explicit migration strategy for
   folder-qualified references; a settings change alone cannot repair them.
5. **Source deletion does not delete the vault note.** When Zotero reports a
   deleted item, retain its existing note and link target and mark its source
   status. A Zotero duplicate merge that changes item identity needs deliberate
   handling; it is not automatically the same recreation case.
6. **Existing user writing remains protected.** Refreshing or rebuilding managed
   sections of an existing file must preserve user content above the synced-source
   notice, user aliases, and supported user frontmatter. Regeneration after
   the user deletes the entire file cannot recover writing that existed only
   in that file. Recovery of deleted personal writing requires a vault backup.
   Legacy notes migrate during sync: everything after the complete intact
   My Notes callout moves to the top without rewriting the personal text.
   The old callout and everything above it are managed; the new synced-source
   notice and everything below it are managed.

The guaranteed recreation case concerns the note target. Heading and block
references additionally depend on the referenced content still existing. Do
not promise recovery of deleted user headings, block IDs, or annotations that
have disappeared from Zotero.

## Current implementation review

| Area | Existing behavior | Contract limit |
| --- | --- | --- |
| Identity lookup | Frontmatter and `itemFileMap` associate files with library identity and item key. Cached paths and legacy matching reject conflicting explicit identities; updates recheck actual file contents. | A legacy item key without library metadata is still ambiguous. Existing legacy notes remain eligible for compatibility. |
| Inserted links | Obsidian generates the link using the preferred format and target-path setting, with optional display text. | Existing manually written unqualified links can still be ambiguous. Folder-qualified targets need consideration when guaranteeing resolution after recreation. |
| Fresh filenames | Readable names use authors, year, and a shortened title. The citekey format uses a generated fallback. | These are derived from current metadata and settings, not a permanent assignment to an identity. |
| Name collisions | Creation tries the first available generated name, then alphabetic suffixes, with an ASCII fallback when needed. Existing paths are skipped. | The assignment depends on availability and processing order. Concurrent bulk workers and different catalog orders can assign different names on a rebuild. A collision must not overwrite or retarget another paper. |
| Existing names | Existing files retain their paths on refresh, including previously generated and manually chosen names. | The name still lives in the note being deleted; no durable naming history restores it after deletion. |
| Renames | Refresh keeps the existing path, including manually moved managed notes. Naming preferences apply to newly created notes. | Recreating deleted notes still needs a durable filename registry; folder-setting changes do not migrate existing notes. |
| Stored paths | Rename and delete events update the file map; rebuilding the map reads surviving note frontmatter. | Deleted file entries are removed, and rebuilding replaces the map. It is a cache of live files, not a durable naming history. |
| Aliases | New managed aliases are added; previous managed and user-added aliases are retained during updates. | Retained aliases do not restore filename or folder-qualified links after deletion. |
| Full sync | Bulk catalog sync checks for an existing file and writes each selected item, rather than relying only on change versions. | The naming gaps above remain. An incremental refresh of tracked notes is not equivalent to recreating the whole library. |

The common rebuild with unchanged metadata, unchanged settings, and no name
collisions can reproduce the same filenames. That does **not** establish the
full contract. In particular, collision ownership, historical names, and
manual names after deletion are not guaranteed by the current code.

## Requirements for future changes

Treat naming and link targets as compatibility-sensitive public behavior. Any
change to sync, metadata normalization, filename generation, folder scope,
aliases, identity matching, or settings persistence must be reviewed against
this contract. Backend changes that affect incoming metadata must preserve
the same guarantees. Preserve the speed of full recreation by
separating identity lookup and name assignment from enrichment and note content
generation.

A durable identity-to-target registry outside the generated notes folder is
one possible implementation. It would need to retain assigned names on file
deletion, record manual renames, distinguish naming history from the live-file
cache, handle occupied paths safely, and migrate existing users. This is a
proposal, not functionality provided by `itemFileMap` today. A migration also
needs a strategy for users whose naming history was already lost.

Do not infer that aliases, a new naming algorithm, or Obsidian's automatic link
updates solve the contract without verifying the full delete-and-recreate
workflow. If naming state or source data has been reset or lost, report the
recovery limit rather than silently attaching old links to a different item.

## Acceptance checks

Use a disposable vault with a separate writing note containing plain links,
display-text links, folder-qualified links, Markdown links, and embeds to the
literature notes. Capture the identity each reference resolves to before and
after each operation, rather than checking only whether a target exists.

- Delete the generated folder, fully sync again, and verify every supported
  reference resolves to its original identity. Repeat after restarting the
  plugin so success does not depend on in-memory state.
- Rebuild colliding titles in reversed order, with different collection scopes,
  across personal and group libraries, and with concurrent workers.
- Repeat after correcting metadata, changing filename format, upgrading naming
  rules, and manually renaming a literature note. Verify the applicable name
  migration and reconstruction behavior.
- Repeat refresh tests with Obsidian's automatic link updates enabled and
  disabled. Check custom aliases and writing above the synced-source notice
  are preserved in existing files.
- Verify local and cloud metadata for the same identity produce compatible
  targets. Verify deleting an item in Zotero retains its existing vault note.
- Verify an occupied path never overwrites an unrelated file or silently makes
  an established link point to a different item.

These are acceptance requirements, not a claim of current test coverage.
Existing unit tests cover filename formatting, retained paths, link markup,
identity matching, and boundary protection. They do not establish complete
reconstruction or collision ownership across sync orders.

## Implementation references

- [Filename generation](../src/literature-note-filenames.ts)
- [File creation and collision handling](../src/literature-note-files.ts)
- [Existing note updates and Zotero deletion marking](../src/literature-note.ts)
- [Identity matching](../src/literature-note-matching.ts)
- [File map persistence and deletion handling](../src/plugin-note-index.ts)
- [Bulk recreation workflow](../src/plugin-bulk-sync.ts)
- [Link target and display text generation](../src/literature-note-links.ts)
- [Managed and user alias handling](../src/literature-note-frontmatter.ts)
- [Filename unit tests](../src/test/literature-note-filenames.test.ts)
- [User content preservation tests](../src/test/boundary-protection.test.ts)
