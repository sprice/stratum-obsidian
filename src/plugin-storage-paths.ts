import type { App } from "obsidian";

const directories = new WeakMap<App, string>();

export function pluginStorageDirectory(app: App): string {
  return directories.get(app) ?? `${app.vault.configDir}/plugins/stratum`;
}

export function setPluginStorageDirectory(app: App, directory?: string): void {
  directories.set(app, directory ?? `${app.vault.configDir}/plugins/stratum`);
}

export function referenceStorePath(app: App): string {
  return `${pluginStorageDirectory(app)}/stratum-references.json`;
}
