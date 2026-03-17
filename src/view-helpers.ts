import type { App } from "obsidian";

const ABSTRACT_TEASER_LENGTH = 220;

interface SettingsManager {
  open(): void;
  openTabById(id: string): void;
}

export function getSettingsManager(app: App): SettingsManager | null {
  return (app as App & { setting?: SettingsManager }).setting ?? null;
}

export function getAbstractTeaser(text: string): string {
  if (text.length <= ABSTRACT_TEASER_LENGTH) {
    return text;
  }

  const teaser = text.slice(0, ABSTRACT_TEASER_LENGTH);
  const lastSpaceIndex = teaser.lastIndexOf(" ");
  const trimmedTeaser =
    lastSpaceIndex > ABSTRACT_TEASER_LENGTH * 0.6
      ? teaser.slice(0, lastSpaceIndex)
      : teaser;

  return `${trimmedTeaser.trimEnd()}...`;
}

export { ABSTRACT_TEASER_LENGTH };
