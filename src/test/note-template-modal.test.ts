import assert from "node:assert/strict";
import test from "node:test";
import type * as Module from "../note-template-modal";
import { loadRuntime } from "./runtime-harness";
import {
  SOURCE_SUMMARY_VARIABLES,
  validateSourceSummaryTemplate,
} from "../source-summary-template";

class Element {
  children: Element[] = [];
  value = "";
  text = "";
  disabled = false;
  createEl(_tag: string, options?: { text?: string }) {
    const element = new Element();
    element.text = options?.text ?? "";
    this.children.push(element);
    return element;
  }
  setText(text: string) {
    this.text = text;
  }
  empty() {
    this.children = [];
  }
  addClass() {}
  focus() {}
}
class Button {
  text = "";
  disabled = false;
  click!: () => void | Promise<void>;
  setButtonText(text: string) {
    this.text = text;
    return this;
  }
  setCta() {
    return this;
  }
  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    return this;
  }
  onClick(click: Button["click"]) {
    this.click = click;
    return this;
  }
}
function fixture(
  save: (template: string) => Promise<void> = () => Promise.resolve(),
  options?: ConstructorParameters<typeof Module.NoteTemplateModal>[3],
) {
  const buttons: Button[] = [];
  class Modal {
    titleEl = { id: "" };
    modalEl = {
      classes: [] as string[],
      addClass(cls: string) {
        this.classes.push(cls);
      },
    };
    contentEl = new Element();
    closed = false;
    setTitle() {}
    close() {
      this.closed = true;
      (this as unknown as { onClose(): void }).onClose();
    }
  }
  class Setting {
    addButton(render: (button: Button) => void) {
      const button = new Button();
      buttons.push(button);
      render(button);
      return this;
    }
  }
  const { NoteTemplateModal } = loadRuntime<typeof Module>(
    "note-template-modal.ts",
    { Modal, Setting, Notice: class {} },
  );
  const modal = new NoteTemplateModal({} as never, "## Summary", save, options);
  modal.onOpen();
  const element = modal.contentEl as unknown as Element;
  return {
    modal,
    input: element.children[2],
    error: element.children[3],
    button: (name: string) => buttons.find((button) => button.text === name)!,
    get closed() {
      return (modal as unknown as Modal).closed;
    },
  };
}

test("cancel does not save; save persists the edited Markdown", async () => {
  const saved: string[] = [];
  const save = (value: string) => {
    saved.push(value);
    return Promise.resolve();
  };
  const cancelled = fixture(save);
  assert.deepEqual(
    (cancelled.modal as unknown as { modalEl: { classes: string[] } }).modalEl
      .classes,
    ["stratum-modal"],
  );
  cancelled.input.value = "## Unsaved draft";
  await cancelled.button("Cancel").click();
  assert.equal(cancelled.closed, true);
  assert.equal(saved.length, 0);
  const edited = fixture(save);
  edited.input.value = "## Questions\n\n- [ ] Read";
  await edited.button("Save").click();
  assert.deepEqual(saved, [edited.input.value]);
  assert.equal(edited.closed, true);
});

test("invalid boundaries cannot save, and failed saves keep the draft available", async () => {
  let saves = 0;
  const f = fixture(() => {
    saves++;
    return Promise.reject(new Error("Disk failure"));
  });
  f.input.value = "```\nUnclosed";
  await f.button("Save").click();
  assert.equal(saves, 0);
  assert.match(f.error.text, /Close any code fences/);
  f.input.value = "## Research";
  await f.button("Save").click();
  assert.equal(saves, 1);
  assert.equal(f.closed, false);
  assert.match(f.error.text, /Could not save/);
  assert.equal(f.input.value, "## Research");
  assert.equal(f.input.disabled, false);
});

test("a misspelled summary variable blocks Save, keeps the draft, and allows correction", async () => {
  const saved: string[] = [];
  const f = fixture(
    (template) => {
      saved.push(template);
      return Promise.resolve();
    },
    {
      title: "Source summary template",
      description: ["Description", "Ownership"],
      variables: SOURCE_SUMMARY_VARIABLES,
      validate: validateSourceSummaryTemplate,
    },
  );
  f.input.value = "### {{title_with__link}}";
  await f.button("Save").click();
  assert.deepEqual(saved, []);
  assert.equal(f.closed, false);
  assert.equal(f.input.value, "### {{title_with__link}}");
  assert.equal(f.error.text, "Unknown variable {{title_with__link}}.");
  f.input.value = "### {{title_with_link}}";
  await f.button("Save").click();
  assert.deepEqual(saved, ["### {{title_with_link}}"]);
  assert.equal(f.closed, true);
});
