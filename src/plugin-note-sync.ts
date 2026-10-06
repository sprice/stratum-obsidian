import { importAnnotationImages } from "./plugin-annotation-images";
import {
  findExistingLiteratureNote,
  toIdentity,
} from "./literature-note-helpers";
import { saveReference } from "./citation-reference-store";
import { assertSupportedZoteroItem } from "./zotero-item-support";
import { parseYaml } from "obsidian";
import { refreshManagedBibEntry } from "./bibtex";
import { literatureNoteEntryFromFrontmatter } from "./library-search-modal";
import { splitFrontmatterContent } from "./literature-note-content";
import { ensureCollectionCatalog } from "./plugin-collection-catalog";
import type { TFile } from "obsidian";
import { Platform } from "obsidian";
import {
  createOrUpdateLiteratureNote,
  type LiteratureNoteWriteResult,
} from "./literature-note";
import {
  type OpenAlexEnrichment,
  type ZoteroItemDetail,
} from "./backend-client";
import { loadEnrichmentForNoteWrite } from "./plugin-enrichment";
import { shouldUseLocalOpenedNoteRefresh } from "./plugin-note-refresh-policy";
import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings";
import {
  LocalZoteroApiError,
  loadLocalZoteroItemDetail,
  loadLocalZoteroLibraries,
} from "./zotero-local";
import { isMissingZoteroItemError } from "./plugin-sync-helpers";

export type NoteSyncSourcePreference = "auto" | "cloud" | "local";

export type NoteSyncDetailLoadResult = {
  detail: ZoteroItemDetail | null;
  usedLocal: boolean;
  localMissing: boolean;
  backendMissing: boolean;
  localError: unknown;
  backendError: unknown;
};

type WriteLiteratureNoteFromDetailParams =
  | {
      detail: ZoteroItemDetail;
      existingFile: TFile | null;
      enrichmentMode?: "load";
    }
  | {
      detail: ZoteroItemDetail;
      existingFile: TFile | null;
      enrichmentMode: "skip";
    }
  | {
      detail: ZoteroItemDetail;
      existingFile: TFile | null;
      enrichmentMode: "provided";
      enrichment: OpenAlexEnrichment | null;
    };

export async function resolveLocalZoteroUserId(
  plugin: StratumPlugin,
): Promise<string> {
  if (plugin.localZoteroUserId) {
    return plugin.localZoteroUserId;
  }

  const response = await loadLocalZoteroLibraries({
    port: plugin.settings.zoteroLocalApiPort,
  });
  plugin.localZoteroUserId = response.userId;
  return response.userId;
}

export async function loadLocalZoteroItemDetailForPlugin(
  plugin: StratumPlugin,
  params: {
    library: EnabledLibrary;
    itemKey: string;
  },
): Promise<ZoteroItemDetail> {
  const catalog = plugin.settings.collectionCatalogs?.[params.library.identity];
  return await loadLocalZoteroItemDetail({
    port: plugin.settings.zoteroLocalApiPort,
    userId: await resolveLocalZoteroUserId(plugin),
    library: params.library,
    itemKey: params.itemKey,
    knownCollections:
      catalog && Date.now() - catalog.updatedAt < 60_000
        ? catalog.collections
        : undefined,
  });
}

export async function loadZoteroItemDetailForNoteSync(
  plugin: StratumPlugin,
  params: {
    library: EnabledLibrary;
    itemKey: string;
    sourcePreference: NoteSyncSourcePreference;
  },
): Promise<NoteSyncDetailLoadResult> {
  let detail: ZoteroItemDetail | null = null;
  let localMissing = false;
  let backendMissing = false;
  let localError: unknown = null;
  let backendError: unknown = null;

  const useLocalFirst =
    params.sourcePreference === "local" ||
    (params.sourcePreference === "auto" &&
      shouldUseLocalOpenedNoteRefresh({
        isDesktopApp: Platform.isDesktopApp,
        bulkSyncEnabled: plugin.settings.bulkSyncEnabled,
      }));

  if (useLocalFirst) {
    try {
      detail = await loadLocalZoteroItemDetailForPlugin(plugin, {
        library: params.library,
        itemKey: params.itemKey,
      });
    } catch (error) {
      if (error instanceof LocalZoteroApiError && error.status === 404) {
        localMissing = true;
      } else {
        localError = error;
      }
    }
  }

  if (
    !detail &&
    params.sourcePreference !== "local" &&
    plugin.backend.hasSession()
  ) {
    try {
      detail = await plugin.backend.getZoteroItemDetail(params.itemKey, {
        library: params.library,
      });
    } catch (error) {
      backendError = error;
      if (isMissingZoteroItemError(error)) {
        backendMissing = true;
      }
    }
  }

  return {
    detail,
    usedLocal: useLocalFirst,
    localMissing,
    backendMissing,
    localError,
    backendError,
  };
}

