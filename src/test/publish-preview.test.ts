import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { loadRuntime } from "./runtime-harness";
import type * as Preview from "../publish-preview";

test("saved legacy tabs open the migrated PDF in the same native workspace leaf", async () => {
  const messages: string[] = [];
  const opened: unknown[] = [];
  const file = { path: "Stratum Docs/Synthetic.pdf" };
  const { PublishPreviewView } = loadRuntime<typeof Preview>(
    "publish-preview.ts",
    {
      ItemView: class {
        contentEl = { setText: (text: string) => messages.push(text) };
        constructor(public leaf: unknown) {}
        setState() {
          return Promise.resolve();
        }
      },
    },
  );
  const leaf = {
    view: undefined as unknown,
    openFile: (value: unknown) => {
      opened.push(value);
      return Promise.resolve();
    },
  };
  const view = new PublishPreviewView(
    leaf as never,
    {
      store: {
        list: () => Promise.resolve({ documents: [{ id: "synthetic" }] }),
      },
      pdfFile: () => file,
      fail: () => assert.fail("Restoring the tab should succeed"),
    } as never,
  );
  leaf.view = view;
  await view.setState({ documentId: "synthetic" }, {} as never);
  assert.deepEqual(opened, [file]);
  assert.equal(messages.length, 0);
  await view.setState({ documentId: "missing" }, {} as never);
  assert.equal(opened.length, 1);
  assert.match(messages[0], /unavailable/);
});

test("superseded restores cannot open a PDF or report stale errors", async () => {
  const opened: unknown[] = [];
  const pending: {
    resolve: (value: { documents: { id: string }[] }) => void;
    reject: (error: Error) => void;
  }[] = [];
  const { PublishPreviewView } = loadRuntime<typeof Preview>(
    "publish-preview.ts",
    {
      ItemView: class {
        contentEl = {
          setText: () => assert.fail("Stale restore changed the tab"),
        };
        constructor(public leaf: unknown) {}
        setState() {
          return Promise.resolve();
        }
      },
    },
  );
  const leaf = {
    view: undefined as unknown,
    openFile: (file: unknown) => {
      opened.push(file);
      return Promise.resolve();
    },
  };
  const view = new PublishPreviewView(
    leaf as never,
    {
      store: {
        list: () =>
          new Promise((resolve, reject) => pending.push({ resolve, reject })),
      },
      pdfFile: (doc: { id: string }) => doc,
      fail: () => assert.fail("Stale restore reported an error"),
    } as never,
  );
  leaf.view = view;
  const first = view.setState({ documentId: "first" }, {} as never);
  await setImmediate();
  const second = view.setState({ documentId: "second" }, {} as never);
  await setImmediate();
  pending[0].resolve({ documents: [{ id: "second" }] });
  await first;
  assert.deepEqual(opened, []);
  leaf.view = {};
  pending[1].reject(new Error("Old lookup failed"));
  await second;
  assert.deepEqual(opened, []);
});
