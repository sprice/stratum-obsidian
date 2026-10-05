# Publish documents on desktop

The **Publish** sidebar tab creates PDF and Word (.docx) snapshots of the selected
Markdown note. It follows the active note in the main workspace and keeps that
selection when you focus the sidebar. Editing and Reading view both work.

## First-time setup

1. Open **Settings → Stratum → Publishing → Publishing tools** and choose
   **Manage tools**. When setup is
   incomplete, the Publish tab offers **Set up in settings** to open plugin settings.
2. Setup automatically finds Pandoc and Tectonic, including standard Homebrew,
   MacPorts, and user installation locations. Each tool shows **Detected** as soon
   as it is found; **Ready** means a sample document was successfully created.
3. If a tool is missing, use the installation links shown for that tool. On macOS,
   Homebrew users can copy an installation command. Installation happens outside
   Obsidian; Stratum does not download or install executables. Choose **Check
   again** after installation.
4. When Tectonic is detected, choose **Enable PDF** to verify PDF conversion.
   Tectonic may download fonts and typesetting support files on the first run.
   Allow several minutes and an internet connection. Checks use a synthetic
   sample, never your note. Word is checked automatically when setup opens.
5. For custom installations, expand **Advanced** to browse for an executable or
   enter its path. **Use automatic detection** clears custom paths and checks
   again. Reopening incomplete setup also checks for newly installed tools.

Successful setup is remembered in the vault's plugin settings. Publish uses that
saved readiness immediately after restarting Obsidian. Once per launch, a silent
background check confirms that the tools can still run; it does not create a
sample PDF or show checking text. Changing executable paths clears saved readiness.
Use **Check again** in setup to explicitly repeat the full conversion checks.

Successful publications do not run additional support checks. If conversion fails,
Stratum checks the tools and tests the affected format using a synthetic document.
Missing tools or a failed sample conversion update saved readiness and show setup
guidance. If the sample succeeds, support stays enabled and the original document
error remains visible. Cancelling a publication and unsupported note content do not
clear verified support.

Word can be used while PDF setup is incomplete. Tool errors appear in setup and
can be retried. On macOS, allow a downloaded executable through the operating
system's normal security controls if it is blocked. On Linux, use an executable
archive appropriate for your distribution and CPU. Executable paths are specific
to each computer; reselect them if vault settings were copied from another device.

## Create and manage documents

Choose **PDF** or **Word** from **Choose file type**, then choose **Create PDF Doc**
or **Create Word Doc**. Stratum captures the note text and citation preferences at
that moment. Each click creates a separate document named from the note title,
such as **Example document.pdf**. If a name is already taken, Stratum uses
**Example document(2).pdf**, **Example document(3).pdf**, and so on. Word documents
use the same pattern with **.docx**. Save as suggests this filename. Existing
publications keep their filenames. The file type resets after successful publishing
and whenever you leave the Publish tab.

Citations use the same formatting as Stratum's Reading view, including the note's
citation style and language overrides. Footnotes become native document footnotes.
Bibliographies keep their explicit placement, or appear at the end. The source note
is left unchanged. Headings, emphasis, lists, quotes, tables, external links, and
vault images are preserved with document formatting rather than Obsidian theme CSS.
Wikilinks become their displayed labels. Properties and Obsidian controls are omitted.

The list below the controls shows all of that note's PDF and Word documents,
newest first. Each row provides:

- **Preview** (eye, PDF only): open the actual PDF in a main-pane tab with page
  navigation, zoom, and selectable text. The file stays in hidden publication
  storage. The sidebar keeps showing its source note's publications.
- **Save as**: choose a destination in the native save dialog and save a copy. The
  stored document remains in the list. Cancelling the dialog makes no changes.
- **Delete**: confirm removal of the stored document. Source notes and saved copies
  elsewhere remain intact.

Word documents have Save as and Delete actions. Save a copy to open it in Word.
Deleting a PDF also clears any open preview of it.

To hide the tab, open **Settings → Stratum → Stratum tabs → Visible tabs**,
choose **Choose visible tabs**, and uncheck **Publish**.
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
