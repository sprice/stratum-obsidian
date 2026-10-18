import { Notice, Platform } from "obsidian";
import type StratumPlugin from "./plugin";
import { PLUGIN_NAME, VIEW_TYPE_STRATUM } from "./constants";
import { readEnabledTabs, resolveActiveTab } from "./stratum-tabs";

const opening = new WeakSet<StratumPlugin>();

/** Reveal Stratum once for new installations, after workspace restoration. */
export async function openInitialSidebar(plugin: StratumPlugin): Promise<void> {
  if (
    plugin.isUnloaded ||
    plugin.settings.initialSidebarOpened ||
    opening.has(plugin)
  )
    return;

  // Keep an in-flight opening out of settings that other startup work may save.
  opening.add(plugin);
  try {
    if (!plugin.app.workspace.getLeavesOfType(VIEW_TYPE_STRATUM).length) {
      const tab = resolveActiveTab(
        Platform.isDesktopApp ? "sync" : "search",
        readEnabledTabs(plugin.settings.enabledTabs),
        Platform.isDesktopApp,
      );
      if (tab) {
        plugin.activeViewTab = tab;
        plugin.settings.lastActiveTab = tab;
        await plugin.activateView();
      }
    }
    if (plugin.isUnloaded) return;
    plugin.settings.initialSidebarOpened = true;
    await plugin.saveSettings();
  } catch {
    plugin.settings.initialSidebarOpened = false;
    if (!plugin.isUnloaded)
      new Notice(`Could not finish opening ${PLUGIN_NAME} for the first time.`);
  } finally {
    opening.delete(plugin);
  }
}
