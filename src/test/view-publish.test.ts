import {
  ButtonComponentMock,
  DropdownComponentMock,
} from "./ui-component-mocks";
import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { readNotePreferences } from "../publish-options";
import { readPublishingTemplates } from "../publish-templates";
import { AASTEX_TEMPLATE } from "../publication-package";
import type { PublishedDocument } from "../publish-model";

class Element {
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
  querySelectorAll() {
    return [];
  }
  focused = false;
  focus() {
    this.focused = true;
  }
  scrollIntoView() {}
}

function setup() {
  const root = new Element();
  const settingsCalls: string[] = [];
  const focusedFonts: string[] = [];
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
    get publishingTemplates() {
      const stored = readPublishingTemplates(undefined);
      return { ...stored, templates: [...stored.templates, AASTEX_TEMPLATE] };
    },
    notePreferences: readNotePreferences({ templateId: "general" }),
    get layout() {
      return this.notePreferences[
        this.selectedFormat === "pdf" ? "pdf" : "docx"
      ];
    },
    academicInfo: { title: "", duplicateTitle: false, bothAuthors: false },
    academicProblem: "",
    duplicateTitleWarning: false,
    preferencesSaving: false,
    propertiesMissing: false,
    prepareAcademic: () => Promise.resolve(),
    citationStyleChoices: () => Promise.resolve(null),
    updatePreferences: () => Promise.resolve(),
    selectFormat(value: string) {
      this.selectedFormat = value;
      return Promise.resolve();
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
    fontError: null as { fonts: string[] } | null,
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
      setTooltip() {},
    },
    {},
    "browser",
    {
      "./publish-customize": {
        renderPublishCustomization: () => (key: string) =>
          focusedFonts.push(key),
      },
    },
  );
  new PublishPanel(root as never, publish as never).onload();
  return { root, publish, settingsCalls, focusedFonts, update: () => update() };
}

test("missing PDF fonts offer recovery in note customization and focus the affected selector", () => {
  const { root, publish, focusedFonts, update } = setup();
  publish.selectedFormat = "pdf";
  publish.notePreferences.pdf.bodyFont = "Missing body";
  publish.fontError = { fonts: ["Missing body", "Missing title"] };
  publish.error = "Missing fonts. Choose another font to publish this PDF.";
  update();
  const choose = root.all().find((el) => el.text === "Choose font")!;
  assert.equal(choose.disabled, false);
  choose.listeners.get("click")!();
  assert.deepEqual(focusedFonts, ["bodyFont"]);
  assert.equal(
    root
      .all()
      .find(
        (el) =>
          el.tag === "details" &&
          el.all().some((child) => child.text === "Customize…"),
      )!.open,
    true,
  );
  publish.fontError = { fonts: ["Missing title"] };
  update();
  root
    .all()
    .find((el) => el.text === "Choose font")!
    .listeners.get("click")!();
  assert.deepEqual(focusedFonts, ["bodyFont", "titleFont"]);
});

