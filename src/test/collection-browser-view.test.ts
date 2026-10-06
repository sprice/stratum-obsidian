import { readEnabledTabs } from "../stratum-tabs";
import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  cssProps: Record<string, string> = {};
  setCssProps(props: Record<string, string>) {
    Object.assign(this.cssProps, props);
  }
  listeners = new Map<
    string,
    (event?: { key: string; preventDefault: () => void }) => void
  >();
  doc: { activeElement: Element | null } = { activeElement: null };
  scrollTop = 0;
  scrollLeft = 0;
  id = "";
  className = "";
  value = "";
  placeholder = "";
  text = "";
  hidden = false;
  disabled = false;
  parent: Element | null = null;
  shown = false;
  change: ((value: string) => void) | null = null;
  selectionStart = 0;
  selectionEnd = 0;
  constructor(public tag = "div") {}
  addClass(...classes: string[]) {
    this.className = [this.className, ...classes].filter(Boolean).join(" ");
  }
  empty() {
    this.children = [];
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
    this.parent = null;
  }
  setText(text: string) {
    this.text = text;
  }
  setAttr(key: string, value: string) {
    this.attrs[key] = value;
  }
  setAttribute(key: string, value: string) {
    this.setAttr(key, value);
  }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  focus() {
    this.doc.activeElement = this;
  }
  isShown() {
    return this.shown;
  }
  createEl(
    tag: string,
    options?: {
      value?: string;
      text?: string;
      cls?: string;
      attr?: Record<string, string>;
    },
  ) {
    const child = new Element(tag);
    child.parent = this;
    child.doc = this.doc;
    child.value = options?.value ?? "";
    child.text = options?.text ?? "";
    child.className = options?.cls ?? "";
    child.attrs = options?.attr ?? {};
    this.children.push(child);
    return child;
  }
  createDiv(options?: { cls?: string; attr?: Record<string, string> }) {
    const child = new Element();
    child.doc = this.doc;
    child.className = options?.cls ?? "";
    child.attrs = options?.attr ?? {};
    this.children.push(child);
    return child;
  }
  createSpan(options?: { text?: string }) {
    const child = new Element("span");
    child.doc = this.doc;
    child.text = options?.text ?? "";
    this.children.push(child);
    return child;
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string) {
    if (selector === "option:disabled")
      return this.all().filter((el) => el.tag === "option" && el.disabled);
    if (selector.startsWith("#"))
      return this.all().filter((el) => el.id === selector.slice(1));
    if (selector === "[data-collection-sort]")
      return this.all().filter((el) => el.dataset.collectionSort);
    const attr = selector.match(/^(\w+)\[aria-label="([^"]+)"\]$/);
    return this.all().filter((el) =>
      attr
        ? el.tag === attr[1] && el.attrs["aria-label"] === attr[2]
        : el.tag === selector,
    );
  }
}

