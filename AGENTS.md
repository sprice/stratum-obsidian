# Stratum Obsidian plugin

This is the independent public plugin repository, also used as the
`packages/stratum-obsidian/` submodule in the Stratum workspace. Run Git commands
from the repository that owns the files. Preserve unrelated work and never
commit generated `main.js`, `node_modules/`, credentials, or private vault data.
Use synthetic examples in tests and shared artifacts.

## Development and validation

- Use pnpm (pinned in `package.json`), Node 22 or newer, TypeScript, and esbuild.
  The minimum build version is Node 20.12.0.
- Install with `pnpm install`; develop with `pnpm dev`; build with
  `pnpm --silent build`. Source lives in `src/`, with `src/main.ts` kept focused
  on lifecycle registration. Bundle all runtime dependencies into `main.js`.
- Run `pnpm --silent check` for formatting, review lint, scorecard compatibility
  lint, tests, type checking, build, and tooling regression tests.
- Finite checks print one success line. Failures print bounded diagnostics and
  the path to a complete local log. Read that log selectively when needed;
  remove retained logs after debugging. Use `STRATUM_VERBOSE=1 pnpm --silent check`
  to stream all nested output. Individual tools also have `:verbose` scripts.
- For targeted tests or direct tools, use `pnpm --silent quiet pnpm exec node
  --test --import tsx src/test/example.test.ts` (with the actual test path).
  `pnpm --silent exec` alone still prints tool output. Resolve focused test,
  lint, and type errors before the full `check`; rerun broader checks when later
  changes affect their coverage.
- Development/watch and data-producing commands retain their output contracts.

## Compatibility and Obsidian APIs

In the Stratum workspace, read `docs/literature-note-link-contract.md` in the
root repository before changing filenames, paths, aliases, identity matching,
sync, folder enumeration, or settings persistence. Links must keep resolving to
the same Zotero item after refresh and full literature-folder recreation.
The contract records implementation gaps; do not assume the live-file cache
or deterministic filenames fulfill it. In a standalone checkout, request
that contract before making these compatibility changes.

- Preserve user-written content and properties outside the managed note set.
- Keep user-facing command IDs and the manifest `id` stable. Register commands
  with `addCommand`; persist settings with `loadData`/`saveData` and provide a
  settings tab when configuration is needed.
- Use Obsidian APIs and register cleanup for listeners, timers, and children.
  Keep startup light, defer heavy work, debounce expensive event work, and avoid
  unnecessary vault scans. Handle async errors and unload races.
- Keep modules focused; consider splitting files beyond 200–300 lines. Use
  strict types and browser-compatible dependencies. Avoid Node/Electron APIs
  in plugin runtime code unless the platform contract supports them.
- Test on mobile where feasible; do not assume desktop behavior unless
  `isDesktopOnly` is true. Be mindful of memory and storage constraints.
- Use native/theme-aware UI, sentence case, short actionable labels, and
  **Settings → Community plugins** notation in instructions.

## Privacy and security

Follow Obsidian's developer policies and plugin guidelines. Default to local
operation; introduce network calls only for an explicit user-facing purpose.
Disclose external services, transmitted data, and risks. Telemetry requires
explicit opt-in. Never execute remote code, fetch/eval scripts, self-update
outside Obsidian releases, or introduce deceptive UI or unsolicited ads.
Read/write only necessary vault content; runtime code must not access files
outside the vault. Never expose private notes, filenames, annotations, or
library organization in tests, docs, logs, commits, or PRs.

## Git and releases

- In the workspace, follow the root `AGENTS.md` and use its commit skill for
  every commit. Plugin and workspace staging/history are separate. Commit and
  push coordinated plugin changes before the root pointer that references them.
- New branches in either repository use only `feature/`, `fix/`, `chore/`,
  `docs/`, `refactor/`, `test/`, `perf/`, `ci/`, or `hotfix/`, followed by a
  short lowercase hyphenated name. Do not rename existing branches unasked.
- Create PRs only when explicitly requested. Merging, marking ready, publishing
  releases, and production deployment require explicit authorization.
- When authorized to release, update `manifest.json` and `versions.json`.
  Keep `minAppVersion` accurate. The release tag must exactly match the manifest
  version, with no `v` prefix; attach `main.js`, `manifest.json`, and `styles.css`
  as individual assets. New plugins must follow community-catalog submission rules.
- For manual testing, install those artifacts in
  `<Vault>/.obsidian/plugins/<plugin-id>/`, reload Obsidian, and enable the plugin.
  Follow root vault-fixture placement and cleanup rules when in the workspace.

Reference APIs and policies as needed: https://docs.obsidian.md,
https://github.com/obsidianmd/obsidian-api, and
https://docs.obsidian.md/community-directory/developer-policies.
