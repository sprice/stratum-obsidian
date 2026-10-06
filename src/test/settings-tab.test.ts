import assert from "node:assert/strict";
import test from "node:test";
import type * as SettingsTab from "../settings-tab";
import type * as PluginModule from "../plugin";
import { DEFAULT_SETTINGS } from "../settings-data";
import { loadRuntime } from "./runtime-harness";
import type { EnabledTabs, StratumTab } from "../stratum-tabs";

class Element {
  isConnected = true;
  scrolled = false;
  scrollIntoView() {
    this.scrolled = true;
  }
  addClass() {}
  setAttr() {}
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  listeners = new Map<string, () => void>();
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, callback);
  }
  blur() {
    this.listeners.get("blur")?.();
  }
  empty() {}
  createDiv() {
    return new Element();
  }
}

class Control {
  inputEl = new Element();
  buttonEl = new Element();
  change?: (value: string | boolean) => Promise<void>;
  click?: () => Promise<void>;
  value?: string | boolean;
  disabled = false;
  getValue() {
    return String(this.value ?? "");
  }
  setValue(value: string | boolean) {
    this.value = value;
    return this;
  }
  setDisabled(value: boolean) {
    this.disabled = value;
    return this;
  }
  setPlaceholder() {
    return this;
  }
  setButtonText() {
    return this;
  }
  setCta() {
    return this;
  }
  addOption() {
    return this;
  }
  onChange(callback: Control["change"]) {
    this.change = callback;
    return this;
  }
  onClick(callback: Control["click"]) {
    this.click = callback;
    return this;
  }
}

class Row {
  static rendered: Row[] = [];
  name = "";
  descEl = new Element();
  settingEl = new Element();
  control?: Control;
  heading = false;
  description = "";
  constructor() {
    Row.rendered.push(this);
  }
  setName(name: string) {
    this.name = name;
    return this;
  }
  setDesc(description: string) {
    this.description = description;
    return this;
  }
  setHeading() {
    this.heading = true;
    return this;
  }
  addText(callback: (control: Control) => void) {
    this.control = new Control();
    callback(this.control);
    return this;
  }
  addToggle = (callback: (control: Control) => void) => this.addText(callback);
  addDropdown = (callback: (control: Control) => void) =>
    this.addText(callback);
  addButton = (callback: (control: Control) => void) => this.addText(callback);
}

function fixture(desktop = false, modern = true) {
  const editors: {
    initial: string;
    save: (template: string) => Promise<void>;
    opened: boolean;
  }[] = [];
  let chooser!: {
    tabs: { id: StratumTab; label: string }[];
    enabled: EnabledTabs;
    onChange: (id: StratumTab, enabled: boolean) => Promise<void>;
  };
  class HostTab {
    containerEl = new Element();
  }
  const platform = { isDesktopApp: desktop };
  const { StratumSettingTab } = loadRuntime<typeof SettingsTab>(
    "settings-tab.ts",
    {
      PluginSettingTab: HostTab,
      Setting: Row,
      SettingGroup: class {
        setHeading(heading: string) {
          new Row().setName(heading).setHeading();
          return this;
        }
        addSetting(render: (setting: Row) => void) {
          render(new Row());
          return this;
        }
      },
      Platform: platform,
      requireApiVersion: () => modern,
    },
    {},
    "node",
    {
      "./note-template-modal": {
        NoteTemplateModal: class {
          opened = false;
          constructor(
            _app: unknown,
            public initial: string,
            public save: (template: string) => Promise<void>,
          ) {
            editors.push(this);
          }
          open() {
            this.opened = true;
          }
        },
      },
      "./settings-tab-chooser": {
        openTabChooser: (anchor: Element, options: typeof chooser) => {
          chooser = options;
          anchor.setAttribute("aria-expanded", "true");
          return () => {
            anchor.setAttribute("aria-expanded", "false");
          };
        },
      },
    },
  );
  let saves = 0;
  let rebuilds = 0;
  let updates = 0;
  let indexedNames: string[] = [];
  const plugin = {
    app: {},
    backend: {
      hasSession: (): boolean => Boolean(plugin.settings.accountEmail),
    },
    settings: structuredClone(DEFAULT_SETTINGS),
    availableGroups: [] as { id: string; name: string; type: string }[],
    zoteroConnection: null as null | {
      connected: boolean;
      zoteroUserId: string;
    },
    saveSettings: () => {
      saves++;
      return Promise.resolve();
    },
    rebuildItemFileMap: () => {
      rebuilds++;
      return Promise.resolve();
    },
    refreshViews: () => {
      updates++;
    },
    isBulkLibrarySyncRunning: () => false,
    isZoteroAutoSyncRunning: () => false,
  };
  const tab = new StratumSettingTab(plugin as never);
  if (modern) {
    Object.assign(tab, {
      update: () => {
        updates++;
        indexedNames = Array.from(tab.getSettingDefinitions()).flatMap((s) =>
          Array.from(s.items, (item) => item.name),
        );
      },
    });
  }
  return {
    tab,
    plugin,
    editors,
    get chooser() {
      return chooser;
    },
    get saves() {
      return saves;
    },
    get rebuilds() {
      return rebuilds;
    },
    get indexedNames() {
      return indexedNames;
    },
    get updates() {
      return updates;
    },
  };
}