test("sidebar controls filter main-pane results and preserve state through refresh and remount", async () => {
  const root = new Element();
  const sidebar = new Element();
  const events = new Map<string, () => void>();
  let revealed = 0;
  let activeBrowser: unknown = null;
  let extraLeaf: { view: unknown } | null = null;
  const leafListeners: ((leaf: { view: unknown }) => void)[] = [];
  const app = {
    metadataCache: {
      on: (event: string, callback: () => void) => {
        events.set(event, callback);
      },
    },
    vault: { on() {} },
    workspace: {
      on(_event: string, callback: (leaf: { view: unknown }) => void) {
        leafListeners.push(callback);
      },
      requestSaveLayout() {},
      getLeavesOfType: () => (extraLeaf ? [leaf, extraLeaf] : [leaf]),
      getActiveViewOfType: () => activeBrowser,
      revealLeaf: (target: unknown) => {
        assert.equal(target, leaf);
        revealed++;
        root.shown = true;
        for (const listener of leafListeners) listener(leaf);
        return Promise.resolve();
      },
      getLeaf: () => {
        throw new Error("Should reuse existing browser");
      },
    },
  };
  const leaf = { app, view: undefined as unknown };
  const { CollectionBrowserView, browseCollections, getCollectionBrowserView } =
    loadRuntime<typeof import("../collection-browser")>(
      "collection-browser.ts",
      {
        ItemView: class {
          constructor(public leaf: unknown) {}
          app = app;
          contentEl = root;
          register() {}
          registerEvent() {}
          setState() {
            return Promise.resolve();
          }
        },
        Modal: class {},
        SearchComponent: class {
          inputEl: Element;
          constructor(header: Element) {
            this.inputEl = header.createEl("input");
          }
          setPlaceholder(value: string) {
            this.inputEl.placeholder = value;
            return this;
          }
          setValue(value: string) {
            this.inputEl.value = value;
            return this;
          }
          onChange(callback: (value: string) => void) {
            this.inputEl.change = callback;
            return this;
          }
        },
        DropdownComponent: class {
          selectEl: Element;
          constructor(container: Element) {
            this.selectEl = container.createEl("select");
          }
        },
        ButtonComponent: class {
          buttonEl: Element;
          constructor(container: Element) {
            this.buttonEl = container.createEl("button");
          }
          setButtonText(text: string) {
            this.buttonEl.text = text;
            return this;
          }
          setTooltip(text: string) {
            this.buttonEl.attrs.title = text;
            return this;
          }
          setCta() {
            this.buttonEl.addClass("mod-cta");
            return this;
          }
        },
        debounce: (callback: () => void) =>
          Object.assign(callback, { cancel() {} }),
      },
      { HTMLElement: Element },
      "node",
      {
        "./collection-browser-data": {
          getCollectionPapers: () => [
            {
              path: "Synthetic.md",
              identity: "user/1/A",
              libraryIdentity: "user:1",
              libraryName: "Synthetic library",
              title: "Synthetic study",
              authors: ["Synthetic author"],
              year: "2026",
              keys: [],
              collectionNames: [],
            },
          ],
        },
        "./collection-catalog-store": {
          onCollectionCatalogChange: () => () => {},
        },
      },
    );
  const plugin = {
    app,
    settings: {
      collectionCatalogs: {},
      enabledTabs: readEnabledTabs(undefined),
    },
    activeViewTab: "search",
    activateView: () => Promise.resolve(),
    refreshViews() {},
  };
  const view = new CollectionBrowserView(leaf as never, plugin as never);
  leaf.view = view;
  await view.onOpen();
  await view.setState(
    {
      layout: "table",
      columns: ["year", "findings"],
      columnSort: "year",
      descending: true,
      query: "synthetic",
    },
    {} as never,
  );
  const peerSidebar = new Element();
  const unmountPeer = view.mountControls(peerSidebar as never);
  const unmount = view.mountControls(sidebar as never);
  assert.equal(root.querySelector("select"), null);
  assert.equal(root.querySelector("input"), null);
  assert.equal(
    sidebar.querySelector('select[aria-label="Choose layout"]')?.value,
    "table",
  );
  assert.ok(
    sidebar
      .querySelector('select[aria-label="Choose layout"]')
      ?.className.includes("stratum-control-select"),
  );
  assert.equal(
    sidebar.querySelector('input[aria-label="Search literature notes"]')?.value,
    "synthetic",
  );
  assert.equal(
    sidebar.querySelector('input[aria-label="Search literature notes"]')
      ?.placeholder,
    "Title, author, year, or more",
  );
  assert.ok(sidebar.all().some((el) => el.text === "1 item"));
  assert.equal(
    sidebar.all().some((el) => el.text === "All libraries"),
    false,
  );
  assert.ok(sidebar.all().some((el) => el.text === "View"));
  assert.ok(sidebar.all().some((el) => el.text === "Search"));
  assert.equal(
    sidebar.all().find((el) => el.text === "Columns")?.attrs.title,
    "Choose table columns",
  );
  const stableControls = sidebar.querySelectorAll("select");
  const stableOptions = stableControls[0].children.slice();
  const stableColumns = sidebar.all().find((el) => el.text === "Columns");
  const showItems = sidebar.all().find((el) => el.text === "Show items")!;
  assert.ok(showItems.className.includes("mod-cta"));
  assert.equal(showItems.hidden, false);
  showItems.listeners.get("click")!();
  await Promise.resolve();
  assert.equal(revealed, 1, "Show items reveals the existing browser");
  assert.equal(showItems.hidden, true);
  // A metadata refresh can arrive after revealing the browser. It must update
  // results without replacing the controls and restarting their transitions.
  await Promise.resolve().then(() => events.get("resolved")!());
  sidebar.querySelectorAll("select").forEach((select, index) => {
    assert.equal(select, stableControls[index]);
  });
  stableControls[0].children.forEach((option, index) => {
    assert.equal(option, stableOptions[index]);
  });
  assert.equal(
    sidebar.all().find((el) => el.text === "Columns"),
    stableColumns,
  );

  root.shown = false;
  for (const listener of leafListeners) listener({ view: null });
  assert.equal(showItems.hidden, false);
  const input = sidebar.querySelector(
    'input[aria-label="Search literature notes"]',
  );
  input.change!("no match");
  assert.equal(peerSidebar.querySelector("input").value, "no match");
  assert.equal(sidebar.querySelector("input"), input);
  assert.equal(root.querySelectorAll("a").length, 0);
  assert.ok(sidebar.all().some((el) => el.text === "0 items"));
  input.change!("synthetic");
  input.value = "synthetic";
  input.focus();
  const results = root
    .all()
    .find((el) => el.className === "stratum-collection-results")!;
  assert.equal(results.attrs["aria-label"], undefined);
  results.scrollLeft = 420;
  results.listeners.get("scroll")!();
  events.get("changed")!();
  const refreshed = root
    .all()
    .find((el) => el.className === "stratum-collection-results")!;
  assert.notEqual(refreshed, results);
  const refreshedInput = sidebar.querySelector(
    'input[aria-label="Search literature notes"]',
  );
  assert.equal(refreshedInput, input);
  sidebar.querySelectorAll("select").forEach((select, index) => {
    assert.equal(select, stableControls[index]);
  });
  assert.equal(refreshedInput.value, "synthetic");
  assert.equal(sidebar.doc.activeElement, refreshedInput);
  assert.equal(refreshed.scrollLeft, 420);
  const snapshot = JSON.stringify(view.getState());
  await browseCollections(plugin as never);
  assert.equal(revealed, 2);
  assert.equal(plugin.activeViewTab, "browse");
  assert.equal(JSON.stringify(view.getState()), snapshot);
  const layout = sidebar.querySelector('select[aria-label="Choose layout"]');
  layout.value = "list";
  layout.listeners.get("change")!();
  assert.equal(view.getState().layout, "list");
  assert.equal(
    peerSidebar.querySelector('select[aria-label="Choose layout"]').value,
    "list",
  );
  assert.equal(root.querySelector("table"), null);
  assert.equal(root.querySelectorAll("a").length, 1);
  const switcher = sidebar.querySelector(
    'select[aria-label="Choose collection"]',
  );
  const viewSelect = sidebar.querySelector(
    'select[aria-label="Choose layout"]',
  );
  const peerViewSelect = peerSidebar.querySelector(
    'select[aria-label="Choose layout"]',
  );
  switcher.value = "unfiled";
  switcher.listeners.get("change")!();
  assert.equal(view.getState().collection, "unfiled");
  assert.equal(view.getState().query, "");
  assert.equal(
    sidebar.querySelector('select[aria-label="Choose layout"]'),
    viewSelect,
  );
  assert.equal(
    peerSidebar.querySelector('select[aria-label="Choose layout"]'),
    peerViewSelect,
  );
  assert.equal(
    peerSidebar.querySelector('select[aria-label="Choose collection"]')?.value,
    "unfiled",
  );
  assert.equal(
    sidebar.querySelector('input[aria-label="Search literature notes"]')?.value,
    "",
  );
  assert.equal(root.querySelectorAll("a").length, 1);
  await view.setState(
    { ...view.getState(), collection: "missing-collection" },
    {} as never,
  );
  const unavailableSwitcher = sidebar.querySelector(
    'select[aria-label="Choose collection"]',
  );
  assert.ok(unavailableSwitcher.querySelector("option:disabled"));
  const layoutBeforeRecovery = sidebar.querySelector(
    'select[aria-label="Choose layout"]',
  );
  unavailableSwitcher.value = "unfiled";
  unavailableSwitcher.listeners.get("change")!();
  assert.equal(unavailableSwitcher.querySelector("option:disabled"), null);
  assert.equal(
    peerSidebar
      .querySelector('select[aria-label="Choose collection"]')
      .querySelector("option:disabled"),
    null,
  );
  assert.equal(
    sidebar.querySelector('select[aria-label="Choose layout"]'),
    layoutBeforeRecovery,
  );
  unmount();
  const detachedInput = sidebar.querySelector("input");
  events.get("changed")!();
  assert.equal(sidebar.querySelector("input"), detachedInput);
  const remount = view.mountControls(sidebar as never);
  // Returning to Browse mounts new controls; later metadata must retain them.
  const remountedSelects = sidebar.querySelectorAll("select");
  remountedSelects[1].focus();
  await Promise.resolve().then(() => events.get("changed")!());
  sidebar.querySelectorAll("select").forEach((select, index) => {
    assert.equal(select, remountedSelects[index]);
  });
  assert.equal(sidebar.doc.activeElement, remountedSelects[1]);
  assert.equal(
    sidebar.querySelector('select[aria-label="Choose collection"]')?.value,
    "unfiled",
  );
  remount();
  unmountPeer();
  const second = new CollectionBrowserView(leaf as never, plugin as never);
  const secondRoot = new Element();
  secondRoot.shown = true;
  Object.assign(second, { contentEl: secondRoot });
  extraLeaf = { view: second };
  await second.onOpen();
  root.shown = false;
  const visibilitySidebar = new Element();
  const unmountVisibility = view.mountControls(visibilitySidebar as never);
  const revealTarget = visibilitySidebar
    .all()
    .find((el) => el.text === "Show items")!;
  for (const listener of leafListeners) listener({ view: null });
  assert.equal(getCollectionBrowserView(plugin as never), view);
  assert.equal(
    revealTarget.hidden,
    false,
    "a visible browser in another pane must not hide the action for this hidden target",
  );
  root.shown = true;
  for (const listener of leafListeners) listener({ view: null });
  assert.equal(revealTarget.hidden, true);
  unmountVisibility();
  activeBrowser = second;
  // The sidebar can be closed while the user activates another Collections tab.
  for (const listener of leafListeners) listener(extraLeaf);
  activeBrowser = null;
  assert.equal(getCollectionBrowserView(plugin as never), second);
  await second.onClose();
  assert.equal(getCollectionBrowserView(plugin as never), view);
  await view.onClose();
  assert.equal(getCollectionBrowserView(plugin as never), null);
  assert.equal(view.isReady(), false);
});

