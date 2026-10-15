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
  toggleClass(cls: string, value: boolean) {
    const classes = this.cls.split(" ").filter((name) => name && name !== cls);
    this.cls = (value ? [...classes, cls] : classes).join(" ");
  }
  setCssProps() {}
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
  remove() {}
}

function setup(state?: import("../view-publish").PublishViewState) {
  const root = new Element();
  const settingsCalls: string[] = [];
  const launchers: unknown[] = [];
  const updates: (() => void)[] = [];
  const publish = {
    plugin: { manifest: { id: "stratum" }, app: {} },
    openSettings(launcher: unknown) {
      settingsCalls.push("open");
      launchers.push(launcher);
      return Promise.resolve(undefined);
    },
    closeSettings() {
      settingsCalls.push("close");
    },
    adoptSettingsLauncher(launcher: unknown) {
      settingsCalls.push("adopt");
      launchers.push(launcher);
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
  );
  const panel = new PublishPanel(root as never, publish as never, state);
  panel.onload();
  return {
    root,
    panel,
    publish,
    settingsCalls,
    launchers,
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
    ["Choose template", "General documents", "Academic papers", "AASTeX"],
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
  assert.deepEqual(settingsCalls, ["adopt", "open", "open", "open"]);
  publish.busy = true;
  update();
  assert.equal(root.all().find((el) => el.text === "Settings")!.disabled, true);
  assert.equal(
    root.all().find((el) => el.text === "Create PDF document")!.disabled,
    true,
  );
});

test("the controller owns the settings window across template changes and panel remounts", () => {
  const state: import("../view-publish").PublishViewState = {
    section: "publish",
    documents: {},
  };
  const first = setup(state);
  const settings = first.root.all().find((el) => el.text === "Settings")!;
  assert.deepEqual(first.launchers, [settings], "the panel offers its button");
  settings.listeners.get("click")!();
  assert.deepEqual(first.launchers, [settings, settings]);
  first.settingsCalls.length = 0;
  const [template, version] = first.root
    .all()
    .filter((el) => el.tag === "select");
  template.value = "academic";
  template.listeners.get("change")!();
  first.publish.notePreferences.templateId = "general";
  version.value = "academic";
  version.listeners.get("change")!();
  assert.deepEqual(first.settingsCalls, ["close", "close"]);
  first.settingsCalls.length = 0;
  first.panel.onunload();
  assert.deepEqual(
    first.settingsCalls,
    [],
    "a sidebar re-render leaves the window open",
  );
  const second = setup(state);
  assert.deepEqual(second.launchers, [
    second.root.all().find((el) => el.text === "Settings"),
  ]);
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
    status
      .all()
      .some((el) => el.text.includes("Settings: Review PDF tool setup")),
  );
});

test("unchanged publishing errors retain their element and scroll position across updates", () => {
  const { root, publish, update } = setup();
  publish.error = "Synthetic conversion failure";
  publish.errorMessage = "Could not create PDF";
  update();
  const error = root.all().find((el) => el.cls === "stratum-publish-error")!;
  error.scrollTop = 80;
  update();
  assert.equal(
    root.all().find((el) => el.cls === "stratum-publish-error"),
    error,
  );
  assert.equal(error.scrollTop, 80);
  publish.error = "Another conversion failure";
  update();
  assert.ok(!root.all().includes(error));
  assert.match(
    root.all().find((el) => el.cls === "stratum-publish-error")!.text,
    /Another conversion failure/,
  );
  publish.error = "";
  update();
  assert.ok(!root.all().some((el) => el.cls === "stratum-publish-error"));
});

test("a font error opens Settings with Choose font as its launcher", () => {
  const { root, publish, settingsCalls, launchers, update } = setup();
  const status = root.all().find((el) => el.cls === "stratum-publish-status")!;
  const choose = status.all().find((el) => el.text === "Choose font")!;
  assert.equal(choose.hidden, true);
  publish.error =
    "“Missing Synthetic Serif” isn’t available on this computer. Choose another font to publish this PDF.";
  publish.fontError = { fonts: ["Missing Synthetic Serif"] };
  update();
  assert.equal(status.hidden, false);
  assert.equal(choose.hidden, false);
  assert.equal(choose.disabled, false);
  settingsCalls.length = 0;
  launchers.length = 0;
  choose.listeners.get("click")!();
  assert.deepEqual(settingsCalls, ["open"]);
  assert.deepEqual(
    launchers,
    [choose],
    "focus returns to the Choose font launcher",
  );
  publish.busy = true;
  update();
  assert.equal(choose.disabled, true);
  publish.busy = false;
  publish.error = "Synthetic unrelated failure";
  publish.fontError = null;
  update();
  assert.equal(choose.hidden, true);
});

