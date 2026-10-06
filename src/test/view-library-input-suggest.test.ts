import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

for (const state of [
  "mounted",
  "detached",
  "disabled",
  "busy",
  "unloaded",
] as const) {
  test(`pending suggestions respect input lifecycle: ${state}`, async () => {
    let finish!: (value: never[]) => void;
    const pending = new Promise<never[]>((resolve) => {
      finish = resolve;
    });
    let feedback = 0;
    let events = 0;
    let selected = 0;
    const input = {
      isConnected: true,
      disabled: false,
      value: "author",
      dispatchEvent() {
        events++;
      },
    };
    const plugin = {
      isUnloaded: false,
      activeNoteActionKey: null as string | null,
      library: {
        fetchSuggestions: () => ({ results: [], pending }),
        selectResult() {
          selected++;
        },
      },
    };
    const { LibraryPaperInputSuggest } = loadRuntime<
      typeof import("../view-library-input-suggest")
    >(
      "view-library-input-suggest.ts",
      {
        AbstractInputSuggest: class {
          close() {}
        },
      },
      { Event: class {} },
    );
    class Suggest extends LibraryPaperInputSuggest {
      fetch() {
        return this.getSuggestions("author");
      }
    }
    const suggest = new Suggest(
      { app: {}, plugin } as never,
      { inputEl: input } as never,
      () => {
        feedback++;
      },
    );
    suggest.fetch();
    assert.equal(feedback, 1);
    if (state === "detached") input.isConnected = false;
    if (state === "disabled") input.disabled = true;
    if (state === "busy") plugin.activeNoteActionKey = "SYNTHKEY";
    if (state === "unloaded") plugin.isUnloaded = true;
    finish([]);
    await pending;
    assert.equal(events, state === "mounted" ? 1 : 0);
    assert.equal(feedback, state === "mounted" ? 2 : 1);
    suggest.selectSuggestion({ key: "SYNTHKEY" } as never);
    assert.equal(selected, state === "mounted" ? 1 : 0);
    assert.equal(input.value, "author", "Selection does not replace the query");
  });
}
