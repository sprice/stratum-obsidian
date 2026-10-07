import {
  createStratumDisclosure,
  createStratumSummary,
  styleStratumComponent,
  createStratumAction,
} from "./ui-controls";
import { Modal, Setting } from "obsidian";
import type StratumPlugin from "./plugin";
import { choosePublishExecutable, publishPlatform } from "./publish-desktop";
import {
  publishingSetupAction,
  publishingToolState,
} from "./publish-setup-state";

type Tool = "pandoc" | "tectonic";
export class PublishSetupModal extends Modal {
  private unsubscribe: (() => void) | null = null;
  private status!: HTMLElement;
  private primary!: HTMLButtonElement;
  private secondary!: HTMLButtonElement;
  private help!: HTMLElement;
  private downloadNote!: HTMLElement;
  private controls: (HTMLInputElement | HTMLButtonElement)[] = [];
  private rows = new Map<
    Tool,
    { badge: HTMLElement; detail: HTMLElement; path: HTMLElement }
  >();
  constructor(private plugin: StratumPlugin) {
    super(plugin.app);
  }
  onOpen(): void {
    const publish = this.plugin.publish;
    if (!publish) {
      this.close();
      return;
    }
    this.setTitle("Publishing tools");
    const { contentEl } = this;
    contentEl.addClass("stratum-publish-setup");
    this.controls = [];
    this.rows.clear();
    contentEl.createEl("p", {
      text: "Word and PDF documents, created on your computer.",
    });
    const tools = contentEl.createDiv({
      cls: "stratum-publish-tools",
      attr: { "aria-live": "polite" },
    });
    for (const [tool, label] of [
      ["pandoc", "PDF & Word • Pandoc"],
      ["tectonic", "PDF · Tectonic"],
    ] as const) {
      const row = tools.createDiv({ cls: "stratum-publish-tool" });
      const heading = row.createDiv({ cls: "stratum-publish-tool-heading" });
      heading.createEl("strong", { text: label });
      const badge = heading.createSpan({ cls: "stratum-publish-tool-state" });
      const detail = row.createDiv({ cls: "stratum-publish-meta" });
      this.rows.set(tool, { badge, detail, path: detail });
    }
    this.help = contentEl.createDiv({ cls: "stratum-publish-install" });
    const advanced = createStratumDisclosure(contentEl);
    createStratumSummary(advanced, { text: "Advanced" });
    advanced.createEl("p", {
      cls: "stratum-publish-meta",
      text: "Tools are found automatically. Choose a location only for a custom installation.",
    });
    for (const tool of ["pandoc", "tectonic"] as const) {
      const key = tool === "pandoc" ? "pandocPath" : "tectonicPath";
      const label = tool === "pandoc" ? "Pandoc" : "Tectonic";
      let inputEl: HTMLInputElement;
      const setting = new Setting(advanced)
        .setName(label)
        .addText((input) => {
          styleStratumComponent(input);
          inputEl = input.inputEl;
          this.controls.push(inputEl);
          input
            .setPlaceholder("Automatic")
            .setValue(this.plugin.settings[key])
            .onChange((value) => {
              this.plugin.settings[key] = value.trim();
              publish.invalidateSupport();
            });
          inputEl.setAttribute("aria-label", `${label} executable path`);
          inputEl.addEventListener("blur", () => {
            void this.plugin
              .saveSettings()
              .catch((error) => publish.fail(error));
          });
        })
        .addButton((button) => {
          styleStratumComponent(button);
          this.controls.push(button.buttonEl);
          button
            .setButtonText("Browse…")
            .setTooltip(`Choose ${label} executable`)
            .onClick(async () => {
              try {
                const selected = await choosePublishExecutable(label);
                if (!selected) return;
                this.plugin.settings[key] = selected;
                publish.invalidateSupport();
                inputEl.value = selected;
                await this.plugin.saveSettings();
                await publish.check();
              } catch (error) {
                publish.fail(error);
              }
            });
        });
      this.rows.get(tool)!.path = setting.descEl;
    }
    const reset = createStratumAction(advanced, {
      text: "Use automatic detection",
    });
    this.controls.push(reset);
    reset.addEventListener("click", () => {
      this.plugin.settings.pandocPath = this.plugin.settings.tectonicPath = "";
      publish.invalidateSupport();
      for (const control of this.controls)
        if (control.tagName === "INPUT")
          (control as HTMLInputElement).value = "";
      void this.plugin
        .saveSettings()
        .then(() => publish.check())
        .catch((error) => publish.fail(error));
    });
    this.downloadNote = contentEl.createEl("p", {
      cls: "stratum-publish-meta",
      text: "The first PDF check may download typesetting files and take a few minutes. Your notes stay on this computer.",
    });
    this.status = contentEl.createDiv({
      cls: "stratum-publish-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    const actions = contentEl.createDiv({
      cls: "stratum-publish-actions stratum-publish-setup-actions",
    });
    this.secondary = createStratumAction(actions);
    this.secondary.addEventListener("click", () => {
      if (publish.checking) publish.cancel();
      else void publish.check(true);
    });
    this.primary = createStratumAction(actions, { cls: "mod-cta" });
    this.primary.addEventListener("click", () => {
      if (publish.readiness?.word && publish.readiness.pdf) this.close();
      else void publish.check(true);
    });
    this.unsubscribe = publish.subscribe(() => this.updateStatus());
    this.updateStatus();
    // Successful setup is cached. Failed or incomplete setup can be retried here.
    if (
      !(publish.readiness?.word && publish.readiness.pdf) &&
      !publish.checking &&
      !publish.busy
    )
      void publish.check();
  }
  private updateStatus(): void {
    const publish = this.plugin.publish!;
    const ready = publish.readiness;
    const missing: Tool[] = [];
    for (const tool of ["pandoc", "tectonic"] as const) {
      const state = publishingToolState(
        ready?.[tool],
        !!(tool === "pandoc" ? ready?.word : ready?.pdf),
        tool === "pandoc" ? ready?.wordError : ready?.pdfError,
        publish.checking,
      );
      const row = this.rows.get(tool)!;
      row.badge.setText(state.label);
      row.badge.toggleClass("is-ready", state.ready);
      row.detail.setText(state.detail);
      row.detail.toggleClass(
        "stratum-publish-error",
        (!!ready?.[tool].path &&
          !!(tool === "pandoc" ? ready.wordError : ready.pdfError)) ||
          !!ready?.[tool].foundPath,
      );
      row.path.setText(ready?.[tool].path || ready?.[tool].foundPath || "");
      if (state.missing) missing.push(tool);
    }
    this.help.empty();
    this.help.hidden = !missing.length;
    if (missing.length) {
      this.help.createEl("p", {
        text: "Install the missing tools, then check again.",
      });
      for (const tool of missing) {
        const link = this.help.createEl("a", {
          text: tool === "pandoc" ? "Get Pandoc" : "Get Tectonic",
          href:
            tool === "pandoc"
              ? "https://pandoc.org/installing.html"
              : "https://tectonic-typesetting.github.io/book/latest/installation/",
        });
        link.setAttr("target", "_blank");
        link.setAttr("rel", "noopener noreferrer");
      }
      if (publishPlatform().platform === "darwin") {
        const brew = createStratumDisclosure(this.help);
        createStratumSummary(brew, { text: "Homebrew installation" });
        const command = `brew install ${missing.join(" ")}`;
        brew.createEl("code", { text: command });
      }
    }
    this.downloadNote.hidden = !!ready?.pdf;
    this.status.empty();
    if (publish.progress) this.status.createEl("p", { text: publish.progress });
    if (publish.error)
      this.status.createEl("p", {
        text: publish.error,
        cls: "stratum-publish-error",
      });
    if (!publish.checking && ready?.tectonic.path && !ready.pandoc.path)
      this.status.createEl("p", { text: "Pandoc is also required for PDF." });
    this.primary.setText(publishingSetupAction(ready, publish.checking));
    this.primary.disabled = publish.checking || publish.busy;
    this.secondary.setText(publish.checking ? "Cancel check" : "Check again");
    this.secondary.hidden = !publish.checking && !(ready?.word && ready.pdf);
    this.secondary.disabled = publish.busy;
    for (const control of this.controls)
      control.disabled = publish.checking || publish.busy;
  }
  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }
}
