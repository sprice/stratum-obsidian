# Stratum user guide

Bring Zotero sources into Obsidian, keep your literature notes current, and use them while writing. For a product overview and installation instructions, see the [README](../README.md).

- [Connect your accounts](#connect-your-accounts)
- [Find and import sources](#find-and-import-sources)
- [Sync a library or collection](#sync-a-library-or-collection)
- [Browse your literature notes](#browse-your-literature-notes)
- [Understand your literature notes](#understand-your-literature-notes)
- [Write with citations](#write-with-citations)
- [Publish documents](#publish-documents)
- [Commands and hotkeys](#commands-and-hotkeys)
- [Enrichment](#enrichment)
- [Privacy and connections](#privacy-and-connections)

## Connect your accounts

1. Open **Settings → Stratum**.
2. Select **Sign in** and complete the browser-based email code flow.
3. Select **Connect Zotero** and approve access in your browser.
4. Return to Obsidian. Stratum settings show your account and Zotero connection.

A Stratum account and internet access are required for sign-in and Zotero authorization. Zotero access uses OAuth; you do not need to create an API key. The service handles cloud Zotero access, rate limiting, and cached search.

Choose your personal library and any group libraries under **Libraries** in Stratum settings. Sync is one way, from Zotero into Obsidian. Editing a literature note does not change the source in Zotero.

## Find and import sources

Run **Stratum: Open library view** from the command palette to open the sidebar's **Search** tab. Search your Zotero library by title, author, or year, optionally narrow the search to a collection, and choose a source to create or update its literature note.

Stratum imports supported Zotero source types, not just academic papers. It creates Markdown files with readable filenames, aliases, structured properties, source information, and available Zotero notes and annotations.

Tracked notes refresh automatically. Opening a literature note triggers a refresh; background cloud checks also keep tracked notes current. Cloud imports work without the Zotero desktop app running, including on mobile.

## Sync a library or collection

Desktop bulk sync imports directly from your local Zotero app.

1. Open Zotero on your desktop.
2. Sign in to Stratum and connect Zotero.
3. In **Settings → Stratum → Sync**, enable **Bulk sync**.
4. Open the Stratum sidebar's **Sync** tab, choose a library and optionally a collection, and start a sync.

With bulk sync enabled, Stratum watches the local Zotero app for changes and refreshes open literature notes as highlights and annotations change. Cloud refresh is used when local Zotero access is unavailable.

If Stratum cannot reach Zotero, check that the app is running and that its local API is available. The **Sync** settings include the local API port and, where available, the Zotero data directory. Most users can keep the defaults.

## Browse your literature notes

Select **Browse literature notes** in the Stratum sidebar or run **Stratum: Browse papers by collection**. The browser opens directly, returning to the existing view if it is already open. A new browser starts with all imported papers. This browser opens notes you have already imported; it does not import sources or create collection pages.

Use the **Collection** menu at the top to switch collections and the search field to filter by title, author, or year. Subcollections are included by default; collections with children offer an **Include subcollections** toggle. **All imported papers** and **Unfiled papers** are also available.

Choose **Table** in the layout menu to compare all imported papers or the selected
collection in the main pane. **Columns** selects up to eight bibliographic or
research properties alongside clickable source titles. Select a heading to sort;
select it again to reverse the order. Missing values stay last, and sorting applies
to the entire filtered collection before pagination. Choose **List** to return
to the title list. The browser saves its layout, columns, and sorting independently
of the Citations sidebar, including when switching collections or reopening Obsidian.

Research columns read properties recorded in your literature notes, using the same
options as the [Citations table](#compare-sources-in-a-table). Browsing and sorting
leave your notes unchanged; no working note or Dataview installation is needed.

Normal Obsidian link modifiers open notes in new tabs. The browser remembers the collection, query, and scroll position through workspace view state. Large results load in batches of 100.

Browsing works offline and without signing in. Membership reflects the last sync: Stratum saves collection keys in note properties and caches the library hierarchy locally. Older notes need a sync or refresh before appearing in collection-specific views. Until then, they remain visible in **All imported papers** and are not assumed to be unfiled.

If the hierarchy is unavailable, direct collection memberships remain browsable and the view explains that a sync is needed. Personal and group libraries remain distinct. One Zotero item has one canonical literature note even when it belongs to several collections. Browsing does not move or rename files.

## Understand your literature notes

Each note has imported content and a personal writing section separated by the **My Notes** callout (`[!stratum]`).

- The imported section contains source information, the abstract, Zotero notes, color-grouped highlights, and links back to Zotero, when available.
- Sync regenerates the imported section. Put your own writing below the **My Notes** boundary to preserve it across updates.
- Stratum-managed properties contain source metadata, collection membership, and available enrichment data.
- If the source is removed from Zotero, Stratum marks the note as deleted rather than deleting your vault file.

Under **Settings → Stratum → Workspace defaults**, choose the literature notes folder and the filename format for new notes:

| Format       | Example                         |
| ------------ | ------------------------------- |
| Readable     | `Smith 2026 - Example study.md` |
| Citation key | `@smith2026example.md`          |

Changing the format does not bulk-rename existing notes. Citation key filenames are generated from author, year, and title; they are separate from the established citation keys used in your manuscripts. Filename preferences do not determine citation identity.

## Write with citations

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

### Citation styles and previews

Choose the default style in **Settings → Stratum → Citations → Default citation style**.
The initial default is APA 7th edition. APA, MLA 9, Chicago 18 notes and
bibliography, IEEE, and NLM/Vancouver are bundled and initially available offline.
Papers inherit the default until you choose a style for that note.

**Choose default style** opens a searchable picker of your available styles.
Choosing a style saves the default immediately. **Choose available citation
styles** opens a searchable checklist covering Zotero's style repository.
Checking a style downloads and saves it immediately; unchecking hides it from
future choices without removing resources or changing existing notes. The current
default is marked **Default** and cannot be unchecked until you choose another.
The checklist shows enabled styles first and keeps saved styles accessible if
the catalog cannot load. Language changes are saved with **Apply language**.
The dialog shows a synthetic citation and reference example.

In the Citations tab, **Citation style for this note** switches immediately
between your available styles and shows the style currently in use.
An existing note style stays visible even if it is hidden from future choices.
Selecting a style saves it for that note, even if it matches the overall default.
**Manage citation styles** opens the style management dialog
directly over Stratum settings. The same dialog is available through
**Manage citation styles** under **Default citation style** in settings.

The command **Change citation style for this paper** also lets you override the
note's language. Its **Use default style** action removes both overrides. The
inline selector changes only the style and preserves any language override.
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
suppresses the automatic list. **Insert bibliography here** remains available for this
optional placement, but formatting stays in Reading view. Live Preview does not generate a reference
list or citation notes.

Note-based styles generate a numbered Notes section. Ordinary `[^note]`
explanatory footnotes share its sequence and may contain citations. Their
Markdown remains editable; citation-generated notes disappear or change when
switching styles. Nested explanatory footnotes and inline `^[note text]` notes
are not supported for citation formatting; use named `[^note]` definitions.
Unsupported notes keep the original Reading output and show a formatting error.

### Citations sidebar

Run **Stratum: Show citations for current note**, or select **Citations** in the
Stratum sidebar. Listing your sources uses local notes and the managed
bibliography; it does not require a connection or change the manuscript.
Fetching missing reference data is a separate action that requires Zotero access.

Each source appears once with its authors, year, title, selectable `@citekey`,
and separate counts for formal citations and literature-note links. Search
by title, author, year, or key, and sort by first appearance, author, or title.

- Select a title to open its literature note in a main-area tab. Existing tabs
  are reused, and the writing note stays open.
- Expand the occurrence count to see excerpts. Selecting one returns to the
  writing note and selects the reference. Reading view switches to editing mode
  for this action. If the text changed since the list was built, the panel
  refreshes instead of navigating to an outdated position.
- Pin the panel to keep its document while switching to another writing note.
  Without a pin, the panel follows writing notes but keeps the manuscript
  context when inspecting Stratum literature notes.

The panel recognizes Pandoc keys, including narrative citations, grouped
citations, suppressed authors, and braced keys. For example, `@example2024`
and `[see @example2024, p. 8; -@sample2023]` reference two sources. Locators
remain visible in occurrence excerpts; this feature does not edit them.

Obsidian wikilinks, embeds, and Markdown links count when they resolve to a
Stratum literature note. Ordinary links do not count. Embedded notes are not
recursively scanned. The current note's footnote text is included; frontmatter,
comments, and code are excluded. The Citations list is for navigation; style-based formatting appears in Reading view.

### Compare sources in a table

In **Citations**, choose **Table** from the layout menu. The table follows the
current writing note's citations and literature-note links, just like the list.
Pin Citations to keep comparing that note's sources while opening other notes.
Your document stays unchanged, and Dataview is not required.

Select **Columns** to choose up to eight properties alongside the source title.
Authors, year, and type are shown initially. Publication and collections are
also available. Select a column heading to sort; select it again to reverse
the order. Sources with missing values stay at the end. The original sort menu
returns to first appearance, author, or title order.

Research columns such as method, findings, and limitations read properties you
record in your literature notes. **Other properties** accepts comma-separated
property names, including spaces and hyphens. For example, a literature note
could have these user-owned properties:

```yaml
method: Interviews
findings:
  - Participants described different expectations across settings.
limitations: A single setting; transfer to other contexts needs checking.
research_status: Needs synthesis
```

Stratum preserves properties outside its managed set during sync. The table
displays scalar and list values; empty values appear as a dash. It does not
extract assessments from prose, read Dataview inline fields, or edit properties.
Keep judgments specific to one essay in that essay's working notes.

Source navigation, occurrence excerpts, and source-health actions remain in the
first column, including unresolved citations. Scroll horizontally in a narrow
sidebar to reach additional columns. Layout, columns, and column sorting are
saved with the Obsidian workspace while the Stratum view remains in its layout.

### Source health and recovery

Citations reports problems beside the affected citation while keeping the style
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

### Reference data and offline use

Sync now requests Zotero's structured CSL data, preserving source types, creator
roles, dates, and publication details. It retains this data in the vault-root
`stratum-references.json`, independently of the literature-note folder. Keep this
file along with `stratum.bib` when backing up the vault. Older imported notes can
be backfilled with **Refresh citation data**; this requires a Zotero connection
and fetches only missing references. Normal sync updates cached references.

Once reference data, a style, and its language are available locally, formatting
works without Zotero running or an internet connection. Missing or conflicting
sources leave citations as Markdown and show an explanation in Citations rather
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

### Consistent keys and repairs

Citation suggestions and the composer show the established insertion key from
`stratum.bib`, even if Zotero now supplies a different key. Existing historical
keys remain valid. Citations shows the keys actually used in the paper. The
literature note's `citation_key` records the supplied metadata; it does not
replace established bibliography ownership. Already-cited sources are preferred
in citation suggestions. Filename preferences do not determine citation identity.

For an unknown or conflicting key, choose **Repair citation** in Citations:

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

### Reading the evidence while writing

In Live Preview, click a citation and choose **Open in reader**. Reading view
provides an arrow beside formatted citations and **Open in reader** beside
citation notes. Footnote numbers still navigate to their notes.

A single resolved source opens its literature note in the sidebar Reader. A group
or multiple notes for one source opens a searchable chooser; choose the exact
source or note. Unknown keys, conflicting ownership, and missing notes lead to
Citations for recovery instead of opening a guessed match.

The manuscript stays in its main tab. **Return to writing** returns to that tab
and restores its selection and scroll when the text and view mode still match.
If the text changed, Stratum focuses the editor without restoring stale offsets.
If the original tab was closed or changed to another file, it explains why it
cannot return. This navigation state lasts until the plugin unloads.

Desktop keyboard and narrow-sidebar interactions have been checked. Mobile
interaction remains untested. Representative CSL checks do not guarantee every
custom style or every Pandoc syntax extension.

## Publish documents

On desktop, use the **Publish** sidebar tab to create PDF or Word snapshots of the
active note with its selected citation style. **Manage tools** in
**Settings → Stratum → Publishing → Publishing tools** opens installation help
and status checks for Pandoc and Tectonic. Created documents stay in hidden plugin storage
and appear when you select their source note; each row offers open, save a copy,
and confirmed delete actions. The tab is enabled by default. To hide it, open
**Settings → Stratum → Stratum tabs → Choose visible tabs** and uncheck **Publish**.

## Commands and hotkeys

Open Obsidian's command palette and search for **Stratum**. Assign shortcuts under **Settings → Hotkeys**.

| Command                              | What it does                                                |
| ------------------------------------ | ----------------------------------------------------------- |
| Open library view                    | Open the sidebar on Search.                                 |
| Browse papers by collection          | Browse imported literature notes by collection.             |
| Open literature note                 | Find an imported note and open it in the main workspace.    |
| Open literature note in reader panel | Find an imported note and open it in the sidebar Reader.    |
| Insert literature note link          | Insert a `[[wikilink]]` at the cursor.                      |
| Insert or edit citation              | Compose or edit Pandoc citations with groups and locators.  |
| Change citation style for this paper | Override the current paper's style and language.            |
| Refresh citation data                | Fetch missing CSL reference data for imported notes.        |
| Insert bibliography here             | Place an optional marker for Reading view's reference list. |
| Show citations for current note      | Inspect cited sources, source health, and recovery actions. |

## Enrichment

For sources with a DOI, Stratum requests metadata from [OpenAlex](https://openalex.org/). Available data appears in note properties and the imported body:

- **Impact:** citation count, citation percentile, field-weighted citation impact (FWCI), and a five-year citation trend.
- **Open access:** access status and a direct PDF link when available.
- **Topics and keywords:** topics, field/subfield hierarchy, and relevance-scored keywords, with wiki-links for backlinks.
- **Authorship:** author names, ORCID links, and institutional affiliations.
- **Funding:** funder names and award IDs.
- **Integrity:** a retraction warning when the source is flagged as retracted.

Availability depends on OpenAlex's coverage of the source. Only the DOI is sent for enrichment; your manuscript, personal notes, filenames, and annotations are not sent to OpenAlex.

## Privacy and connections

### Network access

- Cloud sync and session requests use the Stratum app's `/api/stratum` endpoint, which proxies authentication and functions to Supabase.
- Desktop sync connects directly to the Zotero app on localhost.
- Cloud imports fetch Zotero metadata, notes, and annotations through the service. Search metadata, including abstracts, and enrichment responses may be cached. Cache freshness is not a promise of automatic deletion.
- Finding and downloading additional citation styles contacts `www.zotero.org`. Additional formatting languages come from the Citation Style Language project on `raw.githubusercontent.com`. These requests identify resources, not your manuscript or reference data.
- Selecting Zotero, DOI, OpenAlex, or open access links opens the corresponding destination.

### Your writing and credentials

Your Obsidian manuscript and personal writing below **My Notes** are not uploaded. Stratum writes literature notes locally into your vault. Zotero notes and annotations are source material fetched for imports, distinct from the personal writing you add in Obsidian.

The plugin stores session tokens in Obsidian's platform-native `secretStorage` to stay signed in. It does not store your Zotero OAuth secret locally. Zotero OAuth secrets are encrypted server-side using AES-256, and database access is scoped per authenticated user.

### Analytics and diagnostics

The plugin has no telemetry, analytics, ad tech, or third-party tracking SDKs. Debug builds can write local sync timing and response-code diagnostics to Obsidian's developer console.

The Stratum website uses cookie-free Umami analytics for usage metrics. The managed service uses Sentry for technical error reporting with the Stratum account ID. Sentry user context does not include your email; request bodies, headers, cookies, and query parameters are removed from error events.

Citation formatting runs locally using citeproc-js. See [Third-party notices](../THIRD_PARTY_NOTICES.md) for attribution and licenses, and the [Stratum privacy policy](https://stratumnotes.com/privacy-policy) for service disclosures.

## Area annotation images

On desktop, Stratum can import images made with Zotero’s **Select Area** tool alongside their comments and page links. Install [Better BibTeX](https://github.com/retorquere/zotero-better-bibtex/releases), keep Zotero running, and make sure the item has a citation key and its PDF is available locally. Enable Zotero’s local API under **Settings → Advanced → Allow other applications on this computer to communicate with Zotero**.

Stratum asks Better BibTeX to generate the selected area image, then reads that PNG from Zotero’s local cache. Images are saved in an **Attachments** folder inside your configured literature note folder. The folder is created only when an image is imported successfully. Images and your personal writing are not uploaded to Stratum.

The existing **Zotero data directory** setting must point to your actual Zotero data directory if you use a custom location. No additional image setting is required.

If an image cannot be retrieved, the annotation’s comment and Zotero link still import. Previously imported images are preserved. Run a full library or collection sync to backfill older notes or retry missing images after installing Better BibTeX. Refreshing an individual literature note also retries its images.

Image filenames use a short lowercase title slug and the clipping’s annotation key, such as `stellar-motion-area-imgd1234.png`. Account IDs are not included. Filename collisions receive a numeric suffix without replacing existing files.

Repeated syncs reuse the same image filenames; changes to a title or citation key do not rename them. Stratum does not automatically delete old images, since other notes may reference them. Imported images work on mobile when your vault sync includes them; fetching new images requires desktop Zotero. Drawing annotations and full PDF downloads are not included.
