import type { RegistryPin } from "./publication-registry";

export const INSTALLATION_SCHEMA = 1;
export const RESOURCE_LIMIT = 32 * 1024 * 1024;
export const RUNTIME_EXTENSIONS =
  /\.(cls|sty|bst|rtx|cfg|def|fd|clo|tex|dict|png|jpg|jpeg|pdf|map|enc|tfm|vf|pfb)$/;
export const FRONT_MATTERS = [
  "standard",
  "aastex5",
  "aastex7",
  "acmart",
  "revtex",
  "elsarticle",
  "cas",
  "eptcs",
  "beamer",
  "achemso",
] as const;
export interface InstallationAdapter {
  contract: "latex-manuscript-v1";
  frontMatter: (typeof FRONT_MATTERS)[number];
  documentClass: string;
  classOptions: string[];
  bibliography: string;
  citations: "numeric" | "author-year";
  preload: { name: "hyperref" | "natbib"; options: string[] }[];
  packages: { name: "hyperref" | "natbib"; options: string[] }[];
  pdfOutput?: 1;
}
export interface TemplateInstallation {
  schemaVersion: 1;
  name: string;
  pin: RegistryPin & {
    metadata: RegistryPin["metadata"] & {
      upstreamVersion: string;
      revision: number;
      license: string;
      upstreamUrl: string;
    };
  };
  adapter: InstallationAdapter;
  /** Generated resources are prepared by the maintainer, never by a client installer. */
  assets: { name: string; sha256: string; bytes: number; download: string }[];
}
const hash = /^[a-f0-9]{64}$/;
const segment = /^(?!.*\.\.)[a-z0-9][a-z0-9._-]{0,79}$/;
const path =
  /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/;
