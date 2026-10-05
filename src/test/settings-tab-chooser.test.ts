import assert from "node:assert/strict";
import test from "node:test";
import type * as Chooser from "../settings-tab-chooser";
import { readEnabledTabs } from "../stratum-tabs";
import { loadRuntime } from "./runtime-harness";

function fixture() {
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
    querySelectorAll(tag: string): Element[] {
      return this.children.flatMap((el) => [
        ...(el.tag === tag ? [el] : []),
        ...el.querySelectorAll(tag),
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
  const { openTabChooser } = loadRuntime<typeof Chooser>(
    "settings-tab-chooser.ts",
    { Notice: class {} },
  );
  const close = openTabChooser(anchor as never, {
    tabs: [
      { id: "browse", label: "Browse" },
      { id: "search", label: "Search" },
    ],
    enabled: readEnabledTabs({ search: false }),
    onChange: (id, enabled) => {
      changes.push([id, enabled]);
      return Promise.resolve();
    },
  });
  return {
    doc,
    win,
    anchor,
    panel: doc.body.children[0],
    changes,
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

test("chooser preserves selections and stays open for multiple changes", () => {
  const f = fixture();
  const inputs = f.panel.querySelectorAll("input");
  assert.equal(f.doc.activeElement, inputs[0]);
  assert.deepEqual(
    inputs.map((input) => input.checked),
    [true, false],
  );
  inputs[0].checked = false;
  inputs[0].fire("change");
  inputs[1].checked = true;
  inputs[1].fire("change");
  assert.deepEqual(f.changes, [
    ["browse", false],
    ["search", true],
  ]);
  assert.equal(f.panel.isConnected, true);
  f.close();
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
