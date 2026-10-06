import assert from "node:assert/strict";
import test from "node:test";
import { ChangeSet, Text } from "@codemirror/state";
import { loadRuntime } from "./runtime-harness";
import * as summaryTemplates from "../source-summary-template";
const { DEFAULT_SOURCE_SUMMARY_TEMPLATE } = summaryTemplates;
import { composeLiteratureNoteBody } from "../literature-note-layout";
import {
  MANAGED_START,
  MANAGED_END,
  SYNC_BOUNDARY,
  USER_BOUNDARY_CALLOUT,
} from "../literature-note-content-types";

function fixture(text = "BeforeSelectedAfter") {
  class File {
    constructor(
      public path: string,
      public basename = "Working note",
    ) {}
  }
  class MarkdownView {
    file = new File("Papers/Working.md");
    mode = "source";
    leaf = { view: this };
    getMode() {
      return this.mode;
    }
    editor = {
      getValue: () => text,
      getCursor: (side: string) => ({ line: 0, ch: side === "from" ? 6 : 14 }),
      posToOffset: (p: { ch: number }) => p.ch,
      offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
      replaceRange: (insert: string, p: { ch: number }) => {
        text = text.slice(0, p.ch) + insert + text.slice(p.ch);
        writes++;
      },
      setCursor: (p: { ch: number }) => {
        cursor = p.ch;
      },
      focus: () => {
        focused = true;
      },
    };
  }
  let writes = 0,
    cursor = 0,
    focused = false;
  const view = new MarkdownView();
  const source = new File("Papers/Synthetic source.md", "Synthetic source");
  const files = new Map([
    [view.file.path, view.file],
    [source.path, source],
  ]);
  const metadata = new Map([
    [
      source.path,
      {
        stratum_note_type: "literature-note",
        zotero_title: "Synthetic source",
        authors: ["Alex Example"],
        year: 2026,
      },
    ],
  ]);
  const notices: string[] = [];
  let leaves = [view.leaf];
  const events = new Map<string, (leaf: typeof view.leaf | null) => void>();
  let pick: ((entry: { file: typeof source }) => void) | undefined;
  let closePicker: (() => void) | undefined;
  let extensionUpdate!: (update: unknown) => void;
  const plugin = {
    isUnloaded: false,
    settings: { sourceSummaryTemplate: DEFAULT_SOURCE_SUMMARY_TEMPLATE },
    app: {
      workspace: {
        getLeavesOfType: () => leaves,
        getActiveViewOfType: () => view,
        on: (
          event: string,
          callback: (leaf: typeof view.leaf | null) => void,
        ) => {
          events.set(event, callback);
          return {};
        },
        revealLeaf: () => Promise.resolve(),
      },
      vault: {
        on: () => ({}),
        getAbstractFileByPath: (path: string) => files.get(path),
      },
      metadataCache: {
        getFileCache: (file: File) => ({
          frontmatter: metadata.get(file.path),
        }),
      },
      fileManager: {
        generateMarkdownLink: (
          file: File,
          origin: string,
          _subpath: string,
          alias: string,
        ) => {
          assert.equal(origin, view.file.path);
          return `[[${file.basename}|${alias}]]`;
        },
      },
    },
  };
  const runtime = loadRuntime<typeof import("../source-summary")>(
    "source-summary.ts",
    {
      Component: class {
        registerEvent() {}
        register() {}
      },
      MarkdownView,
      TFile: File,
      Notice: class {
        constructor(message: string) {
          notices.push(message);
        }
      },
      parseYaml: JSON.parse,
      editorInfoField: {},
    },
    {},
    "node",
    {
      "./source-summary-template": summaryTemplates,
      "@codemirror/view": {
        ViewPlugin: {
          fromClass: (ctor: new () => { update(update: unknown): void }) => {
            const instance = new ctor();
            extensionUpdate = instance.update.bind(instance);
            return {};
          },
        },
      },
      "./library-search-modal": {
        buildLiteratureNoteEntries: () => [{ file: source }],
        literatureNoteEntryFromFrontmatter: (
          file: File,
          fm: Record<string, unknown>,
        ) => ({
          file,
          title: fm.zotero_title,
          authors: fm.authors,
          year: String(fm.year),
        }),
        LiteratureNoteSearchModal: class {
          constructor(_app: unknown, _entries: unknown, callback: typeof pick) {
            pick = callback;
          }
          open() {
            closePicker = () =>
              (this as unknown as { onClose(): void }).onClose();
          }
          onClose() {}
        },
      },
    },
  );
  const controller = new runtime.SourceSummaries(plugin as never);
  controller.onload();
  controller.editorExtension();
  return {
    runtime,
    controller,
    view,
    source,
    files,
    notices,
    events,
    plugin,
    get text() {
      return text;
    },
    get writes() {
      return writes;
    },
    get cursor() {
      return cursor;
    },
    get focused() {
      return focused;
    },
    choose: () => pick?.({ file: source }),
    cancel: () => closePicker?.(),
    switchDocument: (nextText: string) => {
      const next = new File("Papers/Other.md", "Other note");
      files.set(next.path, next);
      view.file = next;
      text = nextText;
    },
    returnToDestination: (nextText: string) => {
      view.file = files.get("Papers/Working.md")!;
      text = nextText;
    },
    closeDestination: () => {
      leaves = [];
    },
    update: (changes: ChangeSet) => {
      text = changes.apply(Text.of(text.split("\n"))).toString();
      extensionUpdate({
        state: { field: () => ({ editor: view.editor }) },
        docChanged: true,
        changes,
        view: { hasFocus: false },
      });
    },
  };
}

