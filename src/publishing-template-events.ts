import type StratumPlugin from "./plugin";

const listeners = new WeakMap<StratumPlugin, Set<() => void>>();
export function onTemplateInstalled(
  plugin: StratumPlugin,
  listener: () => void,
): () => void {
  let callbacks = listeners.get(plugin);
  if (!callbacks) listeners.set(plugin, (callbacks = new Set()));
  callbacks.add(listener);
  return () => {
    callbacks.delete(listener);
  };
}
export function notifyTemplateInstalled(plugin: StratumPlugin): void {
  for (const listener of listeners.get(plugin) ?? []) listener();
}
