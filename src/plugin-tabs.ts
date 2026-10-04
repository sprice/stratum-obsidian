import { Notice, Platform } from "obsidian";
import type StratumPlugin from "./plugin";
import { readEnabledTabs, STRATUM_TABS, type StratumTab } from "./stratum-tabs";

export function canOpenStratumTab(
  plugin: StratumPlugin,
  tab: StratumTab,
): boolean {
  if (plugin.isUnloaded) return false;
  if (tab === "sync" && !Platform.isDesktopApp) return false;
  if (!readEnabledTabs(plugin.settings.enabledTabs)[tab]) {
    const label = STRATUM_TABS.find(({ id }) => id === tab)!.label;
    new Notice(
      `${label} is hidden. Enable it in Stratum settings → Stratum tabs.`,
    );
    return false;
  }
  return true;
}

export function selectStratumTab(
  plugin: StratumPlugin,
  tab: StratumTab,
): boolean {
  if (!canOpenStratumTab(plugin, tab)) return false;
  plugin.activeViewTab = tab;
  return true;
}
