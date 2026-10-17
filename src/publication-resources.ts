import { resolveInstallationResources } from "./publication-installation-resources";
import type { TemplateInstallation } from "./publication-installation";
import { Platform } from "obsidian";
import type StratumPlugin from "./plugin";
import type { BibliographyCache } from "./publication-bibliography-cache";
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
  installation: TemplateInstallation,
  signal?: AbortSignal,
  allowDownload = true,
): Promise<Record<string, Uint8Array>> {
  if (!Platform.isDesktop)
    throw new Error("Installing LaTeX templates requires desktop Obsidian.");
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
  return resolveInstallationResources(
    cache,
    installation,
    (spec) => downloadPublicationResource(spec, signal),
    (bytes, maxOutputLength) => zlib.inflateRawSync(bytes, { maxOutputLength }),
    signal,
    allowDownload,
  );
}
