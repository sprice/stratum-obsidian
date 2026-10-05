import {
  availableCitationStyles,
  changeCitationPreferences,
} from "./citation-style-collection";
import type { TFile } from "obsidian";
import type StratumPlugin from "./plugin";
import { cachedStyle, prepareStyle, styleTitle } from "./citation-styles";

export function noteCitationStyleChoices(
  plugin: StratumPlugin,
  file: TFile,
  text: string,
) {
  // Resolve the active style from live text, including unsaved note overrides.
  const { style } = plugin.citations.preferences(file.path, text);
  const ids = new Set([
    ...availableCitationStyles(plugin).map(({ id }) => id),
    style,
  ]);
  return {
    path: file.path,
    selected: style,
    unavailable: !cachedStyle(plugin, style),
    options: Array.from(ids, (id) => ({ id, title: styleTitle(plugin, id) })),
  };
}

export async function setNoteCitationStyle(
  plugin: StratumPlugin,
  file: TFile,
  style: string,
  language: string,
): Promise<void> {
  await changeCitationPreferences(plugin, async () => {
    await prepareStyle(plugin, style, language);
    if (plugin.isUnloaded) return;
    await plugin.app.fileManager.processFrontMatter(
      file,
      (fm: Record<string, unknown>) => {
        fm.stratum_citation_style = style;
        // Changing style must preserve independent language overrides and all
        // other user frontmatter. Language remains editable via the note command.
      },
    );
    plugin.citations.invalidate();
  });
}

export function resetNoteCitationPreferences(
  plugin: StratumPlugin,
  file: TFile,
): Promise<void> {
  return changeCitationPreferences(plugin, async () => {
    await plugin.app.fileManager.processFrontMatter(
      file,
      (fm: Record<string, unknown>) => {
        delete fm.stratum_citation_style;
        delete fm.stratum_citation_language;
      },
    );
    plugin.citations.invalidate();
  });
}
