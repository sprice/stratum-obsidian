import { Notice } from "obsidian";
import type StratumPlugin from "./plugin";
import { loadReferenceStore, saveReference } from "./citation-reference-store";
import { loadZoteroItemDetailForNoteSync } from "./plugin-note-sync";
import { readCslItem } from "./csl-data";
import { buildLiteratureNoteEntries } from "./library-search-modal";
const refreshes = new WeakMap<StratumPlugin, Promise<void>>();
export function refreshCitationData(plugin: StratumPlugin): Promise<void> {
  const pending = refreshes.get(plugin);
  if (pending) return pending;
  const task = fillMissingCitationData(plugin).finally(() =>
    refreshes.delete(plugin),
  );
  refreshes.set(plugin, task);
  return task;
}
async function fillMissingCitationData(plugin: StratumPlugin): Promise<void> {
  const entries = buildLiteratureNoteEntries(plugin);
  let updated = 0,
    failed = 0;
  const known = new Set(
    (await loadReferenceStore(plugin.app)).map((item) => item.id),
  );
  const candidates = entries.filter(
    (entry) => entry.identity && !known.has(entry.identity),
  );
  if (candidates.length)
    new Notice(`Fetching citation data for ${candidates.length} sources…`);
  for (const entry of candidates) {
    if (plugin.isUnloaded) break;
    const [type, id] = entry.identity!.split("/");
    const library = plugin.settings.enabledLibraries.find(
      (lib) => lib.type === type && lib.id === id,
    );
    if (!library) {
      failed++;
      continue;
    }
    try {
      await fetchCitationData(plugin, entry.identity!);
      updated++;
    } catch {
      failed++;
    }
  }
  if (plugin.isUnloaded) return;
  plugin.citations.invalidate();
  new Notice(
    `Citation data: ${updated} sources added${failed ? `, ${failed} unavailable. Check Zotero connection and enabled libraries` : ""}.`,
  );
}

const fetches = new WeakMap<StratumPlugin, Map<string, Promise<void>>>();
/** Fetch only a known identity. No manuscript, bibliography ownership, or note writes. */
export function fetchCitationData(
  plugin: StratumPlugin,
  identity: string,
): Promise<void> {
  let pending = fetches.get(plugin);
  if (!pending) {
    pending = new Map();
    fetches.set(plugin, pending);
  }
  const existing = pending.get(identity);
  if (existing) return existing;
  const task = fetchReference(plugin, identity).finally(() =>
    pending.delete(identity),
  );
  pending.set(identity, task);
  return task;
}
async function fetchReference(
  plugin: StratumPlugin,
  identity: string,
): Promise<void> {
  const match = /^(user|group)\/([^/]+)\/([^/]+)$/.exec(identity);
  if (!match)
    throw new Error(
      "This reference has no verified Zotero identity. Check its key or import its source.",
    );
  const [, type, id, key] = match;
  const library = plugin.settings.enabledLibraries.find(
    (lib) => lib.type === type && lib.id === id,
  );
  if (!library)
    throw new Error(
      "Enable this source's library in Settings → Stratum, then retry.",
    );
  const active = () =>
    !plugin.isUnloaded &&
    plugin.settings.enabledLibraries.some(
      (lib) => lib.type === type && lib.id === id,
    );
  if (!active()) throw new Error("Citation data recovery was cancelled.");
  const result = await loadZoteroItemDetailForNoteSync(plugin, {
    library,
    itemKey: key,
    sourcePreference: "auto",
  });
  if (!active()) throw new Error("Citation data recovery was cancelled.");
  if (!result.detail) {
    if (
      (result.localMissing || result.backendMissing) &&
      !result.localError &&
      (!result.backendError || result.backendMissing)
    )
      throw new Error(
        "The source is unavailable in the connected Zotero library. Check Zotero and library access, then retry. Cached data has been kept.",
      );
    throw new Error(
      "Could not fetch citation data. Check your Zotero connection and library access, then retry. Cached data has been kept.",
    );
  }
  const detail = result.detail;
  if (
    `${detail.library.type}/${detail.library.id}/${detail.item.key}` !==
    identity
  )
    throw new Error(
      "Zotero returned a different source. No citation data was changed.",
    );
  if (!readCslItem(detail.item.csl, identity))
    throw new Error(
      "Zotero did not return usable citation data. Update Stratum and check the source metadata, then retry.",
    );
  await saveReference(plugin.app, detail, active);
  if (!active()) throw new Error("Citation data recovery was cancelled.");
  plugin.citations.invalidate();
}
