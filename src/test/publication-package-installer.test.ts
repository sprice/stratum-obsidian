import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { loadRuntime } from "./runtime-harness";

class Element {
  children: Element[] = [];
  text = "";
  createEl(_tag: string, options: { text?: string } = {}) {
    const child = new Element();
    child.text = options.text ?? "";
    this.children.push(child);
    return child;
  }
  setText(text: string) {
    this.text = text;
  }
  empty() {
    this.children = [];
  }
}
class Button {
  text = "";
  disabled = false;
  click = () => {};
  setButtonText(text: string) {
    this.text = text;
    return this;
  }
  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    return this;
  }
  setCta() {
    return this;
  }
  onClick(callback: () => void) {
    this.click = callback;
    return this;
  }
}

test("installer replaces the install action with an explicit success screen; failures can retry", async () => {
  const buttons: Button[] = [];
  let finish!: (value: unknown) => void;
  let fail!: (error: Error) => void;
  let downloads = 0;
  let saves = 0;
  let viewed = "";
  class Modal {
    contentEl = new Element();
    title = "";
    closed = false;
    app: unknown;
    constructor(app: unknown) {
      this.app = app;
    }
    setTitle(title: string) {
      this.title = title;
    }
    close() {
      this.closed = true;
    }
  }
  const plugin = {
    app: { vault: { getName: () => "Synthetic test vault", adapter: {} } },
    settings: { publishingTemplates: {} },
    addChild() {},
    removeChild() {},
    refreshViews() {},
    saveSettings() {
      saves++;
      return Promise.resolve();
    },
  };
  const { PackageInstallModal } = loadRuntime<{
    PackageInstallModal: new (...args: unknown[]) => Modal & { onOpen(): void };
  }>(
    "publication-package-installer.ts",
    {
      Modal,
      Component: class {
        register() {}
      },
      Setting: class {
        addButton(callback: (button: Button) => void) {
          const button = new Button();
          buttons.push(button);
          callback(button);
          return this;
        }
      },
    },
    { AbortController, Error },
    "browser",
    {
      "./publish-template-settings": {
        PublishingTemplatesModal: class {
          constructor(_plugin: unknown, id: string) {
            viewed = id;
          }
          open() {}
        },
      },
      "./publication-package-installation": {
        installTemplatePackage: () => {
          downloads++;
          return new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          });
        },
      },
      "./publish-templates": {
        readPublishingTemplates: (value: unknown) => value,
      },
      "./plugin-storage-paths": {
        pluginStorageDirectory: () => "synthetic-cache",
      },
      "./publish-desktop": { downloadPublicationResource() {} },
      "./publication-registry": {
        TEMPLATE_REGISTRY_ORIGIN: "https://registry.example",
      },
    },
  );
  const modal = new PackageInstallModal(plugin, {
    id: "example",
    version: "1",
  });
  modal.onOpen();
  buttons[1].click();
  assert.equal(buttons[1].text, "Installing…");
  assert.equal(buttons[1].disabled, true);
  assert.match(modal.contentEl.children[2].text, /Downloading and verifying/);
  buttons[1].click();
  assert.equal(downloads, 1);
  fail(new Error("Network unavailable. Try again."));
  await settle();
  assert.equal(buttons[1].disabled, false);
  assert.match(modal.contentEl.children[2].text, /Network unavailable/);
  buttons[1].click();
  finish({
    manifest: { id: "example", version: "1", name: "Example template" },
    sha256: "a".repeat(64),
  });
  await settle();
  assert.equal(saves, 1);
  assert.equal(modal.title, "Template installed");
  assert.equal(modal.contentEl.children.length, 2);
  assert.match(modal.contentEl.children[0].text, /Example template is ready/);
  assert.match(modal.contentEl.children[1].text, /publishing panel/);
  assert.equal(buttons.at(-2)?.text, "View installed template");
  buttons.at(-2)?.click();
  await settle();
  assert.equal(viewed, "download:example:1");
  assert.equal(buttons.at(-1)?.text, "Done");
  buttons.at(-1)?.click();
  assert.equal(modal.closed, true);
});
