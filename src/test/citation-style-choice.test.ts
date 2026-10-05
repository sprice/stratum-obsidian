import assert from "node:assert/strict";
import test from "node:test";
import type * as Choice from "../citation-style-choice";
import { loadRuntime } from "./runtime-harness";
import { DEFAULT_SETTINGS } from "../settings-data";

function fixture() {
  const frontmatter: Record<string, unknown> = {
    title: "Synthetic draft",
    stratum_citation_style: "apa",
    stratum_citation_language: "en-GB",
  };
  let prepares = 0;
  let invalidations = 0;
  let failPrepare = false;
  let failSave = false;
  const file = { path: "Synthetic draft.md" };
  const styles = {
    apa: "APA",
    ieee: "IEEE",
    custom: "Custom journal",
    "chicago-notes-bibliography":
      "Chicago 18th edition (notes and bibliography)",
  };
  const runtime = loadRuntime<typeof Choice>(
    "citation-style-choice.ts",
    {},
    {},
    "node",
    {
      "./citation-styles": {
        bundledStyles: [
          { id: "apa", title: "APA" },
          { id: "ieee", title: "IEEE" },
          {
            id: "chicago-notes-bibliography",
            title: styles["chicago-notes-bibliography"],
          },
        ],
        cachedStyle: (_plugin: unknown, id: string) =>
          styles[id as keyof typeof styles],
        styleTitle: (_plugin: unknown, id: string) =>
          styles[id as keyof typeof styles] ?? id,
        prepareStyle: () => {
          prepares++;
          return failPrepare
            ? Promise.reject(new Error("Unavailable"))
            : Promise.resolve();
        },
      },
    },
  );
  const plugin = {
    isUnloaded: false,
    settings: {
      citationStyle: DEFAULT_SETTINGS.citationStyle,
      citationStyles: { custom: "xml", apa: "xml" },
    },
    citations: {
      preferences: (_path: string, text: string) => ({
        style: text.includes("stratum_citation_style: apa")
          ? "apa"
          : plugin.settings.citationStyle,
        language: "en-GB",
      }),
      invalidate: () => {
        invalidations++;
      },
    },
    app: {
      fileManager: {
        processFrontMatter: (
          _file: unknown,
          update: (fm: Record<string, unknown>) => void,
        ) => {
          if (failSave) return Promise.reject(new Error("Save failed"));
          update(frontmatter);
          return Promise.resolve();
        },
      },
    },
  };
  return {
    plugin,
    file,
    runtime,
    frontmatter,
    failPrepare: () => {
      failPrepare = true;
    },
    failSave: () => {
      failSave = true;
    },
    get prepares() {
      return prepares;
    },
    get invalidations() {
      return invalidations;
    },
  };
}

test("selector shows the effective style, initially Chicago, and includes installed styles once without a default option", () => {
  const f = fixture();
  const inherited = f.runtime.noteCitationStyleChoices(
    f.plugin as never,
    f.file as never,
    "Draft text",
  );
  const explicit = f.runtime.noteCitationStyleChoices(
    f.plugin as never,
    f.file as never,
    "---\nstratum_citation_style: apa\n---\nDraft text",
  );
  assert.equal(inherited.selected, "chicago-notes-bibliography");
  assert.equal(explicit.selected, "apa");
  assert.deepEqual(
    Array.from(inherited.options, ({ id }) => id),
    ["apa", "ieee", "chicago-notes-bibliography", "custom"],
  );
  f.plugin.settings.citationStyle = "ieee";
  assert.equal(
    f.runtime.noteCitationStyleChoices(
      f.plugin as never,
      f.file as never,
      "Draft text",
    ).selected,
    "ieee",
  );
});

test("selecting another style or the overall default saves the named style and preserves language and unrelated frontmatter", async () => {
  const f = fixture();
  await f.runtime.setNoteCitationStyle(
    f.plugin as never,
    f.file as never,
    "ieee",
    "en-GB",
  );
  assert.equal(f.frontmatter.stratum_citation_style, "ieee");
  await f.runtime.setNoteCitationStyle(
    f.plugin as never,
    f.file as never,
    "chicago-notes-bibliography",
    "en-GB",
  );
  assert.equal(
    f.frontmatter.stratum_citation_style,
    "chicago-notes-bibliography",
  );
  assert.equal(f.frontmatter.stratum_citation_language, "en-GB");
  assert.equal(f.frontmatter.title, "Synthetic draft");
  assert.equal(f.plugin.settings.citationStyle, "chicago-notes-bibliography");
  assert.equal(f.invalidations, 2);
});

for (const failure of ["failPrepare", "failSave"] as const) {
  test(`${failure} retains the previous note preference`, async () => {
    const f = fixture();
    f[failure]();
    await assert.rejects(
      f.runtime.setNoteCitationStyle(
        f.plugin as never,
        f.file as never,
        "ieee",
        "en-GB",
      ),
    );
    assert.equal(f.frontmatter.stratum_citation_style, "apa");
    assert.equal(f.invalidations, 0);
  });
}
