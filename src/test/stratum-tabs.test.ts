import assert from "node:assert/strict";
import test from "node:test";
import {
  readEnabledTabs,
  getVisibleTabs,
  resolveActiveTab,
  STRATUM_TABS,
} from "../stratum-tabs";
import { loadRuntime } from "./runtime-harness";

const allOff = () =>
  readEnabledTabs(
    Object.fromEntries(STRATUM_TABS.map(({ id }) => [id, false])),
  );

test("missing and malformed preferences default on; explicit false survives", () => {
  for (const input of [
    undefined,
    null,
    [],
    "off",
    { reader: "false", sync: 0 },
  ]) {
    assert.ok(Object.values(readEnabledTabs(input)).every(Boolean));
  }
  assert.equal(readEnabledTabs({ reader: false }).reader, false);
  assert.equal(readEnabledTabs({ reader: false }).search, true);
});

test("platform filters Sync without changing saved preferences; all-off is valid", () => {
  const enabled = readEnabledTabs(undefined);
  assert.deepEqual(
    getVisibleTabs(enabled, true).map(({ id }) => id),
    ["browse", "search", "sync", "reader", "sources", "publish"],
  );
  assert.deepEqual(
    getVisibleTabs(enabled, false).map(({ id }) => id),
    ["browse", "search", "reader", "sources"],
  );
  assert.equal(enabled.sync, true);
  assert.equal(enabled.publish, true);
  assert.equal(
    resolveActiveTab("publish", { ...allOff(), publish: true }, false),
    null,
  );
  assert.equal(
    resolveActiveTab(null, { ...allOff(), publish: true }, true),
    "publish",
  );
  assert.equal(
    resolveActiveTab("search", { ...enabled, search: false }, true),
    "browse",
  );
  assert.equal(
    resolveActiveTab("sync", { ...allOff(), sync: true }, false),
    null,
  );
  assert.equal(resolveActiveTab("reader", allOff(), true), null);
  assert.equal(
    resolveActiveTab(null, { ...allOff(), sources: true }, true),
    "sources",
  );
});

test("direct tab selection cannot open disabled tabs or mobile Sync", () => {
  const notices: string[] = [];
  const platform = { isDesktopApp: true };
  const { selectStratumTab } = loadRuntime<typeof import("../plugin-tabs")>(
    "plugin-tabs.ts",
    {
      Platform: platform,
      Notice: class {
        constructor(message: string) {
          notices.push(message);
        }
      },
    },
  );
  const plugin = {
    settings: { enabledTabs: allOff() },
    activeViewTab: null as string | null,
    isUnloaded: false,
    publish: {},
  };
  for (const { id } of STRATUM_TABS)
    assert.equal(selectStratumTab(plugin as never, id), false);
  assert.equal(plugin.activeViewTab, null);
  assert.equal(notices.length, 6);
  plugin.settings.enabledTabs = readEnabledTabs(undefined);
  platform.isDesktopApp = false;
  assert.equal(selectStratumTab(plugin as never, "sync"), false);
  assert.equal(selectStratumTab(plugin as never, "publish"), false);
  assert.equal(selectStratumTab(plugin as never, "reader"), true);
  assert.equal(plugin.activeViewTab, "reader");
  plugin.isUnloaded = true;
  assert.equal(selectStratumTab(plugin as never, "search"), false);
  assert.equal(plugin.activeViewTab, "reader");
});

