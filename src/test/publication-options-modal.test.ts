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
function setup(
  initial: Partial<import("../publication-options").AastexPdfOptions> = {},
) {
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
    selectedTemplate: { renderer: "aastex" },
    notePreferences: { templateId: "package:aastex" },
    layout: { titleSource: "properties" },
    noteProperties: {},
    academicProblem: "",
    publishingIssues: [] as import("../publish-properties").PublishingIssue[],
    aastexHeadingProblems: [],
    aastexPackageProblem: "",
    readiness: { pdf: true },
    busy: false,
    preferencesSaving: false,
    aastexPdfOptions: {
      showLineNumbers: true,
      showDraftDateHeader: true,
      numberedHeadings: false,
      ...initial,
    },
    subscribe(callback: () => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    updateAastexPdfOptions(patch: Record<string, boolean>) {
      saves++;
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
    saves: () => saves,
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
  s.toggles[0].listeners.get("click")!();
  s.reject();
  await settle();
  assert.ok(s.content.all().some((el) => el.text === "Synthetic save failure"));
  s.modal.onClose();
});

test("native setter refresh is silent for all options in both directions, including child-input focus and reopen", async () => {
  const keys = [
    "showLineNumbers",
    "showDraftDateHeader",
    "numberedHeadings",
  ] as const;
  for (const [index, key] of keys.entries())
    for (const start of [false, true]) {
      const s = setup({ [key]: start });
      assert.equal(s.saves(), 0, "Opening configured values cannot autosave");
      const toggle = s.toggles[index];
      const input = toggle.querySelector()!;
      input.focus();
      toggle.listeners.get("click")!();
      assert.equal(s.saves(), 1, `${key}: one user click produces one save`);
      assert.equal(input.checked, !start, "Pending choice remains visible");
      assert.equal(
        toggle.attrs.get("aria-disabled"),
        "false",
        "A focused child keeps its switch enabled",
      );
      s.release();
      await settle();
      assert.equal(s.publish.preferencesSaving, false);
      assert.equal(s.publish.aastexPdfOptions[key], !start);
      assert.equal(
        s.saves(),
        1,
        "Completion refresh cannot enqueue another save",
      );
      assert.ok(
        s.toggles.every((el) => el.attrs.get("aria-disabled") === "false"),
      );
      s.modal.onClose();
      s.modal.onOpen();
      const reopened = s.content
        .all()
        .filter((el) => el.cls.endsWith("stratum-control-toggle"))[index];
      assert.equal(reopened.querySelector()!.checked, !start);
      assert.equal(s.saves(), 1, "Reopening persisted values cannot autosave");
      s.modal.onClose();
    }
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
  s.toggles[0].listeners.get("click")!();
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

test("heading review keeps its open state and focus across unchanged emits", () => {
  const s = setup();
  const publish = s.publish as unknown as { aastexHeadingProblems: string[] };
  publish.aastexHeadingProblems = ["Synthetic heading 1 is numbered."];
  s.emit();
  const disclosure = s.content.all().find((el) => el.tag === "details")!;
  const summary = disclosure.children.find((el) => el.tag === "summary")!;
  assert.equal(summary.text, "Review heading numbers");
  disclosure.open = true;
  summary.focus();
  for (let emit = 0; emit < 3; emit++) {
    publish.aastexHeadingProblems = ["Synthetic heading 1 is numbered."];
    s.emit();
  }
  assert.ok(s.content.contains(disclosure), "The disclosure is not rebuilt");
  assert.equal(disclosure.open, true);
  assert.ok(s.content.contains(summary));
  assert.equal(ownerDocument.activeElement, summary);
  publish.aastexHeadingProblems = [
    "Synthetic heading 1 is numbered.",
    "Synthetic heading 2 is numbered.",
  ];
  s.emit();
  assert.ok(s.content.contains(disclosure));
  assert.equal(disclosure.open, true);
  assert.equal(ownerDocument.activeElement, summary);
  assert.deepEqual(
    disclosure
      .all()
      .filter((el) => el.tag === "li")
      .map((el) => el.text),
    publish.aastexHeadingProblems,
  );
  publish.aastexHeadingProblems = [];
  s.emit();
  assert.ok(!s.content.contains(disclosure));
  s.modal.onClose();
});

test("alerts keep their nodes when unchanged and change text in place", () => {
  const s = setup();
  const alerts = () =>
    s.content.all().filter((el) => el.attrs.get("role") === "alert");
  const initial = alerts();
  assert.equal(initial.length, 3, "Package, academic and save-error alerts");
  const same = () =>
    alerts().length === initial.length &&
    alerts().every((el, index) => el === initial[index]);
  s.publish.aastexPackageProblem = "Synthetic package problem.";
  s.publish.publishingIssues = [
    {
      target: "general",
      message: "Synthetic academic problem.",
      blocking: true,
    },
  ];
  s.emit();
  assert.ok(same(), "Messages reuse the persistent alerts");
  const texts = () =>
    alerts()
      .filter((el) => !el.hidden)
      .map((el) => el.text);
  assert.deepEqual(texts(), [
    "Required: Synthetic academic problem.",
    "Synthetic package problem.",
  ]);
  const approve = s.content
    .all()
    .find((el) => el.text === "Use installed version")!;
  s.emit();
  s.emit();
  assert.ok(same());
  assert.ok(s.content.contains(approve), "The approve button is not rebuilt");
  s.publish.aastexPackageProblem = "Synthetic package update.";
  s.publish.publishingIssues = [];
  s.emit();
  assert.ok(same());
  assert.deepEqual(texts(), ["Synthetic package update."]);
  assert.ok(s.content.contains(approve));
  s.publish.aastexPackageProblem = "";
  s.emit();
  assert.deepEqual(texts(), []);
  assert.ok(!s.content.contains(approve));
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
    .find((el) => el.text.startsWith("Required: Synthetic title"))!;
  assert.equal(alert.attrs.get("role"), "alert");
  assert.equal(
    alert.text,
    "Required: Synthetic title problem.\nRequired: Synthetic author problem.",
  );
  assert.ok(
    s.content.all().some((el) => el.text === "Guidance: Synthetic guidance."),
  );
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
    .find((el) => el.text === "Guidance: Synthetic guidance.")!;
  const writes = saving.textWrites;
  s.emit();
  s.emit();
  assert.equal(saving.textWrites, writes);
  assert.ok(s.content.all().includes(guidance));
  s.publish.preferencesSaving = false;
  s.emit();
  s.toggles[0].listeners.get("click")!();
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

test("AASTeX opens saved non-default switches and keeps pending values without autosaving", async () => {
  const s = setup({ numberedHeadings: true, showLineNumbers: false });
  assert.equal(s.toggles[0].querySelector()!.checked, false);
  assert.equal(s.toggles[2].querySelector()!.checked, true);
  assert.equal(s.saves(), 0);
  s.toggles[0].listeners.get("click")!();
  s.emit();
  assert.equal(s.publish.aastexPdfOptions.showLineNumbers, false);
  assert.equal(
    s.toggles[0].querySelector()!.checked,
    true,
    "pending value wins over saved value",
  );
  assert.equal(s.saves(), 1, "refresh never calls the update method");
  s.release();
  await settle();
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
