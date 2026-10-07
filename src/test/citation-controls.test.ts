import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

function preferencesFixture(note = false) {
  const buttons = new Map<string, () => void | Promise<void>>();
  const frontmatter: Record<string, unknown> = { title: "Synthetic paper" };
  const prepared: string[] = [];
  let savedStyles: Record<string, string> = {};
  const el = {
    empty() {},
    createEl: () => el,
    createDiv: () => el,
    appendText() {},
  };
  class Control {
    label = "";
    setButtonText(label: string) {
      this.label = label;
      return this;
    }
    setDisabled() {
      return this;
    }
    setCta() {
      return this;
    }
    addOptions() {
      return this;
    }
    setValue() {
      return this;
    }
    onChange() {
      return this;
    }
    onClick(callback: () => void | Promise<void>) {
      buttons.set(this.label, callback);
      return this;
    }
  }
  const plugin = {
    app: {
      vault: {
        cachedRead: () => Promise.resolve(JSON.stringify(frontmatter)),
        getMarkdownFiles: () => [],
      },
      fileManager: {
        processFrontMatter: (
          _file: unknown,
          change: (fm: Record<string, unknown>) => void,
        ) => {
          change(frontmatter);
          return Promise.resolve();
        },
      },
    },
    register() {},
    settings: {
      citationStyle: "apa",
      citationLanguage: "en-US",
      availableCitationStyles: ["apa", "custom-enabled"],
      citationStyles: {
        "custom-enabled": "enabled XML",
        "custom-unused": "unused XML",
      },
    },
    citations: {
      preferences: (_path: string, text?: string) => ({
        style: text
          ? (((JSON.parse(text) as Record<string, unknown>)
              .stratum_citation_style ??
              plugin.settings.citationStyle) as string)
          : "apa",
        language: "en-US",
      }),
      invalidate() {},
    },
    saveSettings: () => Promise.resolve(),
    refreshSettingTab() {},
  };
  const { CitationPreferences } = loadRuntime<
    typeof import("../citation-controls")
  >(
    "citation-controls.ts",
    {
      Modal: class {
        constructor(public app: unknown) {}
        contentEl = el;
        modalEl = { addClass() {} };
        setTitle() {}
        close() {}
      },
      FuzzySuggestModal: class {
        modalEl = { addClass() {} };
      },
      Notice: class {},
      Setting: class {
        setName() {
          return this;
        }
        setDesc() {
          return this;
        }
        addButton(callback: (button: Control) => void) {
          callback(new Control());
          return this;
        }
        addDropdown(callback: (button: Control) => void) {
          callback(new Control());
          return this;
        }
      },
    },
    {},
    "node",
    {
      "./citation-styles": {
        styleTitle: (_plugin: unknown, id: string) => id,
        cachedStyle: () => undefined,
        languages: {},
        prepareStyle: (_plugin: unknown, id: string) => {
          prepared.push(id);
          return Promise.resolve();
        },
      },
      "./citation-resources": {
        saveCitationResources: () => {
          savedStyles = { ...plugin.settings.citationStyles };
          return Promise.resolve();
        },
      },
      "./citation-format": {},
      "./citation-render": {},
    },
  );
  const modal = new CitationPreferences(
    plugin as never,
    note ? ({ path: "Papers/Synthetic.md" } as never) : null,
  );
  modal.onOpen();
  return {
    frontmatter,
    prepared,
    buttons,
    get savedStyles() {
      return savedStyles;
    },
  };
}

for (const style of [undefined, "ieee"]) {
  test(`applying a note language preserves its current style and inheritance: ${String(style)}`, async () => {
    const f = preferencesFixture(true);
    if (style) f.frontmatter.stratum_citation_style = style;
    f.buttons.get("Apply language")!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.frontmatter.stratum_citation_style, style);
    assert.equal(f.frontmatter.stratum_citation_language, "en-US");
    assert.equal(f.frontmatter.title, "Synthetic paper");
    assert.deepEqual(f.prepared, [style ?? "apa"]);
  });
}

test("cleanup preserves custom styles enabled for future use", async () => {
  const f = preferencesFixture();
  await f.buttons.get("Remove unused styles")!();
  assert.deepEqual(f.savedStyles, { "custom-enabled": "enabled XML" });
});

