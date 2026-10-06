import {
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  parseYaml,
  type TFile,
} from "obsidian";
import { splitFrontmatterContent } from "./literature-note-frontmatter";
import { VIEW_TYPE_STRATUM } from "./constants";
import { MANAGED_START, MANAGED_END } from "./literature-note-content-types";
import type StratumPlugin from "./plugin";
import {
  readLiteratureNoteLayout,
  NOTE_LAYOUT_KEY,
} from "./literature-note-layout";

interface ZoteroLink {
  label: string;
  uri: string;
}

function literatureNote(
  plugin: StratumPlugin,
  file: TFile | null,
): TFile | null {
  if (
    !file ||
    plugin.app.vault.getAbstractFileByPath(file.path) !== file ||
    plugin.app.metadataCache.getFileCache(file)?.frontmatter
      ?.stratum_note_type !== "literature-note"
  )
    return null;
  return file;
}

/** The active literature note takes priority over a source beside the draft. */
export function zoteroCommandNote(plugin: StratumPlugin): TFile | null {
  const active = literatureNote(
    plugin,
    plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null,
  );
  if (active) return active;
  if (
    plugin.activeViewTab !== "reader" ||
    !plugin.app.workspace
      .getLeavesOfType(VIEW_TYPE_STRATUM)
      .some((leaf) => leaf.view.containerEl.isShown())
  )
    return null;
  return literatureNote(plugin, plugin.readerNoteFile);
}

function isZoteroItemUri(uri: string): boolean {
  return /^zotero:\/\/(?:select|open-pdf)\/(?:library|groups\/\d+)\/items\/[A-Z0-9]+(?:\?[^\s]*)?$/.test(
    uri,
  );
}

/** Only use attachment links from Stratum's managed Reference callout. */
export function zoteroAttachmentLinks(content: string): ZoteroLink[] {
  const { frontmatter, body } = splitFrontmatterContent(content, parseYaml);
  const layout = readLiteratureNoteLayout(body, frontmatter[NOTE_LAYOUT_KEY]);
  if (!layout) return [];
  content = layout.managed;
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END, start);
  if (start < 0 || end < 0) return [];
  const managed = content.slice(start + MANAGED_START.length, end);
  const openLine = managed
    .split(/\r?\n/)
    .find((line) => /^> \*\*Open\*\*: /.test(line));
  if (!openLine) return [];
  const links = new Map<string, ZoteroLink>();
  const matches = [
    ...openLine.matchAll(/\[([^\n]*?)\]\((zotero:\/\/[^\s)]+)\)/g),
  ];
  // The first Zotero URI is the parent item; attachment titles can also be Zotero.
  for (const match of matches.slice(1)) {
    const [, label, uri] = match;
    if (!isZoteroItemUri(uri)) continue;
    links.set(uri, { label, uri });
  }
  return [...links.values()];
}

class AttachmentPicker extends FuzzySuggestModal<ZoteroLink> {
  constructor(
    plugin: StratumPlugin,
    private links: ZoteroLink[],
  ) {
    super(plugin.app);
    this.setPlaceholder("Choose an attachment to open in Zotero");
  }
  getItems(): ZoteroLink[] {
    return this.links;
  }
  getItemText(link: ZoteroLink): string {
    return link.label;
  }
  onChooseItem(link: ZoteroLink): void {
    window.open(link.uri, "_blank", "noopener,noreferrer");
  }
}

export async function openNoteInZotero(
  plugin: StratumPlugin,
  file: TFile,
  attachment: boolean,
): Promise<void> {
  if (!literatureNote(plugin, file)) return;
  if (!attachment) {
    const uri: unknown =
      plugin.app.metadataCache.getFileCache(file)?.frontmatter?.zotero_link;
    if (typeof uri !== "string" || !isZoteroItemUri(uri)) {
      new Notice("This literature note has no valid Zotero item link.");
      return;
    }
    window.open(uri, "_blank", "noopener,noreferrer");
    return;
  }
  const links = zoteroAttachmentLinks(await plugin.app.vault.cachedRead(file));
  if (plugin.isUnloaded || !literatureNote(plugin, file)) return;
  if (!links.length) {
    new Notice(
      "This literature note has no attachment links to open in Zotero.",
    );
  } else if (links.length === 1) {
    window.open(links[0].uri, "_blank", "noopener,noreferrer");
  } else {
    new AttachmentPicker(plugin, links).open();
  }
}

export function registerZoteroOpenCommands(plugin: StratumPlugin): void {
  for (const [id, name, attachment] of [
    ["open-source-in-zotero", "Open source in Zotero", false],
    ["open-attachment-in-zotero", "Open attachment in Zotero", true],
  ] as const) {
    plugin.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const file = zoteroCommandNote(plugin);
        if (!file) return false;
        if (!checking)
          void openNoteInZotero(plugin, file, attachment).catch(
            () => new Notice("Could not open this source in Zotero."),
          );
        return true;
      },
    });
  }
}
