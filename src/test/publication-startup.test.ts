import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

test("publishing services, extension, command and preview are initialized only on desktop", async () => {
  for (const desktop of [false, true]) {
    const calls: string[] = [];
    class Host {}
    class View {
      file = {};
      containerEl = {};
    }
    const obsidian = new Proxy<Record<string, unknown>>(
      {
        Platform: { isDesktopApp: desktop },
        MarkdownView: View,
      },
      { get: (target, key: string) => target[key] ?? Host },
    );
    const runtime = loadRuntime<{
      default: {
        prototype: {
          startPublishing(): Promise<void>;
        };
      };
    }>("plugin.ts", obsidian, {}, "node", {
      "./publication-editor": {
        PublicationEditor: class {
          constructor() {
            calls.push("editor");
          }
          extension() {
            return [];
          }
        },
      },
      "./publish-controller": {
        PublishController: class {
          constructor() {
            calls.push("controller");
          }
        },
      },
      "./publish-preview": { PublishPreviewView: Host },
    });
    const plugin = {
      isUnloaded: false,
      publicationEditor: null,
      publish: null,
      addChild: (child: unknown) => child,
      registerEditorExtension: () => calls.push("extension"),
      addCommand: (command: { id: string }) => calls.push(command.id),
      registerView: () => calls.push("preview"),
    };
    await runtime.default.prototype.startPublishing.call(plugin);
    assert.deepEqual(
      calls,
      desktop
        ? [
            "editor",
            "extension",
            "edit-publication-details",
            "controller",
            "preview",
          ]
        : [],
    );
    assert.equal(!!plugin.publicationEditor, desktop);
    assert.equal(!!plugin.publish, desktop);
  }
});