class Element {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  cssProps: Record<string, string> = {};
  setCssProps(props: Record<string, string>) {
    Object.assign(this.cssProps, props);
  }
  listeners = new Map<
    string,
    (event: { key: string; preventDefault(): void }) => void
  >();
  doc = { activeElement: null as Element | null };
  id = "";
  hidden = false;
  text = "";
  constructor(public tag = "div") {}
  createDiv() {
    const child = new Element();
    child.doc = this.doc;
    this.children.push(child);
    return child;
  }
  createEl(tag: string, options?: { text?: string; cls?: string }) {
    const child = new Element(tag);
    child.text = options?.text ?? "";
    child.doc = this.doc;
    this.children.push(child);
    return child;
  }
  setAttr(key: string, value: string) {
    this.attrs[key] = value;
  }
  addClass() {}
  empty() {
    this.children = [];
  }
  addEventListener(
    name: string,
    fn: (event: { key: string; preventDefault(): void }) => void,
  ) {
    this.listeners.set(name, fn);
  }
  focus() {
    this.doc.activeElement = this;
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  querySelector(selector: string) {
    return selector.startsWith("#")
      ? (this.all().find((el) => el.id === selector.slice(1)) ?? null)
      : null;
  }
}

function viewFixture(desktop: boolean) {
  let settingsOpened = 0;
  let openedId = "";
  let localLoads = 0;
  class Host {
    contentEl = new Element();
    app = {
      setting: {
        open: () => settingsOpened++,
        openTabById: (id: string) => {
          openedId = id;
        },
      },
    };
    register() {}
  }
  const { StratumView } = loadRuntime<typeof import("../view")>(
    "view.ts",
    new Proxy<Record<string, unknown>>(
      { Platform: { isDesktopApp: desktop } },
      { get: (target, key: string) => target[key] ?? Host },
    ),
    {
      crypto: { randomUUID: () => "test" },
      window: {
        requestAnimationFrame: (callback: () => void) => callback(),
        clearTimeout() {},
      },
    },
  );
  const plugin = {
    settings: { enabledTabs: readEnabledTabs(undefined), enabledLibraries: [] },
    manifest: { id: "stratum" },
    activeViewTab: "sync" as string | null,
    backend: { hasSession: () => false },
    localSync: { ensureLibrariesLoaded: () => localLoads++ },
    refreshViews: () => view.render(),
  };
  const view = new StratumView({} as never, plugin as never);
  // Isolate navigation from unrelated vault-backed feature rendering.
  Object.assign(view, { renderBrowseTab: () => {}, renderReaderTab: () => {} });
  const content = view.contentEl as unknown as Element;
  return {
    view,
    plugin,
    content,
    get settingsOpened() {
      return settingsOpened;
    },
    get openedId() {
      return openedId;
    },
    get localLoads() {
      return localLoads;
    },
  };
}

test("signed-out desktop keeps Sync visible and opens settings without local requests", () => {
  const f = viewFixture(true);
  f.view.render();
  assert.equal(f.plugin.activeViewTab, "sync");
  assert.equal(
    f.content.all().filter((el) => el.attrs.role === "tab").length,
    5,
  );
  assert.ok(
    f.content.all().some((el) => el.text.startsWith("Sign in to Stratum")),
  );
  f.content
    .all()
    .find((el) => el.text === "Open Stratum settings")!
    .listeners.get("click")!({ key: "", preventDefault() {} });
  assert.equal(f.settingsOpened, 1);
  assert.equal(f.openedId, "stratum");
  assert.equal(f.localLoads, 0);
});

for (const desktop of [true, false]) {
  test(`empty state opens settings and recovers when a tab is enabled, desktop=${desktop}`, () => {
    const f = viewFixture(desktop);
    f.plugin.settings.enabledTabs = desktop
      ? allOff()
      : { ...allOff(), sync: true };
    f.view.render();
    assert.equal(f.plugin.activeViewTab, null);
    assert.equal(f.content.all().filter((el) => el.tag === "button").length, 1);
    assert.ok(
      f.content.all().some((el) => el.text === "No Stratum tabs enabled"),
    );
    f.content
      .all()
      .find((el) => el.tag === "button")!
      .listeners.get("click")!({ key: "", preventDefault() {} });
    assert.equal(f.settingsOpened, 1);
    f.plugin.settings.enabledTabs.reader = true;
    f.view.render();
    assert.equal(f.plugin.activeViewTab, "reader");
  });
}

test("disabling Reader cleans up its watcher and keyboard navigation skips hidden tabs", () => {
  const f = viewFixture(false);
  let cleaned = 0;
  Object.assign(f.view, { clearReaderFileWatcher: () => cleaned++ });
  f.plugin.activeViewTab = "reader";
  f.plugin.settings.enabledTabs.reader = false;
  f.view.render();
  assert.equal(cleaned, 1);
  assert.equal(f.plugin.activeViewTab, "browse");
  const tabs = f.content.all().filter((el) => el.attrs.role === "tab");
  assert.deepEqual(
    tabs.map((el) => el.text),
    ["Browse", "Search", "Sources"],
  );
  tabs[0].listeners.get("keydown")!({ key: "ArrowRight", preventDefault() {} });
  assert.equal(f.plugin.activeViewTab, "search");
  assert.equal(f.content.doc.activeElement?.text, "Search");
});

for (const desktop of [true, false]) {
  test(`tab layout fills available columns as tabs are hidden, desktop=${desktop}`, () => {
    const f = viewFixture(desktop);
    f.view.render();
    const bar = () =>
      f.content.all().find((el) => el.attrs.role === "tablist")!;
    assert.equal(bar().cssProps["--stratum-tab-count"], desktop ? "5" : "4");
    assert.equal(bar().cssProps["--stratum-compact-tab-count"], "2");
    f.plugin.settings.enabledTabs = { ...allOff(), reader: true };
    f.view.render();
    assert.equal(bar().cssProps["--stratum-tab-count"], "1");
    assert.equal(bar().cssProps["--stratum-compact-tab-count"], "1");
  });
}
