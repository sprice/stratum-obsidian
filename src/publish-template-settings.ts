import { Modal, Notice, Setting } from "obsidian";
import type StratumPlugin from "./plugin";
import { renderPublishCustomization } from "./publish-customize";
import { createPublicationSection } from "./publish-design-controls";
import { readAcademicDefaults } from "./publish-options";

import {
  isBuiltInTemplate,
  readPublishingTemplates,
  removePublishingTemplate,
  publishingTemplateEnabled,
  publishingTemplateId,
  publishingTemplateFamilies,
  type PublishingTemplate,
  type PublishingTemplates,
} from "./publish-templates";
import { styleStratumComponent } from "./ui-controls";
import { ConfirmModal } from "./ui-modal";
import { AASTEX_TEMPLATE } from "./publication-package";
import { JOURNAL_TEMPLATES } from "./journal-profiles";
import {
  installedAastexResources,
  publicationResourceCache,
} from "./publication-resources";
import { setPublishingTemplateEnabled } from "./publishing-template-availability";

function publishingTemplatesFor(plugin: StratumPlugin): PublishingTemplates {
  return readPublishingTemplates(plugin.settings.publishingTemplates);
}
async function savePublishingTemplates(
  plugin: StratumPlugin,
  state: PublishingTemplates,
): Promise<void> {
  const previous = plugin.settings.publishingTemplates;
  const next = readPublishingTemplates({
    ...readPublishingTemplates(previous),
    ...state,
  });
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
const fail = (_error: unknown) =>
  new Notice("Could not save publishing templates. Try again.");

function renderPublishingTemplate(
  container: HTMLElement,
  plugin: StratumPlugin,
  template: PublishingTemplate,
  refresh: () => void,
  rename: (name: string) => void,
  reopen: () => void,
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
    "pdf",
  );
  const { body: prefillBody } = createPublicationSection(
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
    new Setting(prefillBody)
      .setName(name)
      .setDesc(
        "One entry per line. Leave blank to enter details separately in each note.",
      )
      .addTextArea((input) =>
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
  if (isBuiltInTemplate(template.id))
    new Setting(details)
      .setName("Reset defaults")
      .setDesc(
        "Restore this template's layout and fields. The name and prefill details are kept.",
      )
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Reset defaults")
          .onClick(async () => {
            const defaults = readPublishingTemplates(undefined).templates.find(
              (t) => t.id === template.id,
            )!;
            try {
              await update({
                layout: defaults.layout,
                properties: defaults.properties,
              });
              reopen();
            } catch (error) {
              fail(error);
            }
          }),
      );
  else
    new Setting(details)
      .setName("Delete template")
      .setDesc(
        "Notes using this template must choose another before publishing.",
      )
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Delete template")
          .onClick(() => {
            // Deleting asks first; notes and published documents are kept.
            new ConfirmModal(plugin.app, {
              title: `Delete “${template.name}” template?`,
              message: [
                "Notes using this template will need another template selected. Your notes and published documents will be kept.",
              ],
              confirmLabel: "Delete template",
              warning: true,
              confirm: async () => {
                await savePublishingTemplates(
                  plugin,
                  removePublishingTemplate(
                    publishingTemplatesFor(plugin),
                    template.id,
                  ),
                );
                refresh();
              },
              onError: fail,
            }).open();
          }),
      );
}

/** Keeps template fields out of the main plugin settings page. */
export class PublishingTemplatesModal extends Modal {
  private readonly installation = new AbortController();
  constructor(private plugin: StratumPlugin) {
    super(plugin.app);
    this.modalEl.addClass("stratum-modal");
  }

  onOpen(): void {
    this.renderList();
  }

  private renderList(): void {
    this.contentEl.empty();
    this.setTitle("Publishing templates");
    const state = publishingTemplatesFor(this.plugin);
    const all = {
      ...state,
      templates: [...state.templates, AASTEX_TEMPLATE, ...JOURNAL_TEMPLATES],
    };
    for (const family of publishingTemplateFamilies(all)) {
      const template = all.templates.find(
        (t) => publishingTemplateId(t) === family.id,
      )!;
      const row = new Setting(this.contentEl)
        .setName(template.name)
        .setDesc(
          template.renderer === "aastex"
            ? "Official AAS resources. Enabling downloads and verifies missing files; disabling keeps them cached."
            : template.renderer === "journal"
              ? "Journal profiles. Resources currently included with the plugin."
              : `${template.documentType === "academic" ? "Academic paper" : "General document"} · ${isBuiltInTemplate(template.id) ? "Built-in; editable and cannot be deleted." : "Custom template."}`,
        );
      if (!template.renderer)
        row.addButton((button) =>
          styleStratumComponent(button)
            .setButtonText("Configure")
            .onClick(() => this.editTemplate(template.id)),
        );
      row.addToggle((toggle) => {
        toggle.toggleEl.setAttribute("aria-label", `Enable ${template.name}`);
        const enabled = publishingTemplateEnabled(state, template);
        let changing = false;
        styleStratumComponent(toggle)
          .setValue(enabled)
          .onChange((value) => {
            if (changing) return;
            changing = true;
            toggle.setDisabled(true);
            if (value && template.renderer === "aastex")
              row.setDesc("Installing and verifying template resources…");
            void setPublishingTemplateEnabled(
              this.plugin,
              family.id,
              value,
              () =>
                template.renderer === "aastex"
                  ? installedAastexResources(
                      publicationResourceCache(this.plugin),
                      this.installation.signal,
                    )
                  : Promise.resolve(),
              this.installation.signal,
            ).then(
              () => {
                if (!this.installation.signal.aborted) this.renderList();
              },
              (error: unknown) => {
                if (this.installation.signal.aborted) return;
                toggle.setValue(enabled).setDisabled(false);
                changing = false;
                row.setDesc(
                  error instanceof Error
                    ? error.message
                    : "Could not enable this template. Try again.",
                );
              },
            );
          });
      });
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

  private editTemplate(id: string): void {
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
      (name) => this.setTitle(`Edit ${name} template`),
      () => this.editTemplate(id),
    );
  }

  onClose(): void {
    this.installation.abort();
    this.contentEl.empty();
  }
}
