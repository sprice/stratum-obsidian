import pins from "./publication-registry-pins.json";
import { publicationAssetPath } from "./publication-asset-map";
import {
  cachedPublicationResource,
  type BibliographyCache,
} from "./publication-bibliography-cache";
import { publicationArchive } from "./publication-resource-archive";
import { extractPublicationClass } from "./publication-source-class";

declare const __STRATUM_TEMPLATE_REGISTRY_ORIGIN__: string;
// Build-time only: development builds can override the public template origin.
export const TEMPLATE_REGISTRY_ORIGIN =
  typeof __STRATUM_TEMPLATE_REGISTRY_ORIGIN__ === "string"
    ? __STRATUM_TEMPLATE_REGISTRY_ORIGIN__
    : "https://templates.stratumnotes.com";
export const MAX_TEMPLATE_BYTES = 32 * 1024 * 1024;
interface Dependency {
  id: string;
  targetPath: string;
  bytes: number;
  sha256: string;
  download: string;
  requiredFiles: string[];
}
export interface RegistryPin {
  metadata: {
    schemaVersion: number;
    templateId: string;
    version: string;
    sha256: string;
    bytes: number;
    download: string;
    validation: string;
    requiredFiles: string[];
    dependencies: Dependency[];
    compilation: string;
    compilationNotes: string;
    [key: string]: unknown;
  };
  validation: unknown;
  runtime: Record<string, { path: string; sha256: string }>;
  derived?: { source: string; target: string; prefix: string; sha256: string };
}
export const TEMPLATE_RESOURCE_PINS: Readonly<Record<string, RegistryPin>> =
  pins;
export interface RegistryDownload {
  (spec: {
    url: string;
    sha256?: string;
    maxBytes: number;
  }): Promise<Uint8Array>;
}
export function registryUrl(path: string): string {
  if (
    !/^\/api\/templates\/v1\/[a-z0-9._/-]+$/.test(path) ||
    path.includes("..")
  )
    throw new Error("Invalid template mirror download path.");
  return `${TEMPLATE_REGISTRY_ORIGIN}${path}`;
}
export function registryJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(value, (_key, item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en")),
          )
        : item,
    ),
  );
}
export async function resourceDigest(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function equalJson(actual: unknown, expected: unknown): boolean {
  return (
    new TextDecoder().decode(registryJson(actual)) ===
    new TextDecoder().decode(registryJson(expected))
  );
}
/** Only immutable metadata reviewed with the adapter is executable compatibility authority. */
export function verifyRegistryMetadata(value: unknown, pin: RegistryPin): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid template mirror metadata.");
  const {
    available,
    publication,
    localValidation: _local,
    compilation,
    compilationNotes: _notes,
    ...immutable
  } = value as Record<string, unknown>;
  const {
    compilation: _expectedCompilation,
    compilationNotes: _expectedNotes,
    ...expected
  } = pin.metadata;
  if (!equalJson(immutable, expected))
    throw new Error(
      "This mirror release is incompatible with this Stratum adapter. Update Stratum; your saved template version is kept.",
    );
  if (
    available !== true ||
    publication !== "published" ||
    compilation !== "tested"
  )
    throw new Error(
      "This template version is not published to the Stratum mirror yet. Try enabling it later.",
    );
}
/** Complete source packs/notices stay content-addressed; only pinned runtime files reach PDF scratch. */
export async function resolveRegistryResources(
  cache: BibliographyCache,
  pin: RegistryPin,
  download: RegistryDownload,
  inflate: (bytes: Uint8Array, limit: number) => Uint8Array,
  signal?: AbortSignal,
  allowDownload = true,
): Promise<Record<string, Uint8Array>> {
  const metadata = pin.metadata;
  const unavailable = () => {
    throw new Error(
      "Template resources are missing or damaged. Disable and re-enable the template in Manage templates to reinstall this exact version.",
    );
  };
  const fetch = (spec: Parameters<RegistryDownload>[0]) => {
    if (!allowDownload) return unavailable();
    if (signal?.aborted) throw new Error("Template installation cancelled.");
    return download(spec);
  };
  // The validation report is the installation receipt. Canonical expected bytes are pinned,
  // so cached proof cannot substitute a different recipe, dependency or toolchain.
  const validation = registryJson(pin.validation);
  await cachedPublicationResource(
    cache,
    {
      sha256: await resourceDigest(validation),
      maxBytes: validation.length,
      extension: "json",
    },
    async () => {
      const raw = await fetch({
        url: registryUrl(metadata.download.replace(/\/download$/, "")),
        maxBytes: 1024 * 1024,
      });
      verifyRegistryMetadata(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
        pin,
      );
      const report = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await fetch({
            url: registryUrl(metadata.validation),
            maxBytes: 64 * 1024,
          }),
        ),
      ) as unknown;
      if (!equalJson(report, pin.validation))
        throw new Error(
          "The template mirror validation evidence changed. Update Stratum before installing.",
        );
      return validation;
    },
    signal,
  );
  const archive = await cachedPublicationResource(
    cache,
    { sha256: metadata.sha256, maxBytes: metadata.bytes, extension: "zip" },
    () =>
      fetch({
        url: registryUrl(metadata.download),
        sha256: metadata.sha256,
        maxBytes: metadata.bytes,
      }),
    signal,
  );
  if (archive.length !== metadata.bytes)
    throw new Error("Template archive size changed.");
  const files = publicationArchive(archive, inflate);
  for (const dependency of metadata.dependencies) {
    if (
      !publicationAssetPath(dependency.targetPath) ||
      Object.hasOwn(files, dependency.targetPath)
    )
      throw new Error("Invalid template dependency path.");
    const bytes = await cachedPublicationResource(
      cache,
      {
        sha256: dependency.sha256,
        maxBytes: dependency.bytes,
        extension: "bin",
      },
      () =>
        fetch({
          url: registryUrl(dependency.download),
          sha256: dependency.sha256,
          maxBytes: dependency.bytes,
        }),
      signal,
    );
    if (
      bytes.length !== dependency.bytes ||
      !dependency.requiredFiles.includes(dependency.targetPath)
    )
      throw new Error("Invalid template dependency size or required path.");
    files[dependency.targetPath] = bytes;
  }
  for (const required of [
    ...metadata.requiredFiles,
    ...metadata.dependencies.flatMap((d) => d.requiredFiles),
  ])
    if (!publicationAssetPath(required) || !files[required]?.length)
      throw new Error(
        "The template archive is missing a required source, dependency or notice.",
      );
  const result: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  for (const [name, entry] of Object.entries(pin.runtime)) {
    if (
      !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(cls|sty|rtx|bst|jpeg)$/.test(name) ||
      !publicationAssetPath(entry.path)
    )
      throw new Error("Invalid adapter resource path.");
    const bytes = files[entry.path];
    if (!bytes || (await resourceDigest(bytes)) !== entry.sha256)
      throw new Error("A required template resource is missing or damaged.");
    result[name] = bytes;
  }
  if (pin.derived) {
    const d = pin.derived;
    if (!files[d.source] || Object.hasOwn(result, d.target))
      throw new Error("Invalid template class source.");
    const bytes = extractPublicationClass(files[d.source], d.target, d.prefix);
    if ((await resourceDigest(bytes)) !== d.sha256)
      throw new Error("The derived template class fingerprint changed.");
    result[d.target] = bytes;
  }
  if (signal?.aborted) throw new Error("Template installation cancelled.");
  return result;
}
