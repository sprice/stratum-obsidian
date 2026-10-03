# Contributing

## Setup

Use Node.js 22+, pnpm, and Obsidian 1.11.4+. Create a test vault, then clone
this repository into its `.obsidian/plugins/stratum` folder. From that folder:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Enable **Stratum** under **Settings → Community plugins**. Follow the
[README setup](README.md#setup) to sign in and connect Zotero. Keep Zotero open
when testing desktop sync.

## Develop and check

Edit TypeScript in `src/` and styles in `styles.css`. `pnpm dev` rebuilds
`main.js` as you edit; disable and re-enable the plugin to load changes.
Tests live in `src/test/`.

Run `pnpm check` before opening a focused pull request. It checks formatting,
Obsidian lint, scorecard type compatibility, tests, types, and the production
build. Run `pnpm format` to fix source formatting. Test the affected workflow in
Obsidian and describe your changes and validation in the PR.

`pnpm lint:scorecard` also checks production source without ambient Node type
definitions, catching unsafe types that local lint can miss. Both Node CI jobs
run it, and releases require those jobs to pass. This approximates one scanner
limitation; it does not predict the full scorecard. Capability notices such as
filesystem access still require reviewing the feature's behavior and disclosures.

Preserve existing note links and user-written content. Use synthetic examples;
never commit personal vault data, credentials, or generated build files.