test("search indexing exposes settings without rendering controls or doing I/O", () => {
  const { tab } = fixture();
  Row.rendered = [];
  const names = Array.from(tab.getSettingDefinitions()).flatMap((section) =>
    Array.from(section.items, (item) => item.name),
  );
  assert.ok(names.includes("Stratum account"));
  assert.ok(names.includes("Zotero library"));
  assert.ok(names.includes("Literature notes folder"));
  assert.ok(names.includes("Literature note filename format"));
  assert.ok(!names.includes("Bulk sync"));
  assert.ok(!names.includes("Zotero data directory"));
  assert.equal(Row.rendered.length, 0);
});

test("desktop-only and group settings reflect current connection state", () => {
  const { tab, plugin } = fixture(true);
  plugin.settings.accountEmail = "reader@example.test";
  plugin.zoteroConnection = { connected: true, zoteroUserId: "1" };
  plugin.availableGroups = [
    { id: "2", name: "Research group", type: "Public" },
  ];
  let names = Array.from(tab.getSettingDefinitions()).flatMap((s) =>
    Array.from(s.items, (item) => item.name),
  );
  assert.ok(names.includes("Research group"));
  assert.ok(names.includes("Bulk sync"));
  // Area images need this path even when bulk sync is disabled.
  assert.ok(names.includes("Zotero data directory"));
  assert.ok(names.includes("Reset Zotero data directory"));
  plugin.settings.bulkSyncEnabled = true;
  names = Array.from(tab.getSettingDefinitions()).flatMap((s) =>
    Array.from(s.items, (item) => item.name),
  );
  assert.ok(names.includes("Zotero data directory"));
  assert.ok(names.includes("Reset Zotero data directory"));
});

test("modern refresh uses update; older hosts render the same settings", () => {
  const modern = fixture();
  modern.tab.refresh();
  assert.equal(modern.updates, 1);
  const legacy = fixture(false, false);
  Row.rendered = [];
  legacy.tab.refresh();
  const actual = Row.rendered
    .filter((row) => !row.heading)
    .map((row) => row.name);
  const expected = Array.from(legacy.tab.getSettingDefinitions()).flatMap((s) =>
    Array.from(s.items, (item) => item.name),
  );
  assert.deepEqual(actual, expected);
});

test("background refresh updates modern search indexing without rendering a closed tab", () => {
  const f = fixture();
  Object.assign(f.tab.containerEl, { isConnected: false });
  Row.rendered = [];
  f.tab.refresh();
  assert.ok(!f.indexedNames.includes("Research group"));
  f.plugin.settings.accountEmail = "reader@example.test";
  f.plugin.zoteroConnection = { connected: true, zoteroUserId: "1" };
  f.plugin.availableGroups = [
    { id: "2", name: "Research group", type: "Public" },
  ];
  f.tab.refresh();
  assert.ok(f.indexedNames.includes("Research group"));
  assert.equal(Row.rendered.length, 0);
  f.plugin.settings.accountEmail = null;
  f.plugin.zoteroConnection = null;
  f.tab.refresh();
  assert.ok(!f.indexedNames.includes("Research group"));
});

test("background refresh does not render a closed tab on older Obsidian", () => {
  const f = fixture(false, false);
  Object.assign(f.tab.containerEl, { isConnected: false });
  Row.rendered = [];
  f.tab.refresh();
  assert.equal(Row.rendered.length, 0);
});

test("plugin background events reach the settings tab when closed, but stop after unload", () => {
  class HostComponent {}
  const runtime = loadRuntime<typeof PluginModule>(
    "plugin.ts",
    new Proxy<Record<string, unknown>>({}, { get: () => HostComponent }),
  );
  let refreshes = 0;
  const plugin = {
    isUnloaded: false,
    settingTab: {
      containerEl: { isConnected: false },
      refresh: () => {
        refreshes++;
      },
    },
  };
  runtime.default.prototype.refreshSettingTab.call(plugin as never);
  assert.equal(refreshes, 1);
  plugin.isUnloaded = true;
  runtime.default.prototype.refreshSettingTab.call(plugin as never);
  assert.equal(refreshes, 1);
});

for (const modern of [false, true]) {
  test(`folder and filename changes persist with modern host=${modern}`, async () => {
    const f = fixture(false, modern);
    Row.rendered = [];
    if (modern) {
      for (const section of f.tab.getSettingDefinitions()) {
        for (const definition of section.items) {
          definition.render(new Row() as never);
        }
      }
    } else {
      f.tab.refresh();
    }
    const folder = Row.rendered.find(
      (r) => r.name === "Literature notes folder",
    );
    const format = Row.rendered.find(
      (r) => r.name === "Literature note filename format",
    );
    folder?.control?.setValue("  Papers  ");
    folder?.control?.inputEl.blur();
    await new Promise((resolve) => setImmediate(resolve));
    await format?.control?.change?.("citekey");
    assert.equal(f.plugin.settings.notesFolder, "Papers");
    assert.equal(f.plugin.settings.filenameFormat, "citekey");
    assert.equal(f.saves, 2);
    assert.equal(f.rebuilds, 1);
    folder?.control?.setValue(" ");
    folder?.control?.inputEl.blur();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.plugin.settings.notesFolder, DEFAULT_SETTINGS.notesFolder);
  });
}

