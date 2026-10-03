import type { StratumSettings } from "./settings-data";
import type StratumPlugin from "./plugin";

interface Resources {
  styles: Record<string, string>;
  locales: Record<string, string>;
}
const loaded = new WeakSet<StratumPlugin>();
const written = new WeakMap<StratumPlugin, string>();
function path(plugin: StratumPlugin): string | null {
  return plugin.manifest?.dir && plugin.app.vault.adapter
    ? `${plugin.manifest.dir}/citation-resources.json`
    : null;
}
function strings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid citation resource cache.");
  if (Object.values(value).some((value) => typeof value !== "string"))
    throw new Error("Invalid citation resource cache.");
  return value as Record<string, string>;
}
export async function loadCitationResources(
  plugin: StratumPlugin,
): Promise<void> {
  const file = path(plugin);
  if (!file) return;
  loaded.delete(plugin);
  written.delete(plugin);
  if (await plugin.app.vault.adapter.exists(file)) {
    const text = await plugin.app.vault.adapter.read(file);
    const data = JSON.parse(text) as Resources;
    if (plugin.isUnloaded) return;
    const styles = strings(data.styles),
      locales = strings(data.locales);
    plugin.settings.citationStyles = styles;
    plugin.settings.citationLocales = locales;
    written.set(plugin, text);
  }
  loaded.add(plugin);
}
export async function saveCitationResources(
  plugin: StratumPlugin,
): Promise<void> {
  const file = path(plugin);
  if (!file) return;
  if (!loaded.has(plugin))
    throw new Error(
      "Citation resources could not be read. Restore the resource cache before changing styles.",
    );
  for (const id of ["apa", "ieee", "chicago-notes-bibliography"])
    delete plugin.settings.citationStyles[id];
  for (const language of ["en-US", "en-GB", "fr-FR"])
    delete plugin.settings.citationLocales[language];
  const text = JSON.stringify({
    styles: plugin.settings.citationStyles,
    locales: plugin.settings.citationLocales,
  });
  if (written.get(plugin) === text) return;
  await plugin.app.vault.adapter.write(file, text);
  written.set(plugin, text);
}
export function settingsWithoutResources(
  plugin: StratumPlugin,
): Omit<StratumSettings, "citationStyles" | "citationLocales"> &
  Partial<Pick<StratumSettings, "citationStyles" | "citationLocales">> {
  if (!written.has(plugin)) return plugin.settings;
  const {
    citationStyles: _styles,
    citationLocales: _locales,
    ...settings
  } = plugin.settings;
  return settings;
}
