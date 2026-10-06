import { USER_BOUNDARY_CALLOUT } from "../literature-note-content-types";
import { composeLiteratureNoteBody } from "../literature-note-layout";
import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

const itemUri = "zotero://select/library/items/ABCDEFGH";
const pdfUri = "zotero://open-pdf/library/items/PDFABCDE";
function referenceBlock(links: string): string {
  return `<!-- stratum:managed:start -->\n> [!cite] Reference\n> **Open**: [Zotero](${itemUri}) · ${links}\n<!-- stratum:managed:end -->\n`;
}
function noteContent(links: string): string {
  return `${referenceBlock(links)}\n${USER_BOUNDARY_CALLOUT}\n\n`;
}
function fixture() {
  const active = { path: "Papers/Active.md" };
  const reader = { path: "Papers/Reader.md" };
  const draft = { path: "Draft.md" };
  const files = new Map(
    [active, reader, draft].map((file) => [file.path, file]),
  );
  const metadata = new Map<string, Record<string, unknown>>([
    [
      active.path,
      { stratum_note_type: "literature-note", zotero_link: itemUri },
    ],
    [
      reader.path,
      {
        stratum_note_type: "literature-note",
        zotero_link: "zotero://select/groups/123/items/READERAB",
      },
    ],
    [draft.path, {}],
  ]);
  let activeFile: typeof active | null = active;
  let shown = true;
  let content = noteContent(`[PDF](${pdfUri})`);
  const opened: string[] = [];
  const notices: string[] = [];
  const pickers: {
    getItems(): { label: string; uri: string }[];
    onChooseItem(link: { label: string; uri: string }): void;
  }[] = [];
  const commands: { id: string; checkCallback(checking: boolean): boolean }[] =
    [];
  const plugin = {
    app: {
      workspace: {
        getActiveViewOfType: () => (activeFile ? { file: activeFile } : null),
        getLeavesOfType: () => [
          { view: { containerEl: { isShown: () => shown } } },
        ],
      },
      vault: {
        getAbstractFileByPath: (path: string) => files.get(path),
        cachedRead: () => Promise.resolve(content),
      },
      metadataCache: {
        getFileCache: (file: typeof active) => ({
          frontmatter: metadata.get(file.path),
        }),
      },
    },
    activeViewTab: "reader",
    readerNoteFile: reader as typeof reader | null,
    isUnloaded: false,
    addCommand: (command: (typeof commands)[number]) => commands.push(command),
  };
  const api = loadRuntime<typeof import("../zotero-open-commands")>(
    "zotero-open-commands.ts",
    {
      parseYaml: JSON.parse,
      MarkdownView: class {},
      Notice: class {
        constructor(message: string) {
          notices.push(message);
        }
      },
      FuzzySuggestModal: class {
        setPlaceholder() {}
        open() {
          pickers.push(this as never);
        }
      },
    },
    { window: { open: (uri: string) => opened.push(uri) } },
  );
  api.registerZoteroOpenCommands(plugin as never);
  return {
    api,
    plugin,
    active,
    reader,
    draft,
    files,
    metadata,
    opened,
    notices,
    pickers,
    commands,
    set activeFile(file: typeof active | null) {
      activeFile = file;
    },
    set shown(value: boolean) {
      shown = value;
    },
    set content(value: string) {
      content = value;
    },
  };
}

test("commands only check availability until executed and favor the active literature note", () => {
  const f = fixture();
  assert.deepEqual(
    f.commands.map((command) => command.id),
    ["open-source-in-zotero", "open-attachment-in-zotero"],
  );
  assert.equal(f.commands[0].checkCallback(true), true);
  assert.deepEqual(f.opened, []);
  assert.equal(f.commands[0].checkCallback(false), true);
  assert.deepEqual(f.opened, [itemUri]);
});

test("commands use the visible Reader beside a draft or when the sidebar has focus", () => {
  const f = fixture();
  f.activeFile = f.draft;
  assert.equal(f.api.zoteroCommandNote(f.plugin as never), f.reader);
  f.activeFile = null;
  f.commands[0].checkCallback(false);
  assert.deepEqual(f.opened, ["zotero://select/groups/123/items/READERAB"]);
});

