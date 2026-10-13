import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

type KeyEvent = { key: string; preventDefault(): void };

class Element {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  cssProps: Record<string, string> = {};
  listeners = new Map<string, (event: KeyEvent) => void>();
  doc: { activeElement: Element | null } = { activeElement: null };
  id = "";
  text = "";
  className = "";
  hidden = false;
  tabIndex = 0;
  type = "";
  constructor(public tag = "div") {}
  private append(tag: string, options?: { text?: string; cls?: string }) {
    const child = new Element(tag);
    child.doc = this.doc;
    child.text = options?.text ?? "";
    child.className = options?.cls ?? "";
    this.children.push(child);
    return child;
  }
  createEl(tag: string, options?: { text?: string; cls?: string }) {
    return this.append(tag, options);
  }
  createDiv(options?: { text?: string; cls?: string }) {
    return this.append("div", options);
  }
  createSpan(options?: { text?: string; cls?: string }) {
    return this.append("span", options);
  }
  addClass(...classes: string[]) {
    this.className = [this.className, ...classes].filter(Boolean).join(" ");
  }
  toggleClass(cls: string, value: boolean) {
    const classes = this.className
      .split(" ")
      .filter((name) => name && name !== cls);
    this.className = (value ? [...classes, cls] : classes).join(" ");
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  setCssProps(props: Record<string, string>) {
    Object.assign(this.cssProps, props);
  }
  addEventListener(event: string, callback: (event: KeyEvent) => void) {
    this.listeners.set(event, callback);
  }
  focus() {
    this.doc.activeElement = this;
  }
}

const { createStratumFieldset, createStratumTabs } = loadRuntime<
  typeof import("../ui-controls")
>("ui-controls.ts", {
  setIcon() {},
  setTooltip() {},
});

function setup(selected: "one" | "two" | "three" | null = "two") {
  const root = new Element();
  const selections: [string, boolean][] = [];
  const tabs = createStratumTabs(root as unknown as HTMLElement, {
    idPrefix: "synthetic",
    label: "Synthetic panels",
    tabs: [
      { id: "one", label: "One" },
      { id: "two", label: "Two", className: "synthetic-extra" },
      { id: "three", label: "Three" },
    ],
    selected,
    onSelect: (id, fromKeyboard) => {
      selections.push([id, fromKeyboard]);
      tabs.select(id);
    },
  });
  const [label, list] = root.children;
  const buttons = list.children;
  const key = (index: number, name: string) => {
    let prevented = false;
    buttons[index].listeners.get("keydown")!({
      key: name,
      preventDefault: () => (prevented = true),
    });
    return prevented;
  };
  return { root, tabs, label, list, buttons, selections, key };
}

test("tabs label the tab list and link each tab to its panel", () => {
  const { tabs, label, list, buttons } = setup();
  assert.equal(label.text, "Synthetic panels");
  assert.equal(label.hidden, true);
  assert.equal(list.attrs.role, "tablist");
  assert.equal(list.attrs["aria-labelledby"], label.id);
  assert.equal(list.attrs["aria-label"], undefined);
  assert.ok(list.className.split(" ").includes("stratum-tab-bar"));
  assert.deepEqual(list.cssProps, {
    "--stratum-tab-count": "3",
    "--stratum-compact-tab-count": "2",
  });
  assert.deepEqual(
    buttons.map((button) => [
      button.text,
      button.tag,
      button.type,
      button.attrs.role,
      button.id,
      button.attrs["aria-controls"],
    ]),
    [
      [
        "One",
        "button",
        "button",
        "tab",
        "synthetic-tab-one",
        "synthetic-panel-one",
      ],
      [
        "Two",
        "button",
        "button",
        "tab",
        "synthetic-tab-two",
        "synthetic-panel-two",
      ],
      [
        "Three",
        "button",
        "button",
        "tab",
        "synthetic-tab-three",
        "synthetic-panel-three",
      ],
    ],
  );
  assert.equal(tabs.tabId("three"), "synthetic-tab-three");
  assert.equal(tabs.panelId("one"), "synthetic-panel-one");
  assert.equal(tabs.tab("two"), buttons[1] as unknown as HTMLButtonElement);
  assert.ok(buttons[1].className.split(" ").includes("synthetic-extra"));
});

test("tabs keep one selected, focusable tab with the active style", () => {
  const { tabs, buttons } = setup();
  const state = () =>
    buttons.map((button) => [
      button.attrs["aria-selected"],
      button.tabIndex,
      button.className.split(" ").includes("is-active"),
    ]);
  assert.deepEqual(state(), [
    ["false", -1, false],
    ["true", 0, true],
    ["false", -1, false],
  ]);
  tabs.select("three");
  assert.deepEqual(state(), [
    ["false", -1, false],
    ["false", -1, false],
    ["true", 0, true],
  ]);
  assert.ok(
    buttons.every((button) =>
      button.className.split(" ").includes("stratum-control-button"),
    ),
  );
  // Without a selection, the first tab still keeps the list reachable.
  tabs.select(null);
  assert.deepEqual(
    buttons.map((button) => button.tabIndex),
    [0, -1, -1],
  );
});

test("tabs select on click and move focus with arrows, Home and End", () => {
  const { root, buttons, selections, key } = setup();
  buttons[0].listeners.get("click")!({ key: "", preventDefault() {} });
  assert.deepEqual(selections.at(-1), ["one", false]);
  assert.equal(key(0, "ArrowLeft"), true);
  assert.deepEqual(selections.at(-1), ["three", true]);
  assert.equal(root.doc.activeElement, buttons[2]);
  assert.equal(buttons[2].tabIndex, 0);
  key(2, "ArrowRight");
  assert.deepEqual(selections.at(-1), ["one", true]);
  assert.equal(root.doc.activeElement, buttons[0]);
  key(0, "ArrowRight");
  assert.equal(root.doc.activeElement, buttons[1]);
  key(1, "End");
  assert.equal(root.doc.activeElement, buttons[2]);
  key(2, "Home");
  assert.equal(root.doc.activeElement, buttons[0]);
  const count = selections.length;
  // Enter and Space use the native button click.
  assert.equal(key(0, "Enter"), false);
  assert.equal(key(0, "Tab"), false);
  assert.equal(selections.length, count);
});

test("tab column counts follow the number of tabs", () => {
  const root = new Element();
  createStratumTabs(root as unknown as HTMLElement, {
    idPrefix: "single",
    label: "Single",
    tabs: [{ id: "only", label: "Only" }],
    selected: "only",
    onSelect() {},
  });
  assert.deepEqual(root.children[1].cssProps, {
    "--stratum-tab-count": "1",
    "--stratum-compact-tab-count": "1",
  });
});

test("fieldsets are shared cards labelled by their legend", () => {
  const root = new Element();
  const fieldset = createStratumFieldset(root as unknown as HTMLElement, {
    legend: "Synthetic group",
    cls: "synthetic-extra",
  }) as unknown as Element;
  assert.equal(root.children[0], fieldset);
  assert.equal(fieldset.tag, "fieldset");
  assert.equal(fieldset.className, "synthetic-extra stratum-control-card");
  assert.deepEqual(
    fieldset.children.map((child) => [child.tag, child.text]),
    [["legend", "Synthetic group"]],
  );
});
