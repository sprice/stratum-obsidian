import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { DEFAULT_PUBLISH_OPTIONS } from "../publish-options";

class Element {
  tag = "";
  label = "";
  value = "";
  text = "";
  hidden = false;
  disabled = false;
  isConnected = true;
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  choices: { value: string; text: string }[] = [];
  empty() {
    this.choices = [];
    this.children = [];
  }
  createEl(
    tag: string,
    options: { text?: string; value?: string; attr?: { label: string } } = {},
  ) {
    const child = new Element();
    child.tag = tag;
    child.label = options.attr?.label ?? "";
    if (tag === "optgroup") child.choices = this.choices;
    child.text = options.text ?? "";
    this.children.push(child);
    if (options.value !== undefined)
      this.choices.push({ value: options.value, text: child.text });
    return child;
  }
  setText(text: string) {
    this.text = text;
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  trigger(event: string) {
    this.listeners.get(event)?.();
  }
}
function runtime(discover: () => Promise<string[]>) {
  const desktop = loadRuntime<typeof import("../publish-desktop")>(
    "publish-desktop.ts",
    { Platform: { isDesktopApp: true } },
    {
      window: {
        queryLocalFonts: async () =>
          (await discover()).map((family) => ({ family })),
      },
    },
    "browser",
  );
  const controls = loadRuntime<typeof import("../publish-font-controls")>(
    "publish-font-controls.ts",
    {},
    {},
    "browser",
    {
      "./publish-desktop": desktop,
      "./ui-controls": {
        createStratumSelect: (
          parent: Element,
          options: {
            value: string;
            choices: { value: string; label: string }[];
          },
        ) => {
          const select = new Element();
          select.value = options.value;
          select.choices = options.choices.map((choice) => ({
            value: choice.value,
            text: choice.label,
          }));
          parent.children.push(select);
          return select;
        },
        createStratumButton: (parent: Element) => {
          const button = new Element();
          parent.children.push(button);
          return button;
        },
      },
    },
  );
  return {
    ...controls,
    refreshFonts: () => desktop.installedPublishFonts(true),
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("font groups omit empty sections and match saved names without case duplicates", async () => {
  for (const [fonts, selected] of [
    [["Arial", "arial"], "arial"],
    [["Zebra font"], "arial"],
    [[], "arial"],
  ] as const) {
    const controls = runtime(() => Promise.resolve([...fonts]));
    const fields = new Element();
    controls.renderPublishFontControls(
      fields as never,
      new Element() as never,
      { ...DEFAULT_PUBLISH_OPTIONS, bodyFont: "arial" },
      () => Promise.resolve(),
      (error) => {
        throw error;
      },
    )();
    await settle();
    for (const select of fields.children) {
      assert.equal(
        select.children.some((child) => child.tag === "hr"),
        false,
      );
      assert.equal(
        select.children.some((child) => child.tag === "optgroup"),
        false,
      );
    }
    assert.equal(fields.children[0].value, selected);
    assert.equal(
      fields.children[0].choices.filter(
        (choice) => choice.value.toLowerCase() === "arial",
      ).length,
      1,
    );
  }
});

test("font discovery is lazy, shared while loading, cached, and preserves saved or default selections", async () => {
  let calls = 0;
  let finish!: (fonts: string[]) => void;
  const controls = runtime(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const fields = new Element(),
    body = new Element(),
    otherFields = new Element(),
    otherBody = new Element();
  const patches: object[] = [];
  const render = (fields: Element, body: Element) =>
    controls.renderPublishFontControls(
      fields as never,
      body as never,
      { ...DEFAULT_PUBLISH_OPTIONS, bodyFont: "Saved font" },
      (patch) => {
        patches.push(patch);
        return Promise.resolve();
      },
      (error) => {
        throw error;
      },
      "docx",
    );
  const load = render(fields, body),
    otherLoad = render(otherFields, otherBody);
  assert.equal(calls, 0);
  assert.equal(fields.children[0].value, "Saved font");
  load();
  otherLoad();
  assert.equal(calls, 1);
  assert.equal(body.children[0].text, "Loading fonts…");
  fields.children[0].value = "";
  fields.children[0].trigger("change");
  await settle();
  finish([
    "Zebra font",
    "Georgia",
    "Arial",
    "georgia",
    "Another font",
    "Unsafe\\command",
  ]);
  await settle();
  assert.equal(fields.children[0].value, "");
  assert.deepEqual(JSON.parse(JSON.stringify(patches)), [{ bodyFont: "" }]);
  assert.deepEqual(
    fields.children[0].choices.map((choice) => choice.value),
    ["", "Arial", "georgia", "Another font", "Zebra font"],
  );
  assert.deepEqual(
    fields.children[0].children.map((child) => child.tag),
    ["option", "option", "option", "hr", "option", "option"],
  );
  assert.match(
    otherFields.children[0].choices[1].text,
    /Saved font.*Unavailable/,
  );
  assert.equal(body.children[0].hidden, true);
  const cachedFields = new Element();
  render(cachedFields, new Element())();
  assert.equal(calls, 1);
  assert.equal(cachedFields.children[1].choices[0].text, "Same as body");
});

test("reopened and new font controls use the refreshed publishing cache", async () => {
  let calls = 0;
  let fonts = ["Arial", "Old Serif"];
  const controls = runtime(() => {
    calls++;
    return Promise.resolve(fonts);
  });
  const render = (fields: Element) =>
    controls.renderPublishFontControls(
      fields as never,
      new Element() as never,
      {
        ...DEFAULT_PUBLISH_OPTIONS,
        bodyFont: "New Serif",
        titleFont: "Old Serif",
      },
      () => Promise.resolve(),
      (error) => {
        throw error;
      },
    );
  const fields = new Element();
  const reopen = render(fields);
  reopen();
  await settle();
  assert.match(fields.children[0].choices[1].text, /Unavailable/);
  fonts = ["Arial", "New Serif"];
  await controls.refreshFonts();
  reopen();
  await settle();
  const newFields = new Element();
  render(newFields)();
  await settle();
  for (const current of [fields, newFields]) {
    assert.equal(current.children[0].value, "New Serif");
    assert.equal(current.children[0].choices[1].text, "Arial");
    assert.equal(current.children[0].choices[2].text, "New Serif");
    assert.match(current.children[1].choices[1].text, /Old Serif.*Unavailable/);
  }
  assert.equal(calls, 2, "Reopening reads the cache without rescanning fonts");
});

test("failed discovery offers retry and rejected font saves restore the previous choice", async () => {
  let calls = 0;
  const controls = runtime(() => {
    if (++calls === 1) return Promise.reject(new Error("Not available"));
    return Promise.resolve(["Georgia"]);
  });
  const fields = new Element(),
    body = new Element();
  let errors = 0;
  const load = controls.renderPublishFontControls(
    fields as never,
    body as never,
    DEFAULT_PUBLISH_OPTIONS,
    () => Promise.reject(new Error("Save failed")),
    () => {
      errors++;
    },
    "pdf",
  );
  load();
  await settle();
  assert.equal(body.children[1].hidden, false);
  assert.match(body.children[0].text, /Default and saved choices/);
  body.children[1].trigger("click");
  await settle();
  assert.equal(calls, 2);
  assert.equal(body.children[1].hidden, true);
  const select = fields.children[0];
  assert.equal(select.choices[0].text, "Default typesetting font");
  select.value = "Georgia";
  select.trigger("change");
  await settle();
  assert.equal(select.value, "");
  assert.equal(select.disabled, false);
  assert.equal(errors, 1);
});
