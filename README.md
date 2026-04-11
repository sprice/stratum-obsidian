# Stratum

Stratum creates structured literature notes in Obsidian from your Zotero library. No custom templates, no manual API key setup, no setup project before you can take notes. It generates readable markdown and keeps managed sections in sync while leaving your own writing alone.

> **Requires a Stratum account**
>
> Stratum is an open-source plugin paired with a [Stratum](https://stratumnotes.com) account. You need an account and internet access, but the core workflow is free to start. Sign-in, Zotero auth, sync, and enrichment all run through Stratum's service.

Stratum works two ways. When the Zotero app is open on your desktop, Stratum can import your whole library at once and refresh your open notes the moment you highlight or annotate something in Zotero. When the Zotero app is closed, or when you're on mobile, Stratum keeps your notes fresh through its cloud service instead. You don't need to pick a mode. Stratum uses whichever one is available.

## Features

- Search your Zotero library inside Obsidian.
- Create literature notes with readable filenames, aliases, and useful frontmatter.
- Sync personal and group Zotero libraries.
- Pull in all your Zotero notes and annotations.
- Group highlights by color, with deep links back to Zotero.
- Import a whole Zotero library, or a single collection, in one pass straight from the Zotero app.
- Refresh your open literature notes in the background the moment you highlight or annotate in Zotero.
- Rewrite only Stratum's managed section and preserve everything below the `[!stratum]` boundary callout.
- Mark notes as deleted if the source item disappears from Zotero instead of deleting the file from your vault.
- Insert `[@citekey]` pandoc citations and auto-manage a `stratum.bib` file.
- Enrich notes with citation counts, impact metrics, open access links, topics, keywords, funder data, and more via OpenAlex.

## Install

Stratum requires Obsidian `1.11.4` or newer.

While we wait on Community Plugin approval, install Stratum with [BRAT](https://tfthacker.com/BRAT):

1. Install the [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) plugin from Obsidian's **Community plugins** browser.
2. Open **BRAT** settings and choose **Add Beta plugin**.
3. Enter `https://github.com/sprice/stratum-obsidian` as the plugin repository.
4. Let BRAT install the plugin, then enable **Stratum** in **Settings -> Community plugins**.
5. Use BRAT to pull future Stratum updates.

## Setup

1. Open **Settings -> Stratum**.
2. Click **Sign in** and finish the browser-based email code flow.
3. Click **Connect Zotero** and approve Zotero access in the browser.
4. Open the Stratum library view.
5. Search by title, author, or year and create a literature note.

After that, Stratum keeps tracked notes fresh automatically. When you open a literature note, Stratum quietly refreshes it so metadata, highlights, and annotations stay current.

### Import your whole library

If you have the Zotero app installed on your desktop, you can skip searching and import everything at once.

1. Make sure the Zotero app is open.
2. In **Settings -> Stratum**, turn on **Bulk sync**.
3. Pick the library, and optionally a single collection, you want to import.
4. Open the **Sync** tab in the Stratum side panel and start a sync.

With bulk sync on, Stratum also watches the Zotero app for changes. Highlight or annotate a paper in Zotero and the matching note in Obsidian refreshes on its own, even while you're reading it.

## Note format

Each generated note has a managed section and a user section separated by a `[!stratum]` boundary callout.

- The managed section includes a reference block, abstract, imported Zotero notes, grouped highlights, and Zotero deep links.
- The user section starts below the `[!stratum]` boundary callout.
- Sync rewrites the managed section only.
- Your writing below the boundary callout is preserved across updates.

## Commands

Use the side panel to discover papers, read existing literature notes, and import your whole library. Use keyboard commands to reference literature notes while writing.

| Command                              | Description                                                 |
| ------------------------------------ | ----------------------------------------------------------- |
| Open library view                    | Open the Stratum side panel on the Search tab               |
| Open literature note                 | Search your literature notes and open one in the editor     |
| Open literature note in Reader panel | Search your literature notes and open one on the Reader tab |
| Insert literature note link          | Insert a `[[wikilink]]` to a literature note at the cursor  |
| Insert pandoc citation                | Insert `[@citekey]` and auto-manage a `stratum.bib` file    |

Assign hotkeys in **Settings -> Hotkeys** by searching for "Stratum".

## Enrichment

When a paper has a DOI, Stratum automatically enriches the note with data from [OpenAlex](https://openalex.org/):

- **Impact**: citation count, citation percentile, field-weighted citation impact (FWCI), 5-year citation trend.
- **Open access**: OA status and direct PDF link when available.
- **Topics and keywords**: top research topics with field/subfield hierarchy and relevance-scored keywords, wiki-linked for backlinks.
- **Authorship**: author names with ORCID links and institutional affiliations.
- **Funding**: funder names and award IDs.
- **Integrity**: retraction status flagged with a warning banner.

Enrichment data appears in both the note frontmatter (for Dataview queries) and the managed body content.

## Current scope

Stratum is deliberately opinionated. It isn't trying to be every Zotero plugin at once.

- One-way sync from Zotero into Obsidian.
- Personal and group Zotero libraries.
- No template language to learn, no manual API key setup.
- Not a zero-network or offline-only plugin.

## Why it requires an account

The account-backed design lets Stratum skip the usual Zotero plugin setup burden and add features that pure client-side plugins cannot offer.

- Sign-in happens in the browser instead of inside Obsidian.
- Zotero authentication uses OAuth instead of asking you for a manually managed API key.
- The backend handles Zotero API access, rate limiting, and cache-backed search.
- The backend enriches literature notes with data from [OpenAlex](https://openalex.org/). When a paper has a DOI, Stratum adds citation counts, field-weighted citation impact, citation percentile, open access links, topics, keywords, funder data, and more. Only the DOI is sent. The server never stores your notes or note content.

## Privacy

- No telemetry, no analytics, no ad tech, no third-party tracking SDKs in the plugin.
- The Stratum web app uses cookie-free analytics (Umami) to track anonymous usage metrics. No personally identifiable information is collected.
- The managed service uses Sentry for error tracking. When something goes wrong, Sentry captures technical details about the error and your account ID to help us diagnose issues. Sentry does not receive your email, Zotero credentials, or note contents.
- Your notes never leave your device. Stratum writes markdown files into your vault locally. The server never sees, stores, or transmits your note content. Everything you write below the boundary callout stays on your machine.
- The server doesn't store note data. When you sync, the server fetches metadata from Zotero and enrichment data from [OpenAlex](https://openalex.org/), passes it to the plugin, and discards it. Nothing about your notes is saved on the server.
- Enrichment uses only DOIs. To look up citation counts, topics, and other academic metadata, the server sends the paper's DOI to [OpenAlex](https://openalex.org/). No vault content, filenames, annotations, or personal information is shared.
- The plugin stores session tokens in Obsidian's platform-native `secretStorage` to stay signed in across restarts. It doesn't store your Zotero OAuth secret locally.
- Zotero OAuth secrets live server-side, encrypted at rest with AES-256 encryption.
- Server-side database access is scoped per authenticated user.
- The plugin writes diagnostic logs (sync timing, API response codes) to the browser console at the `debug` level. These logs stay local and are not sent anywhere.

## License

Released under the [MIT License](LICENSE).
