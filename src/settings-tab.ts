import { PluginSettingTab, Setting } from "obsidian";
import type { LiteratureNoteFilenameFormat } from "./literature-note-filenames";
import type StratumPlugin from "./plugin";
import { DEFAULT_NOTE_FOLDER } from "./constants";

export class StratumSettingTab extends PluginSettingTab {
  plugin: StratumPlugin;

  constructor(plugin: StratumPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  private createSection(containerEl: HTMLElement, title: string): HTMLElement {
    const sectionEl = containerEl.createDiv({
      cls: "stratum-settings-section",
    });
    new Setting(sectionEl).setName(title).setHeading();

    return sectionEl.createDiv({
      cls: "stratum-settings-panel",
    });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("stratum-settings-tab");

    const accountEmail = this.plugin.settings.accountEmail;
    const zoteroConnection = this.plugin.zoteroConnection;
    const zoteroConnected = Boolean(zoteroConnection?.connected);
    const linkedAt = this.plugin.settings.accountLinkedAt
      ? new Date(this.plugin.settings.accountLinkedAt).toLocaleString()
      : null;
    const zoteroLinkedAt = zoteroConnection?.lastSyncedAt
      ? new Date(zoteroConnection.lastSyncedAt).toLocaleString()
      : null;

    const workspaceSection = this.createSection(containerEl, "Workspace");

    new Setting(workspaceSection)
      .setName("Stratum account")
      .setDesc(
        accountEmail
          ? linkedAt
            ? `Signed in as ${accountEmail}. Linked on ${linkedAt}.`
            : `Signed in as ${accountEmail}.`
          : this.plugin.settings.lastDeviceCode
            ? "Browser sign-in has been opened for this device. Finish the flow and return to Obsidian."
            : "Not signed in yet."
      )
      .addButton((button) =>
        button
          .setButtonText(accountEmail ? "Reconnect sign-in" : "Sign in")
          .setCta()
          .onClick(async () => {
            await this.plugin.startDeviceHandoff();
            this.display();
          })
      );

    const tokenInvalid = zoteroConnection?.tokenValid === false;
    new Setting(workspaceSection)
      .setName("Zotero library")
      .setDesc(
        accountEmail
          ? this.plugin.isLoadingZoteroConnection
            ? "Checking Zotero connection status..."
            : tokenInvalid
              ? "Zotero connection is no longer valid. Please reconnect."
              : zoteroConnected
                ? zoteroLinkedAt
                  ? `Connected as ${zoteroConnection?.zoteroUsername ?? "your Zotero account"}. Last confirmed on ${zoteroLinkedAt}.`
                  : `Connected as ${zoteroConnection?.zoteroUsername ?? "your Zotero account"}.`
                : "Not connected yet."
          : "Sign in to your Stratum account first."
      )
      .addButton((button) => {
        const canConnectZotero = Boolean(accountEmail);
        const needsReconnect = tokenInvalid || !zoteroConnected;
        button
          .setButtonText(needsReconnect ? "Connect Zotero" : "Refresh status")
          .setDisabled(!canConnectZotero || this.plugin.isLoadingZoteroConnection)
          .onClick(async () => {
            if (!canConnectZotero) {
              return;
            }

            if (needsReconnect) {
              await this.plugin.startZoteroConnect();
            } else {
              await this.plugin.refreshZoteroConnection();
            }
            this.display();
          });

        if (needsReconnect) {
          button.setCta();
        }
      });

    new Setting(workspaceSection)
      .setName("Open library view")
      .setDesc("Jump back to the paper picker and literature-note workflow.")
      .addButton((button) =>
        button.setButtonText("Open view").onClick(async () => {
          await this.plugin.activateView();
        })
      );

    const syncSection = this.createSection(containerEl, "Sync");

    new Setting(syncSection)
      .setName("Sync status")
      .setDesc(
        this.plugin.settings.zoteroAutoSync.lastError
          ? `${this.plugin.getAutoSyncStatusLabel()}. Last error: ${this.plugin.settings.zoteroAutoSync.lastError}`
          : this.plugin.settings.zoteroAutoSync.lastSuccessfulSyncAt
            ? `${this.plugin.getAutoSyncStatusLabel()}. Last successful sync: ${new Date(
                this.plugin.settings.zoteroAutoSync.lastSuccessfulSyncAt
              ).toLocaleString()}.`
            : this.plugin.getAutoSyncStatusLabel()
      )
      .addButton((button) =>
        button
          .setButtonText(
            this.plugin.isZoteroAutoSyncRunning() ? "Syncing..." : "Sync now"
          )
          .setDisabled(this.plugin.isZoteroAutoSyncRunning())
          .setCta()
          .onClick(async () => {
            await this.plugin.runZoteroAutoSync("manual");
            this.display();
          })
      );

    new Setting(syncSection)
      .setName("Auto-sync Zotero changes")
      .setDesc(
        "Refresh existing literature notes on startup, when Obsidian regains focus, and on the interval below."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.configureAutoSyncInterval();
            if (value) {
              void this.plugin.runZoteroAutoSync("startup");
            }
            this.display();
          })
      );

    const intervalSetting = new Setting(syncSection)
      .setName("Auto-sync interval (minutes)")
      .setDesc(
        "How often the plugin checks for remote library changes. Default: 15 minutes."
      );
    intervalSetting.addText((text) => {
      text
        .setPlaceholder("15")
        .setValue(String(this.plugin.settings.autoSyncIntervalMinutes))
        .onChange(async (value) => {
          const parsed = Number(value);
          this.plugin.settings.autoSyncIntervalMinutes =
            Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 15;
          await this.plugin.saveSettings();
          this.plugin.configureAutoSyncInterval();
        });

      text.inputEl.addClass("stratum-interval-input");
      text.inputEl.setAttr("inputmode", "numeric");
      text.inputEl.setAttr("aria-label", "Auto-sync interval in minutes");
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.step = "1";
    });

    const defaultsSection = this.createSection(containerEl, "Workspace defaults");

    new Setting(defaultsSection)
      .setName("Literature notes folder")
      .setDesc("Default destination for generated literature notes.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_NOTE_FOLDER)
          .setValue(this.plugin.settings.notesFolder)
          .onChange(async (value) => {
            this.plugin.settings.notesFolder = value.trim() || DEFAULT_NOTE_FOLDER;
            await this.plugin.saveSettings();
            await this.plugin.rebuildItemFileMap();
          })
      );

    new Setting(defaultsSection)
      .setName("Literature note filename format")
      .setDesc(
        "Controls how new literature notes are named. Existing notes are not bulk-renamed when this changes. The citation key format currently uses a generated fallback until richer citekey support is wired in."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("readable", "Readable format (author-year title)")
          .addOption("citekey", "Citation key format (@author2020title)")
          .setValue(this.plugin.settings.filenameFormat)
          .onChange(async (value) => {
            this.plugin.settings.filenameFormat = value as LiteratureNoteFilenameFormat;
            await this.plugin.saveSettings();
          })
      );
  }
}
