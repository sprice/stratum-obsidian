import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  doc: { activeElement: Element | null } = { activeElement: null };
  scrollTop = 0;
  scrollLeft = 0;
  value = "";
  selectionStart = 0;
  selectionEnd = 0;
  constructor(public tag = "div") {}
  addClass() {}
  empty() {
    this.children = [];
  }
  setText() {}
  setAttr(key: string, value: string) {
    this.attrs[key] = value;
  }
  setAttribute(key: string, value: string) {
    this.setAttr(key, value);
  }
  setSelectionRange() {}
  focus() {
    this.doc.activeElement = this;
  }
  createEl(
    tag: string,
    options?: { value?: string; attr?: Record<string, string> },
  ) {
    const child = new Element(tag);
    child.doc = this.doc;
    child.value = options?.value ?? "";
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

test("browser live refresh retains horizontal position and direct browsing preserves the existing view", async () => {
  const root = new Element();
  const events = new Map<string, () => void>();
  let revealed = 0;
  const app = {
    metadataCache: {
      on: (event: string, callback: () => void) => {
        events.set(event, callback);
      },
    },
    vault: { on() {} },
    workspace: {
      requestSaveLayout() {},
      getLeavesOfType: () => [leaf],
      revealLeaf: () => {
        revealed++;
        return Promise.resolve();
      },
      getLeaf: () => {
        throw new Error("Should reuse existing browser");
      },
    },
  };
  const leaf = { app };
  const { CollectionBrowserView, browseCollections } = loadRuntime<
    typeof import("../collection-browser")
  >(
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
        setValue() {
          return this;
        }
        onChange() {
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
  const plugin = { app, settings: { collectionCatalogs: {} } };
  const view = new CollectionBrowserView(leaf as never, plugin as never);
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
  assert.equal(refreshed.scrollLeft, 420);
  const snapshot = JSON.stringify(view.getState());
  browseCollections(plugin as never);
  await Promise.resolve();
  assert.equal(revealed, 1);
  assert.equal(JSON.stringify(view.getState()), snapshot);
  await view.onClose();
});
