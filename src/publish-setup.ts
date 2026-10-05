import { Modal, Setting } from "obsidian";
import type StratumPlugin from "./plugin";
import { choosePublishExecutable, publishPlatform } from "./publish-desktop";

export class PublishSetupModal extends Modal {
  private unsubscribe: (() => void) | null = null;
  private status!: HTMLElement;
  private checkButton!: HTMLButtonElement;
  private finishButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private paths: HTMLInputElement[] = [];
  private steps: HTMLElement[] = [];
  private chooseButtons: HTMLButtonElement[] = [];
  constructor(private plugin: StratumPlugin) {
    super(plugin.app);
  }
  onOpen(): void {
    const publish = this.plugin.publish;
    if (!publish) {
      this.close();
      return;
    }
    this.setTitle("Set up publishing");
    const { contentEl } = this;
    contentEl.addClass("stratum-publish-setup");
    contentEl.createEl("p", {
      text: "Pandoc creates .docx documents. Tectonic also enables PDF creation. Everything runs on your computer.",
    });
    const { platform, arch } = publishPlatform();
    const system =
      platform === "darwin"
        ? `macOS (${arch === "arm64" ? "Apple silicon" : "Intel"})`
        : platform === "win32"
          ? `Windows (${arch === "arm64" ? "ARM64" : "64-bit"})`
          : `Linux (${arch})`;
    contentEl.createEl("p", {
      cls: "stratum-publish-meta",
      text: `Setup for ${system}`,
    });
    this.status = contentEl.createDiv({
      attr: { role: "status", "aria-live": "polite" },
    });
    this.installStep(
      "1. Set up Word",
      platform === "win32"
        ? "Download the Windows .msi installer, open it, and follow the installation steps. Then choose Check again."
        : platform === "darwin"
          ? "Download the macOS .pkg installer, open it, and follow the installation steps. Then choose Check again."
          : "Install Pandoc using your distribution’s package manager or its official Linux package. Then choose Check again.",
      "Get Pandoc",
      "https://pandoc.org/installing.html",
    );
    this.installStep(
      "2. Set up PDF",
      `Download the Tectonic archive for ${system}, extract it to a permanent folder, then choose the ${platform === "win32" ? "tectonic.exe" : "tectonic"} file below.`,
      "Get Tectonic",
      "https://tectonic-typesetting.github.io/book/latest/installation/",
    );
    if (platform === "darwin") {
      const brew = contentEl.createEl("details");
      brew.createEl("summary", { text: "Homebrew users" });
      brew.createEl("p", {
        text: "Run this command in your terminal, then check again.",
      });
      brew.createEl("code").appendText("brew install pandoc tectonic");
      const copy = brew.createEl("button", { text: "Copy command" });
      copy.addEventListener("click", () => {
        void navigator.clipboard
          .writeText("brew install pandoc tectonic")
          .catch((error) => publish.fail(error));
      });
    }
    for (const tool of ["pandoc", "tectonic"] as const) {
      const key = tool === "pandoc" ? "pandocPath" : "tectonicPath";
      const label = tool === "pandoc" ? "Pandoc" : "Tectonic";
      new Setting(contentEl)
        .setName(`${label} location`)
        .setDesc("Already installed? Choose the executable file.")
        .addButton((button) => {
          this.chooseButtons.push(button.buttonEl);
          button.setButtonText(`Choose ${label} file`).onClick(async () => {
            try {
              const selected = await choosePublishExecutable(label);
              if (selected) {
                this.plugin.settings[key] = selected;
                await this.plugin.saveSettings();
                publish.readiness = null;
                this.paths[tool === "pandoc" ? 0 : 1].value = selected;
                await publish.check();
              }
            } catch (error) {
              publish.fail(error);
            }
          });
        });
    }
    const advanced = contentEl.createEl("details");
    advanced.createEl("summary", { text: "Advanced: executable paths" });
    for (const [key, label] of [
      ["pandocPath", "Pandoc"],
      ["tectonicPath", "Tectonic"],
    ] as const)
      new Setting(advanced).setName(`${label} path`).addText((input) => {
        this.paths.push(input.inputEl);
        input
          .setPlaceholder("Detect automatically")
          .setValue(this.plugin.settings[key])
          .onChange((value) => {
            this.plugin.settings[key] = value.trim();
            publish.readiness = null;
          });
        input.inputEl.addEventListener("blur", () => {
          void this.plugin.saveSettings().catch((error) => publish.fail(error));
        });
      });
    contentEl.createEl("p", {
      text: "Finish setup checks both formats using a sample document. Tectonic may download supporting files the first time; your notes are not uploaded. This can take several minutes.",
    });
    const actions = contentEl.createDiv({ cls: "stratum-publish-actions" });
    this.checkButton = actions.createEl("button", { text: "Check again" });
    this.checkButton.addEventListener("click", () => {
      void publish.check();
    });
    this.finishButton = actions.createEl("button", {
      text: "Finish setup",
      cls: "mod-cta",
    });
    this.finishButton.addEventListener("click", () => {
      void publish.check(true);
    });
    this.cancelButton = actions.createEl("button", { text: "Cancel check" });
    this.cancelButton.addEventListener("click", () => publish.cancel());
    const done = actions.createEl("button", { text: "Done" });
    done.addEventListener("click", () => this.close());
    this.unsubscribe = publish.subscribe(() => this.updateStatus());
    this.updateStatus();
    if (!publish.readiness && !publish.checking) void publish.check();
  }
  private installStep(
    title: string,
    description: string,
    label: string,
    url: string,
  ): void {
    const section = this.contentEl.createDiv({ cls: "stratum-publish-step" });
    this.steps.push(section);
    section.createEl("h3", { text: title });
    section.createEl("p", { text: description });
    const link = section.createEl("a", {
      text: label,
      href: url,
      cls: "stratum-publish-install-link",
    });
    link.setAttr("target", "_blank");
    link.setAttr("rel", "noopener noreferrer");
  }
  private updateStatus(): void {
    const publish = this.plugin.publish!;
    this.status.empty();
    const ready = publish.readiness;
    if (this.steps[0]) this.steps[0].hidden = !!ready?.word;
    if (this.steps[1]) this.steps[1].hidden = !!ready?.pdf;
    for (const [label, tool] of [
      ["Pandoc", ready?.pandoc],
      ["Tectonic", ready?.tectonic],
    ] as const) {
      this.status.createEl("p", {
        text: `${label}: ${tool?.version || tool?.error || "Not checked"}`,
      });
    }
    this.status.createEl("p", {
      text: `Word: ${ready?.word ? "Ready" : ready?.wordError || "Setup needed"}`,
    });
    this.status.createEl("p", {
      text: `PDF: ${ready?.pdf ? "Ready" : ready?.pdfError || (ready?.tectonic.path ? "Choose Finish setup to verify PDF support" : "Setup needed")}`,
    });
    if (publish.progress) this.status.createEl("p", { text: publish.progress });
    if (publish.error)
      this.status.createEl("p", {
        text: publish.error,
        cls: "stratum-publish-error",
      });
    this.checkButton.disabled = this.finishButton.disabled =
      publish.checking || publish.busy;
    this.cancelButton.hidden = !publish.checking;
    for (const input of this.paths)
      input.disabled = publish.checking || publish.busy;
    for (const button of this.chooseButtons)
      button.disabled = publish.checking || publish.busy;
  }
  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }
}
