import { TFile, type App } from "obsidian";
import { readCslItem, type CslItem } from "./csl-data";
import type { ZoteroItemDetail } from "./backend-client";
export const REFERENCE_FILE = "stratum-references.json";
interface ReferenceStore {
  version: 1;
  items: CslItem[];
}
export function readReferenceStore(text: string): ReferenceStore {
  const data = JSON.parse(text) as Partial<ReferenceStore>;
  if (
    !data ||
    typeof data !== "object" ||
    data.version !== 1 ||
    !Array.isArray(data.items)
  )
    throw new Error("The citation data file has an unsupported format.");
  const ids = new Set<string>();
  const items = data.items.map((item) => {
    const id = item?.id;
    const parsed =
      typeof id === "string" && /^(user|group)\/[^/]+\/[^/]+$/.test(id)
        ? readCslItem(item, id)
        : null;
    if (!parsed || ids.has(parsed.id))
      throw new Error(
        "The citation data file contains invalid or duplicate sources.",
      );
    ids.add(parsed.id);
    return parsed;
  });
  return { version: 1, items };
}
const snapshots = new WeakMap<App, { text: string; store: ReferenceStore }>();
function cachedStore(app: App, text: string): ReferenceStore {
  const old = snapshots.get(app);
  if (old?.text === text) return old.store;
  const store = readReferenceStore(text);
  snapshots.set(app, { text, store });
  return store;
}
export async function loadReferenceStore(app: App): Promise<CslItem[]> {
  const file = app.vault.getAbstractFileByPath(REFERENCE_FILE);
  if (!file) return [];
  if (!(file instanceof TFile))
    throw new Error("The citation data path is not a file.");
  return cachedStore(app, await app.vault.read(file)).items;
}
const pending = new WeakMap<App, Promise<unknown>>();
const batches = new WeakMap<
  App,
  Map<string, { item: CslItem; active: () => boolean }>
>();
/** Batch a catalog page without blocking its workers on per-item cache writes. */
export function beginReferenceBatch(app: App): () => Promise<void> {
  if (batches.has(app)) throw new Error("Citation cache batch already active.");
  const items = new Map<string, { item: CslItem; active: () => boolean }>();
  batches.set(app, items);
  return async () => {
    batches.delete(app);
    await writeReferences(app, [...items.values()]);
  };
}
async function writeReferences(
  app: App,
  updates: { item: CslItem; active: () => boolean }[],
): Promise<void> {
  if (!updates.length) return;
  const next = (pending.get(app) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const file = app.vault.getAbstractFileByPath(REFERENCE_FILE);
      if (file && !(file instanceof TFile))
        throw new Error("The citation data path is not a file.");
      const merge = (text: string, creating = false) => {
        const active = updates.filter((update) => update.active());
        if (!active.length) return text;
        const store = creating
          ? { version: 1, items: [] as CslItem[] }
          : cachedStore(app, text);
        const index = new Map(store.items.map((item) => [item.id, item]));
        let changed = false;
        for (const { item } of active) {
          if (JSON.stringify(index.get(item.id)) !== JSON.stringify(item)) {
            index.set(item.id, item);
            changed = true;
          }
        }
        return changed
          ? JSON.stringify({ version: 1, items: [...index.values()] }) + "\n"
          : text;
      };
      if (file instanceof TFile) {
        const original = await app.vault.read(file);
        if (merge(original) !== original) await app.vault.process(file, merge);
      } else {
        const content = merge("", true);
        if (content) await app.vault.create(REFERENCE_FILE, content);
      }
    });
  pending.set(app, next);
  await next;
}
export async function saveReference(
  app: App,
  detail: ZoteroItemDetail,
  active: () => boolean,
): Promise<void> {
  const id = `${detail.library.type}/${detail.library.id}/${detail.item.key}`;
  const item = readCslItem(detail.item.csl, id);
  if (!item) return;
  const batch = batches.get(app);
  if (batch) {
    batch.set(id, { item, active });
    return;
  }
  await writeReferences(app, [{ item, active }]);
}
