import { TFile } from "obsidian";
import type StratumPlugin from "./plugin";
import type { ZoteroItemDetail } from "./backend-types";
import {
  annotationImageName,
  validAnnotationImagePath,
} from "./annotation-image-paths";

/** Stored names survive title changes; unowned files always keep their names. */
export function annotationImageDestination(params: {
  plugin: StratumPlugin;
  detail: ZoteroItemDetail;
  key: string;
  prior: unknown;
  folder: string;
}): string {
  const { plugin, detail, key, prior, folder } = params;
  const vault = plugin.app.vault;
  if (validAnnotationImagePath(detail, key, prior)) {
    const current = vault.getAbstractFileByPath(prior);
    if (!current || current instanceof TFile) return prior;
  }
  const parent = `${folder ? `${folder}/` : ""}Attachments`;
  const stem = annotationImageName(detail, key).slice(0, -4);
  let destination = `${parent}/${stem}.png`;
  let suffix = 2;
  while (vault.getAbstractFileByPath(destination)) {
    destination = `${parent}/${stem}-${suffix++}.png`;
  }
  return destination;
}