for (const fail of [false, true]) {
  test(`search selections save resources without changing preferences, failure=${fail}`, async () => {
    const notices: string[] = [];
    const buttons = new Map<string, { click: () => Promise<void> | void }>();
    let checklist!: import("../settings-checklist").ChecklistOptions;
    let choose!: (item: { id: string; title: string }) => void;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let preparations = 0;
    let invalidations = 0;
    const element = {
      empty: () => {
        buttons.clear();
      },
      createEl: () => element,
      createDiv: () => element,
      appendText() {},
    };
    class Control {
      buttonEl = {
        getAttribute: () => "false",
        setAttribute() {},
        addClass() {},
      };
      click = () => {};
      setButtonText(text: string) {
        buttons.set(text, this);
        return this;
      }
      setDisabled() {
        return this;
      }
      setCta() {
        return this;
      }
      addOptions() {
        return this;
      }
      setValue() {
        return this;
      }
      onChange() {
        return this;
      }
      onClick(callback: () => void) {
        this.click = callback;
        return this;
      }
    }
    const plugin = {
      app: {},
      register() {},
      isUnloaded: false,
      saveSettings: () => Promise.resolve(),
      refreshSettingTab() {},
      settings: {
        citationStyle: "apa",
        availableCitationStyles: ["apa"],
        citationLanguage: "en-US",
        citationStyles: {} as Record<string, string>,
      },
      citations: {
        invalidate: () => {
          invalidations++;
        },
      },
    };
    const { CitationPreferences } = loadRuntime<
      typeof import("../citation-controls")
    >(
      "citation-controls.ts",
      {
        Modal: class {
          constructor(public app: unknown) {}
          contentEl = element;
          modalEl = { addClass() {} };
          setTitle() {}
        },
        FuzzySuggestModal: class {
          modalEl = { addClass() {} };
          setPlaceholder() {}
          open() {
            choose = (
              this as unknown as { onChooseItem: typeof choose }
            ).onChooseItem.bind(this);
          }
          close() {}
        },
        Notice: class {
          constructor(text: string) {
            notices.push(text);
          }
        },
        Setting: class {
          setName() {
            return this;
          }
          setDesc() {
            return this;
          }
          addButton(callback: (button: Control) => void) {
            callback(new Control());
            return this;
          }
          addDropdown(callback: (button: Control) => void) {
            callback(new Control());
            return this;
          }
        },
      },
      { Error },
      "node",
      {
        "./settings-checklist": {
          openChecklist: (_anchor: unknown, options: typeof checklist) => {
            checklist = options;
            return () => {};
          },
        },
        "./citation-format": {},
        "./citation-render": {},
        "./citation-resources": {},
        "./citation-styles": {
          bundledStyles: [{ id: "apa", title: "APA" }],
          languages: {},
          cachedStyle: () => undefined,
          styleTitle: () => "APA",
          styleCatalog: () =>
            Promise.resolve([{ id: "synthetic", title: "Synthetic style" }]),
          prepareStyle: async (
            _plugin: unknown,
            id: string,
            language: string,
          ) => {
            preparations++;
            assert.equal(id, "synthetic");
            assert.equal(language, "en-US");
            await pending;
            if (fail) throw new Error("Download failed");
            plugin.settings.citationStyles[id] = "saved CSL";
          },
        },
      },
    );
    const modal = new CitationPreferences(plugin as never);
    modal.onOpen();
    assert.ok(buttons.has("Choose default style"));
    await buttons.get("Choose available citation styles")!.click();
    assert.equal(checklist.items[0].disabled, true);
    assert.equal(checklist.items[0].badge, "Default");
    const items = await checklist.loadItems!();
    assert.ok(items.some((item) => item.id === "synthetic" && !item.checked));
    const saving = checklist.onChange("synthetic", true);
    finish();
    if (fail) await assert.rejects(saving);
    else await saving;
    assert.equal(preparations, 1);
    assert.equal(plugin.settings.citationStyle, "apa");
    assert.equal(plugin.settings.citationLanguage, "en-US");
    assert.equal((modal as unknown as { selected: string }).selected, "apa");
    assert.equal(
      plugin.settings.citationStyles.synthetic,
      fail ? undefined : "saved CSL",
    );
    assert.equal(invalidations, fail ? 0 : 1);
    assert.equal(notices.length, 0);
    if (!fail) {
      await buttons.get("Choose default style")!.click();
      choose({ id: "synthetic", title: "Synthetic style" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(plugin.settings.citationStyle, "synthetic");
    }
    modal.onClose();
  });
}
