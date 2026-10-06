import assert from "node:assert/strict";
import test from "node:test";
import type * as Chooser from "../settings-tab-chooser";
import { readEnabledTabs } from "../stratum-tabs";
import { loadRuntime } from "./runtime-harness";

function fixture(
  checklist?: Partial<import("../settings-checklist").ChecklistOptions>,
) {
  class Target {
    listeners = new Map<string, (event: unknown) => void>();
    addEventListener(name: string, callback: (event: unknown) => void) {
      this.listeners.set(name, callback);
    }
    removeEventListener(name: string) {
      this.listeners.delete(name);
    }
    fire(name: string, event: unknown = {}) {
      this.listeners.get(name)?.(event);
    }
  }
  let disconnected = false;
  let observe!: () => void;
  class Element extends Target {
    children: Element[] = [];
    style = {};
    checked = false;
    disabled = false;
    value = "";
    text = "";
    setText(text: string) {
      this.text = text;
    }
    dataset: Record<string, string> = {};
    addClass() {}
    empty() {
      this.children = [];
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
    isConnected = true;
    attributes = new Map<string, string>();
    constructor(public tag = "div") {
      super();
    }
    ownerDocument!: { defaultView: unknown };
    private append(tag: string) {
      const child = new Element(tag);
      this.children.push(child);
      return child;
    }
    createEl(tag: string) {
      return this.append(tag);
    }
    createDiv() {
      return this.append("div");
    }
    createSpan() {
      return this.append("span");
    }
    contains(target: Element | null): boolean {
      return this === target || this.children.some((el) => el.contains(target));
    }
    querySelectorAll(selector: string): Element[] {
      const tag = selector.split(":")[0];
      return this.children.flatMap((el) => [
        ...(el.tag === tag && (!selector.includes(":disabled") || !el.disabled)
          ? [el]
          : []),
        ...el.querySelectorAll(selector),
      ]);
    }
    querySelector(tag: string) {
      return this.querySelectorAll(tag)[0];
    }
    focus() {
      doc.activeElement = this;
    }
    remove() {
      this.isConnected = false;
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    getBoundingClientRect() {
      return { top: 100, bottom: 130, right: 400 };
    }
  }
  const win = Object.assign(new Target(), {
    innerWidth: 800,
    innerHeight: 600,
    MutationObserver: class {
      constructor(callback: () => void) {
        observe = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  });
  const doc = Object.assign(new Target(), {
    body: new Element(),
    defaultView: win,
    activeElement: null as Element | null,
  });
  const anchor = new Element("button");
  anchor.ownerDocument = doc;
  const changes: [string, boolean][] = [];
  let escapeScope: (() => boolean) | undefined;
  const { openTabChooser } = loadRuntime<typeof Chooser>(
    "settings-tab-chooser.ts",
    { Notice: class {} },
  );
  const options = {
    tabs: [
      { id: "browse" as const, label: "Browse" },
      { id: "search" as const, label: "Search" },
    ],
    enabled: readEnabledTabs({ search: false }),
    onChange: (id: string, enabled: boolean) => {
      changes.push([id, enabled]);
      return Promise.resolve();
    },
  };
  const { openChecklist } = loadRuntime<typeof import("../settings-checklist")>(
    "settings-checklist.ts",
    {
      Notice: class {},
      Scope: class {
        register(_modifiers: unknown, _key: string, callback: () => boolean) {
          escapeScope = callback;
        }
      },
    },
  );
  const close = checklist
    ? openChecklist(anchor as never, {
        title: "Citation styles",
        searchable: true,
        items: [
          {
            id: "apa",
            label: "APA",
            checked: true,
            disabled: true,
            badge: "Default",
          },
          { id: "ieee", label: "IEEE", checked: false },
        ],
        onChange: options.onChange,
        ...checklist,
      })
    : openTabChooser(anchor as never, options);
  return {
    doc,
    win,
    anchor,
    panel: doc.body.children[0],
    changes,
    escapeScope: () => escapeScope?.(),
    close,
    removeAnchor: () => {
      anchor.isConnected = false;
      observe();
    },
    get disconnected() {
      return disconnected;
    },
  };
}

test("chooser preserves selections and stays open for multiple changes", async () => {
  const f = fixture();
  const inputs = f.panel.querySelectorAll("input");
  assert.equal(f.doc.activeElement, inputs[0]);
  assert.deepEqual(
    inputs.map((input) => input.checked),
    [true, false],
  );
  inputs[0].checked = false;
  inputs[0].fire("change");
  await new Promise<void>((resolve) => setImmediate(resolve));
  inputs[1].checked = true;
  inputs[1].fire("change");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(f.changes, [
    ["browse", false],
    ["search", true],
  ]);
  assert.equal(f.panel.isConnected, true);
  f.close();
});

test("Obsidian Escape scope closes only the chooser and is popped once", () => {
  let pushes = 0;
  let pops = 0;
  const f = fixture({
    keyboard: {
      parent: {} as never,
      keymap: {
        pushScope: () => {
          pushes++;
        },
        popScope: () => {
          pops++;
        },
      },
    },
  });
  assert.equal(pushes, 1);
  assert.equal(f.escapeScope(), false);
  assert.equal(f.panel.isConnected, false);
  assert.equal(f.doc.activeElement, f.anchor);
  assert.equal(pops, 1);
  f.close();
  assert.equal(pops, 1);
});

test("Escape restores trigger focus and removes global listeners", () => {
  const f = fixture();
  let prevented = false;
  f.doc.fire("keydown", {
    key: "Escape",
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation() {},
  });
  assert.equal(prevented, true);
  assert.equal(f.panel.isConnected, false);
  assert.equal(f.doc.activeElement, f.anchor);
  assert.equal(f.anchor.attributes.get("aria-expanded"), "false");
  assert.equal(f.doc.listeners.size, 0);
  assert.equal(f.win.listeners.size, 0);
  assert.equal(f.disconnected, true);
  f.close();
});

test("inside clicks retain the chooser; outside clicks and removed settings close it", () => {
  const f = fixture();
  f.doc.fire("pointerdown", { target: f.panel.children[0] });
  assert.equal(f.panel.isConnected, true);
  f.doc.fire("pointerdown", { target: f.doc.body });
  assert.equal(f.panel.isConnected, false);
  const removed = fixture();
  removed.removeAnchor();
  assert.equal(removed.panel.isConnected, false);
  assert.equal(removed.doc.listeners.size, 0);
});

test("returning to the trigger leaves dismissal to its click handler", () => {
  const f = fixture();
  f.doc.fire("pointerdown", { target: f.anchor });
  assert.equal(f.panel.isConnected, true);
  f.panel.fire("focusout", { relatedTarget: f.anchor });
  assert.equal(f.panel.isConnected, true);
  f.close();
  assert.equal(f.panel.isConnected, false);
  assert.equal(f.anchor.attributes.get("aria-expanded"), "false");
});

test("searchable checklist protects the default and rolls back a failed save", async () => {
  const f = fixture({ onChange: () => Promise.reject(new Error("Disk full")) });
  const inputs = f.panel.querySelectorAll("input");
  assert.equal(inputs[1].disabled, true);
  assert.equal(inputs[1].checked, true);
  inputs[2].checked = true;
  inputs[2].fire("change");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(inputs[2].checked, false);
  assert.equal(inputs[2].disabled, false);
  assert.match(f.panel.querySelector("p").text, /Could not save/);
  f.close();
});

test("pending saves retain checkbox focus and ignore repeated changes", async () => {
  let finish!: () => void;
  let changes = 0;
  const f = fixture({
    onChange: () => {
      changes++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  const input = f.panel.querySelectorAll("input")[2];
  input.focus();
  input.checked = true;
  input.fire("change");
  assert.equal(
    input.disabled,
    false,
    "Disabling a focused checkbox blurs it and dismisses the chooser",
  );
  assert.equal(input.attributes.get("aria-disabled"), "true");
  assert.equal(f.doc.activeElement, input);
  input.fire("change");
  assert.equal(changes, 1);
  finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(input.checked, true);
  assert.equal(input.attributes.get("aria-disabled"), "false");
  assert.equal(f.panel.isConnected, true);
  f.close();
});

test("catalog search reaches styles beyond the first 100 and ignores late loads after close", async () => {
  let finish!: (items: import("../settings-checklist").ChecklistItem[]) => void;
  const f = fixture({
    loadItems: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  finish(
    Array.from({ length: 150 }, (_, n) => ({
      id: `style-${n}`,
      label: `Style ${n}`,
      checked: false,
    })),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.panel.querySelectorAll("input").length, 101);
  const search = f.panel.querySelector("input");
  search.value = "Style 149";
  search.fire("input");
  assert.equal(f.panel.querySelectorAll("input").length, 2);
  const result = f.panel.querySelectorAll("input")[1];
  result.checked = true;
  result.fire("change");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(f.changes, [["style-149", true]]);
  f.close();
  const late = fixture({
    loadItems: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  late.close();
  finish([]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(late.panel.querySelectorAll("input").length, 3);
});