test("browsing creates a main-pane tab and selects the sidebar Browse panel", async () => {
  let activated = 0;
  let refreshed = 0;
  let revealed = 0;
  let saved: Record<string, unknown> | undefined;
  const leaf = {
    setViewState: (state: Record<string, unknown>) => {
      saved = state;
      return Promise.resolve();
    },
  };
  const plugin = {
    settings: {
      collectionCatalogs: {},
      enabledTabs: readEnabledTabs(undefined),
    },
    activeViewTab: "search",
    activateView: () => {
      activated++;
      return Promise.resolve();
    },
    refreshViews: () => {
      refreshed++;
    },
    app: {
      workspace: {
        getLeavesOfType: () => [],
        getActiveViewOfType: () => null,
        getLeaf: (mode: string) => {
          assert.equal(mode, "tab");
          return leaf;
        },
        revealLeaf: (target: unknown) => {
          assert.equal(target, leaf);
          revealed++;
          return Promise.resolve();
        },
      },
    },
  };
  const { browseCollections, COLLECTION_BROWSER_VIEW } = loadRuntime<
    typeof import("../collection-browser")
  >(
    "collection-browser.ts",
    { ItemView: class {}, Modal: class {} },
    {},
    "node",
    {
      "./collection-browser-data": {},
      "./collection-catalog-store": {},
    },
  );
  await Promise.all([
    browseCollections(plugin as never),
    browseCollections(plugin as never),
  ]);
  assert.equal(plugin.activeViewTab, "browse");
  assert.equal(activated, 1);
  assert.equal(refreshed, 1);
  assert.equal(revealed, 1);
  assert.equal(saved?.type, COLLECTION_BROWSER_VIEW);
  assert.equal(saved?.active, true);
  assert.equal((saved?.state as Record<string, unknown>).collection, "all");
});

