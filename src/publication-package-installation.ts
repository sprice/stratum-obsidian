import {
  readTemplatePackage,
  resolvePackageResources,
  packageProperties,
  type TemplatePackage,
} from "./publication-package";
import {
  resourceDigest,
  type RegistryDownload,
  TEMPLATE_REGISTRY_ORIGIN,
} from "./publication-registry";
import type { BibliographyCache } from "./publication-bibliography-cache";
import {
  DEFAULT_ACADEMIC_OPTIONS,
  readAcademicDefaults,
} from "./publish-options";
import type { PublishingTemplate } from "./publish-templates";

export interface PackageInstallation {
  manifest: TemplatePackage;
  sha256: string;
}
export function packageChoiceId(p: TemplatePackage, variant: string): string {
  return `download:${p.id}:${p.version}:${variant}`;
}
export function readPackageInstallation(value: unknown): PackageInstallation {
  if (!value || typeof value !== "object")
    throw new Error("Invalid package installation.");
  const v = value as PackageInstallation;
  const manifest = readTemplatePackage(v.manifest);
  if (!/^[a-f0-9]{64}$/.test(v.sha256))
    throw new Error("Invalid manifest pin.");
  return { manifest, sha256: v.sha256 };
}
export async function verifyPackageInstallation(
  value: PackageInstallation,
): Promise<void> {
  const installation = readPackageInstallation(value);
  if (
    (await resourceDigest(
      new TextEncoder().encode(JSON.stringify(installation.manifest)),
    )) !== installation.sha256
  )
    throw new Error(
      "Installed manifest integrity check failed. Reinstall this template.",
    );
}
export function installedPackageChoices({
  manifest: p,
}: PackageInstallation): PublishingTemplate[] {
  return p.variants.map((v) => ({
    id: packageChoiceId(p, v.id),
    name: p.name,
    documentType: "academic",
    renderer: "package",
    package: { manifest: p, variant: v.id },
    version: {
      familyId: `download:${p.id}:${p.version}`,
      label: `${p.version} · ${v.label}`,
    },
    layout: {
      ...DEFAULT_ACADEMIC_OPTIONS,
      titleSource: "body",
      showDate: false,
      bodyFont: "",
      titleFont: "",
    },
    properties: packageProperties(v)
      .filter((f) => f.type !== "authors")
      .map((f) => ({
        key: f.key,
        type: f.type as "text" | "list" | "date",
        required: f.required,
        defaultValue: f.default,
        use: "metadata",
      })),
    prefill: readAcademicDefaults(undefined),
  }));
}
export function readPackageLink(params: Record<string, string>): {
  id: string;
  version: string;
  sha256: string;
} {
  const { id, version, sha256 } = params;
  if (
    ![id, version].every(
      (v) =>
        typeof v === "string" &&
        /^(?!.*\.\.)[a-z0-9][a-z0-9._-]{0,79}$/.test(v),
    ) ||
    !/^[a-f0-9]{64}$/.test(sha256 ?? "")
  )
    throw new Error(
      "Invalid template installation link. Open the template website again.",
    );
  return { id, version, sha256 };
}
/** No link may choose a network origin or supply executable configuration. */
export async function installTemplatePackage(
  request: ReturnType<typeof readPackageLink>,
  cache: BibliographyCache,
  download: RegistryDownload,
  signal?: AbortSignal,
): Promise<PackageInstallation> {
  if (signal?.aborted) throw new Error("Installation cancelled.");
  const bytes = await download({
    url: `${TEMPLATE_REGISTRY_ORIGIN}/api/template-packages/v1/${request.id}/${request.version}`,
    maxBytes: 1_000_000,
  });
  const manifest = readTemplatePackage(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  if (
    manifest.id !== request.id ||
    manifest.version !== request.version ||
    (await resourceDigest(
      new TextEncoder().encode(JSON.stringify(manifest)),
    )) !== request.sha256
  )
    throw new Error(
      "The package does not match this installation link. Refresh the website.",
    );
  await resolvePackageResources(
    cache,
    manifest,
    download,
    TEMPLATE_REGISTRY_ORIGIN,
    false,
    signal,
  );
  if (signal?.aborted) throw new Error("Installation cancelled.");
  return { manifest, sha256: request.sha256 };
}
