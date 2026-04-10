import assert from "node:assert/strict";
import test from "node:test";
import { loadEnrichmentForNoteWrite } from "../plugin-enrichment";
import { DEFAULT_SETTINGS } from "../settings-data";

test("loadEnrichmentForNoteWrite asks the backend and does not persist plugin-side state", async () => {
  const calls: string[] = [];
  const plugin = {
    settings: {
      ...DEFAULT_SETTINGS,
    },
    backend: {
      getOpenAlexEnrichment() {
        calls.push("backend");
        return Promise.resolve(null);
      },
    },
    saveSettings() {
      calls.push("save");
      return Promise.resolve();
    },
  };

  const result = await loadEnrichmentForNoteWrite(plugin as never, {
    doi: "10.1000/test",
  });

  assert.equal(result, null);
  assert.deepEqual(calls, ["backend"]);
});

test("loadEnrichmentForNoteWrite preserves existing enrichment when the backend reports a temporary failure", async () => {
  const plugin = {
    settings: {
      ...DEFAULT_SETTINGS,
    },
    backend: {
      getOpenAlexEnrichment() {
        return Promise.resolve(undefined);
      },
    },
  };

  const result = await loadEnrichmentForNoteWrite(plugin as never, {
    doi: "10.1000/test",
  });

  assert.equal(result, undefined);
});
