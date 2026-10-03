# Third-party citation review: verdicts and fixes

Reviewed the citation feature branch and the related existing plugin paths. The supplied review was treated as a set of claims to verify, rather than instructions to apply blindly. Test fixtures use synthetic references, not personal library data. Delivery is handled separately from the review; no pull request was modified during validation.

“Valid” means the code established the problem. It does not imply every suggested severity, timing estimate, or proposed solution was independently reproduced.

## Serious findings

| Finding | Verdict | Resolution |
| --- | --- | --- |
| Whole-document remark parsing on every editor keystroke, including Source mode | Valid; supplied latency estimates were not reproduced exactly | Authoring uses a lightweight citation scan, skips Source mode and documents without `@`, maps ranges during transactions, and debounces scans outside the typing transaction. Full Markdown parsing remains in publication formatting. |
| Ordinary `@handles` become citations and cause a Reading error footer | Valid | Bare narrative tokens must match a known literature-note or bibliography key. Explicit bracket citations still report unresolved keys. Ordinary handles no longer trigger a citation footer. |
| Reference-cache failures fail otherwise successful note sync; quadratic rewrites | Valid | Catch and log cache errors without failing note creation or identity bookkeeping. Cache parsed snapshots, serialize writes, batch bulk and enrichment references per page, merge external changes, and skip unchanged writes. Corrupt caches are preserved rather than overwritten. |
| Invalidation storms rebuild engines and recursively retry during sync | Valid | Debounce shared invalidation, route ordinary note updates by path, compare relevant literature metadata, retain engines keyed by reference/style/locale content, and bound stale-result failures. Unchanged note and bibliography refreshes avoid writes. |

Synthetic CodeMirror transaction measurements after the fix averaged about 1.5 ms for a 150 KB note and 4.2 ms for a 600 KB note. These are transaction benchmarks, not end-to-end desktop or mobile typing measurements. Cold full-document Reading formatting still costs more than authoring updates.

## Citation findings: P2

| Finding | Verdict | Resolution or boundary |
| --- | --- | --- |
| One bad citation disables the entire manuscript | Valid in part | Unknown or malformed groups now produce diagnostics while valid groups format. A stray unmatched opening bracket no longer consumes later paragraphs. Unsupported key/locator syntax stays raw with a warning. Unsafe explanatory-footnote ordering still blocks note-based styles to preserve native content; see the remaining limits below. |
| Footnote takeover removes back-references and assumes native ordinals | Valid | Author–date and numeric styles retain native footnotes. Note-based styles map named references through Obsidian's source identifiers, preserve repeated references, and generate back-links with the native navigation attributes. References nested in links are rejected safely for note-based styles. |
| Async post-processor returns no promise; PDF may capture too early | Missing promise is valid; claimed PDF symptom unconfirmed | Return the render child's ready promise and retain stale/detached-block guards. Automated tests await completion. No PDF export end-to-end test was performed, and Stratum publishing remains out of scope. |
| Resource XML duplicates bundled resources in settings and lacks pruning/external refresh | Valid | Migrate resource maps to plugin-directory `citation-resources.json`; strip settings maps only after successful persistence. Bundled resources take precedence. Reuse custom IDs, provide unused-style removal with manuscript-use checks, and reload citation preferences/resources on external settings changes. |
| Bundle growth and eager initialization | Partly valid; size alone is not a bug | Defer citeproc initialization until formatting or style preparation. Offline bundled CSL/locale assets remain part of the single-file bundle intentionally. The larger artifact has not been eliminated. |
| Sources status formats the entire manuscript and parses APA XML for its title | Valid | Status uses resolution diagnostics without invoking formatting. Bundled titles use known metadata instead of repeated XML parsing. |
| Preferences modal registers one unload closure per opening | Valid | Track open modals in a set and register one plugin cleanup. Closing removes the modal from the set. |
| Autocomplete rereads/reindexes on every query; no suggestions inside groups | Repeated work valid; group exclusion is intentional | Cache bibliography/index data during a completion session. Group editing remains the citation composer's job; this review does not add ambiguous completion inside locator/prefix text. |

## Citation findings: P3

| Finding | Verdict | Resolution or boundary |
| --- | --- | --- |
| Style catalog downloads on each click | Valid | Cache the shared request; failed requests can retry. |
| Cursor immediately after `]` edits the previous group; prose selections silently replaced | Valid | The closing boundary is excluded. Reject non-citation prose selections instead of deleting them. |
| Reference files live at the vault root; paper overrides are hidden | Hidden overrides valid; file placement is an existing design choice | Show paper style/language in Properties. Keep `stratum.bib` and `stratum-references.json` in their established locations for compatibility. Downloaded style resources move to the plugin directory. |
| Hover runs full manuscript formatting, including engine construction | Performance concern valid in part | Reuse reference loads, document results, and content-keyed formatter engines. Cold formatting can still require manuscript-wide context for disambiguation, citation numbering, and subsequent-note forms. |
| Create handlers observe startup file discovery | Valid | Register these handlers after layout readiness. |
| README command table is stale | Valid | Update command names and include the new citation commands. Preserve stable command IDs. |
| Mobile untested while the manifest permits mobile | Testing gap, not proof of incompatibility | Retain the mobile testing limitation. Desktop local-Zotero/status behavior is gated; cloud features remain available. No mobile device validation was performed. |
| No regression for paper overrides surviving sync | Valid testing gap | Add preservation coverage for managed-note refresh, including BOM frontmatter. |
| No native footnote mapping regression | Valid testing gap | Add identifier/repeated-reference tests grounded in installed Obsidian's emitted footnote attributes. This is not a full visual test. |
| CPAL citeproc inside MIT plugin needs checking | Review warranted; no demonstrated code violation | Keep third-party license/source notices, bundled notices, and existing attribution. CPAL permits larger works; its attribution obligations depend on the supplied Exhibit B. This is a dependency-license inspection, not a legal opinion. |

