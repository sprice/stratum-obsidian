import files from "./publication-templates/aastex/files.json";
import { DEFAULT_ACADEMIC_OPTIONS } from "./publish-options";
import type { PublishingTemplate } from "./publish-templates";
import { publicationAuthors, publicationYaml } from "./publication-metadata";
import type { PublishFormat } from "./publish-model";

type Requirement = "required" | "warning" | "optional";
type RuleKey = "title" | "authors" | "email" | "affiliations" | "abstract";
const ruleKeys: RuleKey[] = [
  "title",
  "authors",
  "email",
  "affiliations",
  "abstract",
];
interface PackageField {
  path: string;
  type: "text" | "list";
  requiredFor: PublishFormat[];
}
export interface PublicationPackage {
  manifest: {
    formatVersion: 1;
    id: string;
    name: string;
    version: string;
    renderer: { id: "aastex"; version: 1 };
    upstreamVersion: string;
    entry: string;
    schema: string;
    defaults: string;
    outputs: PublishFormat[];
    compiler: "tectonic";
    class: string;
    bibliographyStyle: string;
    bibliographyDownload: { url: string; sha256: string };
  };
  schema: {
    fields: PackageField[];
    rules: Record<PublishFormat, Record<RuleKey, Requirement>>;
  };
  defaults: {
    classOptions: string[];
    printEmails: boolean;
    titleSource: "body" | "properties";
    docxMode: "review";
  };
  files: Record<string, string>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const output = (value: unknown): value is PublishFormat =>
  value === "pdf" || value === "docx";
const relativePath = (path: string) =>
  /^[a-zA-Z0-9_./-]+$/.test(path) &&
  !path.startsWith("/") &&
  !path.split("/").some((part) => part === ".." || part === "." || !part);
function json(assets: Record<string, string>, path: string): unknown {
  try {
    return JSON.parse(assets[path]) as unknown;
  } catch {
    throw new Error(`Invalid publication package JSON: ${path}.`);
  }
}
/** Assets are package relative and bundled into main.js, never read from a checkout. */
export function loadPublicationPackage(
  assets: Record<string, string>,
): PublicationPackage {
  for (const path of Object.keys(assets))
    if (!relativePath(path))
      throw new Error("Invalid publication package asset path.");
  const manifest = json(assets, "manifest.json");
  if (
    !object(manifest) ||
    manifest.formatVersion !== 1 ||
    !object(manifest.renderer) ||
    manifest.renderer.id !== "aastex" ||
    manifest.renderer.version !== 1
  )
    throw new Error(
      "This publication package requires an unsupported format or renderer.",
    );
  for (const key of ["id", "name", "version", "upstreamVersion"])
    if (typeof manifest[key] !== "string" || !manifest[key].trim())
      throw new Error(`Invalid publication package ${key}.`);
  if (
    manifest.compiler !== "tectonic" ||
    !Array.isArray(manifest.outputs) ||
    manifest.outputs.length !== 2 ||
    !manifest.outputs.includes("pdf") ||
    !manifest.outputs.includes("docx")
  )
    throw new Error("Unsupported publication package compiler or outputs.");
  for (const key of ["entry", "schema", "defaults", "class"]) {
    const path = manifest[key];
    if (
      typeof path !== "string" ||
      !relativePath(path) ||
      !Object.hasOwn(assets, path)
    )
      throw new Error(
        "A publication package asset is missing or its path is invalid.",
      );
  }
  const parsedManifest = manifest as unknown as PublicationPackage["manifest"];
  if (
    !parsedManifest.class.endsWith(".cls") ||
    typeof parsedManifest.bibliographyStyle !== "string" ||
    !relativePath(parsedManifest.bibliographyStyle) ||
    !parsedManifest.bibliographyStyle.endsWith(".bst") ||
    Object.keys(assets).some((path) => path.endsWith(".bst"))
  )
    throw new Error(
      "Invalid publication package class or external bibliography declaration.",
    );
  const download = manifest.bibliographyDownload;
  if (
    !object(download) ||
    download.url !==
      "https://journals.aas.org/wp-content/uploads/2026/06/aasjournalv7.1.bst" ||
    typeof download.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(download.sha256)
  )
    throw new Error("Invalid publication package bibliography download.");
  const schema = json(assets, parsedManifest.schema);
  if (!object(schema) || !object(schema.rules) || !Array.isArray(schema.fields))
    throw new Error("Invalid publication package metadata schema.");
  for (const format of ["pdf", "docx"]) {
    const rules = schema.rules[format];
    if (
      !object(rules) ||
      ruleKeys.some(
        (key) =>
          typeof rules[key] !== "string" ||
          !["required", "warning", "optional"].includes(rules[key]),
      )
    )
      throw new Error(
        `Invalid publication package requirements for ${format}.`,
      );
  }
  const paths = new Map([
    ["stratum_publish.authors[].name", "text"],
    ["stratum_publish.authors[].email", "text"],
    ["stratum_publish.authors[].affiliations", "list"],
  ]);
  const seen = new Set<string>();
  for (const field of schema.fields) {
    if (
      !object(field) ||
      typeof field.path !== "string" ||
      paths.get(field.path) !== field.type ||
      seen.has(field.path) ||
      !Array.isArray(field.requiredFor) ||
      !field.requiredFor.every(output)
    )
      throw new Error("Unsupported or invalid publication package field.");
    seen.add(field.path);
    const key = field.path.endsWith(".name")
      ? "authors"
      : field.path.endsWith(".email")
        ? "email"
        : "affiliations";
    for (const format of ["pdf", "docx"] as const)
      if (
        field.requiredFor.includes(format) !==
        ((schema.rules[format] as Record<string, unknown>)[key] === "required")
      )
        throw new Error(
          "Publication package field requirements disagree with its rules.",
        );
  }
  if (seen.size !== paths.size)
    throw new Error("Publication package author fields are missing.");
  const defaults = json(assets, parsedManifest.defaults);
  if (
    !object(defaults) ||
    !Array.isArray(defaults.classOptions) ||
    !defaults.classOptions.every(
      (option) =>
        typeof option === "string" && /^[a-zA-Z][a-zA-Z0-9]*$/.test(option),
    ) ||
    typeof defaults.printEmails !== "boolean" ||
    (defaults.titleSource !== "properties" &&
      defaults.titleSource !== "body") ||
    defaults.docxMode !== "review"
  )
    throw new Error("Unsupported publication package defaults.");
  return {
    manifest: parsedManifest,
    schema: schema as unknown as PublicationPackage["schema"],
    defaults: defaults as unknown as PublicationPackage["defaults"],
    files: assets,
  };
}
export const aastexPackage = loadPublicationPackage(files);
export const AASTEX_TEMPLATE: PublishingTemplate = {
  // Settings-owned template IDs cannot contain a colon.
  id: "package:aastex",
  name: "AASTeX",
  documentType: "academic",
  renderer: "aastex",
  layout: {
    ...DEFAULT_ACADEMIC_OPTIONS,
    titleSource: aastexPackage.defaults.titleSource,
    showDate: false,
    showKeywords: false,
    bodyFont: "",
    titleFont: "",
  },
  properties: [],
  prefill: { authors: [], affiliations: [], date: "", keywords: [] },
};

/** The body Abstract is consumed exactly once; fenced examples are not sections. */
export function aastexManuscript(
  text: string,
  titleSource: "body" | "properties",
) {
  const { properties, end } = publicationYaml(text);
  let body = text.slice(end);
  let title =
    typeof properties.title === "string" ? properties.title.trim() : "";
  if (titleSource === "body") {
    const match = /^\s*#\s+(.+?)(?:\s+#+)?\s*(?:\r?\n|$)/.exec(body);
    title = match?.[1].trim() ?? "";
    if (match) body = body.slice(match[0].length);
  }
  const sections: { from: number; start: number; to: number; level: number }[] =
    [];
  let offset = 0,
    fence = "";
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = "";
    } else if (!fence) {
      const heading = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(
        line.trimEnd(),
      );
      if (heading) {
        for (const section of sections)
          if (section.to === body.length && heading[1].length <= section.level)
            section.to = offset;
        if (
          heading[1].length <= 2 &&
          heading[2].trim().toLowerCase() === "abstract"
        )
          sections.push({
            from: offset,
            start: offset + line.length,
            to: body.length,
            level: heading[1].length,
          });
      }
    }
    offset += line.length;
  }
  if (sections.length > 1)
    throw new Error(
      "This manuscript has multiple Abstract sections. Keep one before publishing with AASTeX.",
    );
  const section = sections[0];
  const abstract = section ? body.slice(section.start, section.to).trim() : "";
  if (section) body = body.slice(0, section.from) + body.slice(section.to);
  return {
    properties,
    title,
    body,
    abstract,
    authors: publicationAuthors(properties).authors,
  };
}
export function aastexProblems(
  text: string,
  titleSource: "body" | "properties",
  format: PublishFormat,
  pkg = aastexPackage,
) {
  const manuscript = aastexManuscript(text, titleSource);
  const errors: string[] = [],
    warnings: string[] = [];
  const requirement = (key: RuleKey, message: string) => {
    const rule = pkg.schema.rules[format][key];
    if (rule === "required") errors.push(message);
    else if (rule === "warning") warnings.push(message);
  };
  if (!manuscript.title)
    requirement(
      "title",
      "Add a manuscript title using the selected title source.",
    );
  if (!manuscript.authors.length)
    requirement("authors", "Add at least one author.");
  for (const [i, author] of manuscript.authors.entries()) {
    if (!author.name.trim())
      requirement("authors", `Author ${i + 1} needs a name.`);
    if (!author.email.trim())
      requirement("email", `Author ${i + 1} needs an email address.`);
    if (!author.affiliations.some((value) => value.trim()))
      requirement(
        "affiliations",
        `Author ${i + 1} needs an affiliation/address.`,
      );
  }
  if (!manuscript.abstract)
    requirement(
      "abstract",
      "No Abstract section was found. Check the journal's submission requirements.",
    );
  return { errors, warnings, manuscript };
}
export function escapeLatex(text: string): string {
  const escapes: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "#": "\\#",
    $: "\\$",
    "%": "\\%",
    "&": "\\&",
    _: "\\_",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };
  return text.replace(/[\\{}#$%&_~^]/g, (character) => escapes[character]);
}
export function aastexLatex(
  manuscript: ReturnType<typeof aastexManuscript>,
  body: string,
  abstract: string,
  bibliography: boolean,
  pkg = aastexPackage,
): string {
  const authors = manuscript.authors
    .map((author) =>
      [
        `\\author{${escapeLatex(author.name)}}`,
        `\\email${pkg.defaults.printEmails ? "[show]" : ""}{${escapeLatex(author.email)}}`,
        ...author.affiliations
          .filter((value) => value.trim())
          .map((value) => `\\affiliation{${escapeLatex(value)}}`),
      ].join("\n"),
    )
    .join("\n");
  const values: Record<string, string> = {
    className: pkg.manifest.class
      .split("/")
      .at(-1)!
      .replace(/\.cls$/, ""),
    classOptions: pkg.defaults.classOptions.join(","),
    title: escapeLatex(manuscript.title),
    authors,
    abstract: abstract ? `\\begin{abstract}\n${abstract}\n\\end{abstract}` : "",
    body,
    bibliography: bibliography
      ? `\\bibliographystyle{${pkg.manifest.bibliographyStyle
          .split("/")
          .at(-1)!
          .replace(/\.bst$/, "")}}\n\\bibliography{references}`
      : "",
  };
  return pkg.files[pkg.manifest.entry].replace(
    /\{\{(className|classOptions|title|authors|abstract|body|bibliography)\}\}/g,
    (_match, key: string) => values[key],
  );
}
