# Stratum

**From Zotero notes to a finished paper, all in Obsidian.**

Read and annotate in Zotero. Use Stratum to bring your sources into Obsidian, connect them with your ideas, and develop your argument. Write in your preferred citation style, then create a polished PDF.

**[Install Stratum in Obsidian](https://community.obsidian.md/plugins/stratum)**

**[Read the user guide](docs/user-guide.md)**

**[Join the Discord community](https://discord.gg/GvGQuaSgzF)**

## Bring your next paper together

### Read and collect

Turn sources from your personal and group Zotero libraries into literature notes. Import source details, abstracts, Zotero notes, and highlights with links back to Zotero. Browse imported notes by collection, including subcollections.

Sync keeps imported material current. Write your own notes **above the Synced source content notice** so Stratum preserves them during sync.

For sources with a DOI, available [OpenAlex](https://openalex.org/) data adds context such as citation counts, open access links, and retraction flags.

### Connect and compare

Link literature notes with other notes and ideas in your vault. Insert a source summary with prompts for your own analysis, then build your argument in a writing note.

Compare sources in tables using metadata and research properties you record, such as methods, findings, and limitations. Dataview is not required.

### Write and cite

Compose citations with multiple sources, page numbers, and other locators. Choose APA, IEEE, Chicago Notes, or another CSL style. Reading view formats citations and generates bibliographies or citation notes.

The **Citations** sidebar brings your draft's sources together and flags citation problems. Open a source in the sidebar **Reader** while keeping your draft in its main tab.

Switch citation styles without rewriting your prose. Formatting works offline when the required reference data, style, and language are available locally.

### Publish your paper

Create PDFs on your computer with **General documents** or **Academic papers**. Set document details, author information, citation style, and layout options. Preview your PDFs in Obsidian and save copies to share.

Enable templates in **Settings → Publishing → Manage templates**, or use the gear beside **Publish → Create → Template**. All templates start disabled, including after upgrade; saved note choices are retained. Enabling **AASTeX** downloads pinned class and bibliography resources directly from `journals.aas.org`; no manuscript or reference data is sent. Installed files are verified and reused offline, provided the compiler’s supporting packages and fonts are also cached.

Use **AASTeX** for an astronomy journal format. See [Supported templates](docs/user-guide.md#supported-templates) for its requirements and options.

## Get started

1. [Install Stratum in Obsidian](https://community.obsidian.md/plugins/stratum) and enable the plugin.
2. Open **Settings → Stratum**, select **Sign in**, and complete the email code process in your browser.
3. Select **Connect Zotero** and approve access to your Zotero account.
4. Keep Zotero running on the same computer. Enable **Bulk sync** under **Settings → Stratum → Sync**, then sync a library or collection from the sidebar's **Sync** tab.

To import one source on desktop or mobile, run **Stratum: Open library view**, search for a source, and select it.

**[Read the user guide](docs/user-guide.md)** for sync, source summaries, comparison tables, citations, and publishing instructions.

Update through **Settings → Community plugins → Check for updates**.

## Requirements and privacy

Stratum requires **Obsidian 1.11.4 or newer**, a [Stratum account](https://stratumnotes.com), and internet access for sign-in, Zotero authorization, and cloud imports. Bulk sync and PDF publishing require desktop Obsidian. Publishing also requires Pandoc and Tectonic; the guide explains setup.

Your literature notes are Markdown files in your vault. Stratum does not upload your Obsidian drafts or personal writing. Cloud imports use Stratum's service to fetch Zotero source material. The plugin has no telemetry or analytics.

Read [Privacy and connections](docs/user-guide.md#privacy-and-connections) for service, caching, and network details.

## Optional Zotero plugins

Install [Better BibTeX](https://github.com/retorquere/zotero-better-bibtex/releases) in Zotero to manage citation keys and import area annotation images on desktop.

## Community and contributing

[Join the Stratum community on Discord](https://discord.gg/GvGQuaSgzF) to ask questions, share your research workflow, and help shape Stratum.

Found a bug or have a suggestion? [Open an issue](https://github.com/sprice/stratum-obsidian/issues). To work on the plugin, see [Contributing](CONTRIBUTING.md).

Stratum is open source, released under the [MIT License](LICENSE).
