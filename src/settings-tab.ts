import { PluginSettingTab, Setting } from "obsidian";
import type { LiteratureNoteFilenameFormat } from "./literature-note-filenames";
import type StratumPlugin from "./plugin";
import { DEFAULT_NOTE_FOLDER } from "./constants";
import {
  disableLibrary,
  enableGroupLibrary,
  getLibraryAutoSyncState,
  getPersonalLibrary,
} from "./plugin-libraries";
import { getSyncStatusLabel } from "./zotero-sync";

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
    const lastKnownZoteroUsername =
      zoteroConnection?.zoteroUsername ?? this.plugin.settings.lastKnownZoteroUsername;
    const linkedAt = this.plugin.settings.accountLinkedAt
      ? new Date(this.plugin.settings.accountLinkedAt).toLocaleString()
      : null;
    const lastKnownZoteroLinkedAt =
      zoteroConnection?.lastSyncedAt ?? this.plugin.settings.lastKnownZoteroConfirmedAt;
    const zoteroLinkedAt = lastKnownZoteroLinkedAt
      ? new Date(lastKnownZoteroLinkedAt).toLocaleString()
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
            : "Sign in to Stratum."
      )
      .addButton((button) =>
        button
          .setButtonText(accountEmail ? "Sign out of Stratum" : "Sign in to Stratum")
          .setCta()
          .onClick(async () => {
            if (accountEmail) {
              await this.plugin.signOutFromPlugin();
            } else {
              await this.plugin.startDeviceHandoff();
            }
            this.display();
          })
      );

    const tokenInvalid = zoteroConnection?.tokenValid === false;
    const lastKnownZoteroSummary = lastKnownZoteroUsername
      ? zoteroLinkedAt
        ? `Last connected as ${lastKnownZoteroUsername}. Last confirmed on ${zoteroLinkedAt}.`
        : `Last connected as ${lastKnownZoteroUsername}.`
      : null;
    new Setting(workspaceSection)
      .setName("Zotero library")
      .setDesc(
        accountEmail
          ? this.plugin.isLoadingZoteroConnection
            ? "Checking Zotero connection status..."
            : tokenInvalid
              ? lastKnownZoteroSummary
                ? `Connect to Zotero. ${lastKnownZoteroSummary}`
                : "Connect to Zotero."
              : zoteroConnected
                ? zoteroLinkedAt
                  ? `Connected as ${zoteroConnection?.zoteroUsername ?? "your Zotero account"}. Last confirmed on ${zoteroLinkedAt}.`
                  : `Connected as ${zoteroConnection?.zoteroUsername ?? "your Zotero account"}.`
                : lastKnownZoteroSummary
                  ? `Signed out of Zotero. Connect Zotero again to search and sync papers. ${lastKnownZoteroSummary}`
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

    const librariesSection = this.createSection(containerEl, "Libraries");
    const personalLibrary = getPersonalLibrary(this.plugin);
    if (personalLibrary) {
      new Setting(librariesSection)
        .setName("Personal library")
        .setDesc(
          zoteroConnected
            ? `Always enabled. Connected as ${zoteroConnection?.zoteroUsername ?? "your Zotero account"}.`
            : "Always enabled once Zotero is connected."
        );
    }

    if (!accountEmail || !zoteroConnected) {
      new Setting(librariesSection)
        .setName("Available groups")
        .setDesc("Connect Zotero to load your group libraries.");
    } else if (this.plugin.availableGroups.length === 0) {
      new Setting(librariesSection)
        .setName("Available groups")
        .setDesc("No Zotero group libraries are available for this account.");
    } else {
      for (const group of this.plugin.availableGroups) {
        const identity = `group:${group.id}`;
        const isEnabled = this.plugin.settings.enabledLibraries.some(
          (library) => library.identity === identity
        );
        new Setting(librariesSection)
          .setName(group.name)
          .setDesc(group.type)
          .addToggle((toggle) =>
            toggle
              .setDisabled(
                this.plugin.isBulkLibrarySyncRunning() ||
                  this.plugin.isZoteroAutoSyncRunning()
              )
              .setValue(isEnabled)
              .onChange(async (value) => {
                if (value) {
                  enableGroupLibrary(this.plugin, group);
                } else {
                  disableLibrary(this.plugin, identity);
                }

                await this.plugin.saveSettings();
                this.plugin.refreshViews();
                this.display();
              })
          );
      }
    }

    const syncSection = this.createSection(containerEl, "Sync");

    new Setting(syncSection)
      .setName("Sync libraries")
      .setDesc(
        "Check enabled libraries for remote changes to notes that already exist in your vault."
      )
      .addButton((button) =>
        button
          .setButtonText(
            this.plugin.isBulkLibrarySyncRunning()
              ? "Bulk sync running..."
              : this.plugin.isZoteroAutoSyncRunning()
              ? "Syncing..."
              : "Sync now"
          )
          .setDisabled(
            !accountEmail ||
              !zoteroConnected ||
            this.plugin.isZoteroAutoSyncRunning() ||
              this.plugin.isBulkLibrarySyncRunning()
          )
          .setCta()
          .onClick(async () => {
            await this.plugin.runZoteroAutoSync("manual");
            this.display();
          })
      );

    for (const library of this.plugin.settings.enabledLibraries) {
      const state = getLibraryAutoSyncState(this.plugin, library);
      new Setting(syncSection)
        .setName(library.name)
        .setDesc(
          state.lastError
            ? `${getSyncStatusLabel({
                isSyncing: this.plugin.isZoteroAutoSyncRunning(),
                autoSyncEnabled: this.plugin.settings.autoSyncEnabled,
                state,
              })}. Last error: ${state.lastError}`
            : state.lastSuccessfulSyncAt
              ? `${getSyncStatusLabel({
                  isSyncing: this.plugin.isZoteroAutoSyncRunning(),
                  autoSyncEnabled: this.plugin.settings.autoSyncEnabled,
                  state,
                })}. Last successful sync: ${new Date(
                  state.lastSuccessfulSyncAt
                ).toLocaleString()}.`
              : getSyncStatusLabel({
                  isSyncing: this.plugin.isZoteroAutoSyncRunning(),
                  autoSyncEnabled: this.plugin.settings.autoSyncEnabled,
                  state,
                })
        );
    }

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
