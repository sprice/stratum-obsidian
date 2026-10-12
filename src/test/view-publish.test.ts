import {
  ButtonComponentMock,
  DropdownComponentMock,
  ToggleComponentMock,
} from "./ui-component-mocks";
import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { readNotePreferences } from "../publish-options";
import { readPublishingTemplates } from "../publish-templates";
import { AASTEX_TEMPLATE } from "../publication-package";
import type { PublishedDocument } from "../publish-model";

class Element {
  ownerDocument = { activeElement: null };
  children: Element[] = [];
  text = "";
  value = "";
  hidden = false;
  disabled = false;
  open = false;
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
  createSpan(options?: { text?: string; cls?: string }) {
    return this.append("span", options);
  }
  addClass(cls: string) {
    this.cls = [this.cls, cls].filter(Boolean).join(" ");
  }
  attrs = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
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
  querySelectorAll() {
    return [];
  }
  querySelector() {
    return this.all().find((el) => el.tag === "input") ?? null;
  }
  contains(element: Element | null) {
    return !!element && this.all().includes(element);
  }
  focused = false;
  focus() {
    this.focused = true;
  }
  scrollIntoView() {}
}

function setup(state?: import("../view-publish").PublishViewState) {
  const root = new Element();
  const settingsCalls: string[] = [];
  const focusedFonts: string[] = [];
  const updates: (() => void)[] = [];
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
    get publishingTemplates() {
      const stored = readPublishingTemplates(undefined);
      return { ...stored, templates: [...stored.templates, AASTEX_TEMPLATE] };
    },
    notePreferences: readNotePreferences({ templateId: "general" }),
    get layout() {
      return this.notePreferences.pdf;
    },
    academicInfo: { title: "", duplicateTitle: false, bothAuthors: false },
    academicProblem: "",
    duplicateTitleWarning: false,
    preferencesSaving: false,
    propertiesMissing: false,
    prepareAcademic: () => Promise.resolve(),
    citationStyleChoices: () => Promise.resolve(null),
    updatePreferences: () => Promise.resolve(),
    readiness: { pdf: true, pandoc: { path: "pandoc" } },
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
    fontError: null as { fonts: string[] } | null,
    sourceNote: () => null,
    subscribe(callback: () => void) {
      updates.push(callback);
      return () => {};
    },
    canCreate() {
      return (
        !!this.document &&
        !this.busy &&
        !this.checking &&
        !this.preferencesSaving &&
        !this.academicProblem &&
        this.readiness.pdf
      );
    },
  };
  const { PublishPanel } = loadRuntime<typeof import("../view-publish")>(
    "view-publish.ts",
    {
      ButtonComponent: ButtonComponentMock,
      DropdownComponent: DropdownComponentMock,
      ToggleComponent: ToggleComponentMock,
      Component: class {
        addChild(child: { onload(): void }) {
          child.onload();
          return child;
        }
        register() {}
      },
      Modal: class {},
      setIcon() {},
      setTooltip() {},
    },
    { crypto },
    "browser",
    {
      "./publication-options-modal": {
        PublishingSettingsModal: class {
          constructor(_app: unknown, _publish: unknown, _launcher: unknown) {
            settingsCalls.push("modal");
          }
          open() {}
          close() {}
        },
      },
      "./publish-customize": {
        renderPublishCustomization: () => (key: string) =>
          focusedFonts.push(key),
      },
    },
  );
  new PublishPanel(root as never, publish as never, state).onload();
  return {
    root,
    publish,
    settingsCalls,
    focusedFonts,
    update: () => updates.forEach((callback) => callback()),
  };
}

test("ready publishing creates PDF without a file type selector", () => {
  const { root, update } = setup();
  assert.ok(
    root.all().some((el) => el.text === "PDF documents created for your note"),
  );
  assert.ok(
    !root
      .all()
      .some(
        (el) => el.attrs.get("aria-label") === "Choose file type to publish",
      ),
  );
  assert.equal(
    root.all().find((el) => el.text === "Create PDF document")!.disabled,
    false,
  );
  update();
  assert.equal(
    root.all().find((el) => el.text === "Create PDF document")!.disabled,
    false,
  );
});

