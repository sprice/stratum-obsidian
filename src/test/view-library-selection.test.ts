import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { ButtonComponentMock } from "./ui-component-mocks";

class Element {
  children: Element[] = [];
  text = "";
  cls = "";
  disabled = false;
  open = false;
  isConnected = true;
  attrs: Record<string, string> = {};
  href = "";
  listeners = new Map<string, () => void>();
  constructor(public tag = "div") {}
  createEl(tag: string, options = {}) {
    const child = Object.assign(new Element(tag), options);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) {
    const child = Object.assign(new Element("div"), options);
    this.children.push(child);
    return child;
  }
  setText(text: string) {
    this.text = text;
  }
  addClass(cls: string) {
    this.cls += ` ${cls}`;
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}
function setup(existing = false) {
  const library = { type: "group", id: "7", identity: "group:7" };
  const file = { path: "Papers/Synthetic source.md" };
  const opened: unknown[] = [];
  const identities: unknown[] = [];
  let created = 0;
  const plugin = {
    selectedLibraryResult: {
      key: "ITEMKEY",
      title: "Synthetic source",
      creators: ["A. Author"],
      year: "2024",
      itemType: "journalArticle",
      doi: "10.1234/example",
      abstract: "A full synthetic abstract.",
    },
    selectedLibraryNoteFile: existing ? file : null,
    isSelectedLibraryAbstractExpanded: false,
    activeNoteActionKey: null as string | null,
    libraryNoteActionError: null as {
      key: string;
      libraryIdentity: string;
      message: string;
    } | null,
    isBulkLibrarySyncRunning: () => false,
    findExistingLiteratureNoteFile(identity: unknown) {
      identities.push(identity);
      return file;
    },
    app: {
      workspace: {
        getLeaf: () => ({
          openFile: (value: unknown) => {
            opened.push(value);
            return Promise.resolve();
          },
        }),
      },
    },
    library: {
      createNote: () => {
        created++;
        return Promise.resolve();
      },
    },
    refreshViews() {},
  };
  const runtime = loadRuntime<typeof import("../view-library-selection")>(
    "view-library-selection.ts",
    { ButtonComponent: ButtonComponentMock },
    {},
    "node",
    { "./plugin-libraries": { getSelectedSearchLibrary: () => library } },
  );
  const render = () => {
    const root = new Element();
    runtime.renderSelectedLibraryPaper(
      plugin as never,
      root as never,
      () => {},
    );
    return root.all();
  };
  return { plugin, render, opened, identities, created: () => created };
}
test("new selection exposes creation before a collapsed full abstract", () => {
  const fixture = setup();
  const elements = fixture.render();
  const create = elements.find((el) => el.text === "Create literature note")!;
  const details = elements.find((el) => el.tag === "details")!;
  assert.ok(elements.indexOf(create) < elements.indexOf(details));
  assert.equal(details.open, false);
  assert.ok(
    elements.some((el) => el.text === "A. Author · 2024 · Journal article"),
  );
  create.listeners.get("click")!();
  assert.equal(fixture.created(), 1);
  details.open = true;
  details.listeners.get("toggle")!();
  assert.equal(fixture.plugin.isSelectedLibraryAbstractExpanded, true);
  assert.equal(fixture.render().find((el) => el.tag === "details")!.open, true);
});
test("existing note offers update and opens the identity-matched source", async () => {
  const fixture = setup(true);
  const elements = fixture.render();
  assert.ok(elements.some((el) => el.text === "Update literature note"));
  assert.ok(
    elements.some((el) => el.text === "Your own writing is preserved."),
  );
  elements.find((el) => el.text === "Open note")!.listeners.get("click")!();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.identities)), [
    { libraryType: "group", libraryId: "7", itemKey: "ITEMKEY" },
  ]);
  assert.equal(fixture.opened.length, 1);
});
test("busy actions are disabled and errors stay scoped to the selected library and item", () => {
  const fixture = setup();
  fixture.plugin.activeNoteActionKey = "ITEMKEY";
  let elements = fixture.render();
  assert.equal(
    elements.find((el) => el.text === "Creating note…")!.disabled,
    true,
  );
  assert.equal(
    elements.find((el) => el.text === "Change selection")!.disabled,
    true,
  );
  fixture.plugin.activeNoteActionKey = null;
  fixture.plugin.libraryNoteActionError = {
    key: "ITEMKEY",
    libraryIdentity: "group:7",
    message: "Please try again.",
  };
  elements = fixture.render();
  assert.equal(
    elements.find((el) => el.text === "Please try again.")!.attrs.role,
    "alert",
  );
  fixture.plugin.libraryNoteActionError.libraryIdentity = "user:7";
  assert.equal(
    fixture.render().some((el) => el.text === "Please try again."),
    false,
  );
});

test("DOI suffix punctuation stays in the URL path", () => {
  const fixture = setup();
  fixture.plugin.selectedLibraryResult.doi = "10.1234/example?#part";
  const link = fixture.render().find((el) => el.tag === "a")!;
  const url = new URL(link.href);
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.equal(
    decodeURIComponent(url.pathname.slice(1)),
    "10.1234/example?#part",
  );
});
