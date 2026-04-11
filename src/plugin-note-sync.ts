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
  return await loadLocalZoteroItemDetail({
    port: plugin.settings.zoteroLocalApiPort,
    userId: await resolveLocalZoteroUserId(plugin),
    library: params.library,
    itemKey: params.itemKey,
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

export async function writeLiteratureNoteFromDetail(
  plugin: StratumPlugin,
  params: WriteLiteratureNoteFromDetailParams,
): Promise<LiteratureNoteWriteResult> {
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

  const writeResult = await createOrUpdateLiteratureNote({
    app: plugin.app,
    notesFolder: plugin.settings.notesFolder,
    filenameFormat: plugin.settings.filenameFormat,
    detail: params.detail,
    existingFile: params.existingFile,
    enrichment,
  });
  plugin.rememberLiteratureNoteFile(params.detail, writeResult.file);
  return writeResult;
}