test("Browse preserves mounted controls across tab switches and releases stale targets", async () => {
  const root = new Element();
  let mounted = 0;
  let unmounted = 0;
  let opened = 0;
  let leafChanged: ((leaf: { view: unknown }) => void) | undefined;
  class Browser {
    refreshControls() {}
    leaf = { view: this };
    isReady() {
      return true;
    }
    mountControls(container: Element) {
      mounted++;
      container.createEl("input", {
        attr: { "aria-label": "Search literature notes" },
      });
      return () => {
        unmounted++;
      };
    }
  }
  const browser = new Browser();
  let selectedBrowser = browser;
  let targetReads = 0;
  const app = {
    workspace: {
      getLeavesOfType: () => [{ view: browser }],
      revealLeaf: (leaf: { view: unknown }) => {
        assert.equal(leaf, selectedBrowser.leaf);
        opened++;
        return Promise.resolve().then(() => {
          root.doc.activeElement = null;
          leafChanged!(leaf);
        });
      },
      requestSaveLayout() {},
      on(_event: string, callback: (leaf: { view: unknown }) => void) {
        leafChanged = callback;
      },
    },
  };
  const { StratumView } = loadRuntime<typeof import("../view")>(
    "view.ts",
    {
      Platform: { isDesktopApp: true },
      ItemView: class {
        app = app;
        contentEl = root;
        register() {}
        registerEvent() {}
        addChild<T>(child: T) {
          return child;
        }
        removeChild() {}
      },
    },
    {
      HTMLElement: Element,
      crypto: { randomUUID: () => "synthetic" },
      window: { requestAnimationFrame: (callback: () => void) => callback() },
    },
    "node",
    {
      "./citation-evidence": {},
      "./view-sources": { SourcesPanel: class {} },
      "./view-publish": { PublishPanel: class {} },
      "./collection-browser": {
        CollectionBrowserView: Browser,
        getCollectionBrowserView: () => {
          targetReads++;
          return selectedBrowser;
        },
        browseCollections: () => {
          opened++;
          return Promise.resolve().then(() => {
            root.doc.activeElement = null;
          });
        },
      },
      "./library-search-modal": {},
      "./view-reader-input-suggest": {},
      "./plugin-libraries": {},
      "./plugin-collections": {},
      "./plugin-local-sync": { isLocalSyncSupported: () => true },
      "./view-helpers": {},
      "./view-library-input-suggest": {},
      "./plugin-note-refresh": {},
    },
  );
  const plugin = {
    settings: {
      collectionCatalogs: {},
      enabledTabs: readEnabledTabs(undefined),
    },
    activeViewTab: "browse",
    backend: { hasSession: () => true },
    sources: {},
    publish: { selectedFormat: "" },
    refreshViews: () => view.render(),
  };
  const view = new StratumView({ app } as never, plugin as never);
  // Navigation to Search should not require its unrelated backend fixtures.
  Object.assign(view, { renderSearchTab: () => {} });
  await view.onOpen();
  const tabs = root.all().filter((el) => el.attrs.role === "tab");
  assert.deepEqual(
    tabs.map((el) => el.text),
    ["Browse", "Search", "Sync", "Reader", "Citations", "Publish"],
  );
  assert.equal(tabs[0].attrs["aria-selected"], "true");
  assert.ok(root.querySelector('input[aria-label="Search literature notes"]'));
  assert.equal(mounted, 1);
  const inputBeforeReveal = root.querySelector("input");
  leafChanged!({ view: browser });
  assert.equal(mounted, 1, "revealing the same browser preserves its controls");
  assert.equal(root.querySelector("input"), inputBeforeReveal);
  const focusedInput = root.querySelector("input");
  focusedInput.focus();
  focusedInput.setSelectionRange(2, 4);
  view.render();
  assert.equal(root.querySelector("input"), focusedInput);
  assert.equal(mounted, 1, "whole-plugin refresh must retain Browse controls");
  assert.equal(root.doc.activeElement, root.querySelector("input"));
  assert.equal(root.querySelector("input").selectionStart, 2);
  assert.equal(root.querySelector("input").selectionEnd, 4);
  const currentTabs = root.all().filter((el) => el.attrs.role === "tab");
  currentTabs[4].listeners.get("click")!();
  assert.equal(plugin.activeViewTab, "sources");
  assert.equal(unmounted, 0);
  assert.equal(root.querySelector("input"), focusedInput);
  const browsePanel = root
    .all()
    .find((el) => el.className === "stratum-browse-tab")!;
  assert.equal(browsePanel.hidden, true);
  const readsBeforeSwitch = targetReads;
  selectedBrowser = new Browser();
  leafChanged!({ view: selectedBrowser });
  assert.equal(targetReads, readsBeforeSwitch + 1);
  assert.equal(mounted, 1, "Track browser changes without rerendering Sources");
  root
    .all()
    .find((el) => el.text === "Browse")!
    .listeners.get("click")!();
  assert.equal(plugin.activeViewTab, "browse");
  assert.equal(opened, 1);
  assert.equal(mounted, 2);
  const inputAfterTabSwitch = root.querySelector("input");
  for (let i = 0; i < 3; i++) await Promise.resolve();
  assert.equal(mounted, 2, "revealing results must not rebuild Browse again");
  assert.equal(root.querySelector("input"), inputAfterTabSwitch);
  // An in-flight request from the previous panel may complete after reveal.
  await Promise.resolve().then(() => plugin.refreshViews());
  assert.equal(root.querySelector("input"), inputAfterTabSwitch);
  assert.equal(mounted, 2, "late global refresh must not remount Browse");
  leafChanged!({ view: null });
  await app.workspace.revealLeaf(selectedBrowser.leaf);
  await Promise.resolve().then(() => plugin.refreshViews());
  assert.equal(root.querySelector("input"), inputAfterTabSwitch);
  assert.equal(
    mounted,
    2,
    "late global refresh after Show items retains controls",
  );
  root
    .all()
    .find((el) => el.text === "Citations")!
    .listeners.get("click")!();
  root
    .all()
    .find((el) => el.text === "Citations")!
    .listeners.get("keydown")!({ key: "Home", preventDefault() {} });
  for (let i = 0; i < 3; i++) await Promise.resolve();
  assert.equal(root.doc.activeElement?.text, "Browse");
  assert.equal(plugin.activeViewTab, "browse");
  assert.equal(opened, 3);
  assert.equal(root.querySelector("input"), inputAfterTabSwitch);
  assert.equal(mounted, 2, "returning to the same browser reuses the controls");
  assert.equal(browsePanel.hidden, false);
  selectedBrowser = new Browser();
  leafChanged!({ view: selectedBrowser });
  assert.equal(mounted, 3);
  const clickTab = (text: string) =>
    root
      .all()
      .find((el) => el.text === text)!
      .listeners.get("click")!();
  clickTab("Publish");
  plugin.publish.selectedFormat = "pdf";
  view.render();
  assert.equal(
    plugin.publish.selectedFormat,
    "pdf",
    "refresh keeps the selection",
  );
  clickTab("Citations");
  clickTab("Publish");
  assert.equal(
    plugin.publish.selectedFormat,
    "",
    "returning to Publish clears the selection",
  );
  plugin.publish.selectedFormat = "pdf";
  plugin.settings.enabledTabs.publish = false;
  plugin.settings.enabledTabs.browse = false;
  view.render();
  assert.equal(plugin.activeViewTab, "search");
  assert.equal(plugin.publish.selectedFormat, "");
  assert.equal(
    root.all().some((el) => el.text === "Publish"),
    false,
  );
  plugin.settings.enabledTabs.publish = true;
  view.render();
  clickTab("Publish");
  assert.equal(plugin.publish.selectedFormat, "");
  plugin.activeViewTab = "sources";
  view.render();
  assert.equal(
    root.all().some((el) => el.text === "Browse"),
    false,
  );
  assert.equal(app.workspace.getLeavesOfType()[0].view, browser);
  assert.equal(
    opened,
    3,
    "Hiding Browse does not open or replace its workspace pane",
  );
  await view.onClose();
  assert.equal(unmounted, 3);
});