test("ready publishing hides setup and status, and reflects a completed export's reset", () => {
  const { root, publish, update } = setup();
  const selects = root.all().filter((el) => el.tag === "select");
  assert.equal(selects.length, 4);
  assert.equal(selects[2].value, "");
  assert.ok(selects[2].children.some((el) => el.text === "Choose file type"));
  assert.ok(!root.all().some((el) => el.text === "Synthetic note title"));
  assert.equal(
    root.all().find((el) => el.text === "Set up in settings")!.hidden,
    true,
  );
  assert.equal(
    root.all().find((el) => el.cls === "stratum-publish-status")!.hidden,
    true,
  );
  selects[2].value = "pdf";
  selects[2].listeners.get("change")!();
  assert.equal(publish.selectedFormat, "pdf");
  assert.ok(root.all().some((el) => el.text === "Create PDF document"));
  update();
  assert.equal(
    selects[2].value,
    "pdf",
    "ordinary updates preserve the selection",
  );
  publish.selectedFormat = "";
  update();
  assert.equal(selects[2].value, "");
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
      .some((el) =>
        el.text.includes("There was an error creating the PDF file"),
      ),
  );
  assert.ok(root.all().some((el) => el.text.includes(publish.error)));
  publish.errorMessage = "There was an error with publishing";
  update();
  assert.ok(root.all().some((el) => el.text.startsWith(publish.errorMessage)));
  assert.ok(
    !root
      .all()
      .some((el) =>
        el.text.includes("There was an error creating the PDF file"),
      ),
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
    const scope = root.all().filter((el) => el.tag === "select")[3];
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
  const scope = root.all().filter((el) => el.tag === "select")[3];
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

test("academic setup keeps history accessible and opens defaults through the gear", () => {
  const { root, publish, update, settingsCalls } = setup();
  publish.notePreferences.documentType = "academic";
  publish.notePreferences.templateId = "academic";
  publish.notePreferences.docx.titleSource = "properties";
  publish.propertiesMissing = true;
  publish.academicProblem = "Add a nonempty title property.";
  update();
  assert.equal(
    root.all().find((el) => el.text === "Add publishing properties")!.hidden,
    false,
  );
  assert.equal(
    root.all().find((el) => el.text === "Create document")!.hidden,
    false,
  );
  assert.equal(
    root.all().find((el) => el.cls === "stratum-publish-history")!.hidden,
    false,
  );
  const gear = root
    .all()
    .find((el) => el.cls.split(" ").includes("clickable-icon"))!;
  gear.listeners.get("click")!();
  assert.deepEqual(settingsCalls, ["open", "stratum"]);
  publish.academicInfo.title = "Synthetic paper";
  publish.propertiesMissing = false;
  publish.academicProblem = "";
  update();
  assert.equal(
    root.all().find((el) => el.text === "Add publishing properties")!.hidden,
    true,
  );
  assert.equal(
    root.all().find((el) => el.text === "Create document")!.hidden,
    false,
  );
  assert.equal(gear.hidden, false);
});

test("a note chooses from all templates without a document type selector", () => {
  const { root, publish, update } = setup();
  publish.notePreferences.templateId = undefined;
  update();
  const select = root.all().filter((el) => el.tag === "select")[0];
  assert.equal(select.value, "");
  assert.deepEqual(
    select.children.map((el) => el.text),
    ["Choose template", "General documents", "Academic papers", "AASTeX"],
  );
  assert.equal(
    root.all().find((el) => el.text === "Create document")!.hidden,
    true,
  );
});

test("repeated titles warn without blocking and review the opening choices", () => {
  const { root, publish, focusedFonts, update } = setup();
  publish.notePreferences = readNotePreferences({ templateId: "academic" });
  publish.notePreferences.docx.titleSource = "properties";
  publish.notePreferences.pdf.titleSource = "properties";
  publish.academicInfo = {
    title: "Synthetic title",
    duplicateTitle: true,
    bothAuthors: false,
  };
  publish.duplicateTitleWarning = true;
  publish.selectedFormat = "pdf";
  update();
  const warning = root
    .all()
    .find((el) => el.text === "Title may appear twice.")!;
  assert.equal(
    root.all().find((el) => el.children.includes(warning))!.hidden,
    false,
  );
  const create = root.all().find((el) => el.text === "Create PDF document")!;
  assert.equal(create.disabled, false);
  const review = () =>
    root
      .all()
      .find((el) => el.text === "Review opening")!
      .listeners.get("click")!();
  review();
  assert.deepEqual(focusedFonts, ["opening"]);
  assert.equal(
    root
      .all()
      .find(
        (el) =>
          el.tag === "details" &&
          el.all().some((child) => child.text === "Customize…"),
      )!.open,
    true,
  );
  // Before a file type is chosen, the panel's title choice is the opening control.
  publish.selectedFormat = "";
  update();
  review();
  const titleBlock = root
    .all()
    .find(
      (el) =>
        el.tag === "select" &&
        el.children.some((option) => option.text === "Use title from body"),
    )!;
  assert.equal(titleBlock.focused, true);
  publish.duplicateTitleWarning = false;
  update();
  assert.equal(
    root.all().find((el) => el.children.includes(warning))!.hidden,
    true,
  );
});

test("Reset defaults re-applies the note's template and follows Customize visibility", () => {
  const { root, publish, update } = setup();
  const calls: unknown[] = [];
  (
    publish as { updatePreferences: (patch: unknown) => Promise<void> }
  ).updatePreferences = (patch) => {
    calls.push(patch);
    return Promise.resolve();
  };
  const reset = () => root.all().find((el) => el.text === "Reset defaults")!;
  update();
  assert.equal(reset().hidden, true, "Hidden until a format is chosen");
  publish.selectedFormat = "pdf";
  update();
  assert.equal(reset().hidden, false);
  reset().listeners.get("click")!();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { templateId: "general" },
  ]);
});