test("controller updates keep template and version options until their choices change", () => {
  const { root, publish, update } = setup();
  const select = (label: string) =>
    root
      .all()
      .find(
        (el) => el.tag === "select" && el.attrs.get("aria-label") === label,
      )!;
  const template = select("Choose template");
  const version = select("Choose template version");
  publish.notePreferences.templateId = "package:aastex";
  update();
  const templateOptions = [...template.children];
  const versionOptions = [...version.children];
  assert.equal(template.value, "package:aastex");
  assert.deepEqual(
    versionOptions.map((option) => option.value),
    ["package:aastex"],
  );
  update();
  update();
  assert.ok(
    template.children.every(
      (option, index) => option === templateOptions[index],
    ),
    "unchanged template families keep their option elements",
  );
  assert.ok(
    version.children.every((option, index) => option === versionOptions[index]),
    "unchanged versions keep their option elements",
  );
  const older = {
    ...AASTEX_TEMPLATE,
    id: "package:aastex-synthetic-older",
    version: { familyId: "package:aastex", label: "Synthetic older" },
  };
  Object.defineProperty(publish, "publishingTemplates", {
    get() {
      const stored = readPublishingTemplates(undefined);
      return {
        ...stored,
        templates: [...stored.templates, AASTEX_TEMPLATE, older],
      };
    },
  });
  update();
  assert.equal(template.children[3], templateOptions[3]);
  assert.deepEqual(
    version.children.map((option) => option.text),
    [AASTEX_TEMPLATE.version!.label, "Synthetic older"],
  );
  assert.equal(version.value, "package:aastex");
  publish.notePreferences.templateId = "general";
  update();
  assert.equal(template.value, "general");
  assert.deepEqual(
    version.children.map((option) => option.value),
    ["general"],
  );
});

test("Documents keeps unchanged rows and rebuilds when visible document details change", () => {
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
  update();
  const list = root.all().find((el) => el.cls === "stratum-publish-list")!;
  const row = list.children[0];
  list.scrollTop = 120;
  const actions = () =>
    list.children[0].children.find(
      (el) => el.cls === "stratum-publish-row-actions",
    )!.children;
  const save = actions()[2];
  Object.assign(publish, { saveCopy: () => new Promise(() => {}) });
  save.listeners.get("click")!();
  assert.equal(save.disabled, true);
  publish.documents = [{ ...document }];
  update();
  update();
  assert.equal(list.children[0], row, "unchanged rows are not rebuilt");
  assert.equal(list.scrollTop, 120);
  assert.equal(save.disabled, true, "an action in progress stays disabled");
  assert.equal(actions()[1].disabled, true);
  publish.sourceNote = (() => ({ path: "Synthetic.md" })) as never;
  update();
  assert.notEqual(list.children[0], row);
  assert.equal(
    actions()[1].disabled,
    false,
    "source availability updates the source action",
  );
  assert.equal(list.scrollTop, 120, "a rebuild restores the scroll position");
  const available = list.children[0];
  publish.documents = [{ ...document, filename: "Synthetic renamed.pdf" }];
  update();
  assert.notEqual(list.children[0], available);
  assert.ok(
    list.all().some((el) => el.text === "Synthetic renamed.pdf"),
    "a changed filename rebuilds the row",
  );
});

test("template manager gear shares only the Template column and leaves Version separate", () => {
  const { root } = setup();
  const selectors = root
    .all()
    .find((el) => el.cls === "stratum-publish-template-selectors")!;
  assert.equal(selectors.children.length, 2);
  const first = selectors.children[0].all();
  assert.ok(
    first.some((el) => el.attrs.get("aria-label") === "Choose template"),
  );
  assert.ok(
    first.some(
      (el) => el.attrs.get("aria-label") === "Manage publishing templates",
    ),
  );
  assert.ok(
    !first.some(
      (el) => el.attrs.get("aria-label") === "Choose template version",
    ),
  );
  assert.ok(
    selectors.children[1]
      .all()
      .some((el) => el.attrs.get("aria-label") === "Choose template version"),
  );
});
