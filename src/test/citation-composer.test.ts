import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

test("composer writes to its captured editor and aborts stale or cancelled edits", async () => {
  for (const scenario of [
    "save",
    "changed",
    "closed",
    "cancelled",
    "disk-failure",
  ]) {
    let modal: { isActive: boolean; save: () => Promise<void> } | undefined;
    class File {}
    const file = new File(),
      bib = new File();
    let text = "A claim [@synthetic2026, p. xiv].";
    let open = true;
    let writes = 0;
    let inserted = "";
    const editor = {
      getValue: () => text,
      getCursor: () => ({ line: 0, ch: 15 }),
      posToOffset: (pos: { ch: number }) => pos.ch,
      offsetToPos: (ch: number) => ({ line: 0, ch }),
      replaceRange: (
        value: string,
        from: { ch: number },
        to: { ch: number },
      ) => {
        inserted = value;
        text = text.slice(0, from.ch) + value + text.slice(to.ch);
      },
      setCursor: () => {},
      focus: () => {},
    };
    const runtime = loadRuntime<typeof import("../citation-composer")>(
      "citation-composer.ts",
      {
        TFile: File,
        FuzzySuggestModal: class {},
        Modal: class {
          open() {
            modal = this as unknown as typeof modal;
            modal!.isActive = true;
          }
        },
        Notice: class {
          constructor(message: string) {
            throw new Error(message);
          }
        },
      },
      { Error },
    );
    const plugin = {
      register: () => {},
      app: {
        workspace: {
          activeEditor: { editor, file },
          getLeavesOfType: () => (open ? [{ view: { editor, file } }] : []),
        },
        metadataCache: {
          getFileCache: () => ({
            frontmatter: {
              stratum_note_type: "literature-note",
              zotero_title: "Synthetic source",
              citation_key: "synthetic2026",
              zotero_item_identity: "user/0/TEST",
            },
          }),
        },
        vault: {
          getMarkdownFiles: () => [
            { path: "Papers/Test source.md", basename: "Test source" },
          ],
          getAbstractFileByPath: () => bib,
          read: () => Promise.resolve(""),
          process: async (
            _file: File,
            transform: (value: string) => string,
          ) => {
            await Promise.resolve();
            if (scenario === "disk-failure") throw new Error("Disk full");
            transform("");
            writes++;
          },
        },
      },
    };
    await runtime.openCitationComposer(plugin as never, editor as never);
    assert.ok(modal);
    // Another active editor must not steal the insertion target.
    plugin.app.workspace.activeEditor = {
      editor: {} as typeof editor,
      file: new File(),
    };
    if (scenario === "changed") text += "Changed";
    if (scenario === "closed") open = false;
    if (scenario === "cancelled") modal.isActive = false;
    if (scenario === "save") {
      await modal.save();
      assert.equal(inserted, "[@synthetic2026, p. xiv]");
      assert.equal(text, "A claim [@synthetic2026, p. xiv].");
      assert.equal(writes, 1);
    } else {
      await assert.rejects(modal.save());
      assert.equal(inserted, "");
      assert.equal(writes, 0);
    }
  }
});
