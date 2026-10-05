import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { readSourceTableState } from "../source-table";
import type { SourceRow } from "../document-sources";

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  doc = { activeElement: null };
  isConnected = true;
  scrollTop = 0;
  scrollLeft = 0;
  textContent = "";
  value = "";
  focused = false;
  constructor(
    public tag = "div",
    public text = "",
  ) {}
  addClass() {}
  setAttr(key: string, value: string) {
    this.attrs[key] = value;
  }
  setAttribute(key: string, value: string) {
    this.setAttr(key, value);
  }
  setText(text: string) {
    this.text = text;
  }
  empty() {
    this.children = [];
  }
  focus() {
    this.focused = true;
  }
  contains(element: Element): boolean {
    return (
      this === element || this.children.some((child) => child.contains(element))
    );
  }
  createEl(
    tag: string,
    options?: { text?: string; value?: string; attr?: Record<string, string> },
  ) {
    const element = new Element(tag, options?.text);
    element.value = options?.value ?? "";
    element.attrs = options?.attr ?? {};
    this.children.push(element);
    return element;
  }
  createDiv(options?: { text?: string }) {
    const element = new Element("div", options?.text);
    this.children.push(element);
    return element;
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  querySelectorAll() {
    return this.all().filter((element) => element.dataset.sourceAction);
  }
  trigger(event: string) {
    this.listeners.get(event)?.();
  }
}

for (const failSave of [false, true]) {
  test(`inline style selector applies to the captured note and recovers from save failure=${failSave}`, async () => {
    class Dropdown {
      static instances: Dropdown[] = [];
      selectEl: Element;
      disabled = false;
      change!: (value: string) => Promise<void>;
      constructor(parent: Element) {
        this.selectEl = parent.createEl("select");
        Dropdown.instances.push(this);
      }
      addOption(value: string, text: string) {
        this.selectEl.createEl("option", { value, text });
        return this;
      }
      setValue(value: string) {
        this.selectEl.value = value;
        return this;
      }
      setDisabled(disabled: boolean) {
        this.disabled = disabled;
        return this;
      }
      onChange(callback: (value: string) => Promise<void>) {
        this.change = callback;
        return this;
      }
    }
    const notices: string[] = [];
    const { SourcesPanel } = loadRuntime<typeof import("../view-sources")>(
      "view-sources.ts",
      {
        Component: class {},
        Modal: class {},
        DropdownComponent: Dropdown,
        Notice: class {
          constructor(text: string) {
            notices.push(text);
          }
        },
      },
    );
    const changes: string[][] = [];
    let settingsOpened = 0;
    let selected = "apa";
    let finishSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const sources = {
      citationStyleChoices: () =>
        Promise.resolve({
          path: "Synthetic draft.md",
          selected,
          unavailable: false,
          options: [
            { id: "apa", title: "APA" },
            { id: "ieee", title: "IEEE" },
          ],
        }),
      changeCitationStyle: async (value: string, path: string) => {
        changes.push([value, path]);
        await pendingSave;
        if (failSave) throw new Error("Save failed");
        selected = value;
      },
      manageCitationStyles: () => {
        settingsOpened++;
        return Promise.resolve();
      },
    };
    const root = new Element();
    const panel = new SourcesPanel(
      root as never,
      sources as never,
      {} as never,
      {} as never,
      () => {},
    );
    const status = new Element();
    Object.assign(panel, { citationStatus: status, active: true });
    await (
      panel as unknown as { renderCitationStatus(): Promise<void> }
    ).renderCitationStatus();
    const control = Dropdown.instances[0];
    assert.equal(control.selectEl.value, "apa");
    assert.equal(
      control.selectEl.attrs["aria-label"],
      "Citation style for this note",
    );
    control.setValue("ieee");
    const saving = control.change("ieee");
    assert.equal(control.disabled, true);
    await (
      panel as unknown as { renderCitationStatus(): Promise<void> }
    ).renderCitationStatus();
    const replacement = Dropdown.instances.at(-1)!;
    assert.equal(
      replacement.disabled,
      true,
      "Refresh must not allow overlapping saves",
    );
    await replacement.change("apa");
    assert.equal(changes.length, 1);
    finishSave();
    await saving;
    assert.equal(Dropdown.instances.at(-1)!.disabled, false);
    assert.equal(
      Dropdown.instances.at(-1)!.selectEl.value,
      failSave ? "apa" : "ieee",
    );
    assert.deepEqual(changes, [["ieee", "Synthetic draft.md"]]);
    assert.equal(control.disabled, false);
    assert.equal(control.selectEl.value, failSave ? "apa" : "ieee");
    assert.equal(notices.length, failSave ? 1 : 0);
    status
      .all()
      .find((el) => el.text === "Manage citation styles")!
      .trigger("click");
    assert.equal(settingsOpened, 1);
  });
}

