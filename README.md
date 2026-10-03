# Stratum

**Bring your Zotero library into Obsidian. Read, take notes, search, and write with citations in one place.**

Stratum turns your Zotero sources, notes, and highlights into structured literature notes in your vault. View your literature notes next to your essays and papers, follow citations back to your sources, and change citation styles without rewriting your paper.

No templates to configure. No API keys to manage. Sign in, connect Zotero, and start with a single source or import a whole library.

## From your library to your next essay or paper

### Your research, ready to work with

Search Zotero by title, author, or year and create a literature note inside Obsidian. Import personal and group libraries, including books, articles, reports, and other supported Zotero source types. Your notes include source details, abstracts, Zotero notes, and highlights grouped by color, with links back to Zotero.

Browse your imported notes by Zotero collection, including subcollections. A source has one literature note even when it belongs to several collections.

### Fresh highlights. Your own notes preserved.

When desktop bulk sync is enabled and Zotero is running, Stratum watches for changes and refreshes your open literature notes. Cloud refresh keeps tracked notes current when Zotero is closed or you're on mobile.

Add your thoughts in **My Notes**. Sync updates the imported material while preserving your writing below that boundary. If a source disappears from Zotero, Stratum marks its note as deleted instead of removing the file from your vault.

### Write with sources within reach

Insert and edit citations with multiple sources, page numbers, and other locators. Live Preview shows stable citation keys; Reading view formats citations and generates references or citation notes using your chosen style.

Choose APA, IEEE, Chicago Notes, or another CSL style. Switch styles without changing your document’s citation text. The **Sources** sidebar brings together the sources cited in your draft, flags citation problems, and lets you open a literature note in the sidebar Reader while keeping your paper in its main tab.

Citation formatting runs locally once the required reference data and style are available. Publishing and PDF/Word export are not included yet.

### More context for each source

For sources with a DOI, Stratum can add [OpenAlex](https://openalex.org/) data: citation counts, open access links, research topics, author affiliations, funding information, and retraction flags, when available. Structured properties also make your literature notes useful for Obsidian searches and tables.

## Install

Requires **Obsidian 1.11.4 or newer**.

1. Open **Settings → Community plugins** and turn on community plugins if prompted.
2. Select **Browse** and search for **Stratum** by Shawn Price.
3. Select **Install**, then **Enable**.

[Open Stratum in Obsidian](https://obsidian.md/plugins?id=stratum)

Update through **Settings → Community plugins → Check for updates**.

## Get started

1. Open **Settings → Stratum**, select **Sign in**, and enter the email code in your browser.
2. Select **Connect Zotero** and approve access to your Zotero account.
3. Run **Stratum: Open library view** from the command palette, search for a source, and create your first literature note.

To import a whole library or collection on desktop, keep Zotero open, enable **Bulk sync** in Stratum settings, and start a sync from the sidebar's **Sync** tab.

**[Read the user guide](docs/user-guide.md)** for sync, collection browsing, citation workflows, commands, and privacy details.

## Recommended Zotero plugins

These optional plugins complement Stratum. Install them in Zotero:

- **[Better BibTeX](https://github.com/retorquere/zotero-better-bibtex/releases)** — Generate and manage citation keys for Markdown and other writing workflows.
- **[ZotMeta](https://github.com/RoadToDream/ZotMeta/releases)** — Refresh article and book metadata using identifiers such as DOI, ISBN, and arXiv IDs. Better source metadata helps produce more complete literature notes and citations.

## Account and privacy

Stratum is open source and requires a [Stratum account](https://stratumnotes.com) and internet access for sign-in, Zotero authorization, and imports. Desktop bulk sync requires the Zotero app; existing literature notes remain ordinary Markdown files in your vault.

Your Obsidian drafts and writing in **My Notes** are not uploaded. Cloud imports fetch Zotero metadata, notes, and annotations through Stratum's service; search metadata and enrichment responses may be cached. The plugin has no telemetry or analytics. Citation formatting runs on your device.

Read [Privacy and connections](docs/user-guide.md#privacy-and-connections) for network access, credential storage, and web-service diagnostics.

## Contribute

Found a bug or have a suggestion? [Open an issue](https://github.com/sprice/stratum-obsidian/issues). To work on the plugin, see [Contributing](CONTRIBUTING.md).

Released under the [MIT License](LICENSE).
