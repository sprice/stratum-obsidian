import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import {
  INITIAL_CITATION_STYLES,
  readAvailableCitationStyles,
} from "../citation-style-defaults";

function fixture() {
  let failPrepare = false,
    failSave = false,
    saves = 0,
    invalidations = 0;
  const prepared: string[] = [];
  const runtime = loadRuntime<typeof import("../citation-style-collection")>(
    "citation-style-collection.ts",
    {},
    {},
    "node",
    {
      "./citation-styles": {
        styleTitle: (_plugin: unknown, id: string) => id,
        prepareStyle: (_plugin: unknown, id: string) => {
          prepared.push(id);
          return failPrepare
            ? Promise.reject(new Error("Download failed"))
            : Promise.resolve();
        },
      },
    },
  );
  const plugin = {
    isUnloaded: false,
    settings: {
      citationStyle: "apa",
      citationLanguage: "en-US",
      availableCitationStyles: [...INITIAL_CITATION_STYLES],
      citationStyles: { custom: "retained XML" },
    },
    saveSettings: () => {
      saves++;
      return failSave
        ? Promise.reject(new Error("Save failed"))
        : Promise.resolve();
    },
    refreshSettingTab() {},
    citations: {
      invalidate: () => {
        invalidations++;
      },
    },
  };
  return {
    runtime,
    plugin,
    prepared,
    failPrepare: () => {
      failPrepare = true;
    },
    failSave: () => {
      failSave = true;
    },
    get saves() {
      return saves;
    },
    get invalidations() {
      return invalidations;
    },
  };
}

test("initial availability is five styles and normalization always retains the default", () => {
  assert.equal(INITIAL_CITATION_STYLES.length, 5);
  assert.deepEqual(
    readAvailableCitationStyles(undefined, "apa"),
    INITIAL_CITATION_STYLES,
  );
  assert.deepEqual(
    readAvailableCitationStyles(["ieee", "ieee", null, "../invalid"], "apa"),
    ["ieee", "apa"],
  );
});

test("checking installs and enables; unchecking retains resources and the default", async () => {
  const f = fixture();
  await f.runtime.setCitationStyleAvailable(f.plugin as never, "custom", true);
  assert.ok(f.plugin.settings.availableCitationStyles.includes("custom"));
  assert.equal(f.plugin.settings.citationStyle, "apa");
  await f.runtime.setCitationStyleAvailable(f.plugin as never, "custom", false);
  assert.ok(!f.plugin.settings.availableCitationStyles.includes("custom"));
  assert.equal(f.plugin.settings.citationStyles.custom, "retained XML");
  assert.deepEqual(f.prepared, ["custom"]);
  assert.equal(f.invalidations, 2);
});

for (const failure of ["failPrepare", "failSave"] as const) {
  test(`${failure} does not enable a style or switch the default`, async () => {
    const f = fixture();
    f[failure]();
    await assert.rejects(
      f.runtime.setCitationStyleAvailable(f.plugin as never, "custom", true),
    );
    assert.ok(!f.plugin.settings.availableCitationStyles.includes("custom"));
    await assert.rejects(
      f.runtime.setDefaultCitationStyle(f.plugin as never, "ieee"),
    );
    assert.equal(f.plugin.settings.citationStyle, "apa");
    assert.equal(f.invalidations, 0);
  });
}

test("default protection holds even when a queued default change is still saving", async () => {
  const f = fixture();
  await assert.rejects(
    f.runtime.setCitationStyleAvailable(f.plugin as never, "apa", false),
  );
  await assert.rejects(
    f.runtime.setDefaultCitationStyle(f.plugin as never, "unavailable"),
  );
  await Promise.all([
    f.runtime.setDefaultCitationStyle(f.plugin as never, "ieee"),
    f.runtime.setCitationStyleAvailable(f.plugin as never, "apa", false),
  ]);
  assert.equal(f.plugin.settings.citationStyle, "ieee");
  assert.ok(!f.plugin.settings.availableCitationStyles.includes("apa"));
  await assert.rejects(
    f.runtime.setCitationStyleAvailable(f.plugin as never, "ieee", false),
  );
  assert.equal(f.saves, 2);
});
