import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { ButtonComponentMock } from "./ui-component-mocks";

const focus: { active: Element | null } = { active: null };

class Element {
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  className = "";
  text = "";
  type = "";
  disabled = false;
  constructor(public tag = "div") {}
  private append(tag: string, options?: { text?: string; cls?: string }) {
    const child = new Element(tag);
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
  addClass(...classes: string[]) {
    this.className = [this.className, ...classes].filter(Boolean).join(" ");
  }
  hasClass(cls: string) {
    return this.className.split(" ").includes(cls);
  }
  setText(text: string) {
    this.text = text;
  }
  setAttribute() {}
  empty() {
    this.children = [];
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  click() {
    if (!this.disabled) this.listeners.get("click")?.();
  }
  focus() {
    focus.active = this;
  }
}

class HostModal {
  modalEl = new Element();
  contentEl = new Element();
  title = "";
  closed = 0;
  constructor(_app: unknown) {}
  setTitle(title: string) {
    this.title = title;
  }
  onOpen() {}
  onClose() {}
  open() {
    this.onOpen();
  }
  close() {
    this.closed++;
    this.onClose();
  }
}

const { ConfirmModal } = loadRuntime<typeof import("../ui-modal")>(
  "ui-modal.ts",
  {
    Modal: HostModal,
    ButtonComponent: ButtonComponentMock,
  },
);
type Options = ConstructorParameters<typeof ConfirmModal>[1];

const settle = async () => {
  for (let tick = 0; tick < 5; tick++)
    await new Promise((resolve) => setImmediate(resolve));
};

function open(options: Partial<Options> = {}) {
  focus.active = null;
  const modal = new ConfirmModal({} as never, {
    title: "Delete synthetic item?",
    message: ["Synthetic item.md", "This removes the synthetic item."],
    confirmLabel: "Delete item",
    confirm: () => {},
    ...options,
  });
  modal.open();
  const host = modal as unknown as HostModal;
  const content = host.contentEl;
  const footer = content.children.at(-1)!;
  const [cancel, accept] = footer.children;
  return { host, content, footer, cancel, accept };
}

test("confirm dialog renders its message above a native footer with Cancel focused", () => {
  const { host, content, footer, cancel, accept } = open({ warning: true });
  assert.equal(host.title, "Delete synthetic item?");
  assert.ok(host.modalEl.hasClass("stratum-modal"));
  assert.deepEqual(
    content.children.slice(0, -1).map((child) => [child.tag, child.text]),
    [
      ["p", "Synthetic item.md"],
      ["p", "This removes the synthetic item."],
    ],
  );
  assert.equal(footer.className, "modal-button-container");
  assert.deepEqual(
    footer.children.map((button) => [button.tag, button.type, button.text]),
    [
      ["button", "button", "Cancel"],
      ["button", "button", "Delete item"],
    ],
  );
  assert.ok(accept.hasClass("mod-warning"));
  assert.ok(!accept.hasClass("mod-cta"));
  assert.equal(focus.active, cancel);
});

test("confirm dialog uses the primary style without a warning", () => {
  const { accept } = open();
  assert.ok(accept.hasClass("mod-cta"));
  assert.ok(!accept.hasClass("mod-warning"));
});

test("Cancel closes without confirming", () => {
  let confirmed = 0;
  const { host, content, cancel } = open({ confirm: () => void confirmed++ });
  cancel.click();
  assert.equal(confirmed, 0);
  assert.equal(host.closed, 1);
  assert.equal(content.children.length, 0);
});

test("confirm disables its button while running and closes once it resolves", async () => {
  let calls = 0;
  let finish!: () => void;
  const { host, content, accept } = open({
    confirm: () => {
      calls++;
      return new Promise<void>((resolve) => (finish = resolve));
    },
  });
  accept.click();
  await settle();
  assert.equal(accept.disabled, true);
  accept.listeners.get("click")!();
  await settle();
  assert.equal(calls, 1, "A second click does not repeat the action");
  assert.equal(host.closed, 0);
  finish();
  await settle();
  assert.equal(host.closed, 1);
  assert.equal(content.children.length, 0, "Closing empties the content");
});

test("a failed confirm reports its error and stays open for a retry", async () => {
  const failure = new Error("Synthetic failure");
  const errors: unknown[] = [];
  let calls = 0;
  const { host, accept } = open({
    confirm: () => {
      calls++;
      return calls === 1 ? Promise.reject(failure) : Promise.resolve();
    },
    onError: (error) => errors.push(error),
  });
  accept.click();
  await settle();
  assert.deepEqual(errors, [failure]);
  assert.equal(accept.disabled, false);
  assert.equal(
    focus.active,
    accept,
    "Failed confirm can be retried by keyboard",
  );
  assert.equal(host.closed, 0);
  accept.click();
  await settle();
  assert.equal(calls, 2);
  assert.equal(host.closed, 1);
});
