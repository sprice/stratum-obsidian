import {
  enableVerifiedInstallation,
  removeInstallation,
} from "./publication-installation-state";
import { registryListing } from "./publication-registry-cache";
import { TEMPLATE_REGISTRY_ORIGIN } from "./publication-registry";
import { Platform } from "obsidian";
import {
  registryFamilies,
  registryReleases,
  registryInstallation,
  readRegistryFamilies,
  readRegistryReleases,
  type RegistryFamily,
  type RegistryRelease,
} from "./publication-registry-client";
import {
  installationId,
  type TemplateInstallation,
} from "./publication-installation";
import { installedPublishingTemplate } from "./publication-installed-templates";
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
import {
  installedTemplateResources,
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
  private families: RegistryFamily[] = [];
  private releases: RegistryRelease[] = [];
  private selectedFamily = "";
  private selectedVersions = new Set<string>();
  private status = "Loading the template registry…";
  private installationStatus = "";
  private installationFailed = false;
  private busy = false;
  private listingRequest = 0;
  private view: "list" | "edit" = "list";
  private renderCurrentList() {
    if (!this.installation.signal.aborted && this.view === "list")
      this.renderList();
  }
  private async download(spec: {
    url: string;
    maxBytes: number;
    sha256?: string;
  }) {
    const { downloadPublicationResource } = await import("./publish-desktop");
    return downloadPublicationResource(spec, this.installation.signal);
  }
  private async refreshRegistry() {
    try {
      const result = await registryListing(
        publicationResourceCache(this.plugin),
        "families",
        readRegistryFamilies,
        async () => {
          const items = await registryFamilies((spec) => this.download(spec));
          return {
            value: { schemaVersion: 1, templates: items },
            parsed: items,
          };
        },
      );
      this.families = result.items;
      this.status = result.offline
        ? "Offline · showing the last registry listing. Installed versions remain available."
        : this.families.length
          ? "Choose a template, then select versions to add."
          : "No templates have been published yet.";
    } catch (error) {
      this.status =
        error instanceof Error
          ? error.message
          : "The registry is unavailable. Installed versions still work offline.";
    }
    this.renderCurrentList();
  }
  private async chooseFamily(id: string) {
    this.selectedFamily = id;
    this.installationStatus = "";
    this.installationFailed = false;
    this.selectedVersions.clear();
    this.releases = [];
    const request = ++this.listingRequest;
    this.status = "Loading versions…";
    this.renderList();
    if (!id) {
      this.status = "Choose a template.";
      this.renderList();
      return;
    }
    try {
      const listing = await registryListing(
        publicationResourceCache(this.plugin),
        `versions-${id}`,
        (v) => readRegistryReleases(v, id),
        async () => {
          const items = await registryReleases(
            (spec) => this.download(spec),
            id,
          );
          return {
            value: {
              schemaVersion: 1,
              id,
              releases: items.map((r) => ({
                ...r,
                available: true,
                publication: "published",
              })),
            },
            parsed: items,
          };
        },
      );
      const releases = listing.items;
      if (request !== this.listingRequest) return;
      this.releases = releases;
      this.status = listing.offline
        ? "Offline · cached versions shown. New installations require the mirror."
        : "Select versions, then click Install. Installed versions appear below, ready to use.";
    } catch (error) {
      if (request !== this.listingRequest) return;
      this.status =
        error instanceof Error
          ? error.message
          : "Could not load versions. Retry when connected.";
    }
    this.renderCurrentList();
  }
  private async installSelected() {
    if (this.busy || !this.selectedVersions.size) return;
    this.busy = true;
    this.installationFailed = false;
    const family = this.selectedFamily;
    const versions = [...this.selectedVersions];
    const failures: string[] = [];
    let completed = 0;
    let installed = 0;
    for (const version of versions) {
      if (this.installation.signal.aborted) break;
      this.installationStatus = `Installing ${version} (${++completed}/${versions.length})…`;
      this.renderCurrentList();
      try {
        const manifest = await registryInstallation(
          (spec) => this.download(spec),
          family,
          version,
        );
        await installedTemplateResources(
          publicationResourceCache(this.plugin),
          manifest,
          this.installation.signal,
          true,
        );
        if (this.installation.signal.aborted) break;
        await savePublishingTemplates(
          this.plugin,
          enableVerifiedInstallation(
            publishingTemplatesFor(this.plugin),
            manifest,
          ),
        );
        this.selectedVersions.delete(version);
        installed++;
      } catch (error) {
        failures.push(
          `${version}: ${error instanceof Error ? error.message : "Installation failed."}`,
        );
      }
    }
    this.busy = false;
    if (this.installation.signal.aborted) return;
    this.installationFailed = failures.length > 0;
    const success = installed
      ? `${installed} version${installed === 1 ? "" : "s"} installed and enabled. Ready to use under Your templates.`
      : "";
    this.installationStatus = [
      success,
      ...(failures.length
        ? [
            "Installation failed. Failed versions have not been added. Retry installing them later.",
            ...failures,
          ]
        : []),
    ]
      .filter(Boolean)
      .join("\n");
    new Notice(
      failures.length
        ? "Template installation failed. See the error beside Install."
        : success,
    );
    this.renderCurrentList();
  }
  private installationDetails(manifest: TemplateInstallation) {
    const modal = new Modal(this.plugin.app);
    modal.setTitle(
      `${manifest.name} · ${manifest.pin.metadata.upstreamVersion}`,
    );
    new Setting(modal.contentEl)
      .setName("Exact release")
      .setDesc(manifest.pin.metadata.version);
    new Setting(modal.contentEl)
      .setName("License")
      .setDesc(String(manifest.pin.metadata.license));
    modal.contentEl.createEl("p", {
      text: "Original sources and required notices are retained in the verified cache.",
    });
    const link = modal.contentEl.createEl("a", {
      text: "License and source details",
      href: `${new URL(TEMPLATE_REGISTRY_ORIGIN).origin}/licenses?template=${manifest.pin.metadata.templateId}`,
    });
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    new Setting(modal.contentEl)
      .setName("Repair cached resources")
      .addButton((button) =>
        button.setButtonText("Repair").onClick(() => {
          button.setDisabled(true);
          void installedTemplateResources(
            publicationResourceCache(this.plugin),
            manifest,
            this.installation.signal,
            true,
          ).then(
            () => {
              new Notice("Template resources verified.");
              modal.close();
            },
            (error: unknown) => {
              new Notice(
                error instanceof Error ? error.message : "Repair failed.",
              );
              button.setDisabled(false);
            },
          );
        }),
      );
    new Setting(modal.contentEl)
      .setName("Remove installed version")
      .setDesc(
        "Keeps notes, publication history and cached resources. Documents using this version will need it reinstalled before publishing.",
      )
      .addButton((button) =>
        button.setButtonText("Remove").onClick(() => {
          new ConfirmModal(this.plugin.app, {
            title: `Remove ${manifest.name} ${manifest.pin.metadata.upstreamVersion}?`,
            message: [
              "Notes and publication history are kept. You can reinstall this exact release later.",
            ],
            confirmLabel: "Remove",
            warning: true,
            confirm: async () => {
              await savePublishingTemplates(
                this.plugin,
                removeInstallation(
                  publishingTemplatesFor(this.plugin),
                  installationId(manifest),
                ),
              );
              modal.close();
              this.renderList();
            },
            onError: fail,
          }).open();
        }),
      );
    modal.open();
  }

  constructor(private plugin: StratumPlugin) {
    super(plugin.app);
    this.modalEl.addClass("stratum-modal");
  }

  onOpen(): void {
    this.renderList();
    if (Platform.isDesktop) void this.refreshRegistry();
  }

  private renderList(): void {
    this.view = "list";
    this.contentEl.empty();
    this.setTitle("Publishing templates");
    const state = publishingTemplatesFor(this.plugin);
    new Setting(this.contentEl)
      .setName("Add from registry")
      .setDesc(
        Platform.isDesktop
          ? this.status
          : "Template installation requires desktop Obsidian.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Choose a template…");
        for (const family of this.families)
          dropdown.addOption(family.id, family.name);
        dropdown
          .setValue(this.selectedFamily)
          .setDisabled(this.busy || !Platform.isDesktop)
          .onChange((id) => {
            void this.chooseFamily(id);
          });
        dropdown.selectEl.setAttribute("aria-label", "Registry template");
      })
      .addButton((button) =>
        button
          .setButtonText("Refresh")
          .setDisabled(this.busy || !Platform.isDesktop)
          .onClick(() => {
            void this.refreshRegistry();
            if (this.selectedFamily)
              void this.chooseFamily(this.selectedFamily);
          }),
      );
    const versionList = this.contentEl.createDiv({
      cls: "stratum-template-versions",
    });
    let updateAddButton = () => {};
    for (const release of this.releases) {
      const installed = state.installations?.some(
        (m) =>
          m.pin.metadata.templateId === this.selectedFamily &&
          m.pin.metadata.version === release.version,
      );
      new Setting(versionList)
        .setName(release.upstreamVersion)
        .setDesc(installed ? "Installed" : `Revision ${release.revision}`)
        .addToggle((toggle) => {
          toggle.toggleEl.setAttribute(
            "aria-label",
            `Select ${this.selectedFamily} ${release.upstreamVersion}, revision ${release.revision}`,
          );
          toggle
            .setValue(!!installed || this.selectedVersions.has(release.version))
            .setDisabled(this.busy || !!installed)
            .onChange((value) => {
              if (value) this.selectedVersions.add(release.version);
              else this.selectedVersions.delete(release.version);
              updateAddButton();
            });
        });
    }
    if (this.releases.length)
      new Setting(this.contentEl).addButton((button) => {
        updateAddButton = () => {
          button
            .setButtonText(
              this.selectedVersions.size
                ? `Install ${this.selectedVersions.size} selected version${this.selectedVersions.size === 1 ? "" : "s"}`
                : "Select versions to install",
            )
            .setDisabled(this.busy || !this.selectedVersions.size);
        };
        button.setCta().onClick(() => {
          void this.installSelected();
        });
        updateAddButton();
      });
    if (this.installationStatus) {
      const feedback = this.contentEl.createDiv();
      feedback.setAttribute(
        "role",
        this.installationFailed ? "alert" : "status",
      );
      if (this.installationFailed) feedback.addClass("stratum-publish-error");
      for (const text of this.installationStatus.split("\n"))
        feedback.createEl("p", { text });
    }
    if (state.unavailableInstallations?.length)
      this.contentEl.createEl("p", {
        text: "Some saved versions need a newer plugin or repaired metadata. Their records and document selections are retained.",
        cls: "setting-item-description",
      });
    this.contentEl.createEl("h3", { text: "Your templates" });
    const all = {
      ...state,
      templates: [
        ...state.templates,
        ...(state.installations ?? []).map(installedPublishingTemplate),
      ],
    };
    for (const family of publishingTemplateFamilies(all, true)) {
      const template = all.templates.find(
        (t) => publishingTemplateId(t) === family.id,
      )!;
      const manifest = state.installations?.find(
        (m) => installationId(m) === template.id,
      );
      const row = new Setting(this.contentEl)
        .setName(
          manifest
            ? `${template.name} · ${manifest.pin.metadata.upstreamVersion}`
            : template.name,
        )
        .setDesc(
          manifest
            ? `${manifest.pin.metadata.upstreamVersion} · ${manifest.pin.metadata.templateId === "aastex" ? "Bibliography: nonprofit use only." : "Verified registry release."}`
            : `${template.documentType === "academic" ? "Academic paper" : "General document"} · ${isBuiltInTemplate(template.id) ? "Built-in; editable and cannot be deleted." : "Custom template."}`,
        );
      if (manifest)
        row.addButton((button) =>
          button
            .setButtonText("Details")
            .onClick(() => this.installationDetails(manifest)),
        );
      if (!template.renderer)
        row.addButton((button) =>
          styleStratumComponent(button)
            .setButtonText("Configure")
            .onClick(() => this.editTemplate(template.id)),
        );
      row.addToggle((toggle) => {
        toggle.toggleEl.setAttribute(
          "aria-label",
          `Enable ${template.name}${template.version ? ` ${template.version.label}` : ""}`,
        );
        const enabled = publishingTemplateEnabled(state, template);
        let changing = false;
        styleStratumComponent(toggle)
          .setValue(enabled)
          .onChange((value) => {
            if (changing) return;
            changing = true;
            toggle.setDisabled(true);
            if (value && template.renderer)
              row.setDesc("Installing and verifying template resources…");
            void setPublishingTemplateEnabled(
              this.plugin,
              family.id,
              value,
              () =>
                template.renderer
                  ? installedTemplateResources(
                      publicationResourceCache(this.plugin),
                      manifest!,
                      this.installation.signal,
                      true,
                    )
                  : Promise.resolve(),
              this.installation.signal,
            ).then(
              () => {
                this.renderCurrentList();
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
    this.contentEl.createEl("h3", { text: "Custom templates" });
    new Setting(this.contentEl)
      .setName("Create your own template")
      .setDesc(
        "Start from a built-in template and customize it. Registry versions are installed above.",
      )
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Create custom template")
          .onClick(() => this.addTemplate()),
      );
  }

  private addTemplate(): void {
    this.view = "edit";
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
    this.view = "edit";
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
