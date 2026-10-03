import {
  Notice,
  Platform,
  PluginSettingTab,
  Setting,
  requireApiVersion,
} from "obsidian";

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

interface SearchableSetting {
  name: string;
  render: (setting: Setting) => void;
}

interface SettingsSection {
  type: "group";
  heading: string;
  cls: string;
  items: SearchableSetting[];
}

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

  private createSection(
    sections: SettingsSection[],
    title: string,
  ): SettingsSection {
    const section: SettingsSection = {
      type: "group",
      heading: title,
      cls: "stratum-settings-panel",
      items: [],
    };
    sections.push(section);
    return section;
  }

  private defineSetting(
    section: SettingsSection,
    name: string,
    render: (setting: Setting) => void,
  ): void {
    section.items.push({ name, render });
  }

  // Older Obsidian versions still invoke display(). Both paths use the same
  // definitions and callbacks, including Stratum's sync-state persistence.
  display(): void {
    this.renderLegacy();
  }

  refresh(): void {
    if (requireApiVersion("1.13.0")) {
      this.update();
    } else if (this.containerEl.isConnected) {
      this.renderLegacy();
    }
  }

  private renderLegacy(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("stratum-settings-tab");
    for (const section of this.getSettingDefinitions()) {
      const sectionEl = containerEl.createDiv({
        cls: "stratum-settings-section",
      });
      new Setting(sectionEl).setName(section.heading).setHeading();
      const panel = sectionEl.createDiv({ cls: section.cls });
      for (const definition of section.items) {
        definition.render(new Setting(panel).setName(definition.name));
      }
    }
  }

  getSettingDefinitions(): SettingsSection[] {
    const sections: SettingsSection[] = [];
    const citations = this.createSection(sections, "Citations");
    this.defineSetting(citations, "Default citation style", (setting) => {
      setting
        .setDesc(
          "Format citations and bibliographies in every paper without an override.",
        )
        .addButton((button) =>
          button.setButtonText("Choose style").onClick(async () => {
            const { CitationPreferences } = await import("./citation-controls");
            new CitationPreferences(this.plugin).open();
          }),
        );
    });
    this.defineSetting(citations, "Citation reference data", (setting) => {
      setting
        .setDesc(
          "Fill missing reference data for previously imported notes. Requires your Zotero connection.",
        )
        .addButton((button) =>
          button.setButtonText("Refresh citation data").onClick(async () => {
            const { refreshCitationData } = await import("./citation-refresh");
            await refreshCitationData(this.plugin).catch(
              () =>
                new Notice(
                  "Could not refresh citation data. Check your Zotero connection.",
                ),
            );
          }),
        );
    });
    const accountEmail = this.plugin.backend.hasSession()
      ? this.plugin.settings.accountEmail
      : null;
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

    const workspaceSection = this.createSection(sections, "Workspace");

    this.defineSetting(workspaceSection, "Stratum account", (setting) => {
      const accountSetting = setting
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
              this.refresh();
            });
          });
      } else {
        accountSetting.addButton((button) =>
          button
            .setButtonText("Sign in")
            .setCta()
            .onClick(async () => {
              await this.plugin.startDeviceHandoff();
              this.refresh();
            }),
        );
      }
    });

    const tokenInvalid = zoteroConnection?.tokenValid === false;
    const lastKnownZoteroSummary = lastKnownZoteroUsername
      ? zoteroLinkedAt
        ? `Last connected as ${lastKnownZoteroUsername}. Last confirmed on ${zoteroLinkedAt}.`
        : `Last connected as ${lastKnownZoteroUsername}.`
      : null;
    this.defineSetting(workspaceSection, "Zotero library", (setting) => {
      setting
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
              this.refresh();
            });

          if (needsReconnect) {
            button.setCta();
          }
        });
    });

    const librariesSection = this.createSection(sections, "Libraries");
    const personalLibrary = getPersonalLibrary(this.plugin);
    if (personalLibrary) {
      this.defineSetting(librariesSection, "Personal library", (setting) => {
        setting
          .setName("Personal library")
          .setDesc(
            zoteroConnected
              ? `Always enabled. Connected as ${zoteroConnection?.zoteroUsername ?? "your Zotero account"}.`
              : "Always enabled once Zotero is connected.",
          );
      });
    }

    if (!accountEmail || !zoteroConnected) {
      this.defineSetting(librariesSection, "Available groups", (setting) => {
        setting
          .setName("Available groups")
          .setDesc("Connect Zotero to load your group libraries.");
      });
    } else if (this.plugin.availableGroups.length === 0) {
      this.defineSetting(librariesSection, "Available groups", (setting) => {
        setting
          .setName("Available groups")
          .setDesc("No Zotero group libraries are available for this account.");
      });
    } else {
      for (const group of this.plugin.availableGroups) {
        const identity = `group:${group.id}`;
        const isEnabled = this.plugin.settings.enabledLibraries.some(
          (library) => library.identity === identity,
        );
        this.defineSetting(librariesSection, group.name, (setting) => {
          setting
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
                  this.refresh();
                }),
            );
        });
      }
    }

    const syncSection = this.createSection(sections, "Sync");

    if (Platform.isDesktopApp) {
      this.defineSetting(syncSection, "Bulk sync", (setting) => {
        const bulkSyncSetting = setting
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
                  this.refresh();
                  return;
                }

                this.plugin.isCheckingBulkSyncReadiness = true;
                this.plugin.bulkSyncSettingsError = null;
                this.refresh();

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
                  this.refresh();
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
      });

      const defaultZoteroDataDir = getDefaultZoteroDataDir();
      this.defineSetting(syncSection, "Zotero local API port", (setting) => {
        setting
          .setName("Zotero local API port")
          .setDesc("Use 23119 unless you changed Zotero's local HTTP port.")
          .addText((text) => {
            text
              .setPlaceholder("23119")
              .setValue(String(this.plugin.settings.zoteroLocalApiPort));
            const commit = async () => {
              const parsed = Number(text.getValue());
              const port =
                Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
                  ? parsed
                  : 23119;
              if (port === this.plugin.settings.zoteroLocalApiPort) return;
              this.plugin.settings.zoteroLocalApiPort = port;
              text.setValue(String(port));
              this.plugin.bulkSyncSettingsError = null;
              clearLocalSyncState(this.plugin);
              await this.plugin.saveSettings();
              await this.plugin.reconcileLocalLiveSync();
            };
            text.inputEl.addEventListener("blur", () => {
              void commit().catch(
                () => new Notice("Could not save the Zotero port."),
              );
            });
            text.inputEl.addEventListener("keydown", (event) => {
              if (event.key === "Enter") text.inputEl.blur();
            });

            text.inputEl.addClass("stratum-interval-input");
            text.inputEl.setAttr("inputmode", "numeric");
            text.inputEl.setAttr("aria-label", "Zotero local API port");
            text.inputEl.type = "number";
            text.inputEl.min = "1";
            text.inputEl.step = "1";
          });
      });

      if (this.plugin.settings.bulkSyncEnabled) {
        this.defineSetting(syncSection, "Zotero data directory", (setting) => {
          setting
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
                  this.refresh();
                })();
              });
            });
        });

        this.defineSetting(
          syncSection,
          "Reset Zotero data directory",
          (setting) => {
            setting.addButton((button) =>
              button
                .setButtonText("Reset to default location")
                .onClick(async () => {
                  this.plugin.settings.zoteroDataDir = defaultZoteroDataDir;
                  await this.plugin.saveSettings();
                  await this.plugin.reconcileLocalLiveSync();
                  this.refresh();
                }),
            );
          },
        );
      }
    }

    const defaultsSection = this.createSection(sections, "Workspace defaults");

    this.defineSetting(
      defaultsSection,
      "Literature notes folder",
      (setting) => {
        setting
          .setName("Literature notes folder")
          .setDesc("Default destination for generated literature notes.")
          .addText((text) => {
            text
              .setPlaceholder(DEFAULT_NOTE_FOLDER)
              .setValue(this.plugin.settings.notesFolder);
            const commit = async () => {
              const folder = text.getValue().trim() || DEFAULT_NOTE_FOLDER;
              if (folder === this.plugin.settings.notesFolder) return;
              this.plugin.settings.notesFolder = folder;
              text.setValue(folder);
              await this.plugin.saveSettings();
              await this.plugin.rebuildItemFileMap();
            };
            text.inputEl.addEventListener("blur", () => {
              void commit().catch(
                () => new Notice("Could not save the literature notes folder."),
              );
            });
            text.inputEl.addEventListener("keydown", (event) => {
              if (event.key === "Enter") text.inputEl.blur();
            });
          });
      },
    );

    this.defineSetting(
      defaultsSection,
      "Literature note filename format",
      (setting) => {
        setting
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
      },
    );

    return sections;
  }
}
