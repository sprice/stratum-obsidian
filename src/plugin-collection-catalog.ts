import { rememberCollectionCatalog } from "./collection-catalog-store";
import { Platform } from "obsidian";
import type StratumPlugin from "./plugin";
import type {
  ZoteroCollectionSummary,
  ZoteroItemDetail,
} from "./backend-types";
import type { EnabledLibrary } from "./settings-data";
import { loadLocalZoteroCollections } from "./zotero-local";

const pending = new WeakMap<
  StratumPlugin,
  Map<string, { until: number; promise: Promise<void>; settled: boolean }>
>();
const CACHE_MS = 60_000;

/** Fetch once per library window, including failures. Browsing itself stays offline. */
export function ensureCollectionCatalog(
  plugin: StratumPlugin,
  detail: ZoteroItemDetail,
): Promise<void> {
  const library: EnabledLibrary = {
    type: detail.library.type,
    id: detail.library.id,
    identity: `${detail.library.type}:${detail.library.id}`,
    name:
      detail.library.type === "user"
        ? "My Library"
        : (detail.library.groupName ?? `Group ${detail.library.id}`),
  };
  const cached = plugin.settings.collectionCatalogs?.[library.identity];
  if (cached && Date.now() - cached.updatedAt < CACHE_MS)
    return Promise.resolve();
  const requests =
    pending.get(plugin) ??
    new Map<
      string,
      { until: number; promise: Promise<void>; settled: boolean }
    >();
  pending.set(plugin, requests);
  const previous = requests.get(library.identity);
  if (previous && (!previous.settled || previous.until > Date.now()))
    return previous.promise;
  const promise = (async () => {
    try {
      let collections: ZoteroCollectionSummary[];
      if (Platform.isDesktopApp && plugin.settings.bulkSyncEnabled) {
        try {
          collections = await loadLocalZoteroCollections({
            port: plugin.settings.zoteroLocalApiPort,
            library,
          });
        } catch {
          collections = (
            await plugin.backend.getZoteroLibraryCollections({ library })
          ).collections;
        }
      } else {
        collections = (
          await plugin.backend.getZoteroLibraryCollections({ library })
        ).collections;
      }
      await rememberCollectionCatalog(plugin, library, collections);
    } catch (error) {
      // Collection browsing must never prevent an otherwise successful note sync.
      console.error(
        "stratum: collection hierarchy refresh failed; retaining cached hierarchy",
        error,
      );
    }
  })();
  const request = { until: 0, promise, settled: false };
  requests.set(library.identity, request);
  void promise.then(() => {
    request.settled = true;
    request.until = Date.now() + CACHE_MS;
  });
  return promise;
}
