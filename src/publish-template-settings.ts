import { App, Modal, Notice, Setting } from "obsidian";
import type StratumPlugin from "./plugin";
import { renderPublishCustomization } from "./publish-customize";
import { createPublicationSection } from "./publish-design-controls";
import { readAcademicDefaults } from "./publish-options";

import {
  isBuiltInTemplate,
  readPublishingTemplates,
  removePublishingTemplate,
  type PublishingTemplate,
  type PublishingTemplates,
} from "./publish-templates";
import { createStratumButton, styleStratumComponent } from "./ui-controls";

export function publishingTemplatesFor(
  plugin: StratumPlugin,
): PublishingTemplates {
  return readPublishingTemplates(plugin.settings.publishingTemplates);
}
export async function savePublishingTemplates(
  plugin: StratumPlugin,
  state: PublishingTemplates,
): Promise<void> {
  const previous = plugin.settings.publishingTemplates;
  const next = readPublishingTemplates(state);
  plugin.settings.publishingTemplates = next;
  try {
    await plugin.saveSettings();
  } catch (error) {
    if (plugin.settings.publishingTemplates === next)
      plugin.settings.publishingTemplates = previous;
    throw error;
  }
  plugin.refreshViews();
}
/** Deleting a custom template asks first; notes and published documents are kept. */
export class DeletePublishingTemplateModal extends Modal {
  constructor(
    app: App,
    private name: string,
    private confirm: () => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    this.setTitle(`Delete “${this.name}” template?`);
    this.contentEl.createEl("p", {
      text: "Notes using this template will need another template selected. Your notes and published documents will be kept.",
    });
    const actions = this.contentEl.createDiv({
      cls: "stratum-publish-actions",
    });
    const cancel = createStratumButton(actions, { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const remove = createStratumButton(actions, {
      text: "Delete template",
      className: "mod-warning",
    });
    remove.addEventListener("click", () => {
      remove.disabled = true;
      void this.confirm()
        .then(() => this.close())
        .catch(() => {
          remove.disabled = false;
        });
    });
    cancel.focus();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
const fail = (_error: unknown) =>
  new Notice("Could not save publishing templates. Try again.");

export function renderPublishingTemplate(
  container: HTMLElement,
  plugin: StratumPlugin,
  template: PublishingTemplate,
  refresh: () => void,
  academicTarget: (properties: HTMLDetailsElement, row: HTMLElement) => void,
  rename: (name: string) => void,
): void {
  const details = container;
  const update = async (patch: Partial<PublishingTemplate>) => {
    const state = publishingTemplatesFor(plugin);
    await savePublishingTemplates(plugin, {
      ...state,
      templates: state.templates.map((t) =>
        t.id === template.id ? { ...t, ...patch } : t,
      ),
    });
  };
  new Setting(details).setName("Template name").addText((input) => {
    styleStratumComponent(input)
      .setValue(template.name)
      .onChange(async (value) => {
        if (value.trim()) {
          try {
            await update({ name: value });
            rename(value.trim());
          } catch (error) {
            fail(error);
          }
        }
      });
    input.inputEl.maxLength = 120;
  });
  renderPublishCustomization(
    details,
    template.layout,
    async (patch) => {
      const current = publishingTemplatesFor(plugin).templates.find(
        (t) => t.id === template.id,
      );
      if (current) await update({ layout: { ...current.layout, ...patch } });
    },
    fail,
  );
  const { details: prefill, body: prefillBody } = createPublicationSection(
    details,
    "Prefill details",
  );
  prefillBody.createEl("p", {
    text: "Optional details added during preparation, only when a property is absent. Existing note values are kept.",
    cls: "stratum-publish-meta",
  });
  for (const [key, name] of [
    ["authors", "Authors"],
    ["affiliations", "Affiliations"],
  ] as const) {
    const row = new Setting(prefillBody)
      .setName(name)
      .setDesc(
        "One entry per line. Leave blank to enter details separately in each note.",
      );
    if (key === "authors") academicTarget(prefill, row.settingEl);
    row.addTextArea((input) =>
      styleStratumComponent(input)
        .setValue(template.prefill[key].join("\n"))
        .onChange(async (value) => {
          const current = publishingTemplatesFor(plugin).templates.find(
            (t) => t.id === template.id,
          )!;
          await update({
            prefill: readAcademicDefaults({
              ...current.prefill,
              [key]: value.split(/\r?\n/),
            }),
          }).catch(fail);
        }),
    );
  }
  new Setting(details)
    .setName("Duplicate template")
    .setDesc("Create an editable copy of this template.")
    .addButton((button) =>
      styleStratumComponent(button)
        .setButtonText("Duplicate")
        .onClick(async () => {
          const state = publishingTemplatesFor(plugin);
          const current = state.templates.find((t) => t.id === template.id)!;
          try {
            await savePublishingTemplates(plugin, {
              ...state,
              templates: [
                ...state.templates,
                {
                  ...current,
                  id: `template-${crypto.randomUUID()}`,
                  name: `${current.name} copy`,
                },
              ],
            });
            refresh();
          } catch (error) {
            fail(error);
          }
        }),
    );
  if (!isBuiltInTemplate(template.id))
    new Setting(details)
      .setName("Delete template")
      .setDesc(
        "Notes using this template must choose another before publishing.",
      )
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Delete template")
          .onClick(() => {
            new DeletePublishingTemplateModal(
              plugin.app,
              template.name,
              async () => {
                try {
                  await savePublishingTemplates(
                    plugin,
                    removePublishingTemplate(
                      publishingTemplatesFor(plugin),
                      template.id,
                    ),
                  );
                  refresh();
                } catch (error) {
                  fail(error);
                  throw error;
                }
              },
            ).open();
          }),
      );
}

/** Keeps template fields out of the main plugin settings page. */
export class PublishingTemplatesModal extends Modal {
  constructor(
    private plugin: StratumPlugin,
    private academicDefaults = false,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const id = this.plugin.publish?.notePreferences.templateId;
    if (this.academicDefaults && id) this.editTemplate(id, true);
    else this.renderList();
  }

  private renderList(): void {
    this.contentEl.empty();
    this.setTitle("Publishing templates");
    for (const template of publishingTemplatesFor(this.plugin).templates) {
      new Setting(this.contentEl)
        .setName(template.name)
        .setDesc(
          `${template.documentType === "academic" ? "Academic paper" : "General document"} · ${isBuiltInTemplate(template.id) ? "Built-in; editable and cannot be deleted." : "Custom template."}`,
        )
        .addButton((button) =>
          styleStratumComponent(button)
            .setButtonText("Configure")
            .onClick(() => this.editTemplate(template.id)),
        );
    }
    new Setting(this.contentEl).addButton((button) =>
      styleStratumComponent(button)
        .setButtonText("Add template")
        .setCta()
        .onClick(() => this.addTemplate()),
    );
  }

  private addTemplate(): void {
    this.contentEl.empty();
    this.setTitle("Add template");
    let name = "",
      baseId = "general";
    new Setting(this.contentEl).setName("Template name").addText((input) =>
      styleStratumComponent(input).onChange((value) => {
        name = value.trim();
      }),
    );
    new Setting(this.contentEl).setName("Start from").addDropdown((input) => {
      styleStratumComponent(input);
      for (const template of publishingTemplatesFor(this.plugin).templates)
        input.addOption(template.id, template.name);
      input.setValue(baseId).onChange((value) => {
        baseId = value;
      });
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Cancel")
          .onClick(() => this.renderList()),
      )
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Create template")
          .setCta()
          .onClick(async () => {
            if (!name) {
              new Notice("Enter a template name.");
              return;
            }
            const state = publishingTemplatesFor(this.plugin);
            const base = state.templates.find((t) => t.id === baseId);
            if (!base) {
              this.renderList();
              return;
            }
            const id = `template-${crypto.randomUUID()}`;
            button.setDisabled(true);
            try {
              await savePublishingTemplates(this.plugin, {
                templates: [
                  ...state.templates,
                  {
                    ...base,
                    layout: { ...base.layout },
                    properties: base.properties.map((field) => ({ ...field })),
                    id,
                    name,
                  },
                ],
              });
              this.editTemplate(id);
            } catch (error) {
              fail(error);
              button.setDisabled(false);
            }
          }),
      );
  }

  private editTemplate(id: string, focusProperties = false): void {
    const template = publishingTemplatesFor(this.plugin).templates.find(
      (candidate) => candidate.id === id,
    );
    if (!template) return this.renderList();
    this.contentEl.empty();
    this.setTitle(`Edit ${template.name} template`);
    renderPublishingTemplate(
      this.contentEl,
      this.plugin,
      template,
      () => this.renderList(),
      (properties, row) => {
        if (focusProperties) {
          properties.open = true;
          // Wait until the textarea has been added and the modal is laid out.
          window.requestAnimationFrame(() => {
            if (!row.isConnected) return;
            row.scrollIntoView({ block: "center" });
            row.querySelector<HTMLTextAreaElement>("textarea")?.focus();
          });
        }
      },
      (name) => this.setTitle(`Edit ${name} template`),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
