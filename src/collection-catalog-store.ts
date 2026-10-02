import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings-data";
import type { ZoteroCollectionSummary } from "./backend-types";

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
  await plugin.saveSettings();
}
