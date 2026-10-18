import assert from "node:assert/strict";
import test from "node:test";
import type StratumPlugin from "../plugin";
import { setPublishingTemplateEnabled } from "../publishing-template-availability";
import {
  readPublishingTemplates,
  publishingTemplateEnabled,
} from "../publish-templates";
function setup() {
  const plugin = {
    settings: { publishingTemplates: readPublishingTemplates(undefined) },
    saves: 0,
    refreshes: 0,
    fail: false,
    saveSettings() {
      this.saves++;
      return this.fail
        ? Promise.reject(new Error("Save failed"))
        : Promise.resolve();
    },
    refreshViews() {
      this.refreshes++;
    },
  };
  return { plugin, host: plugin as unknown as StratumPlugin };
}
test("new and legacy configurations enable only built-ins by default", () => {
  for (const value of [
    undefined,
    { templates: [{ id: "custom", name: "My template" }] },
  ]) {
    const state = readPublishingTemplates(value);
    assert.equal(
      state.templates.every(
        (t) =>
          publishingTemplateEnabled(state, t) ===
          ["general", "academic"].includes(t.id),
      ),
      true,
    );
    assert.equal(state.templates[0].id, "general");
  }
  for (const enabledIds of [[], ["general"], ["academic"]]) {
    const state = readPublishingTemplates({ enabledIds });
    assert.deepEqual(state.enabledIds, enabledIds);
    assert.deepEqual(
      readPublishingTemplates(JSON.parse(JSON.stringify(state))).enabledIds,
      enabledIds,
    );
  }
});
test("successful enablement follows installation; disabling preserves configuration", async () => {
  const { plugin, host } = setup();
  let installs = 0;
  await setPublishingTemplateEnabled(
    host,
    "registry:example:1.0-r1",
    true,
    () => {
      assert.deepEqual(plugin.settings.publishingTemplates.enabledIds, [
        "general",
        "academic",
      ]);
      installs++;
      return Promise.resolve();
    },
  );
  await setPublishingTemplateEnabled(
    host,
    "registry:example:1.0-r1",
    false,
    () => {
      throw new Error("Disable must not install");
    },
  );
  assert.deepEqual(plugin.settings.publishingTemplates.enabledIds, [
    "general",
    "academic",
  ]);
  assert.equal(installs, 1);
  assert.equal(plugin.settings.publishingTemplates.templates.length, 2);
  assert.equal(plugin.refreshes, 2);
});
test("failed or cancelled installation leaves enablement untouched", async () => {
  const { plugin, host } = setup();
  await assert.rejects(
    setPublishingTemplateEnabled(host, "registry:example:1.0-r1", true, () =>
      Promise.reject(new Error("Offline")),
    ),
    /Offline/,
  );
  const abort = new AbortController();
  await assert.rejects(
    setPublishingTemplateEnabled(
      host,
      "registry:example:1.0-r1",
      true,
      () => {
        abort.abort();
        return Promise.resolve();
      },
      abort.signal,
    ),
    /cancelled/,
  );
  assert.deepEqual(plugin.settings.publishingTemplates.enabledIds, [
    "general",
    "academic",
  ]);
  assert.equal(plugin.saves, 0);
});
test("concurrent enablement retains both choices and failed settings writes roll back", async () => {
  const { plugin, host } = setup();
  plugin.settings.publishingTemplates = readPublishingTemplates({
    enabledIds: [],
  });
  await Promise.all([
    setPublishingTemplateEnabled(host, "general", true),
    setPublishingTemplateEnabled(host, "academic", true),
  ]);
  assert.deepEqual(plugin.settings.publishingTemplates.enabledIds, [
    "general",
    "academic",
  ]);
  plugin.fail = true;
  await assert.rejects(
    setPublishingTemplateEnabled(host, "general", false),
    /Save failed/,
  );
  assert.deepEqual(plugin.settings.publishingTemplates.enabledIds, [
    "general",
    "academic",
  ]);
});
test("a later disable cannot be undone by an earlier slow installation", async () => {
  const { plugin, host } = setup();
  let release!: () => void;
  const installing = setPublishingTemplateEnabled(
    host,
    "registry:example:1.0-r1",
    true,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await setPublishingTemplateEnabled(host, "registry:example:1.0-r1", false);
  release();
  await installing;
  assert.deepEqual(plugin.settings.publishingTemplates.enabledIds, [
    "general",
    "academic",
  ]);
});
