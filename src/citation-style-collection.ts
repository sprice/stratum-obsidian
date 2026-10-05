import type StratumPlugin from "./plugin";
import { readAvailableCitationStyles } from "./citation-style-defaults";
import { prepareStyle, styleTitle } from "./citation-styles";

export function availableCitationStyles(plugin: StratumPlugin) {
  return readAvailableCitationStyles(
    plugin.settings.availableCitationStyles,
    plugin.settings.citationStyle,
  ).map((id) => ({ id, title: styleTitle(plugin, id) }));
}

// Serialize resource and preference writes shared by settings and note selectors.
const operations = new WeakMap<StratumPlugin, Promise<unknown>>();
export function changeCitationPreferences<T>(
  plugin: StratumPlugin,
  change: () => Promise<T>,
): Promise<T> {
  const next = (operations.get(plugin) ?? Promise.resolve())
    .catch(() => {})
    .then(() => {
      if (plugin.isUnloaded) throw new Error("Stratum has been unloaded.");
      return change();
    });
  operations.set(plugin, next);
  return next;
}

export function setCitationStyleAvailable(
  plugin: StratumPlugin,
  id: string,
  enabled: boolean,
): Promise<void> {
  return changeCitationPreferences(plugin, async () => {
    if (!enabled && id === plugin.settings.citationStyle)
      throw new Error("Choose another default before hiding this style.");
    if (enabled)
      await prepareStyle(plugin, id, plugin.settings.citationLanguage);
    if (plugin.isUnloaded) return;
    const previous = plugin.settings.availableCitationStyles;
    const ids = availableCitationStyles(plugin).map((style) => style.id);
    plugin.settings.availableCitationStyles = enabled
      ? Array.from(new Set([...ids, id]))
      : ids.filter((style) => style !== id);
    try {
      await plugin.saveSettings();
    } catch (error) {
      plugin.settings.availableCitationStyles = previous;
      throw error;
    }
    plugin.citations.invalidate();
  });
}

export function setDefaultCitationStyle(
  plugin: StratumPlugin,
  id: string,
): Promise<void> {
  return changeCitationPreferences(plugin, async () => {
    if (!availableCitationStyles(plugin).some((style) => style.id === id))
      throw new Error("Enable this style before choosing it as the default.");
    await prepareStyle(plugin, id, plugin.settings.citationLanguage);
    if (plugin.isUnloaded) return;
    const previous = plugin.settings.citationStyle;
    plugin.settings.citationStyle = id;
    try {
      await plugin.saveSettings();
    } catch (error) {
      plugin.settings.citationStyle = previous;
      throw error;
    }
    plugin.citations.invalidate();
    plugin.refreshSettingTab();
  });
}
