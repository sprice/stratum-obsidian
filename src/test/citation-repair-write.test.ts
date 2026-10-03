import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./runtime-harness";

test("repair writes guard stale documents, cancellation, concurrent bibliography edits and disk failures", async () => {
  for (const scenario of [
    "success",
    "cancelled",
    "changed-bib",
    "disk-failure",
    "changed-during-write",
  ]) {
    class File {}
    const { commitCitationRepair } = loadRuntime<
      typeof import("../citation-repair-write")
    >("citation-repair-write.ts", { TFile: File });
    let active = scenario !== "cancelled";
    let contents = scenario === "changed-bib" ? "other" : "before";
    let transactions = 0;
    const app = {
      vault: {
        getAbstractFileByPath: () => new File(),
        process: async (_: unknown, update: (text: string) => string) => {
          await Promise.resolve();
          if (scenario === "disk-failure") throw new Error("disk failure");
          contents = update(contents);
          if (scenario === "changed-during-write") active = false;
        },
      },
    };
    const editor = {
      offsetToPos: (ch: number) => ({ line: 0, ch }),
      transaction: (value: { changes: unknown[] }) => {
        transactions++;
        assert.equal(value.changes.length, 2);
      },
    };
    const task = commitCitationRepair(
      app as never,
      editor as never,
      "before",
      {
        key: "safe",
        bibliography: "after",
        edits: [0, 10].map((from) => ({
          from,
          to: from + 4,
          before: "@bad",
          after: "@safe",
          excerpt: "Synthetic",
        })),
      },
      () => active,
    );
    if (scenario === "success") {
      await task;
      assert.equal(transactions, 1);
      assert.equal(contents, "after");
    } else {
      await assert.rejects(task);
      assert.equal(transactions, 0);
      assert.equal(
        contents,
        scenario === "changed-during-write"
          ? "after"
          : scenario === "changed-bib"
            ? "other"
            : "before",
      );
    }
  }
});
