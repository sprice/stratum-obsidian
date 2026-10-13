import type { App, Plugin } from "obsidian";

interface SettingsManager {
  open(): void;
  openTabById(id: string): void;
}

function getSettingsManager(app: App): SettingsManager | null {
  return (app as App & { setting?: SettingsManager }).setting ?? null;
}

export function openStratumSettings(
  plugin: Pick<Plugin, "app" | "manifest">,
): void {
  const settings = getSettingsManager(plugin.app);
  settings?.open();
  settings?.openTabById(plugin.manifest.id);
}
