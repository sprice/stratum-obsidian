import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./runtime-harness";
function fixture() {
  let text = "A claim [@a; @b].";
  let restored = 0,
    focused = 0,
    followed = 0;
  let picker:
    | {
        getSuggestions(query: string): { key: string }[];
        onChooseSuggestion(choice: unknown): void;
        close(): void;
      }
    | undefined;
  const cleanup: (() => void)[] = [];
  const notices: string[] = [];
  class View {
    file = { path: "Papers/Example.md" };
    mode = "source";
    getMode() {
      return this.mode;
    }
    getEphemeralState() {
      return { scroll: 12 };
    }
    setEphemeralState() {
      restored++;
    }
    editor = {
      getValue: () => text,
      listSelections: () => [
        { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
      ],
      getScrollInfo: () => ({ left: 0, top: 120 }),
      setSelections: () => restored++,
      scrollTo: () => {},
      focus: () => focused++,
    };
  }
  const view = new View(),
    leaf = { view };
  let leaves = [leaf];
  let recent: typeof leaf | null = leaf;
  const entries = ["a", "b"].map((key) => ({
    identity: `user/1/${key}`,
    title: `Synthetic ${key}`,
    authors: ["Example"],
    file: { path: `Papers/${key}.md` },
  }));
  let conflict = false;
  const runtime = loadRuntime<typeof import("../citation-evidence")>(
    "citation-evidence.ts",
    {
      MarkdownView: View,
      Notice: class {
        constructor(message: string) {
          notices.push(message);
        }
      },
      SuggestModal: class {
        setPlaceholder() {}
        open() {
          picker = this as unknown as typeof picker;
        }
        close() {
          picker = undefined;
        }
      },
    },
  );
  const plugin = {
    isUnloaded: false,
    settings: { enabledTabs: { reader: true, sources: true } },
    activeViewTab: "sources",
    readerNoteFile: null as unknown,
    saveSettings: () => Promise.resolve(),
    register: (fn: () => void) => cleanup.push(fn),
    refreshViews() {},
    activateView: () => Promise.resolve(),
    sources: {
      showCurrent() {
        followed++;
      },
    },
    citations: {
      diagnose: (keys: string[]) =>
        Promise.resolve(
          keys.map((key) => {
            const entry = entries.find((entry) =>
              entry.identity.endsWith(`/${key}`),
            );
            return {
              key,
              identity: conflict ? undefined : entry?.identity,
              notes: entries.filter(
                (note) => note.identity === entry?.identity,
              ),
              problem: conflict ? "conflicting-key" : undefined,
            };
          }),
        ),
    },
    app: {
      workspace: {
        rootSplit: {},
        getMostRecentLeaf: () => recent,
        getLeavesOfType: () => leaves,
        revealLeaf: () => Promise.resolve(),
      },
      vault: { cachedRead: () => Promise.resolve(text) },
    },
  };
  return {
    runtime,
    plugin,
    view,
    entries,
    open: (keys = ["a"]) =>
      runtime.openCitationEvidence(plugin as never, keys, view.file.path, text),
    get picker() {
      return picker;
    },
    mutate() {
      text += " changed";
    },
    switchTab() {
      recent = null;
    },
    closeTab() {
      leaves = [];
    },
    conflict() {
      conflict = true;
    },
    counts: () => ({ restored, focused, followed }),
    notices,
    unload() {
      plugin.isUnloaded = true;
      cleanup.forEach((fn) => fn());
    },
  };
}
test("single evidence source opens Reader and restores the original editor selection", async () => {
  const f = fixture();
  await f.open();
  assert.equal(f.plugin.readerNoteFile, f.entries[0].file);
  assert.equal(f.plugin.activeViewTab, "reader");
  await f.runtime.returnToWriting(f.plugin as never);
  assert.equal(f.counts().restored, 1);
  f.mutate();
  await f.runtime.returnToWriting(f.plugin as never);
  assert.equal(f.counts().restored, 1);
  f.closeTab();
  await f.runtime.returnToWriting(f.plugin as never);
  assert.equal(f.runtime.hasWritingPosition(f.plugin as never), false);
});
test("groups require a choice and stale papers cannot navigate", async () => {
  const f = fixture();
  await f.open(["a", "b"]);
  assert.ok(f.picker);
  assert.equal(f.plugin.readerNoteFile, null);
  const choice = f.picker.getSuggestions("")[1];
  f.mutate();
  f.picker.onChooseSuggestion(choice);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.plugin.readerNoteFile, null);
  assert.match(f.notices[0], /changed/);
  f.unload();
  assert.equal(f.picker, undefined);
});
test("ambiguous and missing evidence lead to Sources without selecting a note", async () => {
  const f = fixture();
  f.conflict();
  await f.open();
  assert.equal(f.plugin.activeViewTab, "sources");
  assert.equal(f.counts().followed, 1);
  assert.equal(f.plugin.readerNoteFile, null);
});
test("Reading view restores scroll context without switching into editing", async () => {
  const f = fixture();
  f.view.mode = "preview";
  await f.open();
  await f.runtime.returnToWriting(f.plugin as never);
  assert.equal(f.view.mode, "preview");
  assert.equal(f.counts().restored, 1);
  assert.equal(f.counts().focused, 0);
});
test("group selection opens the chosen source, not the first", async () => {
  const f = fixture();
  await f.open(["a", "b"]);
  f.picker!.onChooseSuggestion(f.picker!.getSuggestions("Synthetic b")[0]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.plugin.readerNoteFile, f.entries[1].file);
});
test("ownership changing during a choice routes to recovery", async () => {
  const f = fixture();
  await f.open(["a", "b"]);
  f.conflict();
  f.picker!.onChooseSuggestion(f.picker!.getSuggestions("")[0]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.plugin.readerNoteFile, null);
  assert.equal(f.counts().followed, 1);
});
test("missing evidence routes to recovery and unload prevents navigation", async () => {
  const f = fixture();
  await f.open(["unknown"]);
  assert.equal(f.counts().followed, 1);
  f.unload();
  await f.open();
  assert.equal(f.plugin.readerNoteFile, null);
});

