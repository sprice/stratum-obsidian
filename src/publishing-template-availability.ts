import type StratumPlugin from "./plugin";
import { readPublishingTemplates } from "./publish-templates";

const saves = new WeakMap<StratumPlugin, Promise<void>>();
const requests = new WeakMap<StratumPlugin, Map<string, number>>();
/** Installation completes before enablement; failed installs never change preferences. */
export async function setPublishingTemplateEnabled(
  plugin: StratumPlugin,
  id: string,
  enabled: boolean,
  install: () => Promise<unknown> = () => Promise.resolve(),
  signal?: AbortSignal,
): Promise<void> {
  let intents = requests.get(plugin);
  if (!intents) {
    intents = new Map();
    requests.set(plugin, intents);
  }
  const request = (intents.get(id) ?? 0) + 1;
  intents.set(id, request);
  if (enabled) await install();
  const previous = saves.get(plugin) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      if (intents.get(id) !== request) return;
      if (signal?.aborted) throw new Error("Template installation cancelled.");
      const old = plugin.settings.publishingTemplates;
      const state = readPublishingTemplates(old);
      const ids = new Set(state.enabledIds);
      if (enabled) ids.add(id);
      else ids.delete(id);
      const updated = { ...state, enabledIds: [...ids] };
      plugin.settings.publishingTemplates = updated;
      try {
        await plugin.saveSettings();
      } catch (error) {
        if (plugin.settings.publishingTemplates === updated)
          plugin.settings.publishingTemplates = old;
        throw error;
      }
      plugin.refreshViews();
    });
  saves.set(plugin, next);
  try {
    await next;
  } finally {
    if (saves.get(plugin) === next) saves.delete(plugin);
  }
}
