import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { loadRuntime } from "./runtime-harness";
import type * as Preview from "../publish-preview";
import type { PublishedDocument } from "../publish-model";

class Element {
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  text = "";
  value = "";
  disabled = false;
  clientWidth = 700;
  scrollTop = 0;
  win = { devicePixelRatio: 1 };
  constructor(
    public tag = "div",
    public options: {
      attr?: Record<string, string>;
      text?: string;
      cls?: string;
    } = {},
  ) {
    this.text = options.text ?? "";
  }
  addClass() {}
  css: Record<string, string> = {};
  setCssProps(properties: Record<string, string>) {
    this.css = properties;
  }
  setText(text: string) {
    this.text = text;
  }
  empty() {
    this.children = [];
  }
  replaceChildren(...children: Element[]) {
    this.children = children;
  }
  createEl(tag: string, options?: Element["options"]) {
    const child = new Element(tag, options);
    this.children.push(child);
    return child;
  }
  createDiv(options?: Element["options"]) {
    const child = new Element("div", options);
    this.children.push(child);
    return child;
  }
  createSpan() {
    const child = new Element("span");
    this.children.push(child);
    return child;
  }
  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  getContext() {
    return {};
  }
  find(label: string): Element | undefined {
    if (this.options.attr?.["aria-label"] === label) return this;
    for (const child of this.children) {
      const found = child.find(label);
      if (found) return found;
    }
    return undefined;
  }
  get allText(): string {
    return this.text + this.children.map((child) => child.allText).join(" ");
  }
}

function setup() {
  const calls = { read: 0, destroyed: 0, rendered: [] as number[], text: 0 };
  const subscribers = new Set<() => void>();
  const document: PublishedDocument = {
    id: "pdf",
    noteId: "note",
    filename: "Example.pdf",
    format: "pdf",
    createdAt: new Date().toISOString(),
    citationStyle: "apa",
    citationLanguage: "en-US",
  };
  const publish = {
    catalog: { documents: [document] },
    store: { path: () => ".config/stratum/published/Example.pdf" },
    subscribe: (callback: () => void) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
  };
  let finishRead!: (bytes: ArrayBuffer) => void;
  const reading = new Promise<ArrayBuffer>((resolve) => {
    finishRead = resolve;
  });
  const app = {
    vault: {
      adapter: {
        readBinary: () => {
          calls.read++;
          return reading;
        },
      },
    },
    workspace: { requestSaveLayout() {} },
  };
  const pdf = {
    numPages: 3,
    getPage: (number: number) =>
      Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
          scale,
        }),
        getTextContent: () => Promise.resolve({ items: [] }),
        render: () => {
          calls.rendered.push(number);
          return { promise: Promise.resolve(), cancel() {} };
        },
      }),
  };
  const { PublishPreviewView } = loadRuntime<typeof Preview>(
    "publish-preview.ts",
    {
      ItemView: class {
        contentEl = new Element();
        app = app;
        setState() {
          return Promise.resolve();
        }
      },
      setIcon() {},
      loadPdfJs: () =>
        Promise.resolve({
          getDocument: ({ data }: { data: Uint8Array }) => {
            assert.equal(data.length, 5);
            return {
              promise: Promise.resolve(pdf),
              destroy: () => {
                calls.destroyed++;
                return Promise.resolve();
              },
            };
          },
          TextLayer: class {
            render() {
              calls.text++;
              return Promise.resolve();
            }
            cancel() {}
          },
        }),
    },
    {
      Uint8Array,
      createDiv: (options: Element["options"]) => new Element("div", options),
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    },
    "browser",
  );
  const view = new PublishPreviewView({} as never, publish as never);
  const content = view.contentEl as unknown as Element;
  return { view, content, calls, publish, subscribers, finishRead };
}

test("PDF preview renders stored bytes, restores page state, navigates and clears deleted documents", async () => {
  const { view, content, calls, publish, subscribers, finishRead } = setup();
  await view.onOpen();
  await view.setState(
    { documentId: "pdf", page: 2, zoom: "1.25" },
    {} as never,
  );
  finishRead(new ArrayBuffer(5));
  await settle();
  assert.deepEqual(calls.rendered, [2]);
  assert.equal(calls.text, 1);
  assert.equal(
    content.children.at(-1)!.children[0].css["--total-scale-factor"],
    String((1.25 * 96) / 72),
  );
  assert.equal(view.getDisplayText(), "Example.pdf");
  const next = content.find("Next page")!;
  next.listeners.get("click")!();
  await settle();
  assert.equal(view.getState().page, 3);
  assert.equal(next.disabled, true);
  const input = content.find("Page number")!;
  input.value = "999";
  input.listeners.get("change")!();
  await settle();
  assert.equal(view.getState().page, 3);
  publish.catalog.documents = [];
  subscribers.forEach((callback) => callback());
  assert.equal(calls.destroyed, 1);
  assert.match(content.allText, /no longer available/);
  assert.equal(input.disabled, true);
  await view.onClose();
  assert.equal(subscribers.size, 0);
});

test("closing a preview during loading prevents rendering and opening a PDF worker", async () => {
  const { view, calls, finishRead } = setup();
  await view.onOpen();
  await view.setState({ documentId: "pdf" }, {} as never);
  await view.onClose();
  finishRead(new ArrayBuffer(5));
  await settle();
  assert.deepEqual(calls.rendered, []);
  assert.equal(calls.destroyed, 0);
});
