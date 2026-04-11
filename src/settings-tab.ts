import { Platform, PluginSettingTab, Setting } from "obsidian";
import { isPendingAuthStale } from "./auth-flow";
import { PLUGIN_WEB_APP_URL } from "./build-config";
import type { LiteratureNoteFilenameFormat } from "./literature-note-filenames";
import type StratumPlugin from "./plugin";
import { DEFAULT_NOTE_FOLDER } from "./constants";
import {
  disableLibrary,
  enableGroupLibrary,
  getPersonalLibrary,
} from "./plugin-libraries";
import { clearLocalSyncState } from "./plugin-local-sync";
import { getDefaultZoteroDataDir } from "./zotero-data-dir";

export class StratumSettingTab extends PluginSettingTab {
  plugin: StratumPlugin;

  constructor(plugin: StratumPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  private openDashboard(): void {
    const dashboardUrl = new URL("/dashboard", PLUGIN_WEB_APP_URL).toString();
    window.open(dashboardUrl, "_blank", "noopener,noreferrer");
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
    const pendingAuth = isPendingAuthStale({
      pendingAuth: this.plugin.settings.pendingAuth,
    })
      ? null
      : this.plugin.settings.pendingAuth;
    const zoteroConnection = this.plugin.zoteroConnection;
    const zoteroConnected = Boolean(zoteroConnection?.connected);
    const isPendingStratumSignIn = pendingAuth?.flow === "stratum-sign-in";
    const isPendingZoteroConnect = pendingAuth?.flow === "zotero-connect";
    const lastKnownZoteroUsername =
      zoteroConnection?.zoteroUsername ??
      this.plugin.settings.lastKnownZoteroUsername;
    const linkedAt = this.plugin.settings.accountLinkedAt
      ? new Date(this.plugin.settings.accountLinkedAt).toLocaleString()
      : null;
    const lastKnownZoteroLinkedAt =
      zoteroConnection?.lastSyncedAt ??
      this.plugin.settings.lastKnownZoteroConfirmedAt;
    const zoteroLinkedAt = lastKnownZoteroLinkedAt
      ? new Date(lastKnownZoteroLinkedAt).toLocaleString()
      : null;

    const workspaceSection = this.createSection(containerEl, "Workspace");

    const accountSetting = new Setting(workspaceSection)
      .setName("Stratum account")
      .setDesc(
        accountEmail
          ? linkedAt
            ? `Signed in as ${accountEmail}. Linked on ${linkedAt}.`
            : `Signed in as ${accountEmail}.`
          : isPendingStratumSignIn
            ? "Browser sign-in has been opened for this device. Finish the flow and return to Obsidian."
            : "Sign in to Stratum.",
      );

    if (accountEmail) {
      accountSetting
        .addButton((button) =>
          button.setButtonText("Manage").onClick(() => {
            this.openDashboard();
          }),
        )
        .addButton((button) => {
          button.buttonEl.addClass("stratum-button-danger-subtle");
          button.setButtonText("Log out").onClick(async () => {
            await this.plugin.signOutFromPlugin();
            this.display();
          });
        });
    } else {
      accountSetting.addButton((button) =>
        button
          .setButtonText("Sign in")
          .setCta()
          .onClick(async () => {
            await this.plugin.startDeviceHandoff();
            this.display();
          }),
      );
    }

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
            : isPendingZoteroConnect && !zoteroConnected
              ? "Browser Zotero connection has been opened for this device. Finish the flow and return to Obsidian."
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
          : "Sign in to your Stratum account first.",
      )
      .addButton((button) => {
        const canConnectZotero = Boolean(accountEmail);
        const needsReconnect = tokenInvalid || !zoteroConnected;
        button
          .setButtonText(needsReconnect ? "Connect Zotero" : "Refresh status")
          .setDisabled(
            !canConnectZotero || this.plugin.isLoadingZoteroConnection,
          )
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
            : "Always enabled once Zotero is connected.",
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
          (library) => library.identity === identity,
        );
        new Setting(librariesSection)
          .setName(group.name)
          .setDesc(group.type)
          .addToggle((toggle) =>
            toggle
              .setDisabled(
                this.plugin.isBulkLibrarySyncRunning() ||
                  this.plugin.isZoteroAutoSyncRunning(),
              )
              .setValue(isEnabled)
              .onChange(async (value) => {
                if (value) {
                  enableGroupLibrary(this.plugin, group);
                } else {
                  disableLibrary(this.plugin, identity);
                }

                this.plugin.localSync.reconcileEnabledLibraries();
                await this.plugin.saveSettings();
                await this.plugin.reconcileLocalLiveSync();
                this.plugin.refreshViews();
                this.display();
              }),
          );
      }
    }

    const syncSection = this.createSection(containerEl, "Sync");

