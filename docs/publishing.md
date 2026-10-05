# Publish documents on desktop

The **Publish** sidebar tab creates PDF and Word (.docx) snapshots of the selected
Markdown note. It follows the active note in the main workspace and keeps that
selection when you focus the sidebar. Editing and Reading view both work.

## First-time setup

1. Choose **Set up publishing** in the Publish tab, or open **Settings → Stratum →
   Publishing → Publishing setup**.
2. Install [Pandoc](https://pandoc.org/installing.html) for Word. The setup screen
   links to the official installation instructions for your operating system.
3. Install [Tectonic](https://tectonic-typesetting.github.io/book/latest/installation/)
   for PDF. Extract its executable into a permanent folder and choose it using
   **Choose Tectonic file**. macOS Homebrew users can copy the combined installation
   command from the setup screen. Installation happens outside Obsidian; Stratum
   does not download or install executables.
4. Choose **Check again** to detect tools and verify a real Word conversion. If an
   installed tool is not found, choose its executable or enter its full path under
   **Advanced: executable paths**.
5. Choose **Finish setup** to verify PDF conversion. Tectonic may download fonts
   and typesetting support files on the first run. Allow several minutes and an
   internet connection. Checks use a synthetic sample, never your note.

Word can be used while PDF setup is incomplete. Tool errors appear in setup and
can be retried. On macOS, allow a downloaded executable through the operating
system's normal security controls if it is blocked. On Linux, use an executable
archive appropriate for your distribution and CPU. Executable paths are specific
to each computer; reselect them if vault settings were copied from another device.

## Create and manage documents

Choose **PDF** or **Word** from **Choose File Type**, then choose **Create PDF Doc**
or **Create Word Doc**. Stratum captures the note text and citation preferences at
that moment. Each click creates a separate document with a unique filename.

Citations use the same formatting as Stratum's Reading view, including the note's
citation style and language overrides. Footnotes become native document footnotes.
Bibliographies keep their explicit placement, or appear at the end. The source note
is left unchanged. Headings, emphasis, lists, quotes, tables, external links, and
vault images are preserved with document formatting rather than Obsidian theme CSS.
Wikilinks become their displayed labels. Properties and Obsidian controls are omitted.

The list below the controls shows that note's documents, newest first. Filter by
**All file types**, **PDF**, or **Word**. Each row provides:

- **Open**: open the stored document in the system's default application. Saving
  edits in that application changes this stored document.
- **Save as**: choose a destination in the native save dialog and save a copy. The
  stored document remains in the list. Cancelling the dialog makes no changes.
- **Delete**: confirm removal of the stored document. Source notes and saved copies
  elsewhere remain intact.

To hide the tab, disable **Settings → Stratum → Publishing → Show Publish tab**.
This keeps existing documents.

## Storage and supported content

Documents and their catalog are stored through Obsidian's file adapter under
`<vault configuration folder>/stratum/published/`, normally
`.obsidian/stratum/published/`. They are still files inside the vault directory,
but do not appear as ordinary vault notes or attachments. Include this hidden
folder in backups. Syncing this folder depends on your backup or sync tool;
Stratum does not provide cross-device document sync.

Renaming or moving a source note while Stratum is running preserves its document
history. Deleting the source retains the exported files on disk; a new note at
that path does not inherit them. There is no orphan-document browser. Moves made
while Stratum is not running cannot currently be reconciled automatically.

Unresolved citations block publishing with recovery guidance. Vault PNG and JPEG
images are embedded directly; SVG, GIF, and WebP are converted to PNG (animations
use a still frame). Remote images, embedded notes/PDFs/audio/video, raw HTML media,
and rendered math or diagrams are unsupported and produce an explanation. Replace
these with vault image embeds when publishing. Third-party renderers are not
expected to reproduce interactive content in the exported document.

Conversion runs locally. Temporary files are removed after success, failure, or
cancellation. Tectonic may need an internet connection again for support files not
already cached. Native open/save dialogs use Obsidian's current Electron bridge;
if that bridge is unavailable, Stratum reports the problem rather than silently
choosing a save destination. Publishing is hidden on mobile.

## Contributor validation and manual checks

Automated coverage includes source snapshots, note selection, settings migration,
CSL formatting and native footnote preparation, catalog reload and moves, write
rollback, collision handling, process errors/cancellation/timeouts, desktop guards,
and a mocked native save dialog. Real Pandoc tests inspect DOCX XML. A real PDF
setup test runs when both tools are installed; use `STRATUM_TEST_PANDOC` and
`STRATUM_TEST_TECTONIC` for custom test executable paths.

Remaining hands-on checks before release:

- On macOS, Windows, and Linux, complete setup with missing and installed tools;
  verify executable selection, operating-system permissions, first PDF downloads,
  cancellation, retry, and offline conversion after support files are cached.
- In Obsidian, switch notes and focus the sidebar in Editing and Reading view;
  verify the tab toggle, narrow sidebar layout, reload persistence, and note moves.
- Inspect Word and PDF output for each supported citation style, mixed footnotes,
  explicit bibliography placement, lists, tables, wiki labels, and vault images.
- Exercise native open/save (including cancellation and overwrite prompts) and
  delete confirmation. Check edited Word files and separately saved copies.
- Confirm mobile startup and existing sidebar tabs still work with publishing
  settings copied from desktop.
