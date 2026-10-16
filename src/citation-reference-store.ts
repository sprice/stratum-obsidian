import type { App } from "obsidian";
import { referenceStorePath } from "./plugin-storage-paths";
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
const listeners = new WeakMap<App, Set<() => void>>();
export function onReferenceStoreChange(
  app: App,
  listener: () => void,
): () => void {
  const entries = listeners.get(app) ?? new Set<() => void>();
  listeners.set(app, entries);
  entries.add(listener);
  return () => {
    entries.delete(listener);
  };
}
export async function loadReferenceStore(app: App): Promise<CslItem[]> {
  const path = referenceStorePath(app);
  if (!(await app.vault.adapter.exists(path))) return [];
  return cachedStore(app, await app.vault.adapter.read(path)).items;
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
      const path = referenceStorePath(app);
      const adapter = app.vault.adapter;
      const exists = await adapter.exists(path);
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
      const original = exists ? await adapter.read(path) : "";
      const content = merge(original, !exists);
      if (content === original) return;
      const parts = path.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        const directory = parts.slice(0, i).join("/");
        if (!(await adapter.exists(directory))) await adapter.mkdir(directory);
      }
      if (!updates.some((update) => update.active())) return;
      // A vault sync can restore this file while its parent directories are being created.
      if (await adapter.exists(path))
        await adapter.process(path, (text) => merge(text));
      else {
        const latest = merge("", true);
        if (!latest) return;
        await adapter.write(path, latest);
      }
      for (const listener of listeners.get(app) ?? []) listener();
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
