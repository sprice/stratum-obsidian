import type { BibliographyCache } from "./publication-bibliography-cache";
import { readTemplatePackage } from "./publication-package";
import { registryListing } from "./publication-registry-cache";
import {
  TEMPLATE_REGISTRY_ORIGIN,
  type RegistryDownload,
} from "./publication-registry";

export interface PackageCatalogRelease {
  id: string;
  name: string;
  version: string;
  sha256: string;
}

/** Discovery supplies pins only; installation re-fetches and verifies all bytes. */
export function readPackageCatalog(value: unknown): PackageCatalogRelease[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid template package catalog.");
  const packages = (value as Record<string, unknown>).packages;
  if (!Array.isArray(packages) || packages.length > 1000)
    throw new Error("Invalid template package catalog.");
  const seen = new Set<string>();
  return packages.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Invalid template package listing.");
    const entry = item as Record<string, unknown>;
    const manifest = readTemplatePackage(entry.manifest);
    const key = `${manifest.id}:${manifest.version}`;
    if (
      entry.id !== manifest.id ||
      entry.name !== manifest.name ||
      typeof entry.manifestSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.manifestSha256) ||
      seen.has(key)
    )
      throw new Error("Invalid template package listing.");
    seen.add(key);
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      sha256: entry.manifestSha256,
    };
  });
}

export function packageRegistryListing(
  cache: BibliographyCache,
  download: RegistryDownload,
) {
  return registryListing(
    cache,
    "package-catalog",
    readPackageCatalog,
    async () => {
      const bytes = await download({
        url: `${TEMPLATE_REGISTRY_ORIGIN}/api/template-packages/v1`,
        maxBytes: 4 * 1024 * 1024,
      });
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      return { value, parsed: readPackageCatalog(value) };
    },
  );
}
