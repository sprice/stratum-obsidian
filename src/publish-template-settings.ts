import { installedTemplateGroups } from "./publishing-template-list";
import { onTemplateInstalled } from "./publishing-template-events";
import type { PackageInstallation } from "./publication-package-installation";
import {
  PackageInstallModal,
  installPublishingPackage,
} from "./publication-package-installer";
import {
  packageRegistryListing,
  type PackageCatalogRelease,
} from "./publication-package-catalog";
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
  type PublishingTemplate,
  type PublishingTemplates,
} from "./publish-templates";
import { createStratumAction, styleStratumComponent } from "./ui-controls";
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

const openTemplateManagers = new WeakMap<
  StratumPlugin,
  PublishingTemplatesModal
>();

/** Keeps template fields out of the main plugin settings page. */
export class PublishingTemplatesModal extends Modal {
  private async removePackage(id: string, version: string): Promise<void> {
    const current = publishingTemplatesFor(this.plugin);
    await savePublishingTemplates(this.plugin, {
      ...current,
      packageInstallations: current.packageInstallations?.filter(
        (i) => i.manifest.id !== id || i.manifest.version !== version,
      ),
      enabledIds: current.enabledIds?.filter(
        (value) => value !== `download:${id}:${version}`,
      ),
    });
    this.renderList();
  }
  private readonly installation = new AbortController();
  private families: RegistryFamily[] = [];
  private releases: (RegistryRelease | PackageCatalogRelease)[] = [];
  private packages: PackageCatalogRelease[] = [];
  private packageCatalogOffline = false;
  private selectedFamily = "";
  private selectedVersions = new Set<string>();
  private status = "Choose a template, then select versions to add.";
  private statusRequest = 0;
  private statusTimer?: number;
  private registrySetting?: Setting;
  private installationStatus = "";
  private installationFailed = false;
  private lastInstalledId?: string;
  private busy = false;
  private listingRequest = 0;
  private familyRequest = 0;
  private view: "list" | "edit" = "list";
  private renderCurrentList() {
    if (!this.installation.signal.aborted && this.view === "list")
      this.renderList();
  }
  private setRegistryStatus(message: string) {
    this.status = message;
    this.registrySetting?.setDesc(message);
  }
  private beginRegistryStatus(ready: string, unavailable: string) {
    window.clearTimeout(this.statusTimer);
    const request = ++this.statusRequest;
    let elapsed = false;
    let warning = unavailable;
    this.setRegistryStatus(ready);
    this.statusTimer = window.setTimeout(() => {
      elapsed = true;
      if (request !== this.statusRequest || this.installation.signal.aborted)
        return;
      this.setRegistryStatus(warning);
    }, 3000);
    return (message: string, offline = false) => {
      if (request !== this.statusRequest || this.installation.signal.aborted)
        return;
      if (offline) {
        warning = message;
        if (!elapsed) return;
      } else {
        window.clearTimeout(this.statusTimer);
      }
      this.setRegistryStatus(message);
    };
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
    const request = ++this.familyRequest;
    const unavailable =
      "The registry is unavailable. Installed versions still work offline.";
    const finishStatus = this.beginRegistryStatus(
      "Choose a template, then select versions to add.",
      unavailable,
    );
    try {
      const [legacy, packages] = await Promise.allSettled([
        registryListing(
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
        ),
        packageRegistryListing(publicationResourceCache(this.plugin), (spec) =>
          this.download(spec),
        ),
      ]);
      if (legacy.status === "rejected" && packages.status === "rejected")
        throw new Error(unavailable);
      const result =
        legacy.status === "fulfilled"
          ? legacy.value
          : { items: [], offline: false };
      const packageResult =
        packages.status === "fulfilled"
          ? packages.value
          : { items: [], offline: false };
      if (request !== this.familyRequest || this.installation.signal.aborted)
        return;
      this.packages = packageResult.items;
      this.packageCatalogOffline = packageResult.offline;
      const families = new Map(
        result.items.map((family) => [family.id, family]),
      );
      for (const entry of this.packages)
        families.set(entry.id, {
          id: entry.id,
          name: entry.name,
          versionCount: this.packages.filter((p) => p.id === entry.id).length,
        });
      this.families = [...families.values()];
      const partial = [
        ...(legacy.status === "rejected"
          ? ["The template registry is unavailable."]
          : []),
        ...(packages.status === "rejected"
          ? ["The template package catalog is unavailable."]
          : []),
      ].join(" ");
      finishStatus(
        partial ||
          (result.offline || packageResult.offline
            ? "Offline · showing cached registry listings where needed. Installed versions remain available."
            : this.families.length
              ? "Choose a template, then select versions to add."
              : "No templates have been published yet."),
        !!partial || result.offline || packageResult.offline,
      );
    } catch (error) {
      if (request !== this.familyRequest || this.installation.signal.aborted)
        return;
      finishStatus(error instanceof Error ? error.message : unavailable, true);
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
    const ready = id
      ? "Select versions, then click Install. Installed versions appear below, ready to use."
      : "Choose a template, then select versions to add.";
    const unavailable = "Could not load versions. Retry when connected.";
    const finishStatus = this.beginRegistryStatus(ready, unavailable);
    if (!id) {
      finishStatus(ready);
      this.renderList();
      return;
    }
    this.renderList();
    const packages = this.packages.filter((p) => p.id === id);
    if (packages.length) {
      this.releases = packages.sort((a, b) =>
        b.version.localeCompare(a.version, "en", { numeric: true }),
      );
      finishStatus(
        this.packageCatalogOffline
          ? "Offline · cached package versions shown. Installation verifies resources with the mirror."
          : ready,
        this.packageCatalogOffline,
      );
      this.renderCurrentList();
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
      finishStatus(
        listing.offline
          ? "Offline · cached versions shown. New installations require the mirror."
          : ready,
        listing.offline,
      );
    } catch (error) {
      if (request !== this.listingRequest) return;
      finishStatus(error instanceof Error ? error.message : unavailable, true);
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
        const packaged = this.packages.find(
          (p) => p.id === family && p.version === version,
        );
        if (packaged) {
          await installPublishingPackage(
            this.plugin,
            packaged,
            this.installation.signal,
          );
          this.lastInstalledId = `download:${packaged.id}:${packaged.version}`;
          this.selectedVersions.delete(version);
          installed++;
          continue;
        }
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
        this.lastInstalledId = installationId(manifest);
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
    const state = publishingTemplatesFor(this.plugin);
    const total = this.packages.some((p) => p.id === family)
      ? (state.packageInstallations ?? []).filter(
          (p) => p.manifest.id === family,
        ).length
      : new Set(
          (state.installations ?? [])
            .filter((manifest) => manifest.pin.metadata.templateId === family)
            .map((manifest) => manifest.pin.metadata.version),
        ).size;
    const success = installed
      ? `Added ${installed} version${installed === 1 ? "" : "s"}. ${total} version${total === 1 ? " of this template is" : "s of this template are"} installed.`
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

  private stopWatching?: () => void;
  private highlightTimer?: number;

  constructor(
    private plugin: StratumPlugin,
    private targetId?: string,
  ) {
    super(plugin.app);
    this.modalEl.addClass("stratum-modal");
  }

  onOpen(): void {
    const previous = openTemplateManagers.get(this.plugin);
    if (previous && previous !== this) previous.close();
    openTemplateManagers.set(this.plugin, this);
    this.stopWatching = onTemplateInstalled(this.plugin, () =>
      this.renderCurrentList(),
    );
    this.renderList();
    if (Platform.isDesktop) void this.refreshRegistry();
  }

  private renderList(): void {
    this.view = "list";
    this.contentEl.empty();
    this.setTitle("Publishing templates");
    const state = publishingTemplatesFor(this.plugin);
    const registrySetting = new Setting(this.contentEl)
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
        styleStratumComponent(button)
          .setButtonText("Refresh")
          .setDisabled(this.busy || !Platform.isDesktop)
          .onClick(() => {
            void this.refreshRegistry().then(() => {
              if (this.selectedFamily && !this.installation.signal.aborted)
                void this.chooseFamily(this.selectedFamily);
            });
          }),
      );
    this.registrySetting = registrySetting;
    registrySetting.settingEl.addClass("stratum-template-registry");
    createStratumAction(
      this.contentEl.createDiv({ cls: "stratum-template-registry-link" }),
      { text: "View registry" },
    ).addEventListener("click", () => {
      window.open(
        new URL("/", TEMPLATE_REGISTRY_ORIGIN).href,
        "_blank",
        "noopener,noreferrer",
      );
    });
    const versionList = this.contentEl.createDiv({
      cls: "stratum-template-versions",
    });
    let updateAddButton = () => {};
    for (const release of this.releases) {
      const packaged = "sha256" in release;
      const installed = packaged
        ? state.packageInstallations?.some(
            (p) =>
              p.manifest.id === this.selectedFamily &&
              p.manifest.version === release.version,
          )
        : state.installations?.some(
            (m) =>
              m.pin.metadata.templateId === this.selectedFamily &&
              m.pin.metadata.version === release.version,
          );
      const label = packaged ? release.version : release.upstreamVersion;
      const description = packaged
        ? "Includes the template’s layouts and licensed resources."
        : `Revision ${release.revision}`;
      new Setting(versionList)
        .setName(label)
        .setDesc(installed ? "Installed" : description)
        .addToggle((toggle) => {
          toggle.toggleEl.setAttribute(
            "aria-label",
            `Select ${this.selectedFamily} ${label}${packaged ? "" : `, revision ${release.revision}`}`,
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
      if (this.lastInstalledId && !this.busy)
        new Setting(feedback).addButton((button) =>
          button.setButtonText("View installed template").onClick(() => {
            this.targetId = this.lastInstalledId;
            this.renderList();
          }),
        );
    }
    if (state.unavailableInstallations?.length)
      this.contentEl.createEl("p", {
        text: "Some saved versions need a newer plugin or repaired metadata. Their records and document selections are retained.",
        cls: "setting-item-description",
      });
    this.contentEl.createEl("h3", { text: "Installed templates" });
    for (const group of installedTemplateGroups(state)) {
      let container = this.contentEl;
      if (group.rows.length > 1) {
        const details = this.contentEl.createEl("details");
        details.open = true;
        details.createEl("summary", {
          text: `${group.name} · ${group.rows.length} installed versions`,
        });
        container = details;
      }
      for (const item of group.rows) {
        const {
          template,
          installation: manifest,
          packageInstallation: packaged,
        } = item;
        const row = new Setting(container)
          .setName(
            item.version ? `${template.name} · ${item.version}` : template.name,
          )
          .setDesc(
            packaged
              ? `From template registry · ${packaged.manifest.variants.map((v) => v.label).join(" · ")}`
              : manifest
                ? `From template registry · ${manifest.pin.metadata.templateId === "aastex" ? "Bibliography: nonprofit use only." : `Earlier registry format · revision ${manifest.pin.metadata.revision}.`}`
                : `${template.documentType === "academic" ? "Academic paper" : "General document"} · ${isBuiltInTemplate(template.id) ? "Built-in; editable and cannot be deleted." : "Custom template."}`,
          );
        row.settingEl.setAttribute("data-template-id", item.id);
        if (item.id === this.targetId) {
          row.settingEl.addClass("stratum-template-installed-target");
          row.settingEl.setAttribute("tabindex", "-1");
          row.settingEl.scrollIntoView({ block: "center" });
          row.settingEl.focus({ preventScroll: true });
          window.clearTimeout(this.highlightTimer);
          this.highlightTimer = window.setTimeout(() => {
            row.settingEl.removeClass("stratum-template-installed-target");
            if (this.targetId === item.id) this.targetId = undefined;
          }, 4000);
        }
        if (packaged) {
          row.addButton((button) =>
            button
              .setButtonText("Details")
              .onClick(() => this.packageDetails(packaged)),
          );
          row.addButton((button) =>
            button.setButtonText("Remove").onClick(() => {
              new ConfirmModal(this.plugin.app, {
                title: `Remove ${packaged.manifest.name} ${packaged.manifest.version}?`,
                message: [
                  "Notes and publication history are kept. You can reinstall this version later.",
                ],
                confirmLabel: "Remove",
                warning: true,
                confirm: () =>
                  this.removePackage(
                    packaged.manifest.id,
                    packaged.manifest.version,
                  ),
                onError: fail,
              }).open();
            }),
          );
        }
        if (manifest)
          row.addButton((button) =>
            button
              .setButtonText("Details")
              .onClick(() => this.installationDetails(manifest)),
          );
        if (manifest)
          row.addButton((button) =>
            button.setButtonText("Remove").onClick(() => {
              new ConfirmModal(this.plugin.app, {
                title: `Remove ${template.name} ${item.version}?`,
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
                      item.id,
                    ),
                  );
                  this.renderCurrentList();
                },
                onError: fail,
              }).open();
            }),
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
            `Enable ${template.name}${item.version ? ` ${item.version}` : ""}`,
          );
          const enabled = publishingTemplateEnabled(state, template);
          let changing = false;
          styleStratumComponent(toggle)
            .setValue(enabled)
            .onChange((value) => {
              if (changing) return;
              changing = true;
              toggle.setDisabled(true);
              if (value && manifest)
                row.setDesc("Installing and verifying template resources…");
              void setPublishingTemplateEnabled(
                this.plugin,
                item.id,
                value,
                () =>
                  manifest
                    ? installedTemplateResources(
                        publicationResourceCache(this.plugin),
                        manifest,
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
    }
    this.contentEl.createEl("h3", { text: "Create a template" });
    new Setting(this.contentEl)
      .setName("Create your own template")
      .setDesc("Start from a built-in template and customize it.")
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Create custom template")
          .onClick(() => this.addTemplate()),
      );
  }

  private packageDetails(installed: PackageInstallation): void {
    const modal = new Modal(this.app);
    const p = installed.manifest;
    modal.setTitle(`${p.name} · ${p.version}`);
    modal.contentEl.createEl("p", {
      text: "From template registry · verified resources. Updates install alongside existing versions.",
    });
    modal.contentEl.createEl("p", {
      text: p.variants.map((v) => v.label).join(" · "),
    });
    new Setting(modal.contentEl).addButton((button) =>
      button.setButtonText("Verify / reinstall").onClick(() => {
        modal.close();
        new PackageInstallModal(this.plugin, {
          id: p.id,
          version: p.version,
          sha256: installed.sha256,
        }).open();
      }),
    );
    modal.open();
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
    if (openTemplateManagers.get(this.plugin) === this)
      openTemplateManagers.delete(this.plugin);
    this.stopWatching?.();
    window.clearTimeout(this.highlightTimer);
    window.clearTimeout(this.statusTimer);
    this.registrySetting = undefined;
    this.installation.abort();
    this.contentEl.empty();
  }
}
