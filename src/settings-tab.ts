import {
  SOURCE_SUMMARY_VARIABLES,
  validateSourceSummaryTemplate,
} from "./source-summary-template";
import { STRATUM_TABS, readEnabledTabs } from "./stratum-tabs";
import { openTabChooser } from "./settings-tab-chooser";
import {
  Notice,
  Platform,
  PluginSettingTab,
  Setting,
  SettingGroup,
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
import {
  readAcademicDefaults,
  readPublishOptions,
  DEFAULT_ACADEMIC_OPTIONS,
} from "./publish-options";
import {
  PublishOptionError,
  renderPublishCustomization,
} from "./publish-customize";

interface SearchableSetting {
  name: string;
  render: (setting: Setting) => void;
}

interface SettingsSection {
  type: "group";
  heading: string;
  items: SearchableSetting[];
}

export class StratumSettingTab extends PluginSettingTab {
  plugin: StratumPlugin;
  private closeTabChooser?: () => void;
  private templateRow?: HTMLElement;
  private academicDefaultsRow?: HTMLElement;
  focusAcademicDefaults(): void {
    window.setTimeout(() => {
      this.academicDefaultsRow?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
      this.academicDefaultsRow
        ?.querySelector<HTMLInputElement>("input, textarea")
        ?.focus({ preventScroll: true });
    }, 100);
  }

  async openNoteTemplateEditor(): Promise<void> {
    const { NoteTemplateModal } = await import("./note-template-modal");
    if (this.plugin.isUnloaded) return;
    if (this.templateRow?.isConnected)
      this.templateRow.scrollIntoView({ block: "center" });
    new NoteTemplateModal(
      this.app,
      this.plugin.settings.notesTemplate,
      async (template) => {
        if (this.plugin.isUnloaded) throw new Error("Plugin was unloaded.");
        const previous = this.plugin.settings.notesTemplate;
        this.plugin.settings.notesTemplate = template;
        try {
          await this.plugin.saveSettings();
        } catch (error) {
          this.plugin.settings.notesTemplate = previous;
          throw error;
        }
        this.plugin.refreshViews();
      },
    ).open();
  }

  async openSourceSummaryTemplateEditor(): Promise<void> {
    const { NoteTemplateModal } = await import("./note-template-modal");
    if (this.plugin.isUnloaded) return;
    new NoteTemplateModal(
      this.app,
      this.plugin.settings.sourceSummaryTemplate,
      async (template) => {
        if (this.plugin.isUnloaded) throw new Error("Plugin was unloaded.");
        const previous = this.plugin.settings.sourceSummaryTemplate;
        this.plugin.settings.sourceSummaryTemplate = template;
        try {
          await this.plugin.saveSettings();
        } catch (error) {
          this.plugin.settings.sourceSummaryTemplate = previous;
          throw error;
        }
      },
      {
        title: "Source summary template",
        description: [
          "Starting content for source summaries you insert into your notes.",
          "Changes apply to future insertions. Existing summaries remain yours to edit.",
        ],
        variables: SOURCE_SUMMARY_VARIABLES,
        validate: validateSourceSummaryTemplate,
      },
    ).open();
  }

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
    this.closeTabChooser?.();
    if (requireApiVersion("1.13.0")) {
      this.update();
    } else if (this.containerEl.isConnected) {
      this.renderLegacy();
    }
  }

  hide(): void {
    this.closeTabChooser?.();
  }

  private renderLegacy(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const section of this.getSettingDefinitions()) {
      const group = new SettingGroup(containerEl).setHeading(section.heading);
      for (const definition of section.items) {
        group.addSetting((setting) => {
          definition.render(setting.setName(definition.name));
        });
      }
    }
  }

  getSettingDefinitions(): SettingsSection[] {
    const sections: SettingsSection[] = [];
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

    const defaultsSection = this.createSection(sections, "Workspace defaults");
    this.defineSetting(
      defaultsSection,
      "Literature note template",
      (setting) => {
        this.templateRow = setting.settingEl;
        setting
          .setName("Literature note template")
          .setDesc("Starting content for your literature notes from Zotero")
          .addButton((button) =>
            button.setButtonText("Edit template").onClick(() => {
              void this.openNoteTemplateEditor().catch(
                () => new Notice("Could not open the template editor."),
              );
            }),
          );
      },
    );

    this.defineSetting(
      defaultsSection,
      "Source summary template",
      (setting) => {
        setting
          .setName("Source summary template")
          .setDesc(
            "Starting content when inserting a source summary into a note.",
          )
          .addButton((button) =>
            button.setButtonText("Edit template").onClick(() => {
              void this.openSourceSummaryTemplateEditor().catch(
                () => new Notice("Could not open the template editor."),
              );
            }),
          );
      },
    );

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
            "Choose how new literature notes are named. Existing filenames stay unchanged. Citation key filenames are generated from author, year, and title.",
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

    const librariesSection = this.createSection(sections, "Zotero Libraries");
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

    if (Platform.isDesktopApp) {
      const publishSection = this.createSection(sections, "Publishing");
      this.defineSetting(publishSection, "Publishing tools", (setting) => {
        setting
          .setDesc(
            "Check tool status, get installation help, or choose custom tool locations.",
          )
          .addButton((button) =>
            button.setButtonText("Manage tools").onClick(async () => {
              const { PublishSetupModal } = await import("./publish-setup");
              new PublishSetupModal(this.plugin).open();
            }),
          );
      });
      for (const [key, label] of [
        ["publishingDefaults", "General document defaults"],
        ["academicPublishingDefaults", "Academic layout defaults"],
      ] as const) {
        this.defineSetting(publishSection, label, (setting) => {
          setting.setDesc(
            "Starting appearance for new document configurations. Existing note preferences are kept.",
          );
          const details = setting.settingEl.createEl("details", {
            cls: "stratum-publish-defaults",
          });
          details.createEl("summary", { text: "Customize defaults" });
          renderPublishCustomization(
            details,
            readPublishOptions(
              this.plugin.settings[key],
              key === "academicPublishingDefaults"
                ? DEFAULT_ACADEMIC_OPTIONS
                : undefined,
            ),
            async (patch) => {
              this.plugin.settings[key] = readPublishOptions({
                ...readPublishOptions(
                  this.plugin.settings[key],
                  key === "academicPublishingDefaults"
                    ? DEFAULT_ACADEMIC_OPTIONS
                    : undefined,
                ),
                ...patch,
              });
              await this.plugin.saveSettings();
            },
            (error) => {
              new Notice(
                error instanceof PublishOptionError
                  ? error.message
                  : "Could not save publishing defaults. Try again.",
              );
            },
          );
        });
      }
      const academicSection = this.createSection(sections, "Academic defaults");
      for (const [key, label] of [
        ["authors", "Authors"],
        ["affiliations", "Affiliations"],
        ["keywords", "Keywords"],
      ] as const) {
        this.defineSetting(academicSection, label, (setting) => {
          if (key === "authors") this.academicDefaultsRow = setting.settingEl;
          setting
            .setDesc(
              "One entry per line. Added only when the note's property is absent; leave blank to omit.",
            )
            .addTextArea((input) =>
              input
                .setValue(
                  readAcademicDefaults(this.plugin.settings.academicProperties)[
                    key
                  ].join("\n"),
                )
                .onChange(async (value) => {
                  this.plugin.settings.academicProperties = {
                    ...readAcademicDefaults(
                      this.plugin.settings.academicProperties,
                    ),
                    [key]: value
                      .split(/\r?\n/)
                      .map((v) => v.trim())
                      .filter(Boolean),
                  };
                  await this.plugin.saveSettings();
                }),
            );
        });
      }
      this.defineSetting(academicSection, "Date", (setting) => {
        setting
          .setDesc(
            "Optional date added during preparation. Leave blank to omit.",
          )
          .addText((input) => {
            input.inputEl.type = "date";
            input
              .setValue(
                readAcademicDefaults(this.plugin.settings.academicProperties)
                  .date,
              )
              .onChange(async (value) => {
                this.plugin.settings.academicProperties = {
                  ...readAcademicDefaults(
                    this.plugin.settings.academicProperties,
                  ),
                  date: value,
                };
                await this.plugin.saveSettings();
              });
          });
      });
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

      this.defineSetting(syncSection, "Zotero data directory", (setting) => {
        setting
          .setName("Zotero data directory")
          .setDesc(
            "Used for desktop live sync and reading area annotation images from Zotero’s cache.",
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

    const citations = this.createSection(sections, "Citations");
    this.defineSetting(citations, "Default citation style", (setting) => {
      setting
        .setDesc(
          "Format citations and bibliographies in every paper without an override.",
        )
        .addButton((button) =>
          button.setButtonText("Manage citation styles").onClick(async () => {
            const { CitationPreferences } = await import("./citation-controls");
            new CitationPreferences(this.plugin).open();
          }),
        );
    });
    this.defineSetting(citations, "Citation reference data", (setting) => {
      setting
        .setDesc(
          "Get missing reference details from Zotero for imported notes.",
        )
        .addButton((button) =>
          button
            .setButtonText("Fetch missing citation data")
            .onClick(async () => {
              const { refreshCitationData } =
                await import("./citation-refresh");
              await refreshCitationData(this.plugin).catch(
                () =>
                  new Notice(
                    "Could not refresh citation data. Check your Zotero connection.",
                  ),
              );
            }),
        );
    });

    const tabsSection = this.createSection(sections, "Stratum tabs");
    this.defineSetting(tabsSection, "Visible tabs", (setting) => {
      const tabs = STRATUM_TABS.filter(
        ({ id }) =>
          Platform.isDesktopApp || (id !== "sync" && id !== "publish"),
      );
      const updateSummary = () => {
        const enabled = readEnabledTabs(this.plugin.settings.enabledTabs);
        const visible = tabs.filter(({ id }) => enabled[id]);
        setting.setDesc(
          visible.length === tabs.length
            ? "All tabs shown."
            : visible.length === 0
              ? "No tabs shown."
              : `${visible.map(({ label }) => label).join(", ")} shown.`,
        );
      };
      updateSummary();
      setting.addButton((button) => {
        button.setButtonText("Choose visible tabs");
        button.buttonEl.addClass("stratum-tab-chooser-trigger");
        button.buttonEl.setAttribute("aria-haspopup", "dialog");
        button.buttonEl.setAttribute("aria-expanded", "false");
        button.onClick(() => {
          const wasOpen =
            button.buttonEl.getAttribute("aria-expanded") === "true";
          this.closeTabChooser?.();
          if (wasOpen) return;
          this.closeTabChooser = openTabChooser(button.buttonEl, {
            tabs,
            keyboard: {
              keymap: this.plugin.app.keymap,
              parent: this.plugin.app.scope,
            },
            enabled: readEnabledTabs(this.plugin.settings.enabledTabs),
            onChange: async (id, enabled) => {
              const previous = this.plugin.settings.enabledTabs;
              this.plugin.settings.enabledTabs = {
                ...readEnabledTabs(this.plugin.settings.enabledTabs),
                [id]: enabled,
              };
              updateSummary();
              this.plugin.refreshViews();
              try {
                await this.plugin.saveSettings();
              } catch (error) {
                this.plugin.settings.enabledTabs = previous;
                updateSummary();
                this.plugin.refreshViews();
                throw error;
              }
            },
          });
        });
      });
    });
    if (!Platform.isDesktopApp) {
      this.defineSetting(tabsSection, "Desktop sync", (setting) => {
        setting.setDesc(
          "Local Zotero sync requires desktop and is unavailable on mobile.",
        );
      });
    }

    return sections;
  }
}
