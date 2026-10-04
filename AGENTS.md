# Stratum Obsidian plugin

This repository supports standalone plugin development. Users authenticate with
Stratum’s hosted service; plugin contributors do not need the web-app checkout.

## Development

- Use Node 22+ and the pinned pnpm version. `pnpm dev` watches.
- `src/main.ts` is the esbuild entry point. Keep lifecycle wiring there;
  feature logic belongs in `src/` modules. Bundle runtime dependencies into `main.js`.
- Release artifacts are `main.js`, `manifest.json`, and `styles.css`.
  Do not commit generated output or dependencies. Keep the manifest ID stable
  and set `minAppVersion` to the APIs actually required.

## Validation

Assume full checks passed in the starting checkout. Run the affected tests and
checks for the files/packages you changed. Do not run `pnpm check` or
`check:plugin` by default. Broaden to related tests when shared behavior, dependencies, or a failure warrants it;
run a full suite only for a concrete cross-cutting risk or an explicit request.
Do not repeat successful checks unless subsequent edits affect them.

Run commands from this plugin directory. `<test-files>` means explicit file
paths; select a related set by listing its files, not the entire test glob.

| Purpose | Command |
| --- | --- |
| One test file or selected related test files | `pnpm --silent quiet pnpm exec node --test --import tsx <test-files>` |
| Full source test suite (only when warranted) | `pnpm --silent test` |
| Tooling tests (script changes) | `pnpm --silent test:tooling` |
| TypeScript across the plugin | `pnpm --silent typecheck` |
| Formatting check on changed files | `pnpm --silent quiet pnpm exec prettier --check <changed-files>` |
| Format changed files | `pnpm --silent quiet pnpm exec prettier --write <changed-files>` |
| Obsidian ESLint checks on changed TS/manifest/license files | `OBSIDIAN_REVIEW=1 pnpm --silent quiet pnpm exec eslint --max-warnings=0 <changed-files>` |
| Lint scorecard (lint-policy changes) | `pnpm --silent lint:scorecard` |
| Production bundle plus TypeScript (bundling changes) | `pnpm --silent build` |

Quiet commands report package-qualified results, elapsed time, and available
test/file counts. Aggregate checks include nested results. Failures preserve
exit status and a complete log; read that log if terminal diagnostics are
truncated. Keep watch and data-producing commands visible.

## Compatibility

- Before changing note filenames, aliases, item identity, sync, folder enumeration,
  or settings persistence, read [the link stability contract](docs/literature-note-link-contract.md)
  in this repository. Preserve existing item links after refresh and folder recreation.
- Preserve mobile support. Guard desktop-only Node/Electron functionality so it
  cannot load or execute on mobile; desktop features must not disable the whole plugin.
- Add commands with `this.addCommand()` and stable IDs; persist settings through
  `loadData()` / `saveData()`. Register listeners and timers for unload cleanup.
- Keep startup light: defer expensive work, debounce frequent events, and avoid
  repeated vault-wide scans. Reloading must not duplicate listeners or intervals.
- For Obsidian API and platform behavior, consult `https://docs.obsidian.md`
  and the installed `obsidian` types; keep vault operations on Obsidian APIs.

## User experience and privacy

- Use sentence case and concise labels; show settings paths with `→`.
- Keep vault access scoped to the feature. External services must have a disclosed
  purpose; do not transmit vault content without consent or add hidden telemetry.
- Do not execute downloaded code or implement plugin auto-updates.

## Delivery

- Follow the root workspace's commit skill and Git workflow when in Stratum.
  The plugin has its own staging area and history; commit and push it before
  recording its pointer in the workspace.
- Use only `feature/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, `perf/`,
  `ci/`, or `hotfix/` branch prefixes. Create PRs only on explicit request.
- Merging, releasing, and deployment require explicit authorization. For a
  release, update `manifest.json` and `versions.json`, tag the exact manifest
  version without a `v`, and attach the three release artifacts individually.
