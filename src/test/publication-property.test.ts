import assert from "node:assert/strict";
import test from "node:test";
import {
  changePublicationProperty,
  publicationPropertyRevision,
  publicationYaml,
  type PublicationPropertyOperation,
} from "../publication-metadata";
import { loadRuntime } from "./runtime-harness";
import type * as EditorModule from "../publication-editor";
function edit(text: string, operation: PublicationPropertyOperation): string {
  const change = changePublicationProperty(text, operation);
  const next =
    text.slice(0, change.from) + change.insert + text.slice(change.to);
  publicationYaml(next);
  return next;
}
const sample =
  "---\ntitle: Original # Owned comment\ntags: [private, preserved] # Keep this comment\ncustom:\n  untouched: true\nauthors:\n  - Legacy\nstratum_publish:\n  authors: []\n---\n\n# Body remains unchanged\n";
test("targeted publishing property add/edit/remove preserves unrelated YAML, legacy authors and body", () => {
  let text = edit(sample, { key: "title", value: "Updated: title" });
  text = edit(text, { key: "keywords", value: ["one", "two"] });
  text = edit(text, { key: "date", value: "2026-10-12" });
  text = edit(text, {
    key: "authors",
    value: ["Edited author", "Second author"],
  });
  assert.deepEqual(publicationYaml(text).properties.authors, [
    "Edited author",
    "Second author",
  ]);
  text = edit(text, { key: "keywords", value: "", remove: true });
  assert.equal(
    Object.hasOwn(publicationYaml(text).properties, "keywords"),
    false,
  );
  assert.ok(
    text.includes(
      "tags: [private, preserved] # Keep this comment\ncustom:\n  untouched: true",
    ),
  );
  assert.ok(text.includes("stratum_publish:\n  authors: []"));
  assert.ok(text.endsWith("# Body remains unchanged\n"));
  assert.ok(text.includes("# Owned comment"));
});
test("properties support absent frontmatter, BOM, CRLF, blank required values and explicit deletion", () => {
  let text = edit("\uFEFF# Manuscript\r\n", { key: "title", value: "" });
  assert.equal(publicationYaml(text).properties.title, "");
  assert.ok(text.startsWith("\uFEFF---\r\n"));
  text = edit(text, { key: "title", value: "", remove: true });
  assert.equal(Object.hasOwn(publicationYaml(text).properties, "title"), false);
  assert.ok(text.endsWith("# Manuscript\r\n"));
});
test("unsupported field keys and aliased data are rejected without rewriting the note", () => {
  assert.throws(
    () =>
      edit(sample, { key: "zotero_item_identity" as never, value: "changed" }),
    /not a publishing field/,
  );
  assert.throws(
    () =>
      edit("---\ntitle: &title Shared\nauthors: [*title]\n---\nBody", {
        key: "title",
        value: "changed",
      }),
    /anchored|aliased/,
  );
});
test("flow property edits keep punctuation and multiline text inside the scalar", () => {
  const source =
    "---\r\n{title: Original, tags: [keep]} # retained\r\n---\r\nBody";
  for (const value of [
    "Hello, world",
    "Title } text",
    "Title [text]",
    "Title\nSubtitle",
  ]) {
    const next = edit(source, { key: "title", value });
    assert.deepEqual(publicationYaml(next).properties, {
      title: value,
      tags: ["keep"],
    });
    assert.equal(
      next,
      source.replace("title: Original", `title: ${JSON.stringify(value)}`),
    );
  }
});
test("block scalar property edits preserve header comments and neighboring properties", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = [
      "---",
      "title: |- # Keep this comment",
      "  Original title",
      "# Neighbor comment",
      "custom: retained",
      "---",
      "Body",
    ].join(newline);
    for (const value of ["Updated title", "Title\nSubtitle"]) {
      const next = edit(source, { key: "title", value });
      assert.equal(publicationYaml(next).properties.title, value);
      assert.ok(next.includes("# Keep this comment"));
      assert.ok(
        next.endsWith(
          ["# Neighbor comment", "custom: retained", "---", "Body"].join(
            newline,
          ),
        ),
      );
    }
  }
});
function runtime(initial = sample) {
  let text = initial;
  let readOnly = false;
  const file = { path: "Synthetic.md", stat: { ctime: 1 } };
  let currentFile = file;
  const editor = {
    getValue: () => text,
    offsetToPos: (position: number) => position,
    transaction: ({
      changes,
    }: {
      changes: { from: number; to: number; text: string }[];
    }) => {
      for (const change of changes)
        text = text.slice(0, change.from) + change.text + text.slice(change.to);
    },
  };
  const view = {
    state: {
      doc: { toString: () => text },
      field: () => ({ file: currentFile, editor }),
      facet: (facet: { default: boolean }) => (facet.default ? true : readOnly),
    },
    dispatch() {},
    requestMeasure() {},
  };
  const { PublicationEditor } = loadRuntime<typeof EditorModule>(
    "publication-editor.ts",
    { Component: class {}, editorInfoField: {}, editorLivePreviewField: {} },
    { queueMicrotask, Error },
    "browser",
  );
  const service = new PublicationEditor({ publish: { emit() {} } } as never);
  const unregister = service.registerView(view as never);
  return {
    file,
    view,
    service,
    unregister,
    text: () => text,
    replace: (value: string) => {
      text = value;
    },
    replaceFile: () => {
      currentFile = { path: file.path, stat: { ctime: 2 } };
    },
    setReadOnly: () => {
      readOnly = true;
    },
  };
}
test("metadata sessions retain stale/failed drafts and never write without the original registered editable target", () => {
  const s = runtime();
  const draft = {
    file: s.file as never,
    ctime: 1,
    operation: { key: "title" as const, value: "Draft title" },
    revision: publicationPropertyRevision(
      publicationYaml(s.text()).properties,
      "title",
    ),
    conflict: "",
  };
  s.replace(s.text().replace("Original", "Newer title"));
  assert.equal(s.service.commitProperty(s.file.path, "title", draft), false);
  assert.match(s.text(), /Newer title/);
  assert.equal(s.service.pending(s.file.path), true);
  draft.revision = publicationPropertyRevision(
    publicationYaml(s.text()).properties,
    "title",
  );
  draft.conflict = "";
  assert.equal(s.service.commitProperty(s.file.path, "title", draft), true);
  assert.equal(s.service.pending(s.file.path), false);
  const before = s.text();
  s.setReadOnly();
  assert.equal(
    s.service.commitProperty(s.file.path, "title", {
      ...draft,
      revision: publicationPropertyRevision(
        publicationYaml(before).properties,
        "title",
      ),
      conflict: "",
    }),
    false,
  );
  assert.equal(s.text(), before);
  s.unregister();
  assert.equal(s.service.flush(s.file.path), false);
});

