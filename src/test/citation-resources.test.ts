import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
const resources = loadRuntime<typeof import("../citation-resources")>(
  "citation-resources.ts",
  {},
);
function fixture(initial?: string) {
  let content = initial,
    writes = 0,
    fails = false;
  const plugin = {
    manifest: { dir: "custom-config/plugins/stratum" },
    app: {
      vault: {
        adapter: {
          exists: () => Promise.resolve(content !== undefined),
          read: () => Promise.resolve(content!),
          write: (_path: string, text: string) => {
            if (fails) throw new Error("Disk full");
            content = text;
            writes++;
            return Promise.resolve();
          },
        },
      },
    },
    settings: {
      citationStyle: "apa",
      citationStyles: { "custom-a": "<style/>", apa: "old-bundle" },
      citationLocales: { "en-US": "old-locale" },
    },
  };
  return {
    plugin: plugin as never,
    get writes() {
      return writes;
    },
    get content() {
      return content;
    },
    set content(value: string | undefined) {
      content = value;
    },
    set fails(value: boolean) {
      fails = value;
    },
  };
}
test("migration removes bundled XML and only strips settings after a successful resource write", async () => {
  const f = fixture();
  await resources.loadCitationResources(f.plugin);
  f.fails = true;
  await assert.rejects(resources.saveCitationResources(f.plugin), /Disk full/);
  assert.ok("citationStyles" in resources.settingsWithoutResources(f.plugin));
  f.fails = false;
  await resources.saveCitationResources(f.plugin);
  assert.equal(
    "citationStyles" in resources.settingsWithoutResources(f.plugin),
    false,
  );
  assert.deepEqual(JSON.parse(f.content!), {
    styles: { "custom-a": "<style/>" },
    locales: {},
  });
  await resources.saveCitationResources(f.plugin);
  assert.equal(f.writes, 1);
});
test("corrupt resources do not partially replace the current styles or get overwritten", async () => {
  const f = fixture(
    JSON.stringify({ styles: { replacement: "new" }, locales: { bad: 42 } }),
  );
  await assert.rejects(resources.loadCitationResources(f.plugin), /Invalid/);
  const settings = resources.settingsWithoutResources(f.plugin);
  assert.ok(settings.citationStyles && "custom-a" in settings.citationStyles);
  await assert.rejects(
    resources.saveCitationResources(f.plugin),
    /could not be read/,
  );
  assert.equal(f.writes, 0);
});

test("a later corrupt external resource edit revokes permission to overwrite the cache", async () => {
  const f = fixture();
  await resources.loadCitationResources(f.plugin);
  await resources.saveCitationResources(f.plugin);
  f.content = "{";
  await assert.rejects(resources.loadCitationResources(f.plugin));
  await assert.rejects(
    resources.saveCitationResources(f.plugin),
    /could not be read/,
  );
  assert.equal(f.content, "{");
  assert.ok("citationStyles" in resources.settingsWithoutResources(f.plugin));
});