test("duplicate notes require an explicit file choice", async () => {
  const f = fixture();
  const duplicate = { ...f.entries[0], file: { path: "Papers/Other copy.md" } };
  f.entries.push(duplicate);
  await f.open();
  assert.ok(f.picker);
  assert.equal(f.plugin.readerNoteFile, null);
  f.picker.onChooseSuggestion(f.picker.getSuggestions("Other copy")[0]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.plugin.readerNoteFile, duplicate.file);
});

test("a delayed lookup cannot navigate after switching papers", async () => {
  const f = fixture();
  const diagnose = f.plugin.citations.diagnose;
  let release!: () => void;
  f.plugin.citations.diagnose = async (keys) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return diagnose(keys);
  };
  const opening = f.open();
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.switchTab();
  release();
  await opening;
  assert.equal(f.plugin.readerNoteFile, null);
  assert.equal(f.counts().followed, 0);
});
test("a newer citation request supersedes an older lookup", async () => {
  const f = fixture();
  const diagnose = f.plugin.citations.diagnose;
  let release!: () => void;
  let calls = 0;
  f.plugin.citations.diagnose = async (keys) => {
    if (++calls === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return diagnose(keys);
  };
  const old = f.open(["a"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await f.open(["b"]);
  release();
  await old;
  assert.equal(f.plugin.readerNoteFile, f.entries[1].file);
});
test("return does not apply Reading state after switching into editing during a read", async () => {
  const f = fixture();
  f.view.mode = "preview";
  await f.open();
  f.plugin.app.vault.cachedRead = () => {
    f.view.mode = "source";
    return Promise.resolve("A claim [@a; @b].");
  };
  await f.runtime.returnToWriting(f.plugin as never);
  assert.equal(f.counts().restored, 0);
});

for (const target of ["reader", "sources"] as const) {
  test(`citation evidence cannot open hidden ${target}`, async () => {
    const f = fixture();
    f.plugin.activeViewTab = "search";
    f.plugin.settings.enabledTabs[target] = false;
    await f.open(target === "reader" ? ["a"] : ["missing"]);
    assert.equal(f.plugin.activeViewTab, "search");
    assert.equal(f.plugin.readerNoteFile, null);
    assert.equal(f.counts().followed, 0);
    assert.equal(f.runtime.hasWritingPosition(f.plugin as never), false);
    assert.ok(f.notices.some((message) => message.includes("is hidden")));
  });
}
