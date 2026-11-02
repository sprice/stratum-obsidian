import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { loadRuntime } from "./runtime-harness";

function setup(pending = false) {
  const properties: Record<string, unknown> = {
    course: 123,
    instructor: "Original",
  };
  const edits = new Map<string, (value: string) => void>();
  let save = () => {};
  let release!: () => void;
  const reading = pending
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  class Element {
    children: Element[] = [];
    text = "";
    createEl() {
      const e = new Element();
      this.children.push(e);
      return e;
    }
    setText(text: string) {
      this.text = text;
    }
    empty() {
      this.children = [];
    }
  }
  class Modal {
    contentEl = new Element();
    app: typeof app;
    constructor(value: typeof app) {
      this.app = value;
    }
    setTitle() {}
    close() {}
  }
  const app = {
    vault: {
      read: async () => {
        await reading;
        return JSON.stringify(properties);
      },
    },
    fileManager: {
      processFrontMatter: (
        _file: unknown,
        update: (p: Record<string, unknown>) => void,
      ) => {
        return Promise.resolve().then(() => update(properties));
      },
    },
  };
  const fields = ["course", "instructor", "deadline"].map((key) => ({
    key,
    label: key,
    type: "text",
    required: false,
    default: "",
  }));
  const { PackageFieldsModal } = loadRuntime<{
    PackageFieldsModal: new (
      ...args: unknown[]
    ) => Modal & { onOpen(): void; onClose(): void };
  }>(
    "publication-package-fields.ts",
    {
      Modal,
      Setting: class {
        name = "";
        setName(name: string) {
          this.name = name;
          return this;
        }
        setDesc() {
          return this;
        }
        addText(callback: (input: unknown) => void) {
          const input = {
            setValue: () => input,
            onChange: (edit: (value: string) => void) => {
              edits.set(this.name, edit);
              return input;
            },
          };
          callback(input);
          return this;
        }
        addButton(callback: (button: unknown) => void) {
          const button = {
            setButtonText: () => button,
            setCta: () => button,
            setDisabled: () => button,
            onClick: (click: () => void) => {
              save = click;
              return button;
            },
          };
          callback(button);
          return this;
        }
      },
    },
    {},
    "browser",
    {
      "./publication-metadata": {
        publicationYaml: (text: string) => ({
          properties: JSON.parse(text) as Record<string, unknown>,
        }),
      },
      "./publication-package": { packageVariant: () => ({ fields }) },
    },
  );
  const modal = new PackageFieldsModal(
    {
      plugin: {
        app,
        publicationEditor: { flush: () => true },
        refreshViews() {},
      },
      selectedTemplate: { package: {} },
    },
    { path: "Papers/Synthetic.md" },
  );
  return {
    modal,
    properties,
    edits,
    release: () => release(),
    save: () => save(),
  };
}

test("saving fields preserves untouched values and concurrent edits to untouched fields", async () => {
  const { modal, properties, edits, save } = setup();
  modal.onOpen();
  await settle();
  edits.get("instructor")!("Updated");
  properties.course = 456;
  save();
  await settle();
  assert.deepEqual(properties, {
    course: 456,
    instructor: "Updated",
    deadline: "",
  });
});

test("saving fields rejects conflicting edits before writing any field", async () => {
  const { modal, properties, edits, save } = setup();
  modal.onOpen();
  await settle();
  edits.get("instructor")!("Updated");
  properties.instructor = "Changed elsewhere";
  save();
  await settle();
  assert.deepEqual(properties, {
    course: 123,
    instructor: "Changed elsewhere",
  });
  assert.match(modal.contentEl.children[0].text, /changed while/);
});

test("closing fields during a note read prevents late rendering", async () => {
  const { modal, release, edits } = setup(true);
  modal.onOpen();
  modal.onClose();
  release();
  await settle();
  assert.equal(edits.size, 0);
  assert.equal(modal.contentEl.children.length, 0);
});
