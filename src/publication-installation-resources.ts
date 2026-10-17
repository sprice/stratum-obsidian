import {
  cachedPublicationResource,
  type BibliographyCache,
} from "./publication-bibliography-cache";
import {
  readTemplateInstallation,
  type TemplateInstallation,
} from "./publication-installation";
import {
  registryUrl,
  resolveRegistryResources,
  type RegistryDownload,
} from "./publication-registry";

/** Generated files have their own immutable hashes; publisher archives remain unchanged. */
export async function resolveInstallationResources(
  cache: BibliographyCache,
  value: TemplateInstallation,
  download: RegistryDownload,
  inflate: (bytes: Uint8Array, limit: number) => Uint8Array,
  signal?: AbortSignal,
  allowDownload = true,
): Promise<Record<string, Uint8Array>> {
  const installation = readTemplateInstallation(value);
  const generated = new Set(installation.assets.map((a) => a.name));
  const files = await resolveRegistryResources(
    cache,
    {
      ...installation.pin,
      runtime: Object.fromEntries(
        Object.entries(installation.pin.runtime).filter(
          ([name]) => !generated.has(name),
        ),
      ),
    },
    download,
    inflate,
    signal,
    allowDownload,
  );
  for (const asset of installation.assets) {
    const bytes = await cachedPublicationResource(
      cache,
      {
        sha256: asset.sha256,
        maxBytes: asset.bytes,
        extension: "bin",
      },
      () => {
        if (!allowDownload)
          throw new Error(
            "Template resources are missing or damaged. Repair this exact version in Publishing templates.",
          );
        return download({
          url: registryUrl(asset.download),
          sha256: asset.sha256,
          maxBytes: asset.bytes,
        });
      },
      signal,
    );
    if (bytes.length !== asset.bytes)
      throw new Error("Prepared template resource size changed.");
    files[asset.name] = bytes;
  }
  if (signal?.aborted) throw new Error("Template installation cancelled.");
  return files;
}
