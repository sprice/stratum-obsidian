import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

test("autocomplete excludes emails, code, comments, links and frontmatter", () => {
  const runtime = loadRuntime<typeof import("../citation-suggest")>(
    "citation-suggest.ts",
    {
      EditorSuggest: class {
        setInstructions() {}
      },
      Modal: class {},
      FuzzySuggestModal: class {},
    },
  );
  const suggest = new runtime.CitationSuggest({
    app: { vault: { getMarkdownFiles: () => [] } },
  } as never);
  for (const [text, expected] of [
    ["A claim @smi", true],
    ["@", true],
    ["name@smi", false],
    ["` @smi`", false],
    ["<!-- @smi", false],
    ["---\nauthor: @smi\n---", false],
    ["[[@smi]]", false],
    ["[link](https://example.test/@smi)", false],
    ["```\n@smi", false],
    ["    @smi", false],
  ] as const) {
    const offset = text.indexOf("@") + (text.includes("smi") ? 4 : 1);
    const before = text.slice(0, offset);
    const lines = text.split("\n");
    const line = before.split("\n").length - 1;
    const ch = before.split("\n").at(-1)!.length;
    const editor = {
      getValue: () => text,
      getLine: (i: number) => lines[i],
      posToOffset: (pos: { line: number; ch: number }) =>
        lines.slice(0, pos.line).reduce((n, value) => n + value.length + 1, 0) +
        pos.ch,
    };
    assert.equal(
      Boolean(suggest.onTrigger({ line, ch }, editor as never, {} as never)),
      expected,
      text,
    );
  }
});
