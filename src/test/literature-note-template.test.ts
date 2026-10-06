import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiteratureNoteContent,
  splitFrontmatterContent,
} from "../literature-note-content";
import { normalizeZoteroItemDetail } from "../zotero-item-detail-normalizer";
import { requireLiteratureNoteLayout } from "../literature-note-layout";
import {
  DEFAULT_NOTES_TEMPLATE,
  NOTES_TEMPLATE_KEY,
  validateNotesTemplate,
  renderNotesTemplate,
} from "../literature-note-template";
import {
  MANAGED_START,
  MANAGED_END,
  SYNC_BOUNDARY,
  USER_BOUNDARY_CALLOUT,
} from "../literature-note-content-types";

const detail = normalizeZoteroItemDetail({
  zoteroUserId: "1",
  library: {
    type: "user",
    id: "1",
    identity: "user:1",
    zoteroUriSegment: "library",
  },
  parentItem: {
    key: "TEST0001",
    version: 1,
    data: { itemType: "document", title: "Synthetic paper" },
  },
  childItems: [],
  collections: [],
});
function write(
  notesTemplate = DEFAULT_NOTES_TEMPLATE,
  existingContent?: string,
) {
  return buildLiteratureNoteContent({
    detail,
    notesTemplate,
    existingContent,
    stratumVersion: "test",
    filenameStem: "Synthetic",
    parseYaml: JSON.parse,
    stringifyYaml: JSON.stringify,
    htmlToMarkdown: (html) => html,
  });
}
function read(content: string) {
  const { frontmatter, body } = splitFrontmatterContent(content, JSON.parse);
  return {
    frontmatter,
    ...requireLiteratureNoteLayout(body, frontmatter.stratum_note_layout),
  };
}

test("new notes record their starter and untouched notes follow successive templates", () => {
  const original = write();
  assert.equal(
    read(original).personal,
    renderNotesTemplate(DEFAULT_NOTES_TEMPLATE),
  );
  assert.equal(
    read(original).frontmatter[NOTES_TEMPLATE_KEY],
    read(original).personal,
  );
  const first = write("## Summary\n\n- [ ] Read", original);
  assert.equal(
    read(first).personal,
    renderNotesTemplate("## Summary\n\n- [ ] Read"),
  );
  const second = write("## Questions", first);
  assert.equal(read(second).personal, renderNotesTemplate("## Questions"));
  const repeated = read(write("## Questions", second));
  assert.equal(repeated.personal, read(second).personal);
  assert.equal(
    repeated.frontmatter[NOTES_TEMPLATE_KEY],
    read(second).frontmatter[NOTES_TEMPLATE_KEY],
  );
});

test("edited starters and their recorded history survive later template changes", () => {
  const template = "## Summary\n\n- [ ] Read";
  const initial = write(template);
  for (const edited of [
    "- [x] Read",
    "- [ ] Read\n\nMy analysis  \n[[Companion]]",
    "- [ ] Read\n\n",
  ]) {
    const content = initial.replace(
      "- [ ] Read\n\n" + SYNC_BOUNDARY,
      edited + "\n\n" + SYNC_BOUNDARY,
    );
    const updated = write("## New default", content);
    assert.equal(read(updated).personal, read(content).personal);
    assert.equal(
      read(updated).frontmatter[NOTES_TEMPLATE_KEY],
      renderNotesTemplate(template),
    );
  }
});

test("untracked legacy notes adopt a starter only when empty or historically untouched", () => {
  for (const personal of [
    "",
    "\n",
    "\nMy research\n",
    "\n## Another heading\n",
  ]) {
    const legacy = `${MANAGED_START}\nOld source\n${MANAGED_END}\n\n${USER_BOUNDARY_CALLOUT}\n${personal}`;
    const updated = read(write("## New starter", legacy));
    if (!personal.trim()) {
      assert.equal(updated.personal, renderNotesTemplate("## New starter"));
    } else {
      assert.equal(updated.personal, `## My Notes\n${personal}\n`);
      assert.equal(updated.frontmatter[NOTES_TEMPLATE_KEY], undefined);
    }
  }
});

test("CRLF differences do not lock an untouched starter", () => {
  const initial = write("## Summary\n\nPrompt");
  const { frontmatter } = read(initial);
  const body = splitFrontmatterContent(initial, JSON.parse).body.replaceAll(
    "\n",
    "\r\n",
  );
  const crlf = `---\n${JSON.stringify(frontmatter)}\n---\n${body}`;
  assert.equal(
    read(write("## Changed", crlf)).personal,
    renderNotesTemplate("## Changed"),
  );
});

test("templates cannot break boundaries but may contain fenced marker examples", () => {
  assert.equal(validateNotesTemplate(""), null);
  assert.equal(validateNotesTemplate("## Summary\n\nPrompt"), null);
  assert.ok(validateNotesTemplate("```md\nUnclosed fence"));
  assert.ok(validateNotesTemplate(SYNC_BOUNDARY));
  assert.equal(
    validateNotesTemplate(`\`\`\`md\n${SYNC_BOUNDARY}\n\`\`\``),
    null,
  );
});
