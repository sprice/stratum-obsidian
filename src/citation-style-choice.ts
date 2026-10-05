import type { TFile } from "obsidian";
import type StratumPlugin from "./plugin";
import {
  bundledStyles,
  cachedStyle,
  prepareStyle,
  styleTitle,
} from "./citation-styles";

export function noteCitationStyleChoices(
  plugin: StratumPlugin,
  file: TFile,
  text: string,
) {
  // Resolve the active style from live text, including unsaved note overrides.
  const { style } = plugin.citations.preferences(file.path, text);
  const ids = new Set([
    ...bundledStyles.map(({ id }) => id),
    ...Object.keys(plugin.settings.citationStyles),
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
}
