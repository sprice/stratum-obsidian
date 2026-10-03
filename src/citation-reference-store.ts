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
export async function loadReferenceStore(app: App): Promise<CslItem[]> {
  const file = app.vault.getAbstractFileByPath(REFERENCE_FILE);
  if (!file) return [];
  if (!(file instanceof TFile))
    throw new Error("The citation data path is not a file.");
  return readReferenceStore(await app.vault.read(file)).items;
}
const pending = new WeakMap<App, Promise<unknown>>();
export async function saveReference(
  app: App,
  detail: ZoteroItemDetail,
  active: () => boolean,
): Promise<void> {
  const id = `${detail.library.type}/${detail.library.id}/${detail.item.key}`;
  const item = readCslItem(detail.item.csl, id);
  if (!item) return; // Older servers cannot erase previously imported CSL data.
  const next = (pending.get(app) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (!active()) return;
      const file = app.vault.getAbstractFileByPath(REFERENCE_FILE);
      const update = (text: string, creating = false) => {
        if (!active()) return text;
        const store = creating
          ? { version: 1, items: [] as CslItem[] }
          : readReferenceStore(text);
        const index = store.items.findIndex((value) => value.id === id);
        if (index < 0) store.items.push(item);
        else store.items[index] = item;
        return JSON.stringify(store, null, 2) + "\n";
      };
      if (file instanceof TFile) await app.vault.process(file, update);
      else if (file) throw new Error("The citation data path is not a file.");
      else await app.vault.create(REFERENCE_FILE, update("", true));
    });
  pending.set(app, next);
  await next;
}
