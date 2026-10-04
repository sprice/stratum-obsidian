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
  value = "";
  text = "";
  hidden = false;
  change: ((value: string) => void) | null = null;
  selectionStart = 0;
  selectionEnd = 0;
  constructor(public tag = "div") {}
  addClass() {}
  empty() {
    this.children = [];
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
  createEl(
    tag: string,
    options?: { value?: string; text?: string; attr?: Record<string, string> },
  ) {
    const child = new Element(tag);
    child.doc = this.doc;
    child.value = options?.value ?? "";
    child.text = options?.text ?? "";
    child.attrs = options?.attr ?? {};
    this.children.push(child);
    return child;
  }
  createDiv(options?: { attr?: Record<string, string> }) {
    const child = new Element();
    child.doc = this.doc;
    child.attrs = options?.attr ?? {};
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
      revealLeaf: () => {
        revealed++;
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
          setPlaceholder() {
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
    sidebar.querySelector('select[aria-label="Literature browser layout"]')
      ?.value,
    "table",
  );
  assert.equal(
    sidebar.querySelector('input[aria-label="Search imported papers"]')?.value,
    "synthetic",
  );
  assert.ok(sidebar.all().some((el) => el.text === "1 imported paper"));
  const input = sidebar.querySelector(
    'input[aria-label="Search imported papers"]',
  );
  input.change!("no match");
  assert.equal(peerSidebar.querySelector("input").value, "no match");
  assert.equal(sidebar.querySelector("input"), input);
  assert.equal(root.querySelectorAll("a").length, 0);
  assert.ok(sidebar.all().some((el) => el.text === "0 imported papers"));
  input.change!("synthetic");
  input.value = "synthetic";
  input.focus();
  const results = root
    .all()
    .find((el) => el.attrs["aria-label"] === "Imported papers")!;
  results.scrollLeft = 420;
  results.listeners.get("scroll")!();
  events.get("changed")!();
  const refreshed = root
    .all()
    .find((el) => el.attrs["aria-label"] === "Imported papers")!;
  assert.notEqual(refreshed, results);
  const refreshedInput = sidebar.querySelector(
    'input[aria-label="Search imported papers"]',
  );
  assert.equal(refreshedInput.value, "synthetic");
  assert.equal(sidebar.doc.activeElement, refreshedInput);
  assert.equal(refreshed.scrollLeft, 420);
  const snapshot = JSON.stringify(view.getState());
  await browseCollections(plugin as never);
  assert.equal(revealed, 1);
  assert.equal(plugin.activeViewTab, "browse");
  assert.equal(JSON.stringify(view.getState()), snapshot);
  const layout = sidebar.querySelector(
    'select[aria-label="Literature browser layout"]',
  );
  layout.value = "list";
  layout.listeners.get("change")!();
  assert.equal(view.getState().layout, "list");
  assert.equal(
    peerSidebar.querySelector('select[aria-label="Literature browser layout"]')
      .value,
    "list",
  );
  assert.equal(root.querySelector("table"), null);
  assert.equal(root.querySelectorAll("a").length, 1);
  const switcher = sidebar.querySelector(
    'select[aria-label="Choose collection"]',
  );
  switcher.value = "unfiled";
  switcher.listeners.get("change")!();
  assert.equal(view.getState().collection, "unfiled");
  assert.equal(view.getState().query, "");
  assert.equal(root.querySelectorAll("a").length, 1);
  unmount();
  const detachedInput = sidebar.querySelector("input");
  events.get("changed")!();
  assert.equal(sidebar.querySelector("input"), detachedInput);
  const remount = view.mountControls(sidebar as never);
  assert.equal(
    sidebar.querySelector('select[aria-label="Choose collection"]')?.value,
    "unfiled",
  );
  remount();
  unmountPeer();
  const second = new CollectionBrowserView(leaf as never, plugin as never);
  extraLeaf = { view: second };
  await second.onOpen();
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

test("Browse joins sidebar tabs and switching panels detaches controls without closing results", async () => {
  const root = new Element();
  let mounted = 0;
  let unmounted = 0;
  let opened = 0;
  let leafChanged: ((leaf: { view: unknown }) => void) | undefined;
  class Browser {
    isReady() {
      return true;
    }
    mountControls(container: Element) {
      mounted++;
      container.createEl("input", {
        attr: { "aria-label": "Search imported papers" },
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
      requestSaveLayout() {},
      on(_event: string, callback: (leaf: { view: unknown }) => void) {
        leafChanged = callback;
      },
    },
  };
  const { StratumView } = loadRuntime<typeof import("../view")>(
    "view.ts",
    {
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
    refreshViews: () => view.render(),
  };
  const view = new StratumView({ app } as never, plugin as never);
  await view.onOpen();
  const tabs = root.all().filter((el) => el.attrs.role === "tab");
  assert.deepEqual(
    tabs.map((el) => el.text),
    ["Browse", "Search", "Sync", "Reader", "Sources"],
  );
  assert.equal(tabs[0].attrs["aria-selected"], "true");
  assert.ok(root.querySelector('input[aria-label="Search imported papers"]'));
  assert.equal(mounted, 1);
  const focusedInput = root.querySelector("input");
  focusedInput.focus();
  focusedInput.setSelectionRange(2, 4);
  view.render();
  assert.equal(root.doc.activeElement, root.querySelector("input"));
  assert.equal(root.querySelector("input").selectionStart, 2);
  assert.equal(root.querySelector("input").selectionEnd, 4);
  const currentTabs = root.all().filter((el) => el.attrs.role === "tab");
  currentTabs[4].listeners.get("click")!();
  assert.equal(plugin.activeViewTab, "sources");
  assert.equal(unmounted, 2);
  assert.equal(root.querySelector("input"), null);
  const readsBeforeSwitch = targetReads;
  selectedBrowser = new Browser();
  leafChanged!({ view: selectedBrowser });
  assert.equal(targetReads, readsBeforeSwitch + 1);
  assert.equal(mounted, 2, "Track browser changes without rerendering Sources");
  root
    .all()
    .find((el) => el.text === "Browse")!
    .listeners.get("click")!();
  assert.equal(plugin.activeViewTab, "browse");
  assert.equal(opened, 1);
  assert.equal(mounted, 3);
  for (let i = 0; i < 3; i++) await Promise.resolve();
  root
    .all()
    .find((el) => el.text === "Sources")!
    .listeners.get("click")!();
  root
    .all()
    .find((el) => el.text === "Sources")!
    .listeners.get("keydown")!({ key: "Home", preventDefault() {} });
  for (let i = 0; i < 3; i++) await Promise.resolve();
  assert.equal(root.doc.activeElement?.text, "Browse");
  assert.equal(plugin.activeViewTab, "browse");
  assert.equal(opened, 2);
  selectedBrowser = new Browser();
  leafChanged!({ view: selectedBrowser });
  assert.equal(mounted, 5);
  plugin.settings.enabledTabs.browse = false;
  plugin.activeViewTab = "sources";
  view.render();
  assert.equal(
    root.all().some((el) => el.text === "Browse"),
    false,
  );
  assert.equal(app.workspace.getLeavesOfType()[0].view, browser);
  assert.equal(
    opened,
    2,
    "Hiding Browse does not open or replace its workspace pane",
  );
  await view.onClose();
  assert.equal(unmounted, 5);
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
