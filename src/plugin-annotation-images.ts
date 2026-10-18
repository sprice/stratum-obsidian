import { Platform, TFile, parseYaml, normalizePath } from "obsidian";
import type StratumPlugin from "./plugin";
import type { ZoteroItemDetail } from "./backend-types";
import {
  loadStratumAnnotationImage,
  StratumAnnotationItemError,
  StratumAnnotationError,
} from "./stratum-zotero-images";
import { validAnnotationImagePath } from "./annotation-image-paths";
import { annotationImageDestination } from "./annotation-image-destination";
import { ensureFolder } from "./literature-note-files";
import { splitFrontmatterContent } from "./literature-note-content";
import { loadLocalZoteroLibraries } from "./zotero-local";
import { withAnnotationImageTimeout } from "./annotation-image-timeout";
import { getLiteratureNoteMatchPriority } from "./literature-note-matching";

const states = new WeakMap<
  StratumPlugin,
  {
    unavailableUntil: number;
    port: number;
    pending: Set<string>;
    failures: Set<string>;
    userId: string | null;
    checkedAt: number;
  }
>();
function stateFor(plugin: StratumPlugin) {
  let state = states.get(plugin);
  if (!state || state.port !== plugin.settings.zoteroLocalApiPort) {
    state = {
      unavailableUntil: 0,
      port: plugin.settings.zoteroLocalApiPort,
      pending: new Set(),
      failures: new Set(),
      userId: null,
      checkedAt: 0,
    };
    states.set(plugin, state);
  }
  return state;
}

/** A user-triggered bulk sync retries immediately after installing Stratum in Zotero. */
export function beginAnnotationImageSync(plugin: StratumPlugin): void {
  const state = stateFor(plugin);
  state.unavailableUntil = 0;
  state.checkedAt = 0;
  state.pending.clear();
  state.failures.clear();
}

export function annotationImageSyncSummary(plugin: StratumPlugin): string {
  const state = states.get(plugin);
  const count = state?.pending.size ?? 0;
  state?.pending.clear();
  const reasons = [...(state?.failures ?? [])].join(" ");
  state?.failures.clear();
  return count
    ? ` ${count} area image${count === 1 ? "" : "s"} could not be imported or refreshed; comments and Zotero links were preserved. For images, keep Zotero running with Stratum installed and the source PDF available, then sync again.${reasons ? ` Details: ${reasons}` : ""}`
    : "";
}

export async function importAnnotationImages(
  plugin: StratumPlugin,
  detail: ZoteroItemDetail,
  existingFile: TFile | null,
): Promise<ZoteroItemDetail> {
  const images = detail.annotations.filter((a) => a.type === "image");
  if (!images.length) return detail;
  const { notesFolder, zoteroLocalApiPort, accountId } = plugin.settings;
  const state = stateFor(plugin);
  const frontmatter = existingFile
    ? splitFrontmatterContent(
        await plugin.app.vault.read(existingFile),
        parseYaml,
      ).frontmatter
    : null;
  if (
    existingFile &&
    getLiteratureNoteMatchPriority(frontmatter, {
      libraryType: detail.library.type,
      libraryId: detail.library.id,
      itemKey: detail.item.key,
    }) === null
  )
    throw new Error("The note no longer matches this Zotero item.");
  const stored = frontmatter?.stratum_annotation_images;
  const owned =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const active = () =>
    !plugin.isUnloaded &&
    plugin.settings.accountId === accountId &&
    plugin.settings.notesFolder === notesFolder &&
    plugin.settings.zoteroLocalApiPort === zoteroLocalApiPort &&
    plugin.backend.hasSession() &&
    plugin.settings.enabledLibraries.some(
      (l) => l.type === detail.library.type && l.id === detail.library.id,
    );
  let canFetch = false;
  if (
    Platform.isDesktopApp &&
    Date.now() >= state.unavailableUntil &&
    active()
  ) {
    try {
      if (Date.now() - state.checkedAt > 60_000) {
        state.userId = (
          await withAnnotationImageTimeout(
            loadLocalZoteroLibraries({ port: state.port }),
          )
        ).userId;
        state.checkedAt = Date.now();
      }
      if (detail.library.type !== "user" || state.userId === detail.library.id)
        canFetch = true;
      else
        state.failures.add(
          "The local Zotero account does not match this library.",
        );
    } catch (error) {
      state.failures.add("The local Zotero library identity check failed.");
      if (!(error instanceof StratumAnnotationItemError))
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
      const folder = normalizePath(notesFolder.trim()).replace(/\/+$/, "");
      const destination = annotationImageDestination({
        plugin,
        detail,
        key: annotation.key,
        prior,
        folder,
      });
      if (canFetch && Platform.isDesktopApp && active()) {
        const bytes = await loadStratumAnnotationImage(
          detail,
          annotation,
          state.port,
        ).catch((error: unknown) => {
          if (!(error instanceof StratumAnnotationItemError)) {
            state.unavailableUntil = Date.now() + 60_000;
            canFetch = false;
          }
          throw error;
        });
        if (!validAnnotationImagePath(detail, annotation.key, destination))
          throw new Error("Invalid attachment destination.");
        if (!active()) throw new Error("Image sync cancelled.");
        const current = plugin.app.vault.getAbstractFileByPath(destination);
        if (current instanceof TFile) {
          if (prior !== destination)
            throw new Error("Attachment filename is already in use.");
          const next = new Uint8Array(bytes);
          // Only read files as small as our bounded source image. A colliding
          // user file can be arbitrarily large and must never exhaust memory.
          const existing =
            current.stat.size === next.length
              ? new Uint8Array(await plugin.app.vault.readBinary(current))
              : null;
          const same =
            existing?.length === next.length &&
            existing.every((byte, index) => byte === next[index]);
          if (!same) {
            // An async lookup/read must not retain permission from a note that
            // has since changed its identity or relinquished image ownership.
            if (!existingFile) throw new Error("Missing image ownership.");
            const latest = splitFrontmatterContent(
              await plugin.app.vault.read(existingFile),
              parseYaml,
            ).frontmatter;
            const latestPaths = latest.stratum_annotation_images as
              Record<string, unknown> | undefined;
            if (
              getLiteratureNoteMatchPriority(latest, {
                libraryType: detail.library.type,
                libraryId: detail.library.id,
                itemKey: detail.item.key,
              }) === null ||
              latestPaths?.[annotation.key] !== destination
            )
              throw new Error("Image ownership changed during sync.");
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
    } catch (error) {
      state.failures.add(
        error instanceof StratumAnnotationError
          ? error.message
          : "Could not save the annotation image in the vault.",
      );
      /* Image failures never prevent text sync or discard a previous embed. */
    }
    if (!imported) state.pending.add(identity);
    else state.pending.delete(identity);
    annotations.push({
      ...annotation,
      imagePath,
      imageMissing: !imagePath,
      imageUnavailable: !imagePath ? "Area image unavailable." : undefined,
    });
  }
  return { ...detail, annotations };
}
