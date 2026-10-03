import test from "node:test";
import assert from "node:assert/strict";
import { planCitationRepair } from "../citation-repair-plan";
import {
  updateManagedBibliography,
  resolveBibliographyCitekey,
} from "../bibtex-managed";
import { citationResolver } from "../citation-resolution";
import { readBibliographyBindings } from "../document-sources";
import type { LiteratureNoteEntry } from "../library-search-modal";
const note = (identity = "user/1/A", citationKey = "example") =>
  ({
    identity,
    citationKey,
    title: "Synthetic study",
    authors: ["Example"],
    year: "2024",
    file: { path: `Papers/${identity}.md` },
  }) as LiteratureNoteEntry;

test("metadata cannot steal an established key from another library", () => {
  const a = note(),
    b = note("group/2/A");
  const bib = updateManagedBibliography("", a, true);
  assert.equal(
    citationResolver([a, b], readBibliographyBindings(bib))("example").identity,
    a.identity,
  );
});
test("repair preserves grouped syntax, locators, prose and excluded contexts", () => {
  const a = note();
  const text =
    "[see -@wrong, pp. 12–14; @other, p. 7] then @wrong. `@wrong`\n%% @wrong %%";
  const plan = planCitationRepair(text, "wrong", a, [a], "", "all");
  let output = text;
  for (const edit of [...plan.edits].reverse())
    output = output.slice(0, edit.from) + edit.after + output.slice(edit.to);
  assert.equal(
    output,
    "[see -@example, pp. 12–14; @other, p. 7] then @example. `@wrong`\n%% @wrong %%",
  );
  assert.equal(
    planCitationRepair(text, "wrong", a, [a], "", 1).edits.length,
    1,
  );
});
test("conflict repair appends a safe alias without altering manual entries or old ownership", () => {
  const a = note(),
    b = note("group/2/A");
  const bib =
    updateManagedBibliography("", a, true) +
    "\n@book{example, title={Manual content}}\n";
  const plan = planCitationRepair(
    "[@example]",
    "example",
    a,
    [a, b],
    bib,
    "all",
  );
  assert.ok(plan.bibliography.startsWith(bib));
  assert.notEqual(plan.key, "example");
  const resolve = citationResolver(
    [a, b],
    readBibliographyBindings(plan.bibliography),
  );
  assert.equal(resolve("example").problem, "conflicting-key");
  assert.equal(resolve(plan.key).identity, a.identity);
  assert.equal(resolveBibliographyCitekey(plan.bibliography, a), plan.key);
});
test("historical keys remain usable after metadata and filename changes", () => {
  const a = note();
  const bib = updateManagedBibliography("", a, true);
  const changed = {
    ...a,
    citationKey: "newKey",
    title: "New title",
    file: { path: "Papers/Renamed.md" },
  } as LiteratureNoteEntry;
  const plan = planCitationRepair(
    "[@typo]",
    "typo",
    changed,
    [changed],
    bib,
    0,
  );
  assert.equal(plan.key, "example");
  assert.equal(
    plan.bibliography,
    bib,
    "Repair must not refresh shared metadata",
  );
  assert.equal(
    resolveBibliographyCitekey(plan.bibliography, changed),
    "example",
  );
});
test("unsupported syntax and unverified identities cannot be repaired", () => {
  const a = note();
  assert.throws(() =>
    planCitationRepair(
      "[@wrong, unsupported {syntax}]",
      "wrong",
      a,
      [a],
      "",
      0,
    ),
  );
  assert.throws(
    () =>
      planCitationRepair(
        "[@wrong]",
        "wrong",
        { ...a, identity: null },
        [a],
        "",
        0,
      ),
    /verified/,
  );
});
test("explicit keys cannot overwrite or adopt manual bibliography entries", () => {
  const a = note();
  assert.throws(
    () =>
      updateManagedBibliography(
        "@book{manual, title={Keep}}",
        a,
        true,
        "manual",
      ),
    /ownership/,
  );
});

test("adding a repair alias preserves trailing whitespace and manual content byte-for-byte", () => {
  const a = note();
  const bib = "@book{manual, title={Keep exactly}}\n\n  \n";
  const plan = planCitationRepair("[@typo]", "typo", a, [a], bib, 0);
  assert.ok(plan.bibliography.startsWith(bib));
  assert.equal(
    readBibliographyBindings(plan.bibliography)[0].identity,
    a.identity,
  );
});
