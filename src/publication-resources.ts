import { Platform } from "obsidian";
import type StratumPlugin from "./plugin";
import type { BibliographyCache } from "./publication-bibliography-cache";
import {
  resolveRegistryResources,
  TEMPLATE_RESOURCE_PINS,
} from "./publication-registry";
export function publicationResourceCache(
  plugin: StratumPlugin,
): BibliographyCache {
  return {
    adapter: plugin.app.vault.adapter,
    directory: `${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`}/cache/bibliography`,
  };
}
export async function installedTemplateResources(
  cache: BibliographyCache,
  family: string,
  signal?: AbortSignal,
  allowDownload = true,
): Promise<Record<string, Uint8Array>> {
  if (!Platform.isDesktop)
    throw new Error("Installing LaTeX templates requires desktop Obsidian.");
  if (family === "research") return {};
  const pin = TEMPLATE_RESOURCE_PINS[family];
  if (!pin)
    throw new Error("This template has no compatible Stratum mirror release.");
  const { downloadPublicationResource } = await import("./publish-desktop");
  const require = (window as unknown as { require?: (name: string) => unknown })
    .require;
  if (!require) throw new Error("Desktop file access is unavailable.");
  const zlib = require("node:zlib") as {
    inflateRawSync(
      bytes: Uint8Array,
      options: { maxOutputLength: number },
    ): Uint8Array;
  };
  return resolveRegistryResources(
    cache,
    pin,
    (spec) => downloadPublicationResource(spec, signal),
    (bytes, maxOutputLength) => zlib.inflateRawSync(bytes, { maxOutputLength }),
    signal,
    allowDownload,
  );
}
