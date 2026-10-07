import assert from "node:assert/strict";
import test from "node:test";
import type * as Setup from "../publish-setup";
import type { PublishReadiness } from "../publish-desktop";
import { loadRuntime } from "./runtime-harness";

class Element {
  text = "";
  hidden = false;
  disabled = false;
  value = "";
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  constructor(public tagName = "DIV") {}
  addClass() {}
  toggleClass() {}
  setAttr() {}
  setAttribute() {}
  setText(text: string) {
    this.text = text;
  }
  empty() {
    this.children = [];
  }
  private createChild(tag: string, options?: { text?: string }) {
    const child = new Element(tag.toUpperCase());
    child.text = options?.text || "";
    this.children.push(child);
    return child;
  }
  append(child: Element) {
    this.children = this.children.filter((existing) => existing !== child);
    this.children.push(child);
  }
  createEl(tag: string, options?: { text?: string }) {
    return this.createChild(tag, options);
  }
  createDiv() {
    return this.createChild("div");
  }
  createSpan(options?: { text?: string }) {
    return this.createChild("span", options);
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  click() {
    if (!this.disabled && !this.hidden) this.listeners.get("click")?.();
  }
  find(text: string): Element | undefined {
    if (this.text === text) return this;
    for (const child of this.children) {
      const found = child.find(text);
      if (found) return found;
    }
    return undefined;
  }
}
class Control {
  inputEl = new Element("INPUT");
  buttonEl = new Element("BUTTON");
  setValue(value: string) {
    this.inputEl.value = value;
    return this;
  }
  setPlaceholder() {
    return this;
  }
  setButtonText(text: string) {
    this.buttonEl.text = text;
    return this;
  }
  setTooltip() {
    return this;
  }
  onChange(callback: (value: string) => void) {
    this.inputEl.addEventListener("change", () => callback(this.inputEl.value));
    return this;
  }
  onClick() {
    return this;
  }
}
class Setting {
  descEl = new Element();
  settingEl: Element;
  constructor(private element: Element) {
    this.settingEl = element;
    element.children.push(this.descEl);
  }
  setName() {
    return this;
  }
  addText(callback: (control: Control) => void) {
    const control = new Control();
    this.element.children.push(control.inputEl);
    callback(control);
    return this;
  }
  addButton(callback: (control: Control) => void) {
    const control = new Control();
    this.element.children.push(control.buttonEl);
    callback(control);
    return this;
  }
}

test("setup rechecks stale detection on every open and offers PDF verification without installation help", () => {
  const callbacks = new Set<() => void>();
  const checks: boolean[] = [];
  const publish = {
    readiness: {
      word: true,
      pdf: false,
      pandoc: { path: "/synthetic/pandoc", version: "3" },
      tectonic: { path: "", version: "" },
    } as PublishReadiness | null,
    busy: false,
    checking: false,
    progress: "",
    error: "",
    subscribe: (callback: () => void) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    emit: () => callbacks.forEach((callback) => callback()),
    invalidateSupport: () => {
      publish.readiness = null;
      publish.emit();
    },
    check: (pdf = false) => {
      checks.push(pdf);
      return Promise.resolve();
    },
    cancel: () => {},
  };
  const { PublishSetupModal } = loadRuntime<typeof Setup>(
    "publish-setup.ts",
    {
      Modal: class {
        contentEl = new Element();
        modalEl = { addClass() {} };
        setTitle() {}
        close() {}
      },
      Setting,
    },
    {},
    "browser",
    {
      "./publish-desktop": { publishPlatform: () => ({ platform: "darwin" }) },
    },
  );
  const modal = new PublishSetupModal({
    app: {},
    publish,
    settings: { pandocPath: "", tectonicPath: "" },
  } as never);
  modal.onOpen();
  assert.deepEqual(checks, [false]);
  const content = modal.contentEl as unknown as Element;
  assert.ok(content.find("Get Tectonic"));
  publish.readiness!.tectonic = {
    path: "/synthetic/tectonic",
    version: "0.17",
  };
  callbacks.forEach((callback) => callback());
  assert.equal(content.find("Get Tectonic"), undefined);
  assert.ok(content.find("Detected"));
  assert.ok(content.find("Found automatically"));
  const pathDescription = content.find("/synthetic/tectonic")!;
  function parentOf(root: Element, target: Element): Element | undefined {
    if (root.children.includes(target)) return root;
    return root.children.map((child) => parentOf(child, target)).find(Boolean);
  }
  const description = parentOf(content, pathDescription)!;
  const row = parentOf(content, description)!;
  assert.ok(
    row.children.indexOf(description) >
      row.children.findIndex((child) => child.tagName === "INPUT"),
    "Detected path follows the tool input in DOM order",
  );
  assert.ok(content.find("/synthetic/tectonic"));
  assert.equal(content.find("Use automatic detection")!.hidden, true);
  assert.equal(content.find("Check again")!.hidden, true);
  content.find("Enable PDF")!.click();
  assert.deepEqual(checks, [false, true]);
  publish.checking = true;
  callbacks.forEach((callback) => callback());
  assert.equal(content.find("Cancel check")!.hidden, false);
  assert.equal(content.find("Checking…")!.disabled, true);
  publish.checking = false;
  publish.readiness!.pdf = true;
  callbacks.forEach((callback) => callback());
  assert.ok(content.find("Done"));
  assert.equal(content.find("Check again")!.hidden, false);
  modal.onClose();
  modal.onOpen();
  assert.deepEqual(
    checks,
    [false, true],
    "reopening verified setup does not rerun conversion",
  );
  let sidebarReadiness = publish.readiness;
  const updateSidebar = () => {
    sidebarReadiness = publish.readiness;
  };
  callbacks.add(updateSidebar);
  const advanced = content.children.find(
    (child) => child.tagName === "DETAILS",
  )!;
  const pathInput = advanced.children.find(
    (child) => child.tagName === "INPUT",
  )!;
  pathInput.value = "/different/pandoc";
  pathInput.listeners.get("change")!();
  assert.equal(publish.readiness, null);
  assert.equal(content.find("Use automatic detection")!.hidden, false);
  assert.equal(
    sidebarReadiness,
    null,
    "the sidebar must stop offering creation after a tool path changes",
  );
  callbacks.delete(updateSidebar);
  modal.onClose();
  assert.equal(callbacks.size, 0);
  modal.onOpen();
  assert.deepEqual(checks, [false, true, false]);
  modal.onClose();
});
