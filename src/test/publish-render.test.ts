import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import * as publishDocument from "../publish-document";

class Element {
  children: (Element | string)[] = [];
  parent: Element | null = null;
  attributes: { name: string }[] = [];
  checked = false;
  constructor(
    public tag = "div",
    public type = "",
  ) {}
  addClass() {}
  append(child: Element | string) {
    if (child instanceof Element) child.parent = this;
    this.children.push(child);
  }
  querySelectorAll(selector: string): Element[] {
    const matches = (node: Element) =>
      selector
        .split(",")
        .some(
          (part) =>
            part.trim() === "*" ||
            part.trim() === node.tag ||
            (part.trim() === 'input[type="checkbox"]' &&
              node.tag === "input" &&
              node.type === "checkbox"),
        );
    const descendants = this.children.filter(
      (child): child is Element => child instanceof Element,
    );
    return descendants.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  replaceWith(value: string) {
    const children = this.parent!.children;
    children.splice(children.indexOf(this), 1, value);
  }
  remove() {
    const children = this.parent!.children;
    children.splice(children.indexOf(this), 1);
  }
  get innerHTML(): string {
    return this.children
      .map((child) =>
        typeof child === "string"
          ? child
          : `<${child.tag}>${child.innerHTML}</${child.tag}>`,
      )
      .join("");
  }
}

test("publication retains checked and unchecked task states after removing controls", async () => {
  let unloaded = false;
  const { renderPublication } = loadRuntime<typeof import("../publish-render")>(
    "publish-render.ts",
    {
      Component: class {
        load() {}
        unload() {
          unloaded = true;
        }
      },
      TFile: class {},
      MarkdownRenderer: {
        render: (_app: unknown, _markdown: string, root: Element) => {
          const list = new Element("ul");
          root.append(list);
          for (const [checked, text] of [
            [true, "Finished"],
            [false, "Pending"],
          ] as const) {
            const item = new Element("li");
            const checkbox = new Element("input", "checkbox");
            checkbox.checked = checked;
            item.append(checkbox);
            item.append(text);
            list.append(item);
          }
          root.append(new Element("button"));
          return Promise.resolve();
        },
      },
    },
    { createDiv: () => new Element() },
    "browser",
    { "./publish-document": publishDocument },
  );
  const result = await renderPublication(
    {} as never,
    "- [x] Finished\n- [ ] Pending",
    "Example.md",
    "Example",
    undefined,
    new AbortController().signal,
  );
  assert.match(result.html, /\[x\] Finished/);
  assert.match(result.html, /\[ \] Pending/);
  assert.doesNotMatch(result.html, /<input|<button/);
  assert.equal(unloaded, true);
});
