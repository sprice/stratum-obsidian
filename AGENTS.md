# Stratum Obsidian plugin

This repository supports standalone plugin development. Users authenticate with
Stratum’s hosted service; plugin contributors do not need the web-app checkout.

## Workspace context

When this repository is checked out as `packages/stratum-obsidian` within the
Stratum workspace and `../../AGENTS.md` exists, read it and follow its applicable
workspace, coordination, and delivery instructions alongside this file.

Otherwise, follow this file independently. Standalone development does not
require the private Stratum repository, its agent skills, or cloud configuration.

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
`check:plugin` by default. Broaden to related tests when shared behavior,
dependencies, or a failure warrants it; run a full suite only for a concrete
cross-cutting risk or an explicit request.
Do not repeat successful checks unless subsequent edits affect them.

Run commands from this plugin directory. `<test-files>` means explicit file
paths; select a related set by listing its files, not the entire test glob.

| Purpose                                                     | Command                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| One test file or selected related test files                | `pnpm --silent quiet pnpm exec node --test --import tsx <test-files>`                     |
| Full source test suite (only when warranted)                | `pnpm --silent test`                                                                      |
| Tooling tests (script changes)                              | `pnpm --silent test:tooling`                                                              |
| TypeScript across the plugin                                | `pnpm --silent typecheck`                                                                 |
| Formatting check on changed files                           | `pnpm --silent quiet pnpm exec prettier --check <changed-files>`                          |
| Format changed files                                        | `pnpm --silent quiet pnpm exec prettier --write <changed-files>`                          |
| Obsidian ESLint checks on changed TS/manifest/license files | `OBSIDIAN_REVIEW=1 pnpm --silent quiet pnpm exec eslint --max-warnings=0 <changed-files>` |
| Lint scorecard (lint-policy changes)                        | `pnpm --silent lint:scorecard`                                                            |
| Production bundle plus TypeScript (bundling changes)        | `pnpm --silent build`                                                                     |

Quiet commands report package-qualified results, elapsed time, and available
test/file counts. Aggregate checks include nested results. Failures preserve
exit status and a complete log; read that log if terminal diagnostics are
truncated. Keep watch and data-producing commands visible.

Run `pnpm --silent lint:scorecard` after CSS or decoding changes. Do not add
`display: contents`, `!important`, CSS multicolumn properties, `clip-path`, or runtime base64 encoding/decoding
to production code or bundles; embedded assets use bytes. YAML binary tags
remain encoded text.

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
- Do not execute downloaded code or implement plugin auto-updates. The narrow
  exception is official LaTeX template resources pinned by a strictly validated, versioned
  registry installation manifest and verified
  by SHA-256 before use. Compile those resources only with the existing
  Tectonic untrusted/no-shell-escape protections. This exception does not permit
  downloaded JavaScript, Lua filters, installers, binaries, rendering code, or
  plugin/dependency executable updates.
- Public PRs, comments, fixtures, and documentation must not contain private issue
  discussions or real user data. Read linked private context only with authorized
  access; ask if essential context is unavailable.

## Delivery

- When working within the Stratum workspace, follow its root commit skill and
  applicable issue-delegation and Git workflow. Standalone contributors do not
  need workspace-specific skills.
- Run Git commands in the repository that owns the changes. The plugin has its
  own staging area and history; stage only task-owned changes.
- Use only `feature/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, `perf/`,
  `ci/`, or `hotfix/` branch prefixes. Keep existing branch names unless asked
  to rename them.
- When standalone, create PRs only on explicit request. Use conventional commits
  for authorized commits. For workspace tasks, follow the root's delivery
  authorization rules.
- Clarify blocking acceptance or compatibility decisions before implementation;
  make routine choices independently.
- Self-review the final diff for regressions, compatibility, privacy, and test
  gaps. Fix actionable findings and rerun affected checks. Never bypass failing
  checks; report unresolved limitations.
- Plugin-only work does not require a root pointer update. For coordinated work,
  commit and push the plugin before recording its commit in the root workspace.
  Link companion PRs and explain merge order. After a squash or rebase merge,
  the root must reference the final merged plugin SHA.
- Update an existing task PR rather than opening duplicates. Continue authorized
  PR feedback and CI remediation on the same branch.
- Merging, enabling auto-merge, releasing, and deployment require explicit
  authorization. For a release, update `manifest.json` and `versions.json`,
  tag the exact manifest version without a `v`, and attach the three release
  artifacts individually.

## Code Review Rules

- Preserve user-written note content and existing item links across sync, refresh,
  and folder recreation. Check the link stability contract for identity changes.
- Keep desktop-only Node/Electron code guarded on mobile; check unload cleanup
  and avoid repeated vault-wide work during startup or sync.
- Flag undisclosed network transmission of vault content and incompatible cloud
  payload changes. Never include private issue discussions or real user data
  in public artifacts.
