import { Platform, TFile, Notice, parseYaml, normalizePath } from "obsidian";
import type StratumPlugin from "./plugin";
import type { ZoteroItemDetail } from "./backend-types";
import {
  loadBetterBibtexImagePaths,
  BetterBibtexItemError,
} from "./better-bibtex-images";
import { readAnnotationPng } from "./annotation-image-file";
import {
  annotationImageName,
  validAnnotationImagePath,
} from "./annotation-image-paths";
import { ensureFolder } from "./literature-note-files";
import { splitFrontmatterContent } from "./literature-note-content";
import { loadLocalZoteroLibraries } from "./zotero-local";

const states = new WeakMap<
  StratumPlugin,
  {
    unavailableUntil: number;
    port: number;
    pending: Set<string>;
    userId: string | null;
    checkedAt: number;
    lastNotice: number;
  }
>();
function stateFor(plugin: StratumPlugin) {
  let state = states.get(plugin);
  if (!state || state.port !== plugin.settings.zoteroLocalApiPort) {
    state = {
      unavailableUntil: 0,
      port: plugin.settings.zoteroLocalApiPort,
      pending: new Set(),
      userId: null,
      checkedAt: 0,
      lastNotice: 0,
    };
    states.set(plugin, state);
  }
  return state;
}

/** A user-triggered bulk sync retries immediately after installing BBT. */
export function beginAnnotationImageSync(plugin: StratumPlugin): void {
  const state = stateFor(plugin);
  state.unavailableUntil = 0;
  state.checkedAt = 0;
  state.pending.clear();
}

export function annotationImageSyncSummary(plugin: StratumPlugin): string {
  const state = states.get(plugin);
  const count = state?.pending.size ?? 0;
  state?.pending.clear();
  return count
    ? ` ${count} area image${count === 1 ? "" : "s"} could not be imported or refreshed; comments and Zotero links were preserved. For images, keep Zotero running with Better BibTeX installed and the source PDF available, then sync again.`
    : "";
}

export async function importAnnotationImages(
  plugin: StratumPlugin,
  detail: ZoteroItemDetail,
  existingFile: TFile | null,
): Promise<ZoteroItemDetail> {
  const images = detail.annotations.filter((a) => a.type === "image");
  if (!images.length) return detail;
  const state = stateFor(plugin);
  const stored = existingFile
    ? splitFrontmatterContent(
        await plugin.app.vault.read(existingFile),
        parseYaml,
      ).frontmatter.stratum_annotation_images
    : null;
  const owned =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const active = () =>
    !plugin.isUnloaded &&
    plugin.backend.hasSession() &&
    plugin.settings.enabledLibraries.some(
      (l) => l.type === detail.library.type && l.id === detail.library.id,
    );
  let sources = new Map<string, string>();
  if (
    Platform.isDesktopApp &&
    Date.now() >= state.unavailableUntil &&
    active()
  ) {
    try {
      if (Date.now() - state.checkedAt > 60_000) {
        state.userId = (
          await loadLocalZoteroLibraries({ port: state.port })
        ).userId;
        state.checkedAt = Date.now();
      }
      if (detail.library.type !== "user" || state.userId === detail.library.id)
        sources = await loadBetterBibtexImagePaths(detail, state.port);
    } catch (error) {
      if (!(error instanceof BetterBibtexItemError))
        state.unavailableUntil = Date.now() + 60_000;
    }
  }
  const annotations = [];
  for (const annotation of detail.annotations) {
    if (annotation.type !== "image") {
      annotations.push(annotation);
      continue;
    }
    const prior = owned[annotation.key];
    let imagePath: string | undefined;
    if (
      validAnnotationImagePath(detail, annotation.key, prior) &&
      plugin.app.vault.getAbstractFileByPath(prior) instanceof TFile
    )
      imagePath = prior;
    const identity = `${detail.library.type}/${detail.library.id}/${detail.item.key}/${annotation.key}`;
    let imported = false;
    try {
      const sourcePath = sources.get(annotation.key);
      if (sourcePath && Platform.isDesktopApp && active()) {
        const bytes = await readAnnotationPng({
          dataDir: plugin.settings.zoteroDataDir,
          sourcePath,
          libraryType: detail.library.type,
          libraryId: detail.library.id,
          key: annotation.key,
        });
        const folder = normalizePath(
          plugin.settings.notesFolder.trim(),
        ).replace(/\/+$/, "");
        const destination = `${folder ? `${folder}/` : ""}Attachments/${annotationImageName(detail, annotation.key)}`;
        if (!validAnnotationImagePath(detail, annotation.key, destination))
          throw new Error("Invalid attachment destination.");
        if (!active()) throw new Error("Image sync cancelled.");
        const current = plugin.app.vault.getAbstractFileByPath(destination);
        if (current instanceof TFile) {
          const existing = new Uint8Array(
            await plugin.app.vault.readBinary(current),
          );
          const next = new Uint8Array(bytes);
          const same =
            existing.length === next.length &&
            existing.every((byte, index) => byte === next[index]);
          if (!same) {
            if (prior !== destination)
              throw new Error("Attachment filename is already in use.");
            if (!active()) throw new Error("Image sync cancelled.");
            await plugin.app.vault.modifyBinary(current, bytes);
          }
        } else if (current) {
          throw new Error("Attachment filename is already in use.");
        } else {
          await ensureFolder(
            plugin.app,
            destination.slice(0, destination.lastIndexOf("/")),
          );
          if (!active()) throw new Error("Image sync cancelled.");
          await plugin.app.vault.createBinary(destination, bytes);
        }
        imagePath = destination;
        imported = true;
      }
    } catch {
      /* Image failures never prevent text sync or discard a previous embed. */
    }
    if (!imported) state.pending.add(identity);
    else state.pending.delete(identity);
    annotations.push({
      ...annotation,
      imagePath,
      imageMissing: !imagePath,
      imageUnavailable: !imagePath
        ? "Area image unavailable. Sync on desktop with Zotero running, Better BibTeX installed, a citation key, and the source PDF available."
        : undefined,
    });
  }
  // Bulk sync appends one aggregate message to its existing completion notice.
  if (
    !plugin.bulkLibrarySyncRunPromise &&
    state.pending.size &&
    Date.now() - state.lastNotice > 60_000 &&
    active()
  ) {
    state.lastNotice = Date.now();
    new Notice(`Stratum:${annotationImageSyncSummary(plugin)}`);
  }
  return { ...detail, annotations };
}
