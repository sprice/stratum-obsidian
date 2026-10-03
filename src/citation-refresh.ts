import { Notice } from "obsidian";
import type StratumPlugin from "./plugin";
import { loadReferenceStore, saveReference } from "./citation-reference-store";
import { requireZoteroItemDetailForNoteSync } from "./plugin-note-sync";
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
    const [type, id, key] = entry.identity!.split("/");
    const library = plugin.settings.enabledLibraries.find(
      (lib) => lib.type === type && lib.id === id,
    );
    if (!library) {
      failed++;
      continue;
    }
    try {
      const detail = await requireZoteroItemDetailForNoteSync(plugin, {
        library,
        itemKey: key,
        sourcePreference: "auto",
      });
      if (!detail.item.csl) throw new Error("Citation data unavailable.");
      await saveReference(plugin.app, detail, () => !plugin.isUnloaded);
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
