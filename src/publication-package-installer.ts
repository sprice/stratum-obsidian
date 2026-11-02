import { Component, Modal, Notice, Platform, Setting } from "obsidian";
import type StratumPlugin from "./plugin";
import {
  installTemplatePackage,
  readPackageLink,
} from "./publication-package-installation";
import { readPublishingTemplates } from "./publish-templates";
import { pluginStorageDirectory } from "./plugin-storage-paths";
import { downloadPublicationResource } from "./publish-desktop";
import { TEMPLATE_REGISTRY_ORIGIN } from "./publication-registry";

const installing = new WeakSet<StratumPlugin>();
export class PackageInstallModal extends Modal {
  private aborter = new AbortController();
  private lifecycle = new Component();
  private busy = false;
  constructor(
    private plugin: StratumPlugin,
    private request: ReturnType<typeof readPackageLink>,
  ) {
    super(plugin.app);
    plugin.addChild(this.lifecycle);
    this.lifecycle.register(() => {
      this.aborter.abort();
      this.close();
    });
  }
  onOpen(): void {
    this.setTitle("Install template");
    this.contentEl.createEl("p", {
      text: `${this.request.id} · ${this.request.version}`,
    });
    this.contentEl.createEl("p", {
      text: `Vault: ${this.app.vault.getName()}. Downloads the template and its licensed resources from ${TEMPLATE_REGISTRY_ORIGIN}. Existing template versions and documents are kept. Requires desktop Obsidian, Pandoc 3.12+, and Tectonic 0.17+.`,
    });
    const status = this.contentEl.createEl("p", {
      attr: { role: "status", "aria-live": "polite" },
    });
    new Setting(this.contentEl)
      .addButton((b) => {
        b.setButtonText("Cancel").onClick(() => this.close());
      })
      .addButton((b) => {
        b.setButtonText("Install template")
          .setCta()
          .onClick(() => {
            if (this.busy) return;
            if (installing.has(this.plugin)) {
              status.setText(
                "Another installation is running. Finish or cancel it before trying again.",
              );
              return;
            }
            this.busy = true;
            installing.add(this.plugin);
            b.setDisabled(true).setButtonText("Installing…");
            status.setText("Downloading and verifying template…");
            void this.install()
              .then((name) => {
                if (this.aborter.signal.aborted) return;
                this.setTitle("Template installed");
                this.contentEl.empty();
                this.contentEl.createEl("p", {
                  text: `${name} is ready to use in ${this.app.vault.getName()}.`,
                });
                this.contentEl.createEl("p", {
                  text: "Select a layout from the template menu in the publishing panel.",
                });
                new Setting(this.contentEl).addButton((done) => {
                  done
                    .setButtonText("Done")
                    .setCta()
                    .onClick(() => this.close());
                });
              })
              .catch((error) => {
                if (!this.aborter.signal.aborted)
                  status.setText(
                    error instanceof Error
                      ? error.message
                      : "Installation failed.",
                  );
              })
              .finally(() => {
                this.busy = false;
                installing.delete(this.plugin);
                b.setDisabled(false).setButtonText("Install template");
              });
          });
      });
  }
  private async install(): Promise<string> {
    const signal = this.aborter.signal;
    const p = await installTemplatePackage(
      this.request,
      {
        adapter: this.app.vault.adapter,
        directory: `${pluginStorageDirectory(this.app)}/package-cache`,
      },
      (spec) => downloadPublicationResource(spec, signal),
      signal,
    );
    if (signal.aborted) throw new Error("Installation cancelled.");
    const previous = this.plugin.settings.publishingTemplates;
    const state = readPublishingTemplates(previous);
    const existing = state.packageInstallations?.find(
      (i) =>
        i.manifest.id === p.manifest.id &&
        i.manifest.version === p.manifest.version,
    );
    if (existing && existing.sha256 !== p.sha256)
      throw new Error(
        "This immutable version has changed. Install a new version instead.",
      );
    const next = readPublishingTemplates({
      ...state,
      packageInstallations: [
        ...(state.packageInstallations ?? []).filter((i) => i !== existing),
        p,
      ],
      enabledIds: [
        ...new Set([
          ...(state.enabledIds ?? []),
          `download:${p.manifest.id}:${p.manifest.version}`,
        ]),
      ],
    });
    this.plugin.settings.publishingTemplates = next;
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      if (this.plugin.settings.publishingTemplates === next)
        this.plugin.settings.publishingTemplates = previous;
      throw error;
    }
    this.plugin.refreshViews();
    return p.manifest.name;
  }
  onClose(): void {
    this.aborter.abort();
    this.plugin.removeChild(this.lifecycle);
    this.contentEl.empty();
  }
}
export function openPackageInstall(
  plugin: StratumPlugin,
  params: Record<string, string>,
): void {
  try {
    if (!Platform.isDesktopApp)
      throw new Error("Template publishing requires desktop Obsidian.");
    new PackageInstallModal(plugin, readPackageLink(params)).open();
  } catch (error) {
    new Notice(
      error instanceof Error ? error.message : "Invalid template link.",
    );
  }
}