for (const stage of ["sidebar", "browser", "reveal"] as const) {
  test(`Browse stops after plugin unload during ${stage}`, async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pause = () => {
      started();
      return gate;
    };
    let created = 0;
    let revealed = 0;
    let refreshed = 0;
    const leaf = {
      setViewState: () => (stage === "browser" ? pause() : Promise.resolve()),
    };
    const plugin = {
      isUnloaded: false,
      settings: {
        collectionCatalogs: {},
        enabledTabs: readEnabledTabs(undefined),
      },
      activeViewTab: "search",
      activateView: () => (stage === "sidebar" ? pause() : Promise.resolve()),
      refreshViews: () => {
        refreshed++;
      },
      app: {
        workspace: {
          getLeavesOfType: () => [],
          getActiveViewOfType: () => null,
          getLeaf: () => {
            created++;
            return leaf;
          },
          revealLeaf: () => {
            revealed++;
            return stage === "reveal" ? pause() : Promise.resolve();
          },
        },
      },
    };
    const { browseCollections } = loadRuntime<
      typeof import("../collection-browser")
    >(
      "collection-browser.ts",
      { ItemView: class {}, Modal: class {} },
      {},
      "node",
      { "./collection-browser-data": {}, "./collection-catalog-store": {} },
    );
    const request = browseCollections(plugin as never);
    await reached;
    plugin.isUnloaded = true;
    release();
    await request;
    assert.equal(created, stage === "sidebar" ? 0 : 1);
    assert.equal(revealed, stage === "reveal" ? 1 : 0);
    assert.equal(refreshed, 0);
  });
}

