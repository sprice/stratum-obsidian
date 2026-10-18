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

Run `pnpm ci:check` for the complete cached validation, including browser tests and
real PDF conversion. Install Pandoc, Tectonic, Poppler (`pdftotext`), and Chrome
first; set `STRATUM_TEST_CHROME` if Chrome is outside its usual location. The
command runs up to two independent tasks at once (override with
`WIREIT_PARALLEL`) and caches successful tasks locally. It checks types once;
the separate bundle task does not repeat TypeScript validation.

A successful local run writes `.ci-local-validation.json`. Include that file in
the same commit as the validated changes. GitHub compares its digest with the
checked-out source snapshot, including new and deleted files. A match skips
validation and publishing-tool installation, then bundles the plugin on the
runner. Any subsequent source, tooling, configuration, or documentation change
invalidates the receipt. If files change during validation, no new receipt is
written. Run the command again after finishing your changes.

The receipt is a maintainer assertion that the checks passed locally; it is
portable across operating systems and Node versions, rather than a separate
Linux validation. It contains only a version and source digest. Ignored local
environment files and generated output are excluded, and GitHub always creates
its own bundle using its own build configuration. Review receipts with the code.

Without a matching receipt, GitHub runs `pnpm ci:check` with Wireit caches for
formatting, lint, scorecard, tooling tests, types, source tests, browser tests,
PDF preflight, and bundling. Each task tracks its relevant inputs: workflow and
tooling edits do not invalidate unrelated source checks, and build-only inputs
do not invalidate tests. Browser screenshots, preflight reports, and `main.js`
are restored on cache hits. Publishing checks fingerprint tool versions, Linux
fonts, and optional template resources. Tectonic uses an explicit cache directory
shared with the Actions resource cache.

Release tags always run validation without task caches or local receipts, and
release builds remain fresh. For an uncached run, select **Build & Lint → Run
workflow** and enable **uncached**. Set the repository variable
`STRATUM_CI_CACHE_DISABLED` to `true` to disable both task caches and local receipts.
Standard developer commands remain uncached.

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