test("filling an empty Title commits without a conflict", () => {
  const s = runtime("---\ntitle:\nother: x\n---\nBody\n");
  const draft = {
    file: s.file as never,
    ctime: 1,
    operation: { key: "title" as const, value: "My Paper" },
    revision: publicationPropertyRevision(
      publicationYaml(s.text()).properties,
      "title",
    ),
    conflict: "",
  };
  assert.equal(s.service.commitProperty(s.file.path, "title", draft), true);
  assert.equal(draft.conflict, "");
  assert.equal(s.service.pending(s.file.path), false);
  assert.equal(s.text(), "---\ntitle: My Paper\nother: x\n---\nBody\n");
});

test("renaming the original file preserves drafts while same-path replacement rejects stale metadata and authors", () => {
  const s = runtime();
  const oldPath = s.file.path;
  const draft = {
    file: s.file as never,
    ctime: 1,
    operation: { key: "title" as const, value: "Renamed draft" },
    revision: publicationPropertyRevision(
      publicationYaml(s.text()).properties,
      "title",
    ),
    conflict: "",
  };
  s.service.session(oldPath).properties.set("title", draft);
  s.file.path = "Renamed.md";
  s.service.session(s.file.path);
  s.service.renameNote(s.file as never, oldPath);
  assert.equal(s.service.pending(s.file.path), true);
  assert.equal(s.service.flush(s.file.path), true);
  assert.match(s.text(), /Renamed draft/);
  const before = s.text();
  s.replaceFile();
  assert.equal(
    s.service.commitProperty(s.file.path, "title", {
      ...draft,
      revision: publicationPropertyRevision(
        publicationYaml(s.text()).properties,
        "title",
      ),
    }),
    false,
  );
  assert.equal(
    s.service.commit(s.view as never, s.file.path, "name:0", {
      file: s.file as never,
      ctime: 1,
      operation: { type: "field", author: 0, key: "name", value: "Wrong note" },
      revision: "",
      conflict: "",
    }),
    false,
  );
  assert.equal(s.text(), before);
});
