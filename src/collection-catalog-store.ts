import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings-data";
import type { ZoteroCollectionSummary } from "./backend-types";

const listeners = new WeakMap<StratumPlugin, Set<() => void>>();

export function onCollectionCatalogChange(
  plugin: StratumPlugin,
  listener: () => void,
): () => void {
  const entries = listeners.get(plugin) ?? new Set<() => void>();
  listeners.set(plugin, entries);
  entries.add(listener);
  return () => {
    entries.delete(listener);
  };
}

export async function rememberCollectionCatalog(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  collections: ZoteroCollectionSummary[],
): Promise<void> {
  if (plugin.isUnloaded) return;
  plugin.settings.collectionCatalogs = {
    ...plugin.settings.collectionCatalogs,
    [library.identity]: {
      libraryName: library.name,
      collections,
      updatedAt: Date.now(),
    },
  };
  for (const listener of listeners.get(plugin) ?? []) listener();
  try {
    await plugin.saveSettings();
  } catch (error) {
    // A failed optional cache save must not turn a successful collection fetch
    // into a search/sync failure. Keep the fetched hierarchy usable in memory.
    console.error("stratum: could not persist collection hierarchy", error);
  }
}
