# Stratum user guide

Use Stratum to bring Zotero sources into Obsidian, connect your ideas, write with citations, and create PDFs.

A **literature note** contains imported source material from Zotero as well as your own additional notes. A **writing note** is the Obsidian note where you develop an argument or write a draft.

For installation instructions, see the [README](../README.md).

- [Connect your accounts](#connect-your-accounts)
- [Create and sync literature notes](#create-and-sync-literature-notes)
- [Use your literature notes](#use-your-literature-notes)
- [Compare sources](#compare-sources)
- [Write with citations](#write-with-citations)
- [Publish documents](#publish-documents)
- [Commands and hotkeys](#commands-and-hotkeys)
- [Enrichment](#enrichment)
- [Privacy and connections](#privacy-and-connections)

## Connect your accounts

1. Open **Settings → Stratum**.
2. Select **Sign in**.
3. Complete the email code process in your browser.
4. Select **Connect Zotero**.
5. Approve access to your Zotero account in your browser.
6. Return to Obsidian.

Your account and Zotero connection appear in Stratum settings. Under **Libraries**, select your personal library and the group libraries you want to use.

You need a Stratum account and internet access to sign in, connect Zotero, and import sources through the cloud service.

Sync transfers source material from Zotero to Obsidian. Changes in an Obsidian literature note do not change the source in Zotero.

## Create and sync literature notes

### Sync a library or collection

Bulk sync imports sources from Zotero on the same computer. It requires desktop Obsidian.

1. Keep Zotero running on your computer.
2. Open **Settings → Stratum → Sync**.
3. Enable **Bulk sync**.
4. Open the Stratum sidebar's **Sync** tab.
5. Select a library.
6. Select a collection if you want to import only that collection.
7. Start the sync.

With bulk sync enabled, Stratum checks Zotero for changes and updates open literature notes. Cloud refresh keeps tracked notes current when local Zotero access is unavailable.

If Stratum cannot connect, make sure Zotero is running. In Zotero, enable **Settings → Advanced → Allow other applications on this computer to communicate with Zotero**.

Use the default **Zotero local API port** unless you changed it in Zotero. Set **Zotero data directory** if your data uses a custom location.

### Import one source

1. Run **Stratum: Open library view** from Obsidian's command palette.
2. In **Search**, search by title, author, or year.
3. Select a collection to narrow the results if necessary.
4. Select a source to create or update its literature note.

Cloud imports work on desktop and mobile. The Zotero desktop app does not need to be running.

Stratum imports books, articles, reports, and other supported Zotero source types. Notes contain available metadata, abstracts, Zotero notes, and annotations.

Opening a tracked literature note starts a refresh. Background checks also keep tracked notes current.

### Import area annotation images

Stratum can import images from Zotero's **Select Area** tool. Fetching these images requires desktop Zotero and [Better BibTeX](https://github.com/retorquere/zotero-better-bibtex/releases).

1. Install Better BibTeX in Zotero.
2. Keep Zotero running with its local API enabled.
3. Make sure the source has a citation key and a PDF available on your computer.
4. Sync the source, library, or collection.

Stratum saves imported images in **Attachments** inside your literature notes folder. The folder is created when an image imports successfully.

If an image cannot import, its comment and Zotero link still import. Refresh the note or run another sync to retry.

Sync preserves imported images and reuses their filenames. Stratum does not automatically delete unused images because other notes can link to them.

Imported images work on mobile when your vault sync includes them. Drawing annotations and full PDF downloads are not included.

## Use your literature notes

### Keep your writing safe

Write your own notes **above the Synced source content notice**. The notice and everything below it belong to Stratum. Sync can replace that content.

Keep the notice and its boundary marker in place. If the boundary is missing or damaged, Stratum stops the update to protect your writing.

Stratum also preserves your properties outside its managed set. Source metadata properties, such as authors and year, are managed by Stratum.

If Zotero deletes a source, Stratum marks its note as deleted. The note stays in your vault.

Deleting a literature note also deletes writing stored only in that file. A new sync cannot recover that writing. Use a vault backup for recovery.

### Set starting content and filenames

Open **Settings → Stratum → Workspace defaults**:

- **Literature note template** sets the starting content for your own notes.
- **Literature notes folder** sets the destination for literature notes.
- **Literature note filename format** sets the filename format for new notes.

Template changes apply to new notes and unchanged starter content. They do not replace your writing.

| Filename format | Example                         |
| --------------- | ------------------------------- |
| Readable        | `Smith 2026 - Example study.md` |
| Citation key    | `@smith2026example.md`          |

Changing the filename format does not rename existing notes. Changing the destination folder does not move existing notes.

Citation key filenames and manuscript citation keys have separate purposes. A filename choice does not change an established citation key.

### Browse imported notes

1. Select **Browse literature notes** in the Stratum sidebar.
2. Use **Collection** to select a collection or **All imported papers**.
3. Search by title, author, or year.
4. Select a title to open its literature note.

You can also run **Stratum: Browse papers by collection**.

Subcollections are included by default. Use **Include subcollections** to change this. **Unfiled papers** shows sources without a collection.

The browser shows imported notes. It does not import sources or create collection pages. Browsing works offline and without signing in.

Collection membership reflects the last sync. Sync or refresh notes if their collection information is missing.

One Zotero source has one literature note, even when it belongs to several collections. Personal and group libraries remain separate.

### Connect sources with your ideas

Keep source-specific analysis in its literature note. Use a writing note to connect sources, other vault notes, and your own ideas.

Run **Stratum: Insert literature note link** to link an imported source at the cursor. Use Obsidian links to connect other notes in your vault.

### Insert a source summary

Use a source summary to connect a source with your argument. The default summary includes a literature-note link and prompts for your own analysis.

1. Open your writing note in an editing view.
2. Place the cursor where you want the summary.
3. Run **Stratum: Insert source summary**.
4. Select an imported source.
5. Write under **Main argument**, **Evidence and limits**, and **Connection to my work**.

The summary inserts starting text, not an automatic analysis. It does not create a formal citation.

To change its format, open **Settings → Stratum → Workspace defaults → Source summary template** and select **Edit template**.

## Compare sources

Use a table to compare source metadata and research properties you record. Dataview is not required.

- To compare a library or collection, open **Browse literature notes**.
- To compare sources in a writing note, open **Citations** for that note.

In either view:

1. Select **Table** from the layout menu.
2. Select **Columns**.
3. Choose up to eight properties to show beside the source title.
4. Select a column heading to sort its values.
5. Select the heading again to reverse the order.

Missing values appear last. Choose **List** to return to the list view. Each view remembers its own layout, columns, and sorting.

Research columns read properties in literature notes. For example:

```yaml
method: Interviews
findings:
  - Participants described different expectations.
limitations: One study site.
```

Use **Other properties** for additional property names, separated by commas. Stratum preserves properties outside its managed set during sync.

Tables display single values and lists. Empty values appear as a dash. Tables do not extract findings from prose or read Dataview inline fields.

To compare one draft's sources while opening other notes, pin **Citations**. Scroll horizontally to see more columns in a narrow sidebar.

## Write with citations

### Insert or edit a citation

1. Open your writing note in an editing view.
2. Place the cursor where you want the citation.
3. Run **Stratum: Insert or edit citation**.
4. Search imported sources by title, author, year, or citation key.
5. Add one or more sources.
6. Add published page numbers or another locator if needed.
7. Review the Markdown preview.
8. Save the citation.

You can also type `@` to select a source. Searching imported sources works offline.

A **locator** identifies a page, chapter, section, paragraph, or volume. Use published page numbers, not the PDF viewer's page position.

Use **Move up** and **Remove** to change a citation group. **More options** contains prefix, suffix, and author-suppression controls.

Choose **Narrative** for one source when its author belongs in your sentence. A narrative citation cannot also suppress the author.

To edit a citation, place the cursor inside it and run the same command. Undo restores the previous manuscript text.

Stratum saves citations as Pandoc Markdown. For example:

```markdown
[see @example2026, pp. 42–44; -@sample2025, chap. 3]
@example2026 [p. xiv]
```

Unsupported syntax and unknown or conflicting keys require attention before an edit. Stratum leaves these citations unchanged and explains the problem.

Use **Insert literature note link** for a navigation link without a formal citation. Citation insertion searches imported notes, not sources still only in Zotero.

### Choose a citation style

Open **Settings → Stratum → Citations → Default citation style** to choose the plugin default. APA 7th edition is the initial default.

APA, MLA 9, Chicago 18 notes and bibliography, IEEE, and NLM/Vancouver are available offline with the plugin.

To add styles, select **Manage citation styles**. Select styles from Zotero's style repository to download them. A style preview shows an example citation and reference.

In **Citations**, use **Citation style for this note** to choose a style for one writing note. This choice preserves its language setting.

Run **Stratum: Change citation style for this paper** to change both style and language. **Use default style** removes both overrides.

Changing styles does not rewrite citation keys, page numbers, or manuscript prose. Hiding a style from future choices does not change notes that use it.

### Read formatted citations and references

| Obsidian view | Citation display                                     |
| ------------- | ---------------------------------------------------- |
| Source mode   | Original Markdown.                                   |
| Live Preview  | Citation keys, locators, and added text.             |
| Reading view  | Formatted citations, citation notes, and references. |

Reading view adds a reference list when the selected style supplies one. The list contains formally cited sources, not ordinary literature-note links.

Stratum does not write formatted references into the Markdown. Run **Stratum: Insert bibliography here** to set an explicit position with `<div id="refs"></div>`.

Note-based styles create a numbered **Notes** section. Named explanatory footnotes, such as `[^note]`, share its sequence and can contain citations.

Nested footnotes and inline `^[note text]` notes are not supported for citation formatting. Use named footnotes instead.

### Check sources in the Citations sidebar

Select **Citations** in the Stratum sidebar or run **Stratum: Show citations for current note**.

Each source shows its authors, year, title, citation key, and counts for citations and literature-note links.

- Search by title, author, year, or key.
- Select a source title to open its literature note.
- Expand an occurrence count to see excerpts.
- Select an excerpt to return to that reference in your writing note.
- Pin the panel to keep the current note's sources while you open other notes.

The panel includes references in footnotes. It excludes properties, comments, and code. It does not scan inside embedded notes.

### Read a source beside your draft

In Live Preview, select a citation and choose **Open in reader**. In Reading view, use the citation arrow or **Open in reader**.

A single source opens its literature note in the sidebar **Reader**. A citation group opens a source chooser.

Your writing note stays in its main tab. **Return to writing** returns to that tab. It restores the selection and scroll position when the text and view mode still match.

Stratum does not guess a source when a key is unknown or conflicting. It opens **Citations** so you can resolve the problem.

### Resolve citation problems

| Problem                 | Action                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Citation data missing   | Select **Fetch citation data**. This requires Zotero access.                                            |
| Unknown key             | Check the key, import the source, or use **Repair citation**.                                           |
| Conflicting ownership   | Use **Review matching sources**, then repair the citation if needed.                                    |
| Missing literature note | Sync the library to restore the note. Cached data can still format the citation.                        |
| Duplicate notes         | Inspect the matching notes. Duplicates do not block formatting when source identity and data are clear. |
| Style unavailable       | Download or select the style in citation settings.                                                      |

**Fetch citation data** updates cached references. It does not edit your draft or create a literature note.

To repair a key:

1. Select **Repair citation** in **Citations**.
2. Select the intended imported source.
3. Choose one occurrence or all matching occurrences in this writing note.
4. Review the source, replacement key, and proposed changes.
5. Select **Apply repair**.

Repair changes citation keys only. It preserves locators, prefixes, suffixes, and prose. It does not change other notes or manual bibliography content.

Undo restores the manuscript edit. If the note or reference data changes during the preview, open the repair again.

Stratum preserves established citation keys when source metadata changes. The literature note's `citation_key` property does not replace an established manuscript key.

Missing or conflicting sources show an explanation instead of incomplete formatted references. Unsupported explanatory footnotes can also stop note-based formatting.

### Use citations offline

Formatting works offline when the reference data, style, and language are available locally. Zotero does not need to be running.

Normal sync updates cached reference data. Run **Stratum: Refresh citation data** to fetch missing data for imported notes.

Back up `stratum.bib` and `stratum-references.json` at the vault root. Also back up the plugin directory to retain downloaded styles and languages.

Citation formatting does not require Pandoc. PDF publishing requires separate tools.

## Publish documents

PDF publishing is available in desktop Obsidian. Stratum creates PDFs on your computer. It does not upload your draft.

### Choose a template

Stratum includes two templates for everyday writing:

| Template          | Use                                       |
| ----------------- | ----------------------------------------- |
| General documents | Documents with flexible layout options.   |
| Academic papers   | Papers with document and author metadata. |

Both include citation-style and layout options. For specialized formats, see [Supported templates](#supported-templates).

### Set up publishing tools

1. Open **Settings → Stratum → Publishing → Publishing tools**.
2. Select **Manage tools**.
3. Use **Get Pandoc** and **Get Tectonic** to install any missing tools.
4. Select **Check again**.
5. Resolve any reported setup problem before you create a PDF.

Stratum finds installed tools automatically. Use **Advanced** to select custom tool locations if necessary.

The first PDF check can download typesetting files and take several minutes. Internet access is required when needed files are not cached.

Offline publishing requires all necessary tools and typesetting support files to be available locally.

### Create a PDF

1. Open your writing note.
2. Select **Publish** in the Stratum sidebar.
3. In **Create**, choose a **Template**.
4. Select a **Version** if the template offers one.
5. Select **Settings**.
6. Complete **Document details** and review **PDF options**.
7. Select **Done**.
8. Resolve any notices shown in **Create**.
9. Select **Create PDF document**.

Each created PDF is a saved copy of the note at that time. Later note edits do not change it.

### Edit document details and authors

**Publishing settings → Document details** contains the title and properties used by the selected template. Required fields appear first.

You can also run **Stratum: Edit publication details**. This opens the same settings window on desktop.

Open the note in an editing view to change its details. Select **Open note for editing** if prompted.

- Use **Add author** to create an author entry.
- Enter the author's name.
- Enter an email if the template requires one.
- Use **Add affiliation** for each affiliation.
- Use the arrow controls to change author order.
- Use the remove controls to remove an author or affiliation.

Academic papers allow optional email and affiliations. Author emails do not appear in the PDF.

**Use existing authors** creates grouped entries from author properties already in the note. Assign affiliations to the individual authors yourself.

For General and Academic templates, **Date** and **Keywords** controls enable those fields. Turning a field off preserves its saved value and omits it from the PDF.

Changes save to the note as you edit. **Done** saves pending text. If the note changes elsewhere, review the conflict before applying or discarding your draft.

On mobile, edit publication metadata through Obsidian's native Properties or YAML. Publishing controls and PDF history are available only on desktop.

### Set PDF options

**Title source** selects a title property or a title in the document.

General and Academic templates offer **Citation style** and **Advanced layout**. Use these controls for fonts, page layout, and other template options.

Template-specific requirements and options are listed under [Supported templates](#supported-templates).

**Reset to defaults** resets template options. It preserves document metadata and citation choices.

**Remove unused frontmatter** removes empty properties used by the current template settings. It preserves populated values and unrelated properties. Undo restores removed properties.

To configure reusable templates, open **Settings → Stratum → Publishing → Publishing templates** and select **Manage templates**.

### Preview and save PDFs

Open **Publish → Documents**. Choose **PDF documents for this note** or **All published PDF documents**.

Each entry has these actions:

- **Preview PDF** opens a preview in Obsidian.
- **Open source note** opens the note used to create the PDF, if it still exists.
- **Save as** saves a copy to a location you choose.
- **Delete** opens a confirmation before removing the stored PDF.

Deleting a stored PDF does not delete the source note or copies saved elsewhere.

Stratum stores PDFs under `<vault config>/stratum/published`. Back up this folder if you want to retain PDF history.

### Supported templates

These templates provide specialized publication formats. Use the shared publishing workflow above and follow the requirements for your selected template.

#### AASTeX

The [AASTeX](https://journals.aas.org/aastex-package-for-manuscript-preparation/) template uses the American Astronomical Society’s document class and bibliography style.

##### Requirements

Every author needs a name, email, and affiliation. Author emails do not appear in the PDF.

When **Title source** uses the document title, the title must be a leading `#` heading.

##### PDF options

- **Show line numbers**.
- **Show draft date header**.
- **Headings already contain numbers**.

Review any heading-number warnings before publishing. AASTeX adds its own section numbers. Inconsistent existing numbers can cause duplicate numbering.

##### Versions

Select the template version in **Publish → Create**. If the selected version is unavailable, review the notice. Select **Use installed version** to approve the installed package.

##### Support files

AASTeX is supplied with the plugin. For cited PDFs, Stratum downloads the required bibliography style from AAS when no verified local copy is available.

Stratum checks the file before saving or using it. The cached file contains no manuscript or reference data.

## Commands and hotkeys

Open Obsidian's command palette and search for **Stratum**. Assign shortcuts under **Settings → Hotkeys**.

| Command                              | Purpose                                             |
| ------------------------------------ | --------------------------------------------------- |
| Open library view                    | Open the Stratum sidebar on Search.                 |
| Browse papers by collection          | Browse imported literature notes.                   |
| Open literature note                 | Open an imported note in the main workspace.        |
| Open literature note in reader panel | Open an imported note in the sidebar Reader.        |
| Insert literature note link          | Insert a link at the cursor.                        |
| Insert source summary                | Insert a source link and prompts for your analysis. |
| Insert or edit citation              | Add or edit sources and locators in a citation.     |
| Change citation style for this paper | Set a style and language for the writing note.      |
| Refresh citation data                | Fetch missing reference data for imported notes.    |
| Insert bibliography here             | Set the reference list position in Reading view.    |
| Show citations for current note      | Inspect sources and resolve citation problems.      |
| Edit publication details             | Open publishing settings on desktop.                |

## Enrichment

For sources with a DOI, Stratum requests additional data from [OpenAlex](https://openalex.org/). Available data appears in note properties and imported content.

| Data        | Examples                                                                  |
| ----------- | ------------------------------------------------------------------------- |
| Impact      | Citation counts, percentiles, field-weighted impact, and citation trends. |
| Open access | Access status and a PDF link.                                             |
| Topics      | Research topics, fields, and keywords.                                    |
| Authors     | ORCID links and institutional affiliations.                               |
| Funding     | Funder names and award IDs.                                               |
| Retractions | A warning when OpenAlex flags the source as retracted.                    |

Coverage varies by source. Stratum sends only the DOI to OpenAlex, not your draft, personal notes, filenames, or annotations.

## Privacy and connections

### Network access

- The Stratum service handles sign-in, Zotero authorization, cloud imports, and enrichment.
- Desktop sync connects to Zotero on your computer.
- Cloud imports fetch Zotero metadata, notes, and annotations. The service can cache search metadata, abstracts, and enrichment responses.
- Additional citation styles come from `www.zotero.org`.
- Additional citation languages come from the Citation Style Language project on `raw.githubusercontent.com`.
- AASTeX bibliography-style downloads contact `journals.aas.org`. Tectonic can download typesetting support files.
- Selecting an external source link opens its destination.

Style and language requests identify resources. They do not contain your draft or reference data.

### Your writing and credentials

Stratum does not upload your Obsidian drafts or personal writing in literature notes. Zotero notes and annotations are imported source material.

The plugin stores session tokens in Obsidian's `secretStorage`. It does not store your Zotero OAuth secret locally.

The service encrypts Zotero OAuth secrets and restricts database access to the authenticated user.

### Analytics and diagnostics

The plugin has no telemetry or analytics. Debug builds can write local sync timing and response codes to Obsidian's developer console.

The Stratum website uses cookie-free Umami analytics and Sentry for technical errors with the Stratum account ID.

Sentry user context excludes email. Error events omit request bodies, headers, cookies, and query parameters.

Citation formatting runs locally with citeproc-js. See [Third-party notices](../THIRD_PARTY_NOTICES.md) for licenses and attribution.

See the [Stratum privacy policy](https://stratumnotes.com/privacy-policy) for service details.
