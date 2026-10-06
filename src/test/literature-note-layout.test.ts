import assert from "node:assert/strict";
import test from "node:test";
import {
  composeLiteratureNoteBody,
  readLiteratureNoteLayout,
  requireLiteratureNoteLayout,
} from "../literature-note-layout";
import {
  MANAGED_START,
  MANAGED_END,
  SYNC_BOUNDARY,
  USER_BOUNDARY_CALLOUT,
} from "../literature-note-content-types";
import { markLiteratureNoteAsDeletedContent } from "../literature-note-content";

const managed = `${MANAGED_START}\nSynthetic source\n${MANAGED_END}\n`;
test("existing notice copy remains recognized without cached layout metadata", () => {
  const personal = "## My Notes\n\nPreserve my research\n\n";
  const body = `${personal}${SYNC_BOUNDARY}\n> [!warning] Synced source content\n> Everything below this notice is managed by Stratum and may be updated during sync. Keep your own writing above it.\n\n${managed}`;
  assert.equal(requireLiteratureNoteLayout(body, undefined).personal, personal);
});
for (const version of [undefined, 2]) {
  test(`mixed layout migrates the legacy personal suffix despite version ${version}`, () => {
    const personal =
      "\nResearch  \r\n- [x] Read\r\n[[Companion]]\r\n^research\r\n\r\n";
    const mixed = `${composeLiteratureNoteBody("## My Notes\n\nReplaceable old header\n\n", managed)}\n${USER_BOUNDARY_CALLOUT}\n${personal}`;
    const layout = requireLiteratureNoteLayout(mixed, version);
    assert.equal(layout.personal, `## My Notes\n${personal}`);
    const migrated = composeLiteratureNoteBody(layout.personal, managed);
    assert.doesNotMatch(migrated, /Replaceable old header|\[!stratum\]/);
    const next = requireLiteratureNoteLayout(migrated, 2);
    assert.equal(composeLiteratureNoteBody(next.personal, managed), migrated);
  });
}

test("legacy callout examples above the new boundary or inside source stay examples", () => {
  const personal = `## My Notes\n\n${USER_BOUNDARY_CALLOUT}\n\nMy example\n\n`;
  const source = `${MANAGED_START}\n${USER_BOUNDARY_CALLOUT}\n\nSource example\n${MANAGED_END}\n`;
  const layout = requireLiteratureNoteLayout(
    composeLiteratureNoteBody(personal, source),
    2,
  );
  assert.equal(layout.personal, personal);
  assert.equal(layout.managed, source);
});

test("a complete legacy layout example in new personal writing stays personal", () => {
  const personal = `## My Notes\n\nLegacy example:\n${managed}\n${USER_BOUNDARY_CALLOUT}\n\nExample writing\n\n`;
  const layout = requireLiteratureNoteLayout(
    composeLiteratureNoteBody(personal, managed),
    2,
  );
  assert.equal(layout.personal, personal);
  assert.equal(layout.managed, managed);
  assert.equal(layout.legacy, false);
});
for (const personal of [
  "\n## Research\n\nWriting  \n- [ ] Task\n^block-id\n\n",
  "\r\nWriting with CRLF  \r\n\r\n",
  "Writing without a final newline",
  "",
]) {
  test(`legacy migration preserves every personal byte: ${JSON.stringify(personal)}`, () => {
    const old = `${managed}\n${USER_BOUNDARY_CALLOUT}\n${personal}`;
    const layout = requireLiteratureNoteLayout(old, undefined);
    assert.equal(layout.personal, `## My Notes\n${personal}`);
    const migrated = composeLiteratureNoteBody(layout.personal, managed);
    assert.ok(migrated.startsWith(`## My Notes\n${personal}`));
    const next = requireLiteratureNoteLayout(migrated, 2);
    assert.equal(composeLiteratureNoteBody(next.personal, managed), migrated);
  });
}

test("personal fenced and quoted marker examples do not become the sync boundary", () => {
  const personal = `## My Notes\n\n\`\`\`md\n${SYNC_BOUNDARY}\n${MANAGED_START}\n\`\`\`\n> ${SYNC_BOUNDARY}\n\n`;
  const layout = requireLiteratureNoteLayout(
    composeLiteratureNoteBody(personal, managed),
    2,
  );
  assert.equal(layout.personal, personal);
  assert.equal(layout.managed, managed);
});

test("new layout with CRLF is recognized before metadata cache updates", () => {
  const body = composeLiteratureNoteBody(
    "## My Notes\n\nWriting\n\n",
    managed,
  ).replaceAll("\n", "\r\n");
  assert.equal(
    requireLiteratureNoteLayout(body, undefined).personal,
    "## My Notes\r\n\r\nWriting\r\n\r\n",
  );
});

test("missing or duplicated new boundaries reject replacement", () => {
  assert.equal(readLiteratureNoteLayout("My writing", 2), null);
  const body = composeLiteratureNoteBody("## My Notes\n\n", managed);
  assert.equal(readLiteratureNoteLayout(`${SYNC_BOUNDARY}\n${body}`, 2), null);
});

test("deletion migrates legacy notes without hidden managed markers", () => {
  const deleted = markLiteratureNoteAsDeletedContent({
    existingContent: `Old source\n\n${USER_BOUNDARY_CALLOUT}\n\nPersonal writing\n`,
    parseYaml: () => ({}),
    stringifyYaml: JSON.stringify,
  });
  const layout = requireLiteratureNoteLayout(
    deleted.slice(deleted.indexOf("\n---\n") + 5),
    2,
  );
  assert.match(layout.personal, /Personal writing/);
  assert.match(layout.managed, /This item was removed from Zotero/);
  assert.match(layout.managed, /Old source/);
});

test("a complete new-layout example below the legacy callout remains personal writing", () => {
  const personal = `\nMy analysis before the example.\n${composeLiteratureNoteBody("Example personal writing\n\n", managed)}My analysis after the example.\n`;
  const old = `${managed}\n${USER_BOUNDARY_CALLOUT}\n${personal}`;
  assert.equal(
    requireLiteratureNoteLayout(old, undefined).personal,
    `## My Notes\n${personal}`,
  );
});

test("a Stratum callout example in source content is not the personal boundary", () => {
  const old = `${MANAGED_START}\n> [!abstract]+ Abstract\n> [!stratum] Example in the source\n> Source text\n${MANAGED_END}\n\n${USER_BOUNDARY_CALLOUT}\n\nPersonal writing\n`;
  const layout = requireLiteratureNoteLayout(old, undefined);
  assert.equal(layout.personal, "## My Notes\n\nPersonal writing\n");
  assert.match(layout.managed, /Example in the source/);
});
