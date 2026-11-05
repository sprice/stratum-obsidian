import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { declarativePackageFixture } from "./publication-package-fixture";
import type { PropertyDraft } from "../publication-editor";

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  doc = { activeElement: null };
  value = "";
  disabled = false;
  hidden = false;
  listeners = new Map<string, () => void>();
  constructor(
    public tag = "div",
    public options: Record<string, unknown> = {},
  ) {}
  createDiv() {
    const element = new Element();
    this.children.push(element);
    return element;
  }
  createEl(tag: string, options = {}) {
    const element = new Element(tag, options);
    this.children.push(element);
    return element;
  }
  contains() {
    return false;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  empty() {
    this.children = [];
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

test("switching package field definitions refreshes labels, requirements and input types", () => {
  const { manifest } = declarativePackageFixture();
  const variant = manifest.variants[0];
  assert.ok("properties" in variant);
  variant.properties = [
    {
      key: "notes",
      label: "Notes",
      type: "text",
      required: false,
      default: "",
      prefill: [],
    },
  ];
  const properties = new Map<string, PropertyDraft>();
  const publish = {
    selectedTemplate: { package: { manifest, variant: variant.id } },
    layout: {},
    busy: false,
    preferencesSaving: false,
  };
  const file = { path: "Papers/Synthetic.md", stat: { ctime: 1 } };
  const service = {
    registerPropertyForm: () => () => {},
    session: () => ({ properties }),
    editableView: () => ({ state: { doc: { toString: () => "# Synthetic" } } }),
  };
  const { PublicationPropertyControls } = loadRuntime<
    typeof import("../publication-property-controls")
  >("publication-property-controls.ts", {}, {}, "browser", {
    "./ui-controls": {
      createStratumField: (parent: Element, label: string) =>
        parent.createEl("label", { label }),
      createStratumInput: (parent: Element, options: Record<string, unknown>) =>
        parent.createEl("input", options),
      createStratumTextarea: (
        parent: Element,
        options: Record<string, unknown>,
      ) => parent.createEl("textarea", options),
    },
  });
  const container = new Element();
  const controls = new PublicationPropertyControls(
    container as never,
    publish as never,
    service as never,
    file as never,
  );
  assert.ok(container.all().some((element) => element.tag === "input"));
  variant.properties[0] = {
    ...variant.properties[0],
    label: "Research notes",
    type: "list",
    required: true,
  };
  controls.refresh();
  assert.ok(!container.all().some((element) => element.tag === "input"));
  const textarea = container
    .all()
    .find((element) => element.tag === "textarea")!;
  assert.deepEqual(
    { ...(textarea.options.attr as Record<string, string>) },
    {
      "aria-label": "Research notes",
      "aria-required": "true",
    },
  );
  textarea.listeners.get("focus")!();
  textarea.value = "First note\nSecond note";
  textarea.listeners.get("input")!();
  assert.deepEqual(Array.from(properties.get("notes")!.operation.value), [
    "First note",
    "Second note",
  ]);
  controls.destroy();
});
