import { Component, Modal, Setting, TFile, normalizePath } from "obsidian";
import type StratumPlugin from "./plugin";
import {
  readTemplatePackage,
  packageAssetPath,
  packageVariant,
  type TemplatePackage,
  resolvePackageResources,
} from "./publication-package";
import { renderTemplatePackage } from "./publication-package-render";
import { publicationManuscript } from "./publication-manuscript";
import { detectPublishTool } from "./publish-desktop";
import { publishingWorkspace } from "./publish-workspace";
import { pluginStorageDirectory } from "./plugin-storage-paths";

/** Local proof-of-concept UI. Package fields and variants come exclusively from the manifest. */
export class PublicationPackageModal extends Modal {
  private readonly aborter = new AbortController();
  private manifestPath = "";
  private loadedPath = "";
  private busy = false;
  private loading = false;
  private readonly lifecycle = new Component();
  private manifest?: TemplatePackage;
  private variant = "";
  private manuscript?: ReturnType<typeof publicationManuscript>;
  private values = new Map<string, string>();
  private status?: HTMLElement;
  constructor(
    private readonly plugin: StratumPlugin,
    private readonly note: TFile,
  ) {
    super(plugin.app);
    plugin.addChild(this.lifecycle);
    this.lifecycle.register(() => {
      if (!this.aborter.signal.aborted) {
        this.aborter.abort();
        this.close();
      }
    });
  }
  onOpen(): void {
    this.titleEl.setText("Publish with a template package (experimental)");
    this.contentEl.createEl("p", {
      text: "Choose a local package manifest. The package supplies its layouts, variants and fields. Citations use references.json beside the manifest. This experiment supports Markdown text, math and basic tables; images and Obsidian embeds are not supported yet.",
    });
    new Setting(this.contentEl)
      .setName("Package manifest")
      .addText((t) =>
        t.setPlaceholder("Path/to/manifest.json").onChange((value) => {
          this.manifestPath = value;
        }),
      )
      .addButton((b) =>
        b.setButtonText("Load package").onClick(() => {
          void this.load();
        }),
      );
    this.status = this.contentEl.createEl("p", {
      attr: { role: "status", "aria-live": "polite" },
    });
  }
  private async load(): Promise<void> {
    if (this.busy || this.loading) return;
    this.loading = true;
    this.manifest = undefined;
    this.manuscript = undefined;
    this.contentEl
      .querySelectorAll(".stratum-package-fields")
      .forEach((el) => el.remove());
    try {
      if (
        !this.manifestPath ||
        this.manifestPath.startsWith("/") ||
        this.manifestPath.split(/[\\/]/).includes("..")
      )
        throw new Error("Choose a manifest inside this vault.");
      const file = this.app.vault.getAbstractFileByPath(
        normalizePath(this.manifestPath),
      );
      if (!(file instanceof TFile) || file.extension !== "json")
        throw new Error("Package manifest not found.");
      const manifest = readTemplatePackage(
        JSON.parse(await this.app.vault.read(file)),
      );
      const manuscript = publicationManuscript(
        await this.app.vault.read(this.note),
        "body",
      );
      if (this.aborter.signal.aborted) return;
      this.loadedPath = file.path;
      this.manifest = manifest;
      this.manuscript = manuscript;
      this.variant = this.manifest.defaultVariant;
      this.contentEl
        .querySelectorAll(".stratum-package-fields")
        .forEach((el) => el.remove());
      const fields = this.contentEl.createDiv({
        cls: "stratum-package-fields",
      });
      new Setting(fields).setName("Variant").addDropdown((d) => {
        for (const v of this.manifest!.variants) d.addOption(v.id, v.label);
        d.setValue(this.variant).onChange((id) => {
          this.variant = id;
          this.drawFields(details);
        });
      });
      const details = fields.createDiv();
      this.drawFields(details);
      new Setting(fields)
        .setName("Publish PDF")
        .setDesc(
          "Creates a new PDF beside the active note. Existing files are preserved.",
        )
        .addButton((b) =>
          b
            .setButtonText("Publish PDF")
            .setCta()
            .onClick(() => {
              b.setDisabled(true);
              void this.publish().finally(() => {
                b.setDisabled(false);
              });
            }),
        );
      this.status?.setText(
        `Loaded ${this.manifest.name}. Uses the active note’s title, authors and abstract.`,
      );
    } catch (error) {
      this.status?.setText(
        error instanceof Error ? error.message : "Could not load package.",
      );
    } finally {
      this.loading = false;
    }
  }
  private drawFields(container: HTMLElement): void {
    container.empty();
    this.values.clear();
    if (!this.manifest || !this.manuscript) return;
    for (const f of packageVariant(this.manifest, this.variant).fields) {
      const value =
        this.manuscript.properties[f.key] ??
        (f.type === "list" ? f.default.split("\n").filter(Boolean) : f.default);
      const initial = Array.isArray(value)
        ? value.join("\n")
        : typeof value === "string"
          ? value
          : "";
      this.values.set(f.key, initial);
      const setting = new Setting(container)
        .setName(f.label)
        .setDesc(
          `${f.required ? "Required. " : ""}${f.type === "list" ? "One value per line." : f.type === "date" ? "YYYY-MM-DD." : ""}`,
        );
      if (f.type === "list")
        setting.addTextArea((t) =>
          t.setValue(initial).onChange((v) => {
            this.values.set(f.key, v);
          }),
        );
      else
        setting.addText((t) =>
          t.setValue(initial).onChange((v) => {
            this.values.set(f.key, v);
          }),
        );
    }
  }
  private async publish(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.manifest || !this.manuscript)
        throw new Error("Load a package first.");
      const manifest = this.manifest,
        manuscript = this.manuscript;
      const variantId = this.variant,
        values = new Map(this.values);
      const loadedPath = this.loadedPath;
      const signal = this.aborter.signal;
      this.status?.setText("Verifying package resources…");
      const directory = loadedPath.slice(0, loadedPath.lastIndexOf("/") + 1);
      const resources = await resolvePackageResources(
        {
          adapter: this.app.vault.adapter,
          directory: `${pluginStorageDirectory(this.app)}/package-cache`,
        },
        manifest,
        async (s) => {
          const asset = manifest.assets.find(
            (a) => packageAssetPath(manifest, a) === new URL(s.url).pathname,
          );
          if (!asset) throw new Error("Unknown package asset.");
          return new Uint8Array(
            await this.app.vault.adapter.readBinary(directory + asset.name),
          );
        },
        "https://local-package.invalid",
        false,
        signal,
      );
      const refPath = directory + "references.json";
      const references = (await this.app.vault.adapter.exists(refPath))
        ? (JSON.parse(await this.app.vault.adapter.read(refPath)) as unknown)
        : [];
      if (
        !Array.isArray(references) ||
        references.some((r) => !r || typeof r !== "object" || Array.isArray(r))
      )
        throw new Error(
          "references.json must contain a list of CSL references.",
        );
      const variant = packageVariant(manifest, variantId);
      const properties = { ...manuscript.properties };
      for (const f of variant.fields) {
        const value = values.get(f.key) ?? "";
        properties[f.key] =
          f.type === "list"
            ? value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
            : value;
      }
      this.status?.setText("Checking publishing tools…");
      const [pandoc, tectonic] = await Promise.all([
        detectPublishTool("pandoc", this.plugin.settings.pandocPath, signal),
        detectPublishTool(
          "tectonic",
          this.plugin.settings.tectonicPath,
          signal,
        ),
      ]);
      if (!pandoc.path || !tectonic.path)
        throw new Error(
          "Configure Pandoc and Tectonic in Publishing settings first.",
        );
      this.status?.setText("Rendering PDF…");
      const { pdf } = await renderTemplatePackage(
        {
          package: manifest,
          variant: variantId,
          manuscript: { ...manuscript, properties },
          references: references as Record<string, unknown>[],
          resources,
        },
        {
          workspace: publishingWorkspace(this.app),
          pandoc: pandoc.path,
          tectonic: tectonic.path,
        },
        { signal },
      );
      let index = 0,
        path = "";
      do {
        path = this.note.path.replace(
          /\.md$/i,
          `.package${index ? `-${index}` : ""}.pdf`,
        );
        index++;
      } while (await this.app.vault.adapter.exists(path));
      if (signal.aborted) return;
      await this.app.vault.createBinary(path, Uint8Array.from(pdf).buffer);
      this.status?.setText(`Created ${path}`);
    } catch (error) {
      if (!this.aborter.signal.aborted)
        this.status?.setText(
          error instanceof Error ? error.message : "Publishing failed.",
        );
    } finally {
      this.busy = false;
    }
  }
  onClose(): void {
    this.aborter.abort();
    this.plugin.removeChild(this.lifecycle);
    this.contentEl.empty();
  }
}