test("picker inserts after selection without replacement and returns focus", async () => {
  const f = fixture();
  f.controller.openPicker(f.view.editor as never);
  f.choose();
  await Promise.resolve();
  assert.ok(
    f.text.startsWith(
      "BeforeSelected\n\n---\n### [[Synthetic source|Synthetic source]]",
    ),
  );
  assert.ok(f.text.endsWith("\n\nAfter"));
  assert.ok(f.text.slice(0, f.cursor).endsWith("**Main argument:**"));
  assert.equal(f.writes, 1);
  assert.equal(f.focused, true);
});

test("cancel, closed destination, deleted source, and invalid template never write", () => {
  const cancelled = fixture();
  cancelled.controller.openPicker(cancelled.view.editor as never);
  cancelled.cancel();
  assert.equal(cancelled.writes, 0);
  const closed = fixture();
  closed.controller.openPicker(closed.view.editor as never);
  closed.closeDestination();
  closed.choose();
  assert.equal(closed.writes, 0);
  assert.ok(closed.notices.length);
  const deleted = fixture();
  deleted.files.delete(deleted.source.path);
  deleted.controller.insert(deleted.source as never);
  assert.equal(deleted.writes, 0);
  const invalid = fixture();
  invalid.plugin.settings.sourceSummaryTemplate = "{{bad}}";
  invalid.controller.insert(invalid.source as never);
  assert.equal(invalid.writes, 0);
});

test("Browse keeps the destination through focus changes and inserts there", () => {
  const f = fixture();
  f.events.get("active-leaf-change")?.(null);
  assert.equal(f.controller.destinationStatus().name, "Working note");
  f.controller.insert(f.source as never);
  assert.equal(f.writes, 1);
});

test("personal areas allow insertion while managed content and crossing selections reject it", () => {
  const { runtime } = fixture();
  const managed = `${MANAGED_START}\nSource\n${MANAGED_END}\n`;
  const fm =
    '---\n{"stratum_note_type":"literature-note","stratum_note_layout":2}\n---\n';
  const modern =
    fm + composeLiteratureNoteBody("## My Notes\n\nPersonal\n\n", managed);
  const personal = modern.indexOf("Personal");
  assert.equal(
    runtime.summaryPositionError(modern, personal, personal + 3),
    null,
  );
  assert.ok(
    runtime.summaryPositionError(
      modern,
      personal,
      modern.indexOf(SYNC_BOUNDARY) + 4,
    ),
  );
  assert.ok(
    runtime.summaryPositionError(
      modern,
      modern.indexOf("Source"),
      modern.indexOf("Source"),
    ),
  );
  assert.ok(runtime.summaryPositionError(modern, 0, 0));
  const legacy =
    '---\n{"stratum_note_type":"literature-note"}\n---\n' +
    managed +
    USER_BOUNDARY_CALLOUT +
    "\n\nPersonal";
  assert.equal(
    runtime.summaryPositionError(legacy, legacy.length, legacy.length),
    null,
  );
  assert.ok(runtime.summaryPositionError(legacy, 0, 0));
});

test("intervening edits map the picker bookmark rather than using a stale offset", () => {
  const f = fixture();
  f.controller.openPicker(f.view.editor as never);
  f.update(ChangeSet.of({ from: 0, insert: "Added " }, f.text.length));
  f.choose();
  assert.ok(f.text.startsWith("Added BeforeSelected\n\n---\n###"));
  assert.ok(f.text.endsWith("\n\nAfter"));
});