    if (Platform.isDesktopApp) {
      const bulkSyncSetting = new Setting(syncSection)
        .setName("Bulk sync")
        .setDesc("Enable desktop bulk sync from your local Zotero app.")
        .addToggle((toggle) =>
          toggle
            .setDisabled(
              this.plugin.isCheckingBulkSyncReadiness ||
                (!this.plugin.settings.bulkSyncEnabled &&
                  (!accountEmail || !zoteroConnected)),
            )
            .setValue(this.plugin.settings.bulkSyncEnabled)
            .onChange(async (value) => {
              if (!value) {
                this.plugin.settings.bulkSyncEnabled = false;
                this.plugin.settings.bulkSyncPreferenceInitialized = true;
                this.plugin.bulkSyncSettingsError = null;
                clearLocalSyncState(this.plugin);
                await this.plugin.saveSettings();
                await this.plugin.reconcileLocalLiveSync();
                this.plugin.refreshViews();
                this.display();
                return;
              }

              this.plugin.isCheckingBulkSyncReadiness = true;
              this.plugin.bulkSyncSettingsError = null;
              this.display();

              try {
                await this.plugin.localSync.refreshLibraries();
                if (this.plugin.localSyncLibrariesError) {
                  this.plugin.settings.bulkSyncEnabled = false;
                  this.plugin.bulkSyncSettingsError =
                    this.plugin.localSyncLibrariesError;
                  await this.plugin.saveSettings();
                  await this.plugin.reconcileLocalLiveSync();
                  this.plugin.refreshViews();
                  return;
                }

                this.plugin.settings.bulkSyncEnabled = true;
                this.plugin.settings.bulkSyncPreferenceInitialized = true;
                await this.plugin.saveSettings();
                await this.plugin.reconcileLocalLiveSync();
                this.plugin.refreshViews();
              } catch (error) {
                this.plugin.settings.bulkSyncEnabled = false;
                clearLocalSyncState(this.plugin);
                this.plugin.bulkSyncSettingsError =
                  error instanceof Error
                    ? error.message
                    : "Could not verify the local Zotero API.";
                await this.plugin.saveSettings();
                await this.plugin.reconcileLocalLiveSync();
                this.plugin.refreshViews();
              } finally {
                this.plugin.isCheckingBulkSyncReadiness = false;
                this.display();
              }
            }),
        );

      if (
        !this.plugin.settings.bulkSyncEnabled &&
        (!accountEmail || !zoteroConnected)
      ) {
        bulkSyncSetting.descEl.createDiv({
          cls: "stratum-settings-inline-note",
          text: "Sign in to Stratum and connect Zotero before enabling desktop bulk sync.",
        });
      } else if (this.plugin.isCheckingBulkSyncReadiness) {
        bulkSyncSetting.descEl.createDiv({
          cls: "stratum-settings-inline-note",
          text: "Checking the local Zotero HTTP server and API...",
        });
      } else if (this.plugin.bulkSyncSettingsError) {
        bulkSyncSetting.descEl.createDiv({
          cls: "stratum-settings-inline-error",
          text: this.plugin.bulkSyncSettingsError,
        });
      }

      const defaultZoteroDataDir = getDefaultZoteroDataDir();
      new Setting(syncSection)
        .setName("Zotero local API port")
        .setDesc("Use 23119 unless you changed Zotero's local HTTP port.")
        .addText((text) => {
          text
            .setPlaceholder("23119")
            .setValue(String(this.plugin.settings.zoteroLocalApiPort))
            .onChange(async (value) => {
              const parsed = Number(value);
              this.plugin.settings.zoteroLocalApiPort =
                Number.isFinite(parsed) && parsed > 0
                  ? Math.round(parsed)
                  : 23119;
              this.plugin.bulkSyncSettingsError = null;
              clearLocalSyncState(this.plugin);
              await this.plugin.saveSettings();
              await this.plugin.reconcileLocalLiveSync();
            });

          text.inputEl.addClass("stratum-interval-input");
          text.inputEl.setAttr("inputmode", "numeric");
          text.inputEl.setAttr("aria-label", "Zotero local API port");
          text.inputEl.type = "number";
          text.inputEl.min = "1";
          text.inputEl.step = "1";
        });

      if (this.plugin.settings.bulkSyncEnabled) {
        new Setting(syncSection)
          .setName("Zotero data directory")
          .setDesc(
            "Used for desktop live sync when Zotero changes while Obsidian is open.",
          )
          .addText((text) => {
            text
              .setPlaceholder(defaultZoteroDataDir)
              .setValue(this.plugin.settings.zoteroDataDir);

            text.inputEl.setAttr("aria-label", "Zotero data directory");
            text.inputEl.addEventListener("change", () => {
              void (async () => {
                this.plugin.settings.zoteroDataDir =
                  text.inputEl.value.trim() || defaultZoteroDataDir;
                await this.plugin.saveSettings();
                await this.plugin.reconcileLocalLiveSync();
                this.display();
              })();
            });
          });

        const zoteroDataDirActions = syncSection.createDiv({
          cls: "stratum-settings-subaction-row",
        });
        const resetZoteroDataDirButton = zoteroDataDirActions.createEl(
          "button",
          {
            text: "Reset to default location",
          },
        );
        resetZoteroDataDirButton.type = "button";
        resetZoteroDataDirButton.addEventListener("click", () => {
          void (async () => {
            this.plugin.settings.zoteroDataDir = defaultZoteroDataDir;
            await this.plugin.saveSettings();
            await this.plugin.reconcileLocalLiveSync();
            this.display();
          })();
        });
      }
    }

    const defaultsSection = this.createSection(
      containerEl,
      "Workspace defaults",
    );

    new Setting(defaultsSection)
      .setName("Literature notes folder")
      .setDesc("Default destination for generated literature notes.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_NOTE_FOLDER)
          .setValue(this.plugin.settings.notesFolder)
          .onChange(async (value) => {
            this.plugin.settings.notesFolder =
              value.trim() || DEFAULT_NOTE_FOLDER;
            await this.plugin.saveSettings();
            await this.plugin.rebuildItemFileMap();
          }),
      );

    new Setting(defaultsSection)
      .setName("Literature note filename format")
      .setDesc(
        "Controls how new literature notes are named. Existing notes are not bulk-renamed when this changes. The citation key format currently uses a generated fallback until richer citekey support is wired in.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("readable", "Readable format (author-year title)")
          .addOption("citekey", "Citation key format (@author2020title)")
          .setValue(this.plugin.settings.filenameFormat)
          .onChange(async (value) => {
            this.plugin.settings.filenameFormat =
              value as LiteratureNoteFilenameFormat;
            await this.plugin.saveSettings();
          }),
      );
  }
}
