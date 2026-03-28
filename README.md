# Stratum

Stratum creates structured literature notes in Obsidian from your Zotero cloud library without Better BibTeX, running Zotero, or custom templates. It generates readable markdown and keeps managed sections in sync while leaving your own writing alone.

> **Requires a Stratum account**
>
> Stratum is an open-source plugin paired with a [Stratum](https://stratumnotes.com) account. You need an account and internet access, but the core workflow is free to start. Sign-in, Zotero auth, and sync all run through Stratum's service. The same architecture will support server-side enrichment features in the future.

## Features

- Search your Zotero library inside Obsidian.
- Create literature notes with readable filenames, aliases, and useful frontmatter.
- Pull in all your Zotero notes and annotations.
- Group highlights by color, with deep links back to Zotero.
- Auto-sync your literature notes with updates from Zotero without overwriting your own changes.
- Rewrite only Stratum's managed section and preserve everything below `## My Notes`.
- Mark notes as deleted if the source item disappears from Zotero instead of deleting the file from your vault.

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

After that, Stratum keeps tracked notes fresh automatically.

## Note format

Each generated note has a managed section and a user section.

- The managed section includes a reference block, abstract, imported Zotero notes, grouped highlights, and Zotero deep links.
- The user section starts at `## My Notes`.
- Sync rewrites the managed section only.
- Your writing below `## My Notes` is preserved across updates.

## Commands

Use the side panel to discover papers and create notes. Use keyboard commands to reference them while writing.

| Command                      | Description                                                    |
| ---------------------------- | -------------------------------------------------------------- |
| Open library view            | Opens the Stratum side panel                                   |
| Open literature note         | Search your literature notes and open one                      |
| Insert literature note link  | Insert a `[[wikilink]]` to a literature note at the cursor     |
| Insert pandoc citation       | Insert `[@citekey]` and auto-manage a `stratum.bib` file       |
| Sync Zotero changes now      | Manually trigger a Zotero sync                                 |
| Sync all Zotero papers       | Sync your entire Zotero library                                |

Assign hotkeys in **Settings -> Hotkeys** by searching for "Stratum".

## Current scope

Stratum is deliberately opinionated. It isn't trying to be every Zotero plugin at once.

- One-way sync from Zotero into Obsidian.
- Personal Zotero libraries today.
- Tracked-note sync, not full-library mirroring.
- No Better BibTeX, local bridge, or templating language.
- Not a zero-network or offline-only plugin.

## Why it requires an account

The account-backed design lets Stratum skip the usual Zotero plugin setup burden.

- Sign-in happens in the browser instead of inside Obsidian.
- Zotero authentication uses OAuth instead of asking you for a manually managed API key.
- The backend handles Zotero API access, rate limiting, and cache-backed search.
- The same backend will power future server-side enrichment: citation counts, related papers, open-access links, citation graphs, and AI-generated summaries.

## Privacy

- No telemetry, no analytics, no ad tech, no third-party tracking SDKs in the plugin.
- The Stratum web app uses cookie-free analytics to track anonymous usage metrics.
- Stratum's backend makes Zotero Web API requests on your behalf. It keeps per-account search caches so the plugin stays responsive and handles rate limits gracefully.
- Your vault stays local. Stratum writes markdown into your vault but doesn't upload your vault or its path.
- The content you write below `## My Notes` is preserved locally and isn't sent to Stratum.
- The plugin writes diagnostic logs (sync timing, API response codes) to the browser console at the `debug` (verbose) level. These logs stay local in your Obsidian developer console and are not sent anywhere. They are hidden by default and only visible when you enable verbose logging in devtools.
- The plugin stores session tokens in Obsidian's platform-native `secretStorage` to stay signed in across restarts. It doesn't store your Zotero OAuth secret locally.
- Zotero OAuth secrets live server-side, encrypted at rest.
- Server-side database access is scoped per authenticated user.
- When enrichment features arrive, those lookups will happen server-side. The plugin won't call third-party enrichment APIs directly.

## License

Released under the [MIT License](LICENSE).
