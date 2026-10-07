import type { App } from "obsidian";

interface SettingsManager {
  open(): void;
  openTabById(id: string): void;
}

export function getSettingsManager(app: App): SettingsManager | null {
  return (app as App & { setting?: SettingsManager }).setting ?? null;
}