test("history scope switches documents and survives controller updates", () => {
  const { root, publish, update } = setup();
  root
    .all()
    .find((el) => el.text === "Documents")!
    .listeners.get("click")!();
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
  const scope = root
    .all()
    .find((el) => el.text === "Show")!
    .children.find((el) => el.tag === "select")!;
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

test("a note chooses from all templates without a document type selector", () => {
  const { root, publish, update } = setup();
  publish.notePreferences.templateId = undefined;
  update();
  const select = root.all().filter((el) => el.tag === "select")[0];
  assert.equal(select.value, "");
  assert.deepEqual(
    select.children.map((el) => el.text),
    [
      "Choose template",
      "General documents",
      "Academic papers",
      "AASTeX · 7.0.2",
    ],
  );
  assert.equal(
    root.all().find((el) => el.text === "Create PDF document")!.hidden,
    true,
  );
});

test("secondary selection and Documents state survive panel remounts", () => {
  const state: import("../view-publish").PublishViewState = {
    section: "publish",
    documents: { scope: "all" },
  };
  const first = setup(state);
  const documents = first.root.all().find((el) => el.text === "Documents")!;
  documents.listeners.get("click")!();
  assert.equal(state.section, "documents");
  assert.equal(
    first.root.all().find((el) => el.cls === "stratum-publish-panel")!.hidden,
    true,
  );
  assert.equal(documents.attrs.get("aria-selected"), "true");
  const list = first.root
    .all()
    .find((el) => el.cls === "stratum-publish-list")!;
  list.scrollTop = 240;
  first.root
    .all()
    .find((el) => el.text === "Create")!
    .listeners.get("click")!();
  first.update();
  documents.listeners.get("click")!();
  assert.equal(list.scrollTop, 240);
  const second = setup(state);
  assert.equal(
    second.root
      .all()
      .find((el) => el.text === "Documents")!
      .attrs.get("aria-selected"),
    "true",
  );
  assert.equal(
    second.root
      .all()
      .find((el) => el.text === "Show")!
      .children.find((el) => el.tag === "select")!.value,
    "all",
  );
  second.update();
  assert.ok(second.root.all().some((el) => el.text === "Create PDF document"));
  assert.ok(
    !second.root.all().some((el) => el.tag === "option" && el.value === "docx"),
  );
});

test("Documents hides legacy Word entries without mutating history", () => {
  const { root, publish, update } = setup();
  publish.documents = ["pdf", "docx"].map((format) => ({
    id: format,
    noteId: "synthetic",
    filename: `Synthetic.${format}`,
    format,
    createdAt: "2026-10-11T12:00:00Z",
    citationStyle: "apa",
    citationLanguage: "en-US",
  })) as PublishedDocument[];
  update();
  const actions = root
    .all()
    .filter((el) => el.cls === "stratum-publish-row-actions");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].children.length, 4);
  assert.ok(!root.all().some((el) => el.text === "Synthetic.docx"));
  assert.equal(publish.documents.length, 2);
});

test("one note Settings entry replaces scattered controls for all three templates", () => {
  const { root, publish, settingsCalls, update } = setup();
  for (const templateId of ["general", "academic", "package:aastex"]) {
    publish.notePreferences.templateId = templateId;
    update();
    const controls = root
      .all()
      .find((el) => el.cls === "stratum-publish-controls")!;
    assert.deepEqual(
      controls.children.map((el) => el.text),
      ["Settings", "Create PDF document"],
    );
    assert.ok(
      !root
        .all()
        .some((el) =>
          [
            "Customize…",
            "Reset defaults",
            "Add publishing properties",
            "Edit publication details",
            "Title block",
            "Citation style",
          ].includes(el.text),
        ),
    );
    controls.children[0].listeners.get("click")!();
  }
  assert.deepEqual(settingsCalls, ["modal", "modal", "modal"]);
  publish.busy = true;
  update();
  assert.equal(root.all().find((el) => el.text === "Settings")!.disabled, true);
  assert.equal(
    root.all().find((el) => el.text === "Create PDF document")!.disabled,
    true,
  );
});

test("Create status is hidden when ready and exposes only actionable requirements or failures", () => {
  const { root, publish, update } = setup();
  const status = root.all().find((el) => el.cls === "stratum-publish-status")!;
  assert.equal(status.hidden, true);
  publish.academicProblem =
    "Add a manuscript title using the selected title source.";
  update();
  assert.equal(status.hidden, false);
  assert.equal(
    root.all().find((el) => el.text === "Create PDF document")!.disabled,
    true,
  );
  publish.academicProblem = "";
  publish.readiness.pdf = false;
  update();
  assert.ok(
    status.all().some((el) => el.text.includes("PDF tools need setup")),
  );
});