test("deleting the picker insertion anchor aborts rather than moving the summary", () => {
  const f = fixture();
  f.controller.openPicker(f.view.editor as never);
  f.update(
    ChangeSet.of(
      { from: 0, to: f.text.length, insert: "Replacement" },
      f.text.length,
    ),
  );
  f.choose();
  assert.equal(f.writes, 0);
  assert.equal(f.text, "Replacement");
  assert.match(f.notices[0], /position is no longer valid/);
});

test("reusing the editor for another document does not map old bookmarks into it", () => {
  const f = fixture();
  f.controller.openPicker(f.view.editor as never);
  f.switchDocument("New");
  assert.doesNotThrow(() =>
    f.update(ChangeSet.of({ from: 3, insert: " text" }, f.text.length)),
  );
  f.choose();
  assert.equal(f.writes, 0);
  assert.equal(f.text, "New text");
  assert.match(f.notices[0], /destination is no longer open/);
});

test("invalid YAML properties do not bypass the insertion boundary check", () => {
  const { runtime } = fixture();
  const content = "---\ninvalid: [\n---\nManaged content";
  assert.match(
    runtime.summaryPositionError(content, content.length, content.length)!,
    /invalid properties/,
  );
  const valid = '---\n{"type":"working-note"}\n---\nWriting';
  assert.equal(
    runtime.summaryPositionError(valid, valid.length, valid.length),
    null,
  );
});

test("returning to a reused pane does not resurrect its stale picker bookmark", () => {
  const f = fixture();
  f.controller.openPicker(f.view.editor as never);
  f.switchDocument("New");
  f.update(ChangeSet.of({ from: 3, insert: " text" }, f.text.length));
  f.returnToDestination("Different writing in the original file");
  f.choose();
  assert.equal(f.writes, 0);
  assert.equal(f.text, "Different writing in the original file");
  assert.match(f.notices[0], /position is no longer valid/);
});

test("empty properties blocks remain protected while their note body is writable", () => {
  const { runtime } = fixture();
  for (const properties of [
    "---\n---\n",
    "---\r\n---\r\n",
    "\uFEFF---\n---\n",
  ]) {
    const content = properties + "Existing writing";
    assert.match(
      runtime.summaryPositionError(content, 4, 4)!,
      /below its properties/,
    );
    assert.equal(
      runtime.summaryPositionError(
        content,
        properties.length,
        properties.length,
      ),
      null,
    );
  }
});

test("insertion cannot replace the real sync boundary with a template example", () => {
  const managed = `${MANAGED_START}\nSource\n${MANAGED_END}\n`;
  const content =
    '---\n{"stratum_note_type":"literature-note","stratum_note_layout":2}\n---\n' +
    composeLiteratureNoteBody(
      "## My Notes\n\n```\nExample\n```\n\nPersonal writing to preserve\n\n",
      managed,
    );
  const f = fixture(content);
  const offset = content.indexOf("Example");
  f.view.editor.getCursor = () => ({ line: 0, ch: offset });
  f.controller.capture(f.view as never);
  f.plugin.settings.sourceSummaryTemplate = `\`\`\`\`\n${SYNC_BOUNDARY}\n${MANAGED_START}\n\`\`\`\``;
  f.controller.insert(f.source as never);
  assert.equal(f.writes, 0);
  assert.equal(f.text, content);
  assert.match(f.notices[0], /boundary/);
});

test("valid insertion preserves modern and legacy personal content and managed sections", () => {
  const managed = `${MANAGED_START}\nSource\n${MANAGED_END}\n`;
  const properties = '---\n{"stratum_note_type":"literature-note"}\n---\n';
  for (const body of [
    composeLiteratureNoteBody("## My Notes\n\nPersonal writing\n\n", managed),
    managed + USER_BOUNDARY_CALLOUT + "\n\nPersonal writing",
  ]) {
    const content = properties + body;
    const f = fixture(content);
    const offset =
      content.indexOf("Personal writing") + "Personal writing".length;
    f.view.editor.getCursor = () => ({ line: 0, ch: offset });
    f.controller.capture(f.view as never);
    f.controller.insert(f.source as never);
    assert.equal(f.writes, 1, f.notices.join("; "));
    assert.ok(f.text.includes("Personal writing\n\n---\n###"));
    assert.ok(f.text.includes(managed));
  }
});
