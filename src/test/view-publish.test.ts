import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

class Element {
  children: Element[] = [];
  text = "";
  value = "";
  hidden = false;
  disabled = false;
  cls = "";
  listeners = new Map<string, () => void>();
  constructor(public tag = "div") {}
  private append(
    tag: string,
    options?: { text?: string; value?: string; cls?: string },
  ) {
    const child = new Element(tag);
    Object.assign(child, options);
    this.children.push(child);
    return child;
  }
  createEl(
    tag: string,
    options?: { text?: string; value?: string; cls?: string },
  ) {
    return this.append(tag, options);
  }
  createDiv(options?: { text?: string; cls?: string }) {
    return this.append("div", options);
  }
  empty() {
    this.children = [];
  }
  setText(text: string) {
    this.text = text;
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

function setup() {
  const root = new Element();
  const settingsCalls: string[] = [];
  let update!: () => void;
  const publish = {
    plugin: {
      manifest: { id: "stratum" },
      app: {
        setting: {
          open: () => settingsCalls.push("open"),
          openTabById: (id: string) => settingsCalls.push(id),
        },
      },
    },
    selectedFormat: "",
    readiness: { word: true, pdf: true },
    document: { basename: "Synthetic note title" },
    documents: [],
    busy: false,
    checking: false,
    progress: "",
    error: "",
    subscribe(callback: () => void) {
      update = callback;
      return () => {};
    },
    canCreate() {
      return !!this.selectedFormat && !this.busy;
    },
  };
  const { PublishPanel } = loadRuntime<typeof import("../view-publish")>(
    "view-publish.ts",
    {
      Component: class {
        register() {}
      },
      Modal: class {},
      setIcon() {},
    },
  );
  new PublishPanel(root as never, publish as never).onload();
  return { root, publish, settingsCalls, update: () => update() };
}

test("ready publishing hides setup and status, and reflects a completed export's reset", () => {
  const { root, publish, update } = setup();
  const selects = root.all().filter((el) => el.tag === "select");
  assert.equal(selects.length, 1);
  assert.equal(selects[0].value, "");
  assert.ok(selects[0].children.some((el) => el.text === "Choose file type"));
  assert.ok(!root.all().some((el) => el.text === "Synthetic note title"));
  assert.equal(
    root.all().find((el) => el.text === "Set up in settings")!.hidden,
    true,
  );
  assert.equal(
    root.all().find((el) => el.cls === "stratum-publish-status")!.hidden,
    true,
  );
  selects[0].value = "pdf";
  selects[0].listeners.get("change")!();
  assert.equal(publish.selectedFormat, "pdf");
  assert.ok(root.all().some((el) => el.text === "Create PDF Doc"));
  update();
  assert.equal(
    selects[0].value,
    "pdf",
    "ordinary updates preserve the selection",
  );
  publish.selectedFormat = "";
  update();
  assert.equal(selects[0].value, "");
  assert.equal(
    root.all().find((el) => el.text === "Create document")!.disabled,
    true,
  );
});

test("incomplete setup opens plugin settings; progress and errors remain visible", () => {
  const { root, publish, settingsCalls, update } = setup();
  publish.readiness.pdf = false;
  update();
  const button = root.all().find((el) => el.text === "Set up in settings")!;
  assert.equal(button.hidden, false);
  button.listeners.get("click")!();
  assert.deepEqual(settingsCalls, ["open", "stratum"]);
  publish.checking = true;
  update();
  assert.equal(button.hidden, true);
  assert.ok(root.all().some((el) => el.text === "Checking publishing tools…"));
  publish.checking = false;
  publish.readiness.pdf = true;
  publish.error = "Synthetic conversion failure";
  update();
  assert.equal(button.hidden, true);
  assert.equal(
    root.all().find((el) => el.cls === "stratum-publish-status")!.hidden,
    false,
  );
  assert.ok(root.all().some((el) => el.text === publish.error));
});
