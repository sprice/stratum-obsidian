import {
  ButtonComponentMock,
  DropdownComponentMock,
} from "./ui-component-mocks";
import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import type { PublishedDocument } from "../publish-model";

class Element {
  children: Element[] = [];
  text = "";
  value = "";
  hidden = false;
  disabled = false;
  scrollTop = 0;
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
  addClass(cls: string) {
    this.cls = [this.cls, cls].filter(Boolean).join(" ");
  }
  setAttribute() {}
  empty() {
    this.children = [];
    this.scrollTop = 0;
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
    document: { basename: "Synthetic note title", extension: "md" } as {
      basename: string;
      extension: string;
    } | null,
    historyScope: "note",
    documents: [] as PublishedDocument[],
    allDocuments: [] as PublishedDocument[],
    busy: false,
    checking: false,
    progress: "",
    error: "",
    errorMessage: "",
    sourceNote: () => null,
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
      ButtonComponent: ButtonComponentMock,
      DropdownComponent: DropdownComponentMock,
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
  assert.equal(selects.length, 2);
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
  publish.errorMessage = "There was an error creating the PDF file";
  update();
  assert.equal(button.hidden, true);
  assert.equal(
    root.all().find((el) => el.cls === "stratum-publish-status")!.hidden,
    false,
  );
  assert.ok(
    root
      .all()
      .some((el) => el.text === "There was an error creating the PDF file"),
  );
  assert.ok(!root.all().some((el) => el.text === publish.error));
  publish.errorMessage = "There was an error with publishing";
  update();
  assert.ok(root.all().some((el) => el.text === publish.errorMessage));
  assert.ok(
    !root
      .all()
      .some((el) => el.text === "There was an error creating the PDF file"),
  );
});

test("creation and note history require Markdown, but all history remains accessible", () => {
  const { root, publish, update } = setup();
  const regions = [
    "stratum-publish-controls",
    "stratum-publish-history",
    "stratum-publish-list",
  ].map((cls) => root.all().find((el) => el.cls === cls)!);
  assert.ok(regions.every((el) => !el.hidden));
  assert.ok(
    root.all().some((el) => el.text === "No published documents for this note"),
  );
  for (const document of [
    null,
    { basename: "Synthetic image", extension: "png" },
  ]) {
    publish.document = document;
    update();
    assert.equal(regions[0].hidden, true);
    assert.equal(regions[1].hidden, false);
    assert.equal(regions[2].hidden, true);
    const scope = root.all().filter((el) => el.tag === "select")[1];
    scope.value = "all";
    scope.listeners.get("change")!();
    assert.equal(regions[0].hidden, true);
    assert.equal(regions[2].hidden, false);
    assert.ok(root.all().some((el) => el.text === "No published documents"));
    scope.value = "note";
    scope.listeners.get("change")!();
    assert.equal(regions[2].hidden, true);
  }
  publish.document = { basename: "Synthetic note", extension: "md" };
  update();
  assert.ok(regions.every((el) => !el.hidden));
});

test("history scope switches documents and survives controller updates", () => {
  const { root, publish, update } = setup();
  const document: PublishedDocument = {
    id: "first",
    noteId: "note-one",
    filename: "Synthetic first.pdf",
    format: "pdf",
    createdAt: "2026-10-05T12:00:00Z",
    citationStyle: "apa",
    citationLanguage: "en-US",
  };
  publish.documents = [document];
  publish.allDocuments = [
    document,
    {
      ...document,
      id: "second",
      noteId: "note-two",
      filename: "Synthetic second.pdf",
    },
  ];
  update();
  const filenames = () =>
    root
      .all()
      .filter((el) => el.cls === "stratum-publish-filename")
      .map((el) => el.text);
  assert.deepEqual(filenames(), ["Synthetic first.pdf"]);
  assert.equal(
    root.all().find((el) => el.cls === "stratum-publish-row-actions")!
      .children[1].disabled,
    true,
    "the source action is disabled when the source note is unavailable",
  );
  const scope = root.all().filter((el) => el.tag === "select")[1];
  scope.value = "all";
  scope.listeners.get("change")!();
  assert.equal(publish.historyScope, "all");
  const list = root.all().find((el) => el.cls === "stratum-publish-list")!;
  list.scrollTop = 240;
  assert.deepEqual(filenames(), [
    "Synthetic first.pdf",
    "Synthetic second.pdf",
  ]);
  publish.documents = [];
  update();
  assert.equal(scope.value, "all");
  assert.equal(
    list.scrollTop,
    240,
    "refreshes preserve the history scroll position",
  );
  assert.equal(filenames().length, 2);
  scope.value = "note";
  scope.listeners.get("change")!();
  assert.equal(
    list.scrollTop,
    0,
    "a different history scope starts at the top",
  );
  assert.deepEqual(filenames(), []);
});