const token = /^[a-zA-Z0-9_-]+(?:=[a-zA-Z0-9_-]+)?$/;
const resource = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;
export function isTemplateResourceName(name: string): boolean {
  return resource.test(name) && RUNTIME_EXTENSIONS.test(name);
}
const failure = (): never => {
  throw new Error(
    "Invalid template installation metadata. Update Stratum or retry after the mirror is repaired.",
  );
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return failure();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) failure();
}
function string(value: unknown, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 1000 ||
    (pattern && !pattern.test(value))
  )
    return failure();
  return value;
}
function size(value: unknown, max = RESOURCE_LIMIT): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
    return failure();
  return Number(value);
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return failure();
  return value;
}
function packageList(value: unknown) {
  return array(value, 2).map((item) => {
    const p = object(item);
    exact(p, ["name", "options"]);
    if (p.name !== "hyperref" && p.name !== "natbib") return failure();
    const options = array(p.options, 3).map((v) => string(v));
    if (
      options.some(
        (v) =>
          ![
            "bookmarksnumbered",
            "unicode",
            "numbers",
            "authoryear",
            "longnamesfirst",
          ].includes(v),
      )
    )
      failure();
    return { name: p.name, options };
  });
}
export function installationId(installation: TemplateInstallation): string {
  return `registry:${installation.pin.metadata.templateId}:${installation.pin.metadata.version}`;
}
/** Validate before persisting or executing any remotely supplied resource description. */
export function readTemplateInstallation(value: unknown): TemplateInstallation {
  const v = object(value);
  exact(v, ["schemaVersion", "name", "pin", "adapter", "assets"]);
  if (v.schemaVersion !== INSTALLATION_SCHEMA) return failure();
  string(v.name);
  const pin = object(v.pin);
  exact(pin, ["metadata", "validation", "runtime", "dependencyPaths"]);
  const m = object(pin.metadata);
  if (m.schemaVersion !== 1 || m.redistribution !== "reviewed")
    return failure();
  const id = string(m.templateId, segment),
    version = string(m.version, segment);
  if (
    version !==
    `${string(m.upstreamVersion, segment)}-r${size(m.revision, 100000)}`
  )
    failure();
  string(m.license);
  const upstream = new URL(string(m.upstreamUrl));
  if (upstream.protocol !== "https:" || upstream.username || upstream.password)
    failure();
  string(m.sha256, hash);
  size(m.bytes);
  const base = `/api/templates/v1/${id}/versions/${version}`;
  if (
    m.download !== `${base}/download` ||
    m.validation !== `${base}/validation`
  )
    failure();
  for (const required of array(m.requiredFiles, 5000)) string(required, path);
  let total = Number(m.bytes);
  const targets = new Set<string>();
  const dependencyIds = new Set<string>();
  const dependencies = array(m.dependencies, 32).map(object);
  for (const d of dependencies) {
    const dep = string(d.id, segment);
    if (d.download !== `${base}/dependencies/${dep}/download`) failure();
    const target = string(d.targetPath, path);
    if (targets.has(target) || dependencyIds.has(dep)) failure();
    dependencyIds.add(dep);
    targets.add(target);
    string(d.sha256, hash);
    total += size(d.bytes);
    array(d.requiredFiles, 5000).forEach((v) => string(v, path));
    if (pin.dependencyPaths) string(object(pin.dependencyPaths)[dep], path);
  }
  if (pin.dependencyPaths)
    exact(object(pin.dependencyPaths), [...dependencyIds]);
  if (total > 100 * 1024 * 1024) failure();
  const validation = object(pin.validation);
  if (
    validation.schemaVersion !== 1 ||
    validation.templateId !== id ||
    validation.version !== version ||
    validation.sourceSha256 !== m.sha256 ||
    validation.recipeSha256 !== m.validationRecipeSha256
  )
    failure();
  string(validation.recipeSha256, hash);
  string(validation.toolchainImage, /@sha256:[a-f0-9]{64}$/);
  const dimensions = object(validation.dimensions);
  const checks = [
    "sourceIdentity",
    "archiveSafety",
    "requiredFiles",
    "license",
    "dependencies",
    "compilation",
    "bibliography",
  ];
  exact(dimensions, checks);
  if (checks.some((check) => dimensions[check] !== "passed")) failure();
  const deps = array(validation.dependencies, 32);
  // Compare bound values directly; JSON property order is not an identity.
  if (
    deps.length !== dependencies.length ||
    deps.some((value, i) => {
      const dependency = object(value);
      return ["id", "sha256", "targetPath"].some(
        (key) => dependency[key] !== dependencies[i][key],
      );
    })
  )
    failure();
  const runtime = object(pin.runtime);
  if (Object.keys(runtime).length > 5000) failure();
  for (const [name, entry] of Object.entries(runtime)) {
    if (!isTemplateResourceName(name)) failure();
    const e = object(entry);
    exact(e, ["path", "sha256"]);
    string(e.path, path);
    string(e.sha256, hash);
  }
  const a = object(v.adapter);
  exact(a, [
    "contract",
    "frontMatter",
    "documentClass",
    "classOptions",
    "bibliography",
    "citations",
    "preload",
    "packages",
    "pdfOutput",
  ]);
  if (
    a.contract !== "latex-manuscript-v1" ||
    !FRONT_MATTERS.includes(a.frontMatter as (typeof FRONT_MATTERS)[number])
  )
    failure();
  const cls = string(a.documentClass, /^[a-zA-Z0-9_-]+$/);
  if (!Object.hasOwn(runtime, `${cls}.cls`)) failure();
  array(a.classOptions, 20).forEach((v) => string(v, token));
  if (a.citations !== "numeric" && a.citations !== "author-year") failure();
  string(a.bibliography, /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/);
  packageList(a.preload);
  packageList(a.packages);
  if (a.pdfOutput !== undefined && a.pdfOutput !== 1) failure();
  const assets = array(v.assets, 100);
  const names = new Set<string>();
  for (const value of assets) {
    const asset = object(value);
    exact(asset, ["name", "sha256", "bytes", "download"]);
    const name = string(asset.name, resource),
      sha = string(asset.sha256, hash);
    if (
      !Object.hasOwn(runtime, name) ||
      names.has(name) ||
      object(runtime[name]).sha256 !== sha
    )
      failure();
    names.add(name);
    total += size(asset.bytes);
    if (asset.download !== `${base}/installation/assets/${sha}`) failure();
  }
  if (total > 100 * 1024 * 1024) failure();
  return value as TemplateInstallation;
}
