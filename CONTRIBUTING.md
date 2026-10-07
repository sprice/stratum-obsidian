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

Run `pnpm --silent check` before opening a focused pull request. It checks formatting,
Obsidian lint, scorecard type compatibility, tests, types, and the production
build. Run `pnpm format` to fix source formatting. Test the affected workflow in
Obsidian and describe your changes and validation in the PR.

Finite checks print one success line. On failure, they preserve the exit status,
show bounded diagnostics, and report a full local log. Successful logs are
deleted; remove retained failure logs after debugging. Use
`STRATUM_VERBOSE=1 pnpm --silent check` to stream all nested output, or use an
individual tool's `:verbose` script. Extra arguments are forwarded. Development
and watch commands keep their live output.
CI prints full failure diagnostics so they remain available in the job output.

`pnpm lint:scorecard` checks CSS and decoding regression rules through
`pnpm lint:scorecard:rules`: no `display: contents`, no `!important`, and no
direct runtime base64 decoding calls in production `src/` (tests and tooling
are excluded). Decoding checks cover `atob`, `fromBase64`, `setFromBase64`,
and Buffer construction with literal `base64` or `base64url` encodings,
including literal computed method names. They do not trace aliases or dynamic
encoding values. Base64 encoding is allowed. Store embedded assets as bytes.
The same command also checks production source without ambient Node type
definitions, catching unsafe types that local lint can miss. Both Node CI jobs
run it, and releases require those jobs to pass. This approximates one scanner
limitation; it does not predict the full scorecard. Capability notices such as
filesystem access still require reviewing the feature's behavior and disclosures.

Preserve existing note links and user-written content. Use synthetic examples;
never commit personal vault data, credentials, or generated build files.