test("hidden, inactive, deleted, and non-literature Reader notes do not enable commands", () => {
  const f = fixture();
  f.activeFile = f.draft;
  f.shown = false;
  assert.equal(f.commands[0].checkCallback(true), false);
  f.shown = true;
  f.plugin.activeViewTab = "search";
  assert.equal(f.commands[0].checkCallback(true), false);
  f.plugin.activeViewTab = "reader";
  f.files.delete(f.reader.path);
  assert.equal(f.commands[0].checkCallback(true), false);
  f.files.set(f.reader.path, f.reader);
  f.metadata.set(f.reader.path, {});
  assert.equal(f.commands[0].checkCallback(true), false);
});

test("single attachment opens the existing Zotero PDF link", async () => {
  const f = fixture();
  await f.api.openNoteInZotero(f.plugin as never, f.active as never, true);
  assert.deepEqual(f.opened, [pdfUri]);
  assert.equal(f.pickers.length, 0);
});

test("multiple attachments offer a choice including non-PDF source attachments", async () => {
  const f = fixture();
  const other = "zotero://select/library/items/OTHERABC";
  f.content = noteContent(
    `[PDF](${pdfUri}) · [Zotero: Supplement](${other}) · [PDF](${pdfUri})`,
  );
  await f.api.openNoteInZotero(f.plugin as never, f.active as never, true);
  assert.equal(f.opened.length, 0);
  assert.equal(f.pickers.length, 1);
  const choices = f.pickers[0].getItems();
  assert.equal(choices.length, 2);
  f.pickers[0].onChooseItem(choices[1]);
  assert.deepEqual(f.opened, [other]);
});

test("personal links and external source URLs cannot become attachment targets", async () => {
  const f = fixture();
  f.content =
    noteContent("[Source](https://example.test/paper)") +
    `> **Open**: [Personal PDF](${pdfUri})\n`;
  await f.api.openNoteInZotero(f.plugin as never, f.active as never, true);
  assert.equal(f.opened.length, 0);
  assert.equal(f.notices.length, 1);
  f.metadata.get(f.active.path)!.zotero_link = "https://example.test";
  await f.api.openNoteInZotero(f.plugin as never, f.active as never, false);
  assert.equal(f.opened.length, 0);
  assert.equal(f.notices.length, 2);
});

test("an attachment read that finishes after unloading does not open Zotero", async () => {
  const f = fixture();
  const opening = f.api.openNoteInZotero(
    f.plugin as never,
    f.active as never,
    true,
  );
  f.plugin.isUnloaded = true;
  await opening;
  assert.equal(f.opened.length, 0);
});

test("attachment commands ignore managed marker examples in personal writing at the top", async () => {
  const f = fixture();
  f.content = `---\n{"stratum_note_layout":2}\n---\n${composeLiteratureNoteBody(
    `## My Notes\n\n${referenceBlock("[Example](zotero://open-pdf/library/items/EXAMPLE1)")}\n`,
    referenceBlock(`[PDF](${pdfUri})`),
  )}`;
  await f.api.openNoteInZotero(f.plugin as never, f.active as never, true);
  assert.deepEqual(f.opened, [pdfUri]);
});

test("a PDF attachment named Zotero is not discarded as the parent-item link", async () => {
  const f = fixture();
  f.content = noteContent(`[Zotero](${pdfUri})`);
  await f.api.openNoteInZotero(f.plugin as never, f.active as never, true);
  assert.deepEqual(f.opened, [pdfUri]);
});

test("damaged new boundaries do not make personal reference examples into attachment targets", async () => {
  const f = fixture();
  f.content = `---\n{"stratum_note_layout":2}\n---\n## My Notes\n\n${referenceBlock(`[Example](${pdfUri})`)}`;
  await f.api.openNoteInZotero(f.plugin as never, f.active as never, true);
  assert.equal(f.opened.length, 0);
  assert.equal(f.notices.length, 1);
});

test("actual layout metadata distinguishes old-callout examples above the new boundary", async () => {
  const f = fixture();
  f.content = `---\n{"stratum_note_layout":2}\n---\n${composeLiteratureNoteBody(`## My Notes\n\n${USER_BOUNDARY_CALLOUT}\n\nPersonal example\n\n`, referenceBlock(`[PDF](${pdfUri})`))}`;
  await f.api.openNoteInZotero(f.plugin as never, f.active as never, true);
  assert.deepEqual(f.opened, [pdfUri]);
});
