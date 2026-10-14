import assert from "node:assert/strict";
import test from "node:test";
import { focusControlByKey, StableRender } from "../ui-render";

const doc: { activeElement: Element | null } = { activeElement: null };
class Element {
  children: Element[] = [];
  attrs = new Map<string, string>();
  doc = doc;
  child(attrs: Record<string, string> = {}): Element {
    const child = new Element();
    for (const [name, value] of Object.entries(attrs))
      child.attrs.set(name, value);
    this.children.push(child);
    return child;
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  querySelectorAll(selector: string): Element[] {
    const name = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    assert.ok(name, `unexpected selector ${selector}`);
    return this.descendants().filter((element) => element.attrs.has(name));
  }
  contains(element: Element | null): boolean {
    return (
      !!element && (element === this || this.descendants().includes(element))
    );
  }
  empty(): void {
    this.children = [];
  }
  focus(): void {
    doc.activeElement = this;
  }
  descendants(): Element[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}
const host = (element: Element) => element as unknown as HTMLElement;
const attribute = "data-test-control";

test("stable render skips repeated signatures and patches an unchanged structure", () => {
  const render = new StableRender(host(new Element()), attribute);
  assert.equal(render.changed("a"), true);
  assert.equal(render.changed("a"), false);
  assert.equal(render.changed("b"), true);
  assert.equal(render.keeps("shape"), false);
  assert.equal(render.keeps("shape"), true);
  assert.equal(render.keeps("other"), false);
  render.invalidate();
  assert.equal(render.keeps("other"), false);
  assert.equal(render.keeps("other"), true);
});

test("stable render rebuilds and returns focus to the control with the same key", () => {
  const container = new Element();
  const key = 'Move author "1" up';
  container
    .child()
    .child({ [attribute]: key })
    .focus();
  const render = new StableRender(host(container), attribute);
  const restoreFocus = render.clear();
  assert.equal(container.children.length, 0);
  container.child({ [attribute]: "Add author" });
  const replacement = container.child().child({ [attribute]: key });
  assert.notEqual(doc.activeElement, replacement);
  restoreFocus();
  assert.equal(doc.activeElement, replacement);
});

test("stable render leaves focus outside the container alone", () => {
  const container = new Element();
  const outside = new Element();
  outside.attrs.set(attribute, "title");
  outside.focus();
  const restoreFocus = new StableRender(host(container), attribute).clear();
  const inside = container.child({ [attribute]: "title" });
  restoreFocus();
  assert.equal(doc.activeElement, outside);
  focusControlByKey(host(container), attribute, "title");
  assert.equal(doc.activeElement, inside);
});
