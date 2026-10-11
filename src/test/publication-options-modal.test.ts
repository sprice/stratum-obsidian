import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { ButtonComponentMock, ToggleComponentMock } from "./ui-component-mocks";

const ownerDocument: { activeElement: unknown } = { activeElement: null };
class Element {
  children: Element[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, () => void>();
  ownerDocument = ownerDocument;
  text = "";
  cls = "";
  disabled = false;
  isConnected = true;
  focused = false;
  constructor(public tag = "div") {}
  private append(tag: string, options: { text?: string; cls?: string } = {}) {
    const child = new Element(tag);
    Object.assign(child, options);
    this.children.push(child);
    return child;
  }
  createEl(tag: string, options = {}) {
    return this.append(tag, options);
  }
  createDiv(options = {}) {
    return this.append("div", options);
  }
  createSpan(options = {}) {
    return this.append("span", options);
  }
  addClass(...names: string[]) {
    this.cls += " " + names.join(" ");
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  setText(text: string) {
    this.text = text;
  }
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, callback);
  }
  empty() {
    this.children = [];
  }
  focus() {
    this.focused = true;
    ownerDocument.activeElement = this;
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}
function setup() {
  const listeners = new Set<() => void>();
  let release!: () => void;
  let reject!: (error: Error) => void;
  let resets = 0;
  const writes: string[] = [];
  const publish = {
    document: {
      path: "Papers/Synthetic.md",
      basename: "Synthetic",
      stat: { ctime: 1 },
    },
    selectedTemplate: { renderer: "aastex" },
    selectedFormat: "pdf",
    busy: false,
    preferencesSaving: false,
    aastexPdfOptions: {
      showLineNumbers: true,
      showDraftDateHeader: true,
      numberedHeadings: false,
    },
    subscribe(callback: () => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    updateAastexPdfOptions(patch: Record<string, boolean>) {
      const captured = this.document.path;
      this.preferencesSaving = true;
      listeners.forEach((callback) => callback());
      return new Promise<void>((resolve, fail) => {
        release = () => {
          writes.push(captured);
          Object.assign(this.aastexPdfOptions, patch);
          this.preferencesSaving = false;
          listeners.forEach((callback) => callback());
          resolve();
        };
        reject = fail;
      });
    },
    resetAastexPdfOptions() {
      resets++;
      return Promise.resolve();
    },
  };
  class Modal {
    modalEl = new Element();
    contentEl = new Element();
    closed = false;
    setTitle() {}
    close() {
      this.closed = true;
      (this as unknown as { onClose(): void }).onClose();
    }
  }
  const { AastexOptionsModal } = loadRuntime<
    typeof import("../publication-options-modal")
  >(
    "publication-options-modal.ts",
    {
      Modal,
      ToggleComponent: ToggleComponentMock,
      ButtonComponent: ButtonComponentMock,
    },
    { Error },
    "browser",
  );
  const launcher = new Element("button");
  const modal = new AastexOptionsModal(
    {} as never,
    publish as never,
    launcher as never,
  );
  modal.onOpen();
  const content = modal.contentEl as unknown as Element;
  const toggles = content
    .all()
    .filter(
      (el) =>
        el.cls.includes("stratum-control-toggle ") ||
        el.cls.endsWith("stratum-control-toggle"),
    );
  return {
    modal,
    content,
    toggles,
    publish,
    launcher,
    writes,
    listeners,
    release: () => release(),
    reject: () => reject(new Error("Synthetic save failure")),
    resets: () => resets,
    emit: () => listeners.forEach((callback) => callback()),
  };
}
test("options auto-save preserves focused switch and the captured note when switching sources", async () => {
  const s = setup();
  assert.equal(s.toggles.length, 3);
  s.toggles[0].focus();
  s.toggles[0].listeners.get("click")!();
  assert.equal(s.toggles[0].attrs.get("aria-disabled"), "false");
  assert.equal(s.toggles[1].attrs.get("aria-disabled"), "true");
  s.publish.document = { ...s.publish.document, path: "Papers/Other.md" };
  s.emit();
  assert.equal((s.modal as unknown as { closed: boolean }).closed, true);
  assert.equal(s.listeners.size, 0);
  assert.equal(s.launcher.focused, true);
  s.release();
  await Promise.resolve();
  assert.deepEqual(s.writes, ["Papers/Synthetic.md"]);
});
test("Word options explain PDF scope and cannot save or reset", () => {
  const s = setup();
  s.publish.selectedFormat = "docx";
  s.emit();
  assert.ok(
    s.content
      .all()
      .some((el) => el.text.includes("Word uses the selected citation style")),
  );
  assert.ok(s.toggles.every((el) => el.attrs.get("aria-disabled") === "true"));
  const reset = s.content
    .all()
    .find((el) => el.text === "Reset document options")!;
  assert.equal(reset.disabled, true);
  reset.listeners.get("click")!();
  assert.equal(s.resets(), 0);
  assert.equal(s.publish.selectedFormat, "docx");
  s.modal.onClose();
});
test("reset uses current defaults and failed auto-saves remain visible in the modal", async () => {
  const s = setup();
  s.content
    .all()
    .find((el) => el.text === "Reset document options")!
    .listeners.get("click")!();
  assert.equal(s.resets(), 1);
  s.toggles[0].listeners.get("click")!();
  s.reject();
  await Promise.resolve();
  assert.ok(s.content.all().some((el) => el.text === "Synthetic save failure"));
  s.modal.onClose();
});