export async function requireZoteroItemDetailForNoteSync(
  plugin: StratumPlugin,
  params: {
    library: EnabledLibrary;
    itemKey: string;
    sourcePreference: NoteSyncSourcePreference;
  },
): Promise<ZoteroItemDetail> {
  const result = await loadZoteroItemDetailForNoteSync(plugin, params);
  if (result.detail) {
    return result.detail;
  }

  const error =
    result.backendError instanceof Error
      ? result.backendError
      : result.localError instanceof Error
        ? result.localError
        : new Error("Failed to load Zotero item detail.");
  throw error;
}

export function canSyncLibrary(
  plugin: StratumPlugin,
  library: { type: string; id: string },
): boolean {
  return (
    !plugin.isUnloaded &&
    plugin.backend.hasSession() &&
    plugin.settings.enabledLibraries.some(
      (entry) => entry.type === library.type && entry.id === library.id,
    )
  );
}

export async function writeLiteratureNoteFromDetail(
  plugin: StratumPlugin,
  params: WriteLiteratureNoteFromDetailParams,
): Promise<LiteratureNoteWriteResult> {
  assertSupportedZoteroItem(params.detail);
  const accountId = plugin.settings.accountId;
  let writes = noteWrites.get(plugin);
  if (!writes) {
    writes = new Map();
    noteWrites.set(plugin, writes);
  }
  const key = `${params.detail.library.type}/${params.detail.library.id}/${params.detail.item.key}`;
  const previous = writes.get(key);
  const operation = (async () => {
    const earlier = await previous?.catch(() => null);
    if (plugin.settings.accountId !== accountId)
      throw new Error("Note sync was cancelled.");
    const earlierFile =
      earlier &&
      plugin.app.vault.getAbstractFileByPath(earlier.file.path) === earlier.file
        ? earlier.file
        : null;
    return writeLiteratureNoteFromDetailNow(plugin, {
      ...params,
      existingFile: params.existingFile ?? earlierFile,
    });
  })();
  writes.set(key, operation);
  try {
    return await operation;
  } finally {
    if (writes.get(key) === operation) writes.delete(key);
  }
}

// Keep an image's ownership write and its note update together. Otherwise a
// second sync can mistake the first sync's new PNG for an unrelated collision.
const noteWrites = new WeakMap<
  StratumPlugin,
  Map<string, Promise<LiteratureNoteWriteResult>>
>();

async function writeLiteratureNoteFromDetailNow(
  plugin: StratumPlugin,
  params: WriteLiteratureNoteFromDetailParams,
): Promise<LiteratureNoteWriteResult> {
  assertSupportedZoteroItem(params.detail);
  const accountId = plugin.settings.accountId;
  const canWrite = () =>
    plugin.settings.accountId === accountId &&
    canSyncLibrary(plugin, params.detail.library);
  // Hierarchy is optional browser metadata; its network latency must not hold
  // up writing a paper (or the rest of a bulk import).
  void ensureCollectionCatalog(plugin, params.detail);
  let enrichment: OpenAlexEnrichment | null | undefined;
  if (params.enrichmentMode === "skip") {
    enrichment = undefined;
  } else if (params.enrichmentMode === "provided") {
    enrichment = params.enrichment;
  } else {
    enrichment = await loadEnrichmentForNoteWrite(plugin, {
      doi: params.detail.item.doi,
    });
  }

  if (!canWrite()) throw new Error("Note sync was cancelled.");
  const existingFile =
    params.existingFile ??
    (params.detail.annotations.some((annotation) => annotation.type === "image")
      ? findExistingLiteratureNote(
          plugin.app,
          toIdentity(params.detail),
          plugin.settings.notesFolder,
        )
      : null);
  const imageDetail = await importAnnotationImages(
    plugin,
    params.detail,
    existingFile,
  );
  const writeResult = await createOrUpdateLiteratureNote({
    stratumVersion: plugin.manifest.version,
    notesTemplate: plugin.settings.notesTemplate,
    app: plugin.app,
    notesFolder: plugin.settings.notesFolder,
    filenameFormat: plugin.settings.filenameFormat,
    detail: imageDetail,
    existingFile,
    canWrite,
    enrichment,
  });
  try {
    await saveReference(plugin.app, params.detail, canWrite);
  } catch (error) {
    console.error(
      "stratum: citation cache could not be updated; literature note sync succeeded",
      error,
    );
  }
  plugin.rememberLiteratureNoteFile(params.detail, writeResult.file);
  if (plugin.app.vault.getAbstractFileByPath("stratum.bib")) {
    try {
      const content = await plugin.app.vault.read(writeResult.file);
      const { frontmatter } = splitFrontmatterContent(content, parseYaml);
      await refreshManagedBibEntry(
        plugin.app,
        literatureNoteEntryFromFrontmatter(writeResult.file, frontmatter),
        canWrite,
      );
    } catch (error) {
      console.error(
        "stratum: could not refresh managed bibliography entry",
        error,
      );
    }
  }
  return writeResult;
}
