import {
  createStratumDisclosure,
  createStratumSummary,
  styleStratumComponent,
  createStratumButton,
} from "./ui-controls";
import { Modal, Setting } from "obsidian";
import type StratumPlugin from "./plugin";
import { choosePublishExecutable } from "./publish-desktop";
import { PLUGIN_WEB_APP_URL } from "./build-config";
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
  private reset!: HTMLButtonElement;
  private controls: (HTMLInputElement | HTMLButtonElement)[] = [];
  private rows = new Map<
    Tool,
    { badge: HTMLElement; detail: HTMLElement; path: HTMLElement }
  >();
  constructor(private plugin: StratumPlugin) {
    super(plugin.app);
    this.modalEl.addClass("stratum-modal");
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
      text: "PDF documents, created on your computer.",
    });
    const tools = contentEl.createDiv({
      cls: "stratum-publish-tools",
      attr: { "aria-live": "polite" },
    });
    for (const [tool, label] of [
      ["pandoc", "Pandoc"],
      ["tectonic", "Tectonic"],
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
              this.syncReset();
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
                this.syncReset();
                await this.plugin.saveSettings();
                await publish.check(true);
              } catch (error) {
                publish.fail(error);
              }
            });
        });
      // Keep the description after the input without flattening its parent with CSS.
      setting.settingEl.append(setting.descEl);
      this.rows.get(tool)!.path = setting.descEl;
    }
    const reset = createStratumButton(advanced, {
      text: "Use automatic detection",
      wrap: true,
    });
    this.reset = reset;
    this.controls.push(reset);
    reset.addEventListener("click", () => {
      this.plugin.settings.pandocPath = this.plugin.settings.tectonicPath = "";
      publish.invalidateSupport();
      this.syncReset();
      for (const control of this.controls)
        if (control.tagName === "INPUT")
          (control as HTMLInputElement).value = "";
      // The reset button hides itself, so keep keyboard focus in the section.
      this.controls.find((control) => control.tagName === "INPUT")?.focus();
      void this.plugin
        .saveSettings()
        .then(() => publish.check(true))
        .catch((error) => publish.fail(error));
    });
    this.downloadNote = contentEl.createEl("p", {
      cls: "stratum-publish-meta",
      text: "First-time setup may download files needed to publish PDFs.",
    });
    this.status = contentEl.createDiv({
      cls: "stratum-publish-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    let checkOnIdle = !publish.readiness?.pdf;
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    this.secondary = createStratumButton(actions, { text: "Check again" });
    this.secondary.addEventListener("click", () => {
      if (publish.checking) {
        checkOnIdle = false;
        publish.cancel();
      } else void publish.check(true);
    });
    this.primary = createStratumButton(actions, {
      text: "Check again",
      primary: true,
    });
    this.primary.addEventListener("click", () => {
      if (publish.readiness?.pdf) this.close();
      else void publish.check(true);
    });
    // A lightweight check may still be running when opened from Publish.
    // Finish verification once it settles, without repeating successful setup.
    const checkWhenIdle = () => {
      if (!checkOnIdle || publish.checking || publish.busy) return;
      checkOnIdle = false;
      if (!publish.readiness?.pdf) void publish.check(true);
    };
    this.unsubscribe = publish.subscribe(() => {
      this.updateStatus();
      checkWhenIdle();
    });
    this.updateStatus();
    checkWhenIdle();
  }
  private updateStatus(): void {
    const publish = this.plugin.publish!;
    const ready = publish.readiness;
    const missing: Tool[] = [];
    for (const tool of ["pandoc", "tectonic"] as const) {
      const state = publishingToolState(
        ready?.[tool],
        !!(tool === "pandoc" ? ready?.pandoc.path : ready?.pdf),
        tool === "pandoc" ? ready?.pandoc.error : ready?.pdfError,
        publish.checking,
      );
      const row = this.rows.get(tool)!;
      row.badge.setText(state.label);
      row.badge.toggleClass("is-ready", state.ready);
      row.detail.setText(state.detail);
      row.detail.toggleClass(
        "stratum-publish-error",
        (!!ready?.[tool].path &&
          !!(tool === "pandoc" ? ready.pandoc.error : ready.pdfError)) ||
          !!ready?.[tool].foundPath,
      );
      const path = ready?.[tool].path || ready?.[tool].foundPath || "";
      row.path.empty();
      if (path) {
        row.path.createSpan({
          text: this.hasCustomPath(tool)
            ? "Custom path"
            : "Found automatically",
        });
        row.path.createSpan({ cls: "stratum-publish-path", text: path });
      }
      if (state.missing) missing.push(tool);
    }
    this.help.empty();
    this.help.hidden = !missing.length;
    if (missing.length) {
      createStratumButton(this.help, {
        text: "View installation guide",
        wrap: true,
      }).addEventListener("click", () => {
        const url = new URL("/install-dependencies", PLUGIN_WEB_APP_URL);
        window.open(url.toString(), "_blank", "noopener,noreferrer");
      });
    }
    this.syncReset();
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
    this.secondary.hidden = !publish.checking && !ready?.pdf;
    this.secondary.disabled = publish.busy;
    for (const control of this.controls)
      control.disabled = publish.checking || publish.busy;
  }
  /** Mirrors detection: a bare tool name still means automatic lookup. */
  private hasCustomPath(tool: Tool): boolean {
    const value =
      this.plugin.settings[
        tool === "pandoc" ? "pandocPath" : "tectonicPath"
      ].trim();
    return !!value && value !== tool && value !== `${tool}.exe`;
  }
  private syncReset(): void {
    this.reset.hidden =
      !this.hasCustomPath("pandoc") && !this.hasCustomPath("tectonic");
  }
  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }
}