test("native table preserves source navigation and diagnostics and sorts custom properties without writes", () => {
  const { SourcesPanel } = loadRuntime<typeof import("../view-sources")>(
    "view-sources.ts",
    {
      Component: class {
        register() {}
      },
      Modal: class {},
      SearchComponent: class {
        inputEl = new Element("input");
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
      setIcon() {},
    },
    { HTMLElement: Element },
  );
  const source = (id: string, title: string): SourceRow => ({
    id,
    keys: [],
    entry: {
      title,
      authors: ["Synthetic author"],
      year: "2026",
      file: { path: `${id}.md` },
    } as SourceRow["entry"],
    occurrences: [
      { kind: "link", excerpt: "A synthetic connection" },
    ] as SourceRow["occurrences"],
  });
  const first = source("A", "First synthetic source");
  const second = source("B", "Second synthetic source");
  const unresolved: SourceRow = {
    id: "unknown",
    keys: ["unknown2026"],
    issue: "unresolved",
    occurrences: [
      { kind: "citation", excerpt: "[@unknown2026]" },
    ] as SourceRow["occurrences"],
  };
  let opened = "",
    navigations = 0,
    saved = 0;
  const controller = {
    document: { basename: "Synthetic draft" },
    rows: [first, second, unresolved],
    subscribe: () => () => {},
    subscribeCitationChanges: () => () => {},
    citationStyleChoices: () => Promise.resolve(null),
    properties: (row: SourceRow) =>
      row === first
        ? { sample_size: 100 }
        : { sample_size: 9, findings: "<img src=x onerror=example>" },
    openSource: (file: { path: string }) => {
      opened = file.path;
    },
    returnToDocument: () => {
      navigations++;
    },
  };
  const root = new Element();
  const state = {
    ...readSourceTableState({
      layout: "table",
      columns: ["sample_size", "findings"],
    }),
    query: "",
    sort: "appearance",
    scroll: 0,
    scrollLeft: 0,
    expanded: new Set<string>(),
  };
  const panel = new SourcesPanel(
    root as never,
    controller as never,
    state,
    {} as never,
    () => {
      saved++;
    },
  );
  panel.onload();
  assert.equal(
    root.all().filter((el) => el.tag === "tbody")[0].children.length,
    3,
  );
  const action = (id: string) =>
    root.all().find((el) => el.dataset.sourceAction === id)!;
  action("A:open").trigger("click");
  assert.equal(opened, "A.md");
  action("A:occurrence:0").trigger("click");
  assert.equal(navigations, 1);
  assert.ok(
    root.all().some((el) => el.text.includes("Citation key not found")),
  );
  assert.ok(
    root
      .all()
      .some(
        (el) => el.tag === "td" && el.text === "<img src=x onerror=example>",
      ),
  );
  action("sort:sample_size").trigger("click");
  assert.equal(state.columnSort, "sample_size");
  assert.equal(saved, 1);
  const sortMenu = root
    .all()
    .find((el) => el.attrs["aria-label"] === "Sort citations")!;
  assert.equal(sortMenu.value, "column");
  assert.equal(action("sort:sample_size").focused, true);
  const sorted = root.all().find((el) => el.tag === "tbody")!;
  assert.ok(
    sorted.children[0].all().some((el) => el.dataset.sourceAction === "B:open"),
  );
  action("sort:sample_size").trigger("click");
  assert.equal(state.descending, true);
  sortMenu.value = "appearance";
  sortMenu.trigger("change");
  assert.equal(state.columnSort, null);
  assert.ok(
    root
      .all()
      .find((el) => el.tag === "tbody")!
      .children[0].all()
      .some((el) => el.dataset.sourceAction === "A:open"),
  );
  const layout = root
    .all()
    .find((el) => el.attrs["aria-label"] === "Citations layout")!;
  layout.value = "list";
  layout.trigger("change");
  assert.equal(state.layout, "list");
  assert.ok(root.all().some((el) => el.tag === "li"));
  assert.equal(
    root.all().some((el) => el.tag === "table"),
    false,
  );
  panel.onunload();
  state.layout = "table";
  const firstContainer = new Element();
  const firstPanel = new SourcesPanel(
    firstContainer as never,
    controller as never,
    state,
    {} as never,
    () => {},
  );
  firstPanel.onload();
  const results = firstContainer
    .all()
    .find(
      (el) =>
        el.attrs["aria-label"] ===
        "Citation results; scroll to see additional columns",
    )!;
  results.scrollLeft = 420;
  results.trigger("scroll");
  firstPanel.onunload();
  const nextContainer = new Element();
  const nextPanel = new SourcesPanel(
    nextContainer as never,
    controller as never,
    state,
    {} as never,
    () => {},
  );
  nextPanel.onload();
  const restoredResults = nextContainer
    .all()
    .find(
      (el) =>
        el.attrs["aria-label"] ===
        "Citation results; scroll to see additional columns",
    )!;
  assert.equal(
    restoredResults.scrollLeft,
    420,
    "Rebuilding Sources must preserve the visible research columns",
  );
  nextPanel.onunload();
});
