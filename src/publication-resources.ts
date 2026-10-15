import { Platform } from "obsidian";
import type StratumPlugin from "./plugin";
import type { BibliographyCache } from "./publication-bibliography-cache";
import { cachedPublicationResource } from "./publication-bibliography-cache";
import { publicationArchive } from "./publication-resource-archive";
import manifest from "./publication-templates/aastex/manifest.json";

export function publicationResourceCache(
  plugin: StratumPlugin,
): BibliographyCache {
  return {
    adapter: plugin.app.vault.adapter,
    directory: `${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`}/cache/bibliography`,
  };
}
/** Pins are shipped with the renderer, never supplied by a downloaded catalog. */
export const AASTEX_RESOURCE = {
  ...manifest.provenance,
  maxBytes: 5_000_000,
  extension: "zip" as const,
  classHash: "0ee51ff72a4d0b608a1885e87cddad4bcb41efacb852889de97637671c74d8ad",
};
export async function installedAastexResources(
  cache: BibliographyCache,
  signal?: AbortSignal,
  allowDownload = true,
): Promise<Record<string, Uint8Array>> {
  if (!Platform.isDesktop)
    throw new Error("Installing LaTeX templates requires desktop Obsidian.");
  const { downloadPublicationResource: download } =
    await import("./publish-desktop");
  const fetch = (resource: Parameters<typeof download>[0]) => {
    if (!allowDownload)
      throw new Error(
        "Template resources are missing or damaged. Enable the template again in Manage templates to reinstall.",
      );
    return download(resource, signal);
  };
  const require = (window as unknown as { require?: (name: string) => unknown })
    .require;
  if (!require) throw new Error("Desktop file access is unavailable.");
  const zlib = require("node:zlib") as {
    inflateRawSync(
      bytes: Uint8Array,
      options: { maxOutputLength: number },
    ): Uint8Array;
  };
  return resolvePublicationResourcePack(
    cache,
    {
      archive: AASTEX_RESOURCE,
      entries: { "aastex702.cls": AASTEX_RESOURCE.classHash },
      files: { "aasjournalv7.1.bst": manifest.bibliographyDownload },
    },
    fetch,
    (bytes, maxOutputLength) => zlib.inflateRawSync(bytes, { maxOutputLength }),
    signal,
  );
}

interface ResourceSpecification {
  url: string;
  sha256: string;
  maxBytes?: number;
  extension?: "bst" | "zip";
}
export interface PublicationResourcePack {
  archive: ResourceSpecification;
  entries: Record<string, string>;
  files: Record<string, ResourceSpecification>;
}
/** Shared resolver: retain the complete source archive, expose only approved runtime bytes. */
export async function resolvePublicationResourcePack(
  cache: BibliographyCache,
  pack: PublicationResourcePack,
  download: (specification: ResourceSpecification) => Promise<Uint8Array>,
  inflate: (bytes: Uint8Array, limit: number) => Uint8Array,
  signal?: AbortSignal,
): Promise<Record<string, Uint8Array>> {
  const archive = await cachedPublicationResource(
    cache,
    pack.archive,
    () => download(pack.archive),
    signal,
  );
  const files = publicationArchive(archive, inflate);
  const result: Record<string, Uint8Array> = {};
  for (const [name, hash] of Object.entries(pack.entries)) {
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(cls|sty|rtx|bst)$/.test(name))
      throw new Error("Invalid template resource name.");
    const entries = Object.entries(files).filter(
      ([path]) => path.split("/").at(-1) === name,
    );
    if (entries.length !== 1)
      throw new Error("The template archive has no unique required resource.");
    const bytes = entries[0][1];
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    );
    if (
      Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("") !==
      hash
    )
      throw new Error("The template resource fingerprint changed.");
    result[name] = bytes;
  }
  for (const [name, resource] of Object.entries(pack.files)) {
    if (
      !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(cls|sty|rtx|bst)$/.test(name) ||
      Object.hasOwn(result, name)
    )
      throw new Error("Invalid template resource name.");
    result[name] = await cachedPublicationResource(
      cache,
      resource,
      () => download(resource),
      signal,
    );
  }
  if (signal?.aborted) throw new Error("Publishing cancelled.");
  return result;
}
