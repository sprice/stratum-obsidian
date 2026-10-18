import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../settings-data";
import { loadRuntime } from "./runtime-harness";

function fixture(isDesktopApp = true) {
  const notices: string[] = [];
  const { openInitialSidebar } = loadRuntime<
    typeof import("../plugin-onboarding")
  >("plugin-onboarding.ts", {
    Platform: { isDesktopApp },
    Notice: class {
      constructor(message: string) {
        notices.push(message);
      }
    },
  });
  let openings = 0;
  let saves = 0;
  let existing = false;
  const plugin = {
    isUnloaded: false,
    settings: structuredClone(DEFAULT_SETTINGS),
    activeViewTab: "search" as string | null,
    app: { workspace: { getLeavesOfType: () => (existing ? [{}] : []) } },
    activateView: () => {
      openings++;
      return Promise.resolve();
    },
    saveSettings: () => {
      saves++;
      return Promise.resolve();
    },
  };
  return {
    plugin,
    notices,
    open: () => openInitialSidebar(plugin as never),
    counts: () => ({ openings, saves }),
    restoreView: () => {
      existing = true;
    },
  };
}

test("first opening selects Sync once and later loads preserve the chosen tab", async () => {
  const f = fixture();
  await Promise.all([f.open(), f.open()]);
  assert.equal(f.plugin.activeViewTab, "sync");
  assert.equal(f.plugin.settings.lastActiveTab, "sync");
  assert.equal(f.plugin.settings.initialSidebarOpened, true);
  assert.deepEqual(f.counts(), { openings: 1, saves: 1 });
  f.plugin.activeViewTab = f.plugin.settings.lastActiveTab = "publish";
  await f.open();
  assert.equal(f.plugin.activeViewTab, "publish");
  assert.deepEqual(f.counts(), { openings: 1, saves: 1 });
});

test("restored views and unloaded plugins are left alone", async () => {
  const f = fixture();
  f.restoreView();
  await f.open();
  assert.equal(f.plugin.activeViewTab, "search");
  assert.deepEqual(f.counts(), { openings: 0, saves: 1 });
  const unloaded = fixture();
  unloaded.plugin.isUnloaded = true;
  await unloaded.open();
  assert.deepEqual(unloaded.counts(), { openings: 0, saves: 0 });
});

test("mobile starts on Search and disabled tabs remain disabled", async () => {
  const mobile = fixture(false);
  await mobile.open();
  assert.equal(mobile.plugin.activeViewTab, "search");
  const desktop = fixture();
  desktop.plugin.settings.enabledTabs.sync = false;
  await desktop.open();
  assert.equal(desktop.plugin.activeViewTab, "browse");
  const hidden = fixture();
  for (const tab of Object.keys(hidden.plugin.settings.enabledTabs))
    hidden.plugin.settings.enabledTabs[
      tab as keyof typeof hidden.plugin.settings.enabledTabs
    ] = false;
  await hidden.open();
  assert.deepEqual(hidden.counts(), { openings: 0, saves: 1 });
});

test("failed opening is reported and can be retried", async () => {
  const f = fixture();
  f.plugin.activateView = () => Promise.reject(new Error("Opening failed"));
  await f.open();
  assert.equal(f.plugin.settings.initialSidebarOpened, false);
  assert.equal(f.notices.length, 1);
  f.plugin.activateView = () => Promise.resolve();
  await f.open();
  assert.equal(f.plugin.settings.initialSidebarOpened, true);
  assert.equal(f.counts().saves, 1);
});

test("concurrent settings saves cannot mark an in-flight opening complete", async () => {
  const f = fixture();
  let finish!: () => void;
  f.plugin.activateView = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const saved: boolean[] = [];
  f.plugin.saveSettings = () => {
    saved.push(f.plugin.settings.initialSidebarOpened);
    return Promise.resolve();
  };
  const pending = f.open();
  await f.open();
  await f.plugin.saveSettings();
  assert.deepEqual(saved, [false]);
  finish();
  await pending;
  assert.deepEqual(saved, [false, true]);
});

test("unloading during opening does not persist completion", async () => {
  const f = fixture();
  let finish!: () => void;
  f.plugin.activateView = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const pending = f.open();
  f.plugin.isUnloaded = true;
  finish();
  await pending;
  assert.equal(f.plugin.settings.initialSidebarOpened, false);
  assert.equal(f.counts().saves, 0);
});

test("a failed completion save can be retried without reopening the restored view", async () => {
  const f = fixture();
  f.restoreView();
  f.plugin.saveSettings = () => Promise.reject(new Error("Save failed"));
  await f.open();
  assert.equal(f.plugin.settings.initialSidebarOpened, false);
  assert.equal(f.notices.length, 1);
  f.plugin.saveSettings = () => Promise.resolve();
  await f.open();
  assert.equal(f.plugin.settings.initialSidebarOpened, true);
  assert.equal(f.counts().openings, 0);
});