for (const reason of ["panel switch", "tab disabled"] as const) {
  for (const stage of ["sidebar", "browser"] as const) {
    test(`Browse stops after ${reason} during ${stage}`, async () => {
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        started = resolve;
      });
      const pause = () => {
        started();
        return gate;
      };
      let created = 0;
      let revealed = 0;
      let refreshed = 0;
      const plugin = {
        settings: {
          collectionCatalogs: {},
          enabledTabs: readEnabledTabs(undefined),
        },
        activeViewTab: "search",
        activateView: () => (stage === "sidebar" ? pause() : Promise.resolve()),
        refreshViews: () => {
          refreshed++;
        },
        app: {
          workspace: {
            getLeavesOfType: () => [],
            getActiveViewOfType: () => null,
            getLeaf: () => {
              created++;
              return {
                setViewState: () =>
                  stage === "browser" ? pause() : Promise.resolve(),
              };
            },
            revealLeaf: () => {
              revealed++;
              return Promise.resolve();
            },
          },
        },
      };
      const { browseCollections } = loadRuntime<
        typeof import("../collection-browser")
      >(
        "collection-browser.ts",
        { ItemView: class {}, Modal: class {} },
        {},
        "node",
        { "./collection-browser-data": {}, "./collection-catalog-store": {} },
      );
      const request = browseCollections(plugin as never);
      await reached;
      if (reason === "panel switch") plugin.activeViewTab = "sources";
      else plugin.settings.enabledTabs.browse = false;
      release();
      await request;
      assert.equal(created, stage === "sidebar" ? 0 : 1);
      assert.equal(revealed, 0);
      assert.equal(refreshed, 0);
      assert.equal(
        plugin.activeViewTab,
        reason === "panel switch" ? "sources" : "browse",
      );
    });
  }
}

test("hidden Browse cannot create or reveal a workspace pane", async () => {
  let notices = 0;
  const { browseCollections } = loadRuntime<
    typeof import("../collection-browser")
  >(
    "collection-browser.ts",
    {
      ItemView: class {},
      Modal: class {},
      Notice: class {
        constructor() {
          notices++;
        }
      },
    },
    {},
    "node",
    { "./collection-browser-data": {}, "./collection-catalog-store": {} },
  );
  const plugin = {
    settings: { enabledTabs: { browse: false } },
    activeViewTab: "search",
    activateView: () => {
      throw new Error("Must not open sidebar");
    },
    app: {
      workspace: {
        getLeavesOfType: () => {
          throw new Error("Must not touch existing panes");
        },
      },
    },
  };
  await browseCollections(plugin as never);
  assert.equal(plugin.activeViewTab, "search");
  assert.equal(notices, 1);
});
