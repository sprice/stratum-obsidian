import {
  cachedPublicationResource,
  type BibliographyCache,
} from "./publication-bibliography-cache";
import { publicationManuscript } from "./publication-manuscript";

/** Experimental, application-independent publishing package contract. */
export interface PackageField {
  key: string;
  label: string;
  type: "text" | "list" | "date";
  required: boolean;
  default: string;
  maxLength?: number;
}
export interface PackageVariant {
  id: string;
  label: string;
  template: string;
  fields: PackageField[];
  anonymous: boolean;
  requires: {
    title: boolean;
    authors: boolean;
    affiliations: boolean;
    abstract: boolean;
    authorDetails: ("institution" | "city" | "country" | "email")[];
  };
  citations:
    | { engine: "bibtex"; style: string; mode: "numeric" | "author-year" }
    | { engine: "citeproc"; style: string };
}
export interface PackageProperty extends Omit<PackageField, "type"> {
  type: PackageField["type"] | "authors";
  prefill: ("heading" | "filename" | "title" | "abstract")[];
  affiliationsRequired?: boolean;
  authorDetails?: PackageVariant["requires"]["authorDetails"];
}
export interface DeclarativePackageVariant extends Omit<
  PackageVariant,
  "fields" | "requires"
> {
  properties: PackageProperty[];
}
export interface TemplatePackage {
  spec:
    | "pandoc-latex-package-v1"
    | "pandoc-latex-package-v2"
    | "pandoc-latex-package-v3";
  id: string;
  version: string;
  name: string;
  license: string;
  sources: { url: string; license: string }[];
  capabilities: ["pandoc-json-v1", "tectonic-v1"];
  defaultVariant: string;
  variants: (PackageVariant | DeclarativePackageVariant)[];
  assets: {
    name: string;
    sha256: string;
    bytes: number;
    download?: string;
    role: "resource" | "template" | "citation-style" | "notice" | "source";
  }[];
}
/** Limits apply at both the host adapter and the neutral rendering boundary. */
export const PACKAGE_IMAGE_LIMITS = {
  count: 100,
  individualBytes: 20 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
} as const;
const token = /^(?!.*\.\.)[a-z0-9][a-z0-9._-]{0,79}$/;
const filename = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,149}$/;
const keyPattern = /^[a-z][a-z0-9_]{0,79}$/;
const forbidden = new Set(["constructor", "prototype", "__proto__"]);
const reserved = new Set([
  "package-filter.lua",
  "body.md",
  "abstract.md",
  "processed.json",
  "input.json",
  "source.html",
  "abstract.html",
  "abstract.json",
  "body.json",
  "references.json",
  "references.bib",
  "document.tex",
  "document.pdf",
  "document.aux",
  "document.log",
]);
const invalid = (): never => {
  throw new Error("Invalid or unsupported template package.");
};
function obj(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return invalid();
  const o = v as Record<string, unknown>;
  if (
    Object.keys(o).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(o, k))
  )
    return invalid();
  return o;
}
function str(v: unknown, pattern?: RegExp, max = 1000): string {
  if (
    typeof v !== "string" ||
    !v.length ||
    v.length > max ||
    (pattern && !pattern.test(v)) ||
    forbidden.has(v)
  )
    return invalid();
  return v;
}
function list(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) return invalid();
  return v;
}
function bool(v: unknown) {
  if (typeof v !== "boolean") invalid();
}
export function readTemplatePackage(value: unknown): TemplatePackage {
  const p = obj(value, [
    "spec",
    "id",
    "version",
    "name",
    "license",
    "sources",
    "capabilities",
    "defaultVariant",
    "variants",
    "assets",
  ]);
  if (
    ![
      "pandoc-latex-package-v1",
      "pandoc-latex-package-v2",
      "pandoc-latex-package-v3",
    ].includes(String(p.spec))
  )
    invalid();
  const declarative = p.spec === "pandoc-latex-package-v3";
  const portable = p.spec !== "pandoc-latex-package-v1";
  const assetName = portable
    ? /^(?:[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/){0,4}[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/
    : filename;
  const id = str(p.id, token),
    version = str(p.version, token);
  str(p.name);
  str(p.license);
  if (
    JSON.stringify(p.capabilities) !==
    JSON.stringify(["pandoc-json-v1", "tectonic-v1"])
  )
    invalid();
  const sources = list(p.sources, 40);
  if (!sources.length) invalid();
  for (const v of sources) {
    const s = obj(v, ["url", "license"]),
      url = new URL(str(s.url));
    if (url.protocol !== "https:" || url.username || url.password) invalid();
    str(s.license);
  }
  const names = new Map<string, Record<string, unknown>>();
  const scratchNames = new Set<string>();
  let total = 0;
  const assets = list(p.assets, 5000);
  if (!assets.length) invalid();
  for (const v of assets) {
    const a = obj(
        v,
        portable
          ? ["name", "sha256", "bytes", "role"]
          : ["name", "sha256", "bytes", "download", "role"],
      ),
      name = str(a.name, assetName);
    if (name.split("/").some((part) => part.includes(".."))) invalid();
    const scratchName = packageFilename(name).toLowerCase();
    if (
      scratchNames.has(scratchName) ||
      reserved.has(scratchName) ||
      scratchName === "manifest.json"
    )
      invalid();
    scratchNames.add(scratchName);
    if (names.has(name.toLowerCase()) || reserved.has(name.toLowerCase()))
      invalid();
    const hash = str(a.sha256, /^[a-f0-9]{64}$/);
    if (
      !Number.isSafeInteger(a.bytes) ||
      Number(a.bytes) < 1 ||
      Number(a.bytes) > 32 * 1024 * 1024
    )
      invalid();
    total += Number(a.bytes);
    if (
      !portable &&
      a.download !== `/api/template-packages/v1/${id}/${version}/assets/${hash}`
    )
      invalid();
    if (
      !["resource", "template", "citation-style", "notice", "source"].includes(
        String(a.role),
      )
    )
      invalid();
    if (a.role === "template" && !name.endsWith(".tex")) invalid();
    if (a.role === "citation-style" && !name.endsWith(".csl")) invalid();
    if (
      a.role === "resource" &&
      !/\.(cls|sty|bst|rtx|cfg|def|fd|clo|tex|dict|png|jpg|jpeg|pdf|map|enc|tfm|vf|pfb|txt)$/.test(
        name,
      )
    )
      invalid();
    names.set(name.toLowerCase(), a);
  }
  if (total > 100 * 1024 * 1024) invalid();
  const variants = list(p.variants, 32),
    ids = new Set<string>();
  if (!variants.length) invalid();
  for (const v of variants) {
    const a = obj(
        v,
        declarative
          ? ["id", "label", "template", "properties", "anonymous", "citations"]
          : [
              "id",
              "label",
              "template",
              "fields",
              "anonymous",
              "requires",
              "citations",
            ],
      ),
      variantId = str(a.id, token);
    if (ids.has(variantId)) invalid();
    ids.add(variantId);
    str(a.label);
    bool(a.anonymous);
    const template = str(a.template, assetName);
    if (
      !assets.some((v) => {
        const x = v as Record<string, unknown>;
        return x.name === template && x.role === "template";
      })
    )
      invalid();
    if (declarative) readPackageProperties(a.properties);
    else {
      const r = obj(a.requires, [
        "title",
        "authors",
        "affiliations",
        "abstract",
        "authorDetails",
      ]);
      [r.title, r.authors, r.affiliations, r.abstract].forEach(bool);
      const details = list(r.authorDetails, 4);
      if (
        new Set(details).size !== details.length ||
        details.some(
          (k) =>
            !["institution", "city", "country", "email"].includes(String(k)),
        )
      )
        invalid();
      const keys = new Set<string>();
      for (const v of list(a.fields, 64)) {
        const f = obj(v, ["key", "label", "type", "required", "default"]),
          key = str(f.key, keyPattern);
        if (keys.has(key)) invalid();
        keys.add(key);
        str(f.label);
        bool(f.required);
        if (
          !["text", "date", "list"].includes(String(f.type)) ||
          typeof f.default !== "string" ||
          f.default.length > 10000
        )
          invalid();
      }
    }
    const c = a.citations as Record<string, unknown>;
    if (c?.engine === "bibtex") {
      obj(c, ["engine", "style", "mode"]);
      str(c.style, /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/);
      if (c.mode !== "numeric" && c.mode !== "author-year") invalid();
      if (
        !assets.some((v) => {
          const x = v as Record<string, unknown>;
          return (
            typeof x.name === "string" &&
            packageFilename(x.name) === `${String(c.style)}.bst` &&
            x.role === "resource"
          );
        })
      )
        invalid();
    } else if (c?.engine === "citeproc") {
      obj(c, ["engine", "style"]);
      if (
        !assets.some((v) => {
          const x = v as Record<string, unknown>;
          return x.name === c.style && x.role === "citation-style";
        })
      )
        invalid();
    } else invalid();
  }
  if (!ids.has(str(p.defaultVariant, token))) invalid();
  return value as TemplatePackage;
}
export function packageVariant(
  p: TemplatePackage,
  id = p.defaultVariant,
): PackageVariant {
  readTemplatePackage(p);
  const v = p.variants.find((v) => v.id === id);
  if (!v) throw new Error("Unknown template variant.");
  if (!("properties" in v)) return v;
  const properties = v.properties;
  const authors = properties.find((f) => f.type === "authors");
  return {
    ...v,
    fields: properties.filter(
      (f): f is PackageProperty & { type: PackageField["type"] } =>
        f.type !== "authors" && !["title", "abstract"].includes(f.key),
    ),
    requires: {
      title: !!properties.find((f) => f.key === "title")?.required,
      authors: !!authors?.required,
      affiliations: !!authors?.affiliationsRequired,
      abstract: !!properties.find((f) => f.key === "abstract")?.required,
      authorDetails: authors?.authorDetails ?? [],
    },
  };
}
export function packageProperties(
  v: PackageVariant | DeclarativePackageVariant,
): PackageProperty[] {
  if ("properties" in v) return v.properties;
  return [
    {
      key: "title",
      label: "Title",
      type: "text",
      required: v.requires.title,
      default: "",
      prefill: ["heading", "filename"],
    },
    {
      key: "authors",
      label: "Authors",
      type: "authors",
      required: v.requires.authors,
      default: "",
      prefill: [],
      affiliationsRequired: v.requires.affiliations,
      authorDetails: v.requires.authorDetails,
    },
    {
      key: "abstract",
      label: "Abstract",
      type: "text",
      required: v.requires.abstract,
      default: "",
      prefill: ["abstract"],
    },
    ...v.fields.map((f) => ({ ...f, prefill: [] })),
  ];
}
function readPackageProperties(value: unknown): void {
  const keys = new Set<string>();
  for (const item of list(value, 64)) {
    if (!item || typeof item !== "object") invalid();
    const supplied = item as Record<string, unknown>;
    const f = obj(item, [
      "key",
      "label",
      "type",
      "required",
      "default",
      "prefill",
      ...["maxLength", "affiliationsRequired", "authorDetails"].filter((k) =>
        Object.hasOwn(supplied, k),
      ),
    ]);
    const key = str(f.key, keyPattern);
    if (
      keys.has(key) ||
      key.startsWith("stratum_") ||
      ["author", "affiliations"].includes(key)
    )
      invalid();
    keys.add(key);
    str(f.label);
    bool(f.required);
    if (
      !["text", "list", "date", "authors"].includes(String(f.type)) ||
      typeof f.default !== "string" ||
      f.default.length > 10000
    )
      invalid();
    if (
      (f.type === "authors") !== (key === "authors") ||
      (["title", "abstract"].includes(key) && f.type !== "text")
    )
      invalid();
    const rules = list(f.prefill, 4);
    if (
      new Set(rules).size !== rules.length ||
      rules.some(
        (r) =>
          !["heading", "filename", "title", "abstract"].includes(String(r)),
      ) ||
      (rules.length && f.type !== "text")
    )
      invalid();
    if (
      Object.hasOwn(f, "maxLength") &&
      (f.type !== "text" ||
        !Number.isSafeInteger(f.maxLength) ||
        Number(f.maxLength) < 1 ||
        Number(f.maxLength) > 10000)
    )
      invalid();
    if (f.type === "authors") {
      if (f.default !== "" || rules.length) invalid();
      if (Object.hasOwn(f, "affiliationsRequired"))
        bool(f.affiliationsRequired);
      if (Object.hasOwn(f, "authorDetails")) {
        const details = list(f.authorDetails, 4);
        if (
          new Set(details).size !== details.length ||
          details.some(
            (d) =>
              !["institution", "city", "country", "email"].includes(String(d)),
          )
        )
          invalid();
      }
    } else if (
      Object.hasOwn(f, "affiliationsRequired") ||
      Object.hasOwn(f, "authorDetails")
    )
      invalid();
  }
}
export function packageProblems(
  v: PackageVariant,
  manuscript: ReturnType<typeof publicationManuscript>,
): string[] {
  const errors: string[] = [];
  if (v.requires.title && !manuscript.title.trim()) errors.push("Add a title.");
  if (!v.anonymous) {
    if (v.requires.authors && !manuscript.authors.length)
      errors.push("Add an author.");
    for (const author of manuscript.authors) {
      if (!author.name.trim()) errors.push("Add an author name.");
      if (v.requires.affiliations && !author.affiliations.some((a) => a.trim()))
        errors.push("Add an affiliation.");
      for (const key of v.requires.authorDetails)
        if (!author[key]?.trim()) errors.push(`Add author ${key}.`);
    }
  }
  if (v.requires.abstract && !manuscript.abstract.trim())
    errors.push("Add an abstract.");
  for (const f of v.fields) {
    const value = Object.hasOwn(manuscript.properties, f.key)
      ? manuscript.properties[f.key]
      : f.type === "list"
        ? f.default.split("\n").filter(Boolean)
        : f.default;
    const empty =
      value === "" ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) &&
        (!value.length ||
          value.every((item) => typeof item === "string" && !item.trim())));
    if (empty) {
      if (f.required) errors.push(`Add ${f.label}.`);
      continue;
    }
    const valid =
      f.type === "list"
        ? Array.isArray(value) && value.every((s) => typeof s === "string")
        : typeof value === "string";
    if (
      !valid ||
      (f.type === "date" &&
        (typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value))
    )
      errors.push(`Check ${f.label} (${f.type}).`);
  }
  for (const f of packageProperties(v)) {
    const value =
      f.key === "title"
        ? manuscript.title
        : f.key === "abstract"
          ? manuscript.abstract
          : Object.hasOwn(manuscript.properties, f.key)
            ? manuscript.properties[f.key]
            : f.default;
    if (
      typeof value === "string" &&
      f.maxLength &&
      Array.from(value).length > f.maxLength
    )
      errors.push(
        `${f.label} must be ${f.maxLength} characters or fewer. Edit the suggested value.`,
      );
  }
  return errors;
}
/** Only hash-verified bytes enter scratch. Source archives/notices are retained in cache, never executed. */
export async function resolvePackageResources(
  cache: BibliographyCache,
  value: TemplatePackage,
  download: (s: { url: string; maxBytes: number }) => Promise<Uint8Array>,
  origin: string,
  offline = false,
  signal?: AbortSignal,
): Promise<Record<string, Uint8Array>> {
  const p = readTemplatePackage(value),
    base = new URL(origin);
  if (
    (base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
      )) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    invalid();
  const result: Record<string, Uint8Array> = {};
  for (const a of p.assets) {
    const bytes = await cachedPublicationResource(
      cache,
      { sha256: a.sha256, maxBytes: a.bytes, extension: "bin" },
      async () => {
        if (offline)
          throw new Error("Template resource is unavailable offline.");
        return download({
          url: new URL(packageAssetPath(p, a), base).href,
          maxBytes: a.bytes,
        });
      },
      signal,
    );
    if (bytes.length !== a.bytes) invalid();
    if (["resource", "template", "citation-style"].includes(a.role))
      result[a.name] = bytes;
  }
  return result;
}

/** Package paths are portable; compilation uses unique, verified basenames. */
export function packageFilename(path: string): string {
  return path.split("/").at(-1)!;
}
export function packageAssetPath(
  p: TemplatePackage,
  a: TemplatePackage["assets"][number],
): string {
  return (
    a.download ??
    `/api/template-packages/v1/${p.id}/${p.version}/assets/${a.sha256}`
  );
}