for (const desktop of [true, false]) {
  test(`tab settings persist and refresh with desktop=${desktop}`, async () => {
    const f = fixture(desktop);
    const sections = f.tab.getSettingDefinitions();
    const index = sections.findIndex(
      (section) => section.heading === "Stratum tabs",
    );
    assert.equal(sections[index - 1].heading, "Citations");
    assert.equal(sections[0].heading, "Workspace");
    assert.equal(sections[1].heading, "Workspace defaults");
    assert.equal(sections[2].heading, "Zotero Libraries");
    Row.rendered = [];
    for (const item of sections[index].items)
      item.render(new Row().setName(item.name) as never);
    const row = Row.rendered.find((row) => row.name === "Visible tabs")!;
    assert.equal(row.description, "All tabs shown.");
    await row.control!.click!();
    assert.equal(row.control!.buttonEl.getAttribute("aria-expanded"), "true");
    await row.control!.click!();
    assert.equal(row.control!.buttonEl.getAttribute("aria-expanded"), "false");
    await row.control!.click!();
    assert.equal(row.control!.buttonEl.getAttribute("aria-expanded"), "true");
    const choices = f.chooser.tabs;
    assert.deepEqual(
      Array.from(choices, (tab) => tab.label),
      desktop
        ? ["Browse", "Search", "Sync", "Reader", "Citations", "Publish"]
        : ["Browse", "Search", "Reader", "Citations"],
    );
    for (const tab of choices) {
      assert.equal(f.chooser.enabled[tab.id], true);
      await f.chooser.onChange(tab.id, false);
    }
    assert.equal(row.description, "No tabs shown.");
    assert.equal(f.saves, choices.length);
    assert.equal(f.updates, choices.length);
    assert.equal(f.plugin.settings.enabledTabs.sync, !desktop);
    assert.equal(f.plugin.settings.enabledTabs.publish, !desktop);
    assert.equal(
      sections.some((section) => section.heading === "Stratum Publishing"),
      desktop,
    );
    assert.equal(f.plugin.settings.enabledTabs.reader, false);
  });
}

test("tab visibility updates before a slow settings save completes", async () => {
  const f = fixture(true);
  let release!: () => void;
  f.plugin.saveSettings = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const browse = f.tab
    .getSettingDefinitions()
    .find((section) => section.heading === "Stratum tabs")!
    .items.find((item) => item.name === "Visible tabs")!;
  const row = new Row();
  browse.render(row as never);
  await row.control!.click!();
  const saving = f.chooser.onChange("browse", false);
  try {
    assert.equal(f.plugin.settings.enabledTabs.browse, false);
    assert.equal(
      f.updates,
      1,
      "Do not leave a disabled tab visible while saveData is pending",
    );
  } finally {
    release();
    await saving;
  }
});

test("failed tab saves restore visibility and its summary", async () => {
  const f = fixture(true);
  f.plugin.saveSettings = () => Promise.reject(new Error("Disk full"));
  const setting = f.tab
    .getSettingDefinitions()
    .find((section) => section.heading === "Stratum tabs")!
    .items.find((item) => item.name === "Visible tabs")!;
  const row = new Row();
  setting.render(row as never);
  await row.control!.click!();
  await assert.rejects(f.chooser.onChange("browse", false), /Disk full/);
  assert.equal(f.plugin.settings.enabledTabs.browse, true);
  assert.equal(row.description, "All tabs shown.");
  assert.equal(f.updates, 2);
});

for (const modern of [true, false]) {
  test(`template editor opens from settings and rolls back failed saves with modern=${modern}`, async () => {
    const f = fixture(false, modern);
    Row.rendered = [];
    if (modern)
      for (const section of f.tab.getSettingDefinitions()) {
        for (const definition of section.items)
          definition.render(new Row() as never);
      }
    else f.tab.refresh();
    const row = Row.rendered.find(
      (r) => r.name === "Literature note template",
    )!;
    assert.ok(row);
    await row.control!.click!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(row.settingEl.scrolled, true);
    assert.equal(f.editors[0].opened, true);
    assert.equal(f.editors[0].initial, "## My Notes");
    await f.editors[0].save("## Summary");
    assert.equal(f.plugin.settings.notesTemplate, "## Summary");
    assert.equal(f.saves, 1);
    f.plugin.saveSettings = () => Promise.reject(new Error("Disk failure"));
    await assert.rejects(f.editors[0].save("## Rejected"), /Disk failure/);
    assert.equal(f.plugin.settings.notesTemplate, "## Summary");
  });
}
