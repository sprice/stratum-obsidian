import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { loadRuntime } from "./runtime-harness";
import {
  ButtonComponentMock,
  ToggleComponentMock,
  DropdownComponentMock,
  SettingMock,
} from "./ui-component-mocks";

const ownerDocument: { activeElement: unknown } = { activeElement: null };
class Element {
  children: Element[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, () => void>();
  ownerDocument = ownerDocument;
  get childElementCount() {
    return this.children.length;
  }
  querySelectorAll(selector: string) {
    return this.all().filter((el) => selector.split(",").includes(el.tag));
  }
  querySelector(selector = "input") {
    return (
      this.all().find((el) => el.tag === (selector === "p" ? "p" : "input")) ??
      null
    );
  }
  contains(element: Element | null) {
    return !!element && this.all().includes(element);
  }
  text = "";
  get textContent() {
    return this.text;
  }
  cls = "";
  hidden = false;
  open = false;
  disabled = false;
  checked = false;
  isConnected = true;
  focused = false;
  constructor(public tag = "div") {}
  private append(
    tag: string,
    {
      attr,
      ...options
    }: { text?: string; cls?: string; attr?: Record<string, string> } = {},
  ) {
    const child = new Element(tag);
    Object.assign(child, options);
    for (const [name, value] of Object.entries(attr ?? {}))
      child.attrs.set(name, value);
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
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  textWrites = 0;
  emptyCalls = 0;
  setText(text: string) {
    this.textWrites++;
    this.text = text;
  }
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, callback);
  }
  removeEventListener(name: string, callback: () => void) {
    if (this.listeners.get(name) === callback) this.listeners.delete(name);
  }
  empty() {
    this.emptyCalls++;
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
  let saves = 0;
  const writes: string[] = [];
  const publish = {
    plugin: { settings: {} },
    document: {
      path: "Papers/Synthetic.md",
      basename: "Synthetic",
      stat: { ctime: 1 },
    },
    selectedTemplate: { renderer: "journal" },
    journalProfile: { name: "Synthetic" },
    notePreferences: { templateId: "registry:example:1.0-r1" },
    layout: { titleSource: "properties" },
    noteProperties: {},
    academicProblem: "",
    publishingIssues: [] as import("../publish-properties").PublishingIssue[],
    readiness: { pdf: true },
    busy: false,
    preferencesSaving: false,
    subscribe(callback: () => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    updateLayout(patch: Record<string, unknown>) {
      saves++;
      const captured = this.document.path;
      this.preferencesSaving = true;
      listeners.forEach((callback) => callback());
      return new Promise<void>((resolve, fail) => {
        release = () => {
          writes.push(captured);
          Object.assign(this.layout, patch);
          this.preferencesSaving = false;
          listeners.forEach((callback) => callback());
          resolve();
        };
        reject = fail;
      });
    },
    get settingsResetChanges() {
      return true;
    },
    resetSettings() {
      resets++;
      return Promise.resolve();
    },
    closedSettings: [] as unknown[],
    settingsClosed(modal: unknown) {
      this.closedSettings.push(modal);
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
  const { PublishingSettingsModal } = loadRuntime<
    typeof import("../publication-options-modal")
  >(
    "publication-options-modal.ts",
    {
      Modal,
      Setting: SettingMock,
      ToggleComponent: ToggleComponentMock,
      ButtonComponent: ButtonComponentMock,
      DropdownComponent: DropdownComponentMock,
    },
    { Error, queueMicrotask },
    "browser",
  );
  const launcher = new Element("button");
  const modal = new PublishingSettingsModal(
    {} as never,
    publish as never,
    launcher as never,
  );
  modal.onOpen();
  const content = modal.contentEl as unknown as Element;
  const title = content.all().find((el) => el.tag === "select")!;
  const changeTitle = () => {
    Object.assign(title, { value: "body" });
    title.listeners.get("change")!();
  };
  return {
    modal,
    content,
    changeTitle,
    title,
    publish,
    launcher,
    writes,
    listeners,
    release: () => release(),
    reject: () => reject(new Error("Synthetic save failure")),
    resets: () => resets,
    saves: () => saves,
    emit: () => listeners.forEach((callback) => callback()),
  };
}
test("options auto-save preserves title choice and the captured note when switching sources", async () => {
  const s = setup();
  s.title.focus();
  s.changeTitle();
  s.publish.document = { ...s.publish.document, path: "Papers/Other.md" };
  s.emit();
  assert.equal((s.modal as unknown as { closed: boolean }).closed, true);
  assert.equal(s.listeners.size, 0);
  assert.equal(s.launcher.focused, true);
  assert.deepEqual(s.publish.closedSettings, [s.modal]);
  s.release();
  await Promise.resolve();
  assert.deepEqual(s.writes, ["Papers/Synthetic.md"]);
});
test("a removed launcher hands focus return to its replacement", () => {
  const s = setup();
  const replacement = new Element("button");
  s.modal.adoptLauncher(replacement as never);
  s.modal.close();
  assert.equal(s.launcher.focused, true, "a connected launcher is kept");
  assert.equal(replacement.focused, false);
  const next = setup();
  next.launcher.isConnected = false;
  next.modal.adoptLauncher(replacement as never);
  next.modal.close();
  assert.equal(next.launcher.focused, false);
  assert.equal(replacement.focused, true);
});
test("reset uses current defaults and failed auto-saves remain visible in the modal", async () => {
  const s = setup();
  s.content
    .all()
    .find((el) => el.text === "Reset to defaults")!
    .listeners.get("click")!();
  assert.equal(s.resets(), 1);
  s.changeTitle();
  s.reject();
  await settle();
  assert.ok(s.content.all().some((el) => el.text === "Synthetic save failure"));
  s.modal.onClose();
});

test("modal refresh preserves list boundary buttons through busy and idle transitions", () => {
  const s = setup();
  const authors = (s.modal as unknown as { authorContainer: Element })
    .authorContainer;
  const boundary = authors.createEl("button");
  boundary.disabled = true;
  const enabled = authors.createEl("button");
  s.emit();
  assert.equal(boundary.disabled, true);
  assert.equal(enabled.disabled, false);
  s.publish.busy = true;
  s.emit();
  assert.equal(boundary.disabled, true);
  assert.equal(enabled.disabled, true);
  s.publish.busy = false;
  s.emit();
  assert.equal(boundary.disabled, true);
  assert.equal(enabled.disabled, false);
  s.modal.onClose();
});

test("resolving a metadata close warning does not hide a retained option failure", async () => {
  const s = setup();
  s.changeTitle();
  s.reject();
  await settle();
  const state = s.modal as unknown as {
    closingError: boolean;
    error: { hidden: boolean };
  };
  state.closingError = true;
  s.emit();
  assert.equal(state.closingError, false);
  assert.equal(state.error.hidden, false);
  s.modal.onClose();
});

test("registry settings expose class-controlled layout without legacy switches or approval", () => {
  const s = setup();
  assert.ok(
    s.content.all().some((el) => el.text.includes("profile controls layout")),
  );
  assert.ok(
    !s.content
      .all()
      .some((el) =>
        /heading numbers|Line numbers|Draft date|Use installed version/.test(
          el.text,
        ),
      ),
  );
  const alert = s.content.all().find((el) => el.attrs.get("role") === "alert")!;
  s.publish.publishingIssues = [
    { target: "general", message: "Synthetic problem", blocking: true },
  ];
  s.emit();
  assert.equal(alert.text, "Synthetic problem");
  const writes = alert.textWrites;
  s.emit();
  assert.equal(alert.textWrites, writes);
  s.modal.onClose();
});

test("without editable fields, the validation block lists every issue with its label", () => {
  const s = setup();
  s.publish.publishingIssues = [
    {
      target: "title",
      message: "Synthetic title problem.",
      blocking: true,
    },
    {
      target: "author",
      author: 0,
      field: "name",
      message: "Synthetic author problem.",
      blocking: true,
    },
    {
      target: "general",
      message: "Synthetic guidance.",
      blocking: false,
    },
  ];
  s.emit();
  const alert = s.content
    .all()
    .find((el) => el.text.startsWith("Synthetic title"))!;
  assert.equal(alert.attrs.get("role"), "alert");
  assert.equal(
    alert.text,
    "Synthetic title problem.\nSynthetic author problem.",
  );
  assert.ok(s.content.all().some((el) => el.text === "Synthetic guidance."));
  s.modal.onClose();
});

test("unchanged saves, failures and validation notes do not rewrite live content", async () => {
  const s = setup();
  s.publish.publishingIssues = [
    { target: "general", message: "Synthetic guidance.", blocking: false },
  ];
  s.publish.preferencesSaving = true;
  s.emit();
  const saving = s.content.all().find((el) => el.text === "Saving settings…")!;
  const guidance = s.content
    .all()
    .find((el) => el.text === "Synthetic guidance.")!;
  const writes = saving.textWrites;
  s.emit();
  s.emit();
  assert.equal(saving.textWrites, writes);
  assert.ok(s.content.all().includes(guidance));
  s.publish.preferencesSaving = false;
  s.emit();
  s.changeTitle();
  s.reject();
  await settle();
  const failure = s.content
    .all()
    .find((el) => el.text === "Synthetic save failure")!;
  assert.ok(failure);
  const failureWrites = failure.textWrites;
  s.emit();
  s.emit();
  assert.equal(failure.textWrites, failureWrites);
  assert.ok(s.content.all().includes(failure));
  assert.ok(s.content.all().includes(guidance));
  s.modal.onClose();
});

test("opening the note reports a failure inside Settings and restores its button focus", async () => {
  const s = setup();
  Object.assign(s.publish, {
    editPublicationDetails: () =>
      Promise.reject(new Error("Synthetic open failure")),
  });
  const button = s.content
    .all()
    .find((el) => el.text === "Open note for editing")!;
  button.listeners.get("click")!();
  await settle();
  assert.ok(s.content.all().some((el) => el.text === "Synthetic open failure"));
  assert.equal(ownerDocument.activeElement, button);
  s.modal.onClose();
});