## Existing plugin findings

| Finding | Verdict | Resolution or boundary |
| --- | --- | --- |
| Access-token 401/403 discards the refresh token without retry | Valid | Force one shared refresh, retry once, and retain a rotated refresh token if the retried access request is denied. Failed refresh authentication still clears the session. |
| Bulk progress rebuilds every sidebar tab every 120 ms | Valid | Progress updates target the Sync panel. Other panels are not remounted on each progress tick. |
| Loading one item scans library-wide annotations | Valid | Fetch annotation children for that item's attachments using the local API's scoped children endpoint and pagination. |
| Per-item collection requests repeat | Valid | Reuse a fresh known collection catalog; fall back when stale or unavailable. |
| Bulk sync fetches and rewrites every item twice | Valid avoidable work | Reuse detail data for the enrichment pass. The second pass still applies genuinely changed enrichment; unchanged content avoids writes. |
| Any non-404 local item failure restarts bulk sync from zero | Valid | Distinguish connection/auth/rate-limit failures from item-specific failures; retain item retry behavior instead of restarting for all local errors. |
| Manually moved notes are forgotten and duplicated | Valid | Discover managed identities outside the configured literature folder and retain their existing file paths. |
| Changing the configured literature root has no migration | True existing feature gap, outside this task | Correct the link-contract document so it does not describe an implemented migration. Automatic root migration and a durable filename registry remain separate work. |
| Unsafe filename characters produce broken generated wiki links | Valid for new generated names | Strip `#`, `^`, `[` and `]` from new managed filenames. Do not rename existing files automatically. Older/manual unsafe filenames remain a compatibility concern. |
| Timestamp causes every refresh to rewrite unchanged notes | Valid | Preserve the existing content when only the sync timestamp would differ. Real metadata changes and a newer importing plugin version still update the note. |
| Folder and port edits persist/rescan/restart for every character | Valid | Apply on blur or Enter after validation; reject invalid ports. |
| Email in synced settings incorrectly implies an authenticated device | Valid | Derive sign-in UI from the device session. Email remains display metadata. |
| Auth callback consumes pending state early and lacks error handling | Valid | Consume pending handoff state after successful awaited session setup and surface callback failures. |
| Privacy statement claims all metadata is discarded despite search caching | Valid | Correct the README to disclose search metadata, including abstracts, and distinguish it from vault contents. |

## Smaller existing findings

| Finding | Verdict | Resolution or boundary |
| --- | --- | --- |
| Email changes reset same-account sync state | Valid | Prefer stable account ID, including the token's subject for cache identity. Retain email fallback for legacy sessions when no stable ID exists. This does not change authentication authority. |
| Desktop status bar and status polling run on mobile | Valid | Gate the desktop status UI/interval. |
| Deferred tabs skipped by `instanceof` | Not established as a defect | Retain guards for actual instantiated Stratum views; do not force background leaf hydration merely to refresh UI. |
| CRLF notes lose preserved enrichment | Valid | Extract managed sections with CRLF support and add coverage. |
| DOI matching is case-sensitive | Valid | Normalize DOI comparisons when preserving enrichment. |
| My Notes boundary stricter than valid callout syntax | Valid | Accept supported indentation/case/spacing variants while retaining the user-content boundary. |
| BOM prevents managed refresh | Valid | Parse BOM frontmatter and preserve correct body offsets. |
| Unused rename machinery and stale contract | Valid | Remove unused rename helpers/tests and update the contract's description of actual behavior. |
| Filename length counts UTF-16 units | Valid | Truncate by code points to avoid splitting surrogate pairs. This is not a full grapheme-aware or filesystem-byte-length policy. |
| `yes`/`no` strings used instead of booleans | Not inherently a defect | Preserve established human-facing frontmatter compatibility. No unrelated metadata migration added. |
| Dead CSS | Valid | Remove unused selector blocks while retaining selectors emitted by current UI paths. |
| Moved Obsidian documentation URLs | Valid | Update developer-policy and submission-requirement links. |

## Validation and remaining limits

The package's full `pnpm check` passed with **338 tests**: formatting, Obsidian review lint with zero warnings, tests, TypeScript, and production build. Added regression coverage targets failed auth retry, partial citation formatting, footnote mapping, resource migration failures, batched reference writes, no-op bibliography refresh, managed-note preservation, moved identities, and filename safety.

Remaining limits are explicit rather than silently formatting incorrectly:

- Note-based styles require named explanatory footnotes. Inline `^[...]`, nested notes, and footnote references inside links are rejected for these styles. Author–date/numeric formatting preserves native inline notes.
- Cold Reading formatting still parses the full manuscript; CSL formatting depends on document order and disambiguation.
- Mobile visual behavior and PDF capture were not tested in this pass.
- Root-folder migration, durable filename ownership after deletion/recreation, and old unsafe manually named files remain separate compatibility work.
- Bundled styles/locales intentionally remain in the offline artifact. Resource migration preserves legacy settings if the new cache cannot be saved.

Primary references checked: [Zotero local API](https://www.zotero.org/support/dev/web_api/v3/local_api), [Zotero local endpoint implementation](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/server/server_localAPI.js), [Obsidian load-time guidance](https://docs.obsidian.md/plugins/guides/load-time), [Obsidian developer policies](https://docs.obsidian.md/community-directory/developer-policies), and [citeproc's CPAL text](https://github.com/Juris-M/citeproc-js/blob/master/CPAL).
