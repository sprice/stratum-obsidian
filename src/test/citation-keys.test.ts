import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./runtime-harness";
import { updateManagedBibliography } from "../bibtex-managed";
import type { LiteratureNoteEntry } from "../library-search-modal";
const note = (identity: string, citationKey: string) =>
  ({
    identity,
    citationKey,
    authors: ["Example"],
    title: "Study",
    year: "2024",
    file: { path: `Papers/${citationKey}.md` },
  }) as LiteratureNoteEntry;
const { citationKeyIndex, preferCitedSources } = loadRuntime<
  typeof import("../citation-keys")
>("citation-keys.ts", { TFile: class {} });
test("display and insertion use established keys while colliding sources remain blocked", () => {
  const old = note("user/1/A", "old");
  const bibliography = updateManagedBibliography("", old, true);
  const changed = { ...old, citationKey: "new" };
  const collision = note("group/2/A", "old");
  const index = citationKeyIndex([changed, collision], bibliography);
  assert.equal(index.key(changed), "old");
  assert.equal(index.label(changed), "@old");
  assert.match(index.label(collision), /needs repair/);
  assert.throws(() => index.key(collision));
});
test("suggestions prioritize sources already cited through historical keys", () => {
  const a = note("user/1/A", "a"),
    b = note("user/1/B", "b");
  const bib = updateManagedBibliography("", b, true);
  const changed = { ...b, citationKey: "new" };
  assert.equal(
    preferCitedSources([a, changed], "[@b]", bib)[0].identity,
    b.identity,
  );
});
