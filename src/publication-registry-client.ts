import { registryUrl, type RegistryDownload } from "./publication-registry";
import { readTemplateInstallation } from "./publication-installation";

export interface RegistryFamily {
  id: string;
  name: string;
  versionCount: number;
}
export interface RegistryRelease {
  version: string;
  upstreamVersion: string;
  revision: number;
}
const idPattern = /^(?!.*\.\.)[a-z0-9][a-z0-9._-]{0,79}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid template registry response.");
  return value as Record<string, unknown>;
}
export function readRegistryFamilies(value: unknown): RegistryFamily[] {
  const result = record(value);
  if (
    result.schemaVersion !== 1 ||
    !Array.isArray(result.templates) ||
    result.templates.length > 1000
  )
    throw new Error("Unsupported template registry catalog. Update Stratum.");
  const seen = new Set<string>();
  return result.templates.map((value) => {
    const t = record(value);
    if (
      typeof t.id !== "string" ||
      !idPattern.test(t.id) ||
      seen.has(t.id) ||
      typeof t.name !== "string" ||
      !t.name.trim() ||
      t.name.length > 200 ||
      !Number.isSafeInteger(t.versionCount) ||
      Number(t.versionCount) < 1 ||
      Number(t.versionCount) > 10000
    )
      throw new Error("Invalid template registry family.");
    seen.add(t.id);
    return { id: t.id, name: t.name, versionCount: Number(t.versionCount) };
  });
}
async function json(
  download: RegistryDownload,
  path: string,
): Promise<unknown> {
  const bytes = await download({
    url: registryUrl(path),
    maxBytes: 4 * 1024 * 1024,
  });
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}
export async function registryFamilies(download: RegistryDownload) {
  return readRegistryFamilies(await json(download, "/api/templates/v1"));
}
export async function registryReleases(
  download: RegistryDownload,
  id: string,
): Promise<RegistryRelease[]> {
  if (!idPattern.test(id)) throw new Error("Invalid template identity.");
  return readRegistryReleases(
    await json(download, `/api/templates/v1/${id}/versions`),
    id,
  );
}
export function readRegistryReleases(
  input: unknown,
  id: string,
): RegistryRelease[] {
  const value = record(input);
  if (
    value.schemaVersion !== 1 ||
    value.id !== id ||
    !Array.isArray(value.releases) ||
    value.releases.length > 10000
  )
    throw new Error("Invalid template release listing.");
  const seen = new Set<string>();
  return value.releases
    .map((value) => {
      const r = record(value);
      if (
        typeof r.version !== "string" ||
        !idPattern.test(r.version) ||
        typeof r.upstreamVersion !== "string" ||
        !idPattern.test(r.upstreamVersion) ||
        !Number.isSafeInteger(r.revision) ||
        Number(r.revision) < 1 ||
        r.version !== `${r.upstreamVersion}-r${Number(r.revision)}` ||
        r.available !== true ||
        r.publication !== "published" ||
        seen.has(r.version)
      )
        throw new Error("Invalid published template release.");
      seen.add(r.version);
      return {
        version: r.version,
        upstreamVersion: r.upstreamVersion,
        revision: Number(r.revision),
      };
    })
    .sort(
      (a, b) =>
        b.upstreamVersion.localeCompare(a.upstreamVersion, "en", {
          numeric: true,
        }) || b.revision - a.revision,
    );
}
export async function registryInstallation(
  download: RegistryDownload,
  id: string,
  version: string,
) {
  if (!idPattern.test(id) || !idPattern.test(version))
    throw new Error("Invalid template release identity.");
  const installation = readTemplateInstallation(
    await json(
      download,
      `/api/templates/v1/${id}/versions/${version}/installation`,
    ),
  );
  if (
    installation.pin.metadata.templateId !== id ||
    installation.pin.metadata.version !== version
  )
    throw new Error("The mirror returned another template release.");
  return installation;
}
