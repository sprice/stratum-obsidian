import { publicationTableFilter } from "./publication-table-filter";
import { compatibleMathTex } from "./publish-math-compat";
import { runPublishTool } from "./publish-desktop";
import type { PublishWorkspace } from "./publish-workspace";
import type { publicationManuscript } from "./publication-manuscript";
import {
  packageProblems,
  PACKAGE_IMAGE_LIMITS,
  packageFilename,
  packageVariant,
  type TemplatePackage,
} from "./publication-package";

type Meta = { t: string; c: unknown };
const text = (value: string): Meta => ({
  t: "MetaInlines",
  c: [{ t: "Str", c: value }],
});
const sequence = (values: Meta[]): Meta => ({ t: "MetaList", c: values });
const record = (values: Record<string, Meta>): Meta => ({
  t: "MetaMap",
  c: values,
});
export interface PackagePublication {
  package: TemplatePackage;
  variant?: string;
  manuscript: ReturnType<typeof publicationManuscript>;
  references: Record<string, unknown>[];
  resources: Record<string, Uint8Array>;
  images?: Record<string, Uint8Array>;
  citationGroups?: Record<
    string,
    {
      id: string;
      prefix: string;
      suffix: string;
      mode: "NormalCitation" | "AuthorInText" | "SuppressAuthor";
    }[]
  >;
}
/** Pure metadata boundary: document text cannot supply raw TeX or compiler options. */
export function packageMetadata(p: PackagePublication): Record<string, Meta> {
  const v = packageVariant(p.package, p.variant);
  const errors = packageProblems(v, p.manuscript);
  if (errors.length) throw new Error(errors.join(" "));
  const m = p.manuscript;
  const affiliations = [
    ...new Set(m.authors.flatMap((a) => a.affiliations).filter(Boolean)),
  ];
  return {
    title: text(m.title),
    authors: sequence(
      (v.anonymous ? [] : m.authors).map((a) =>
        record({
          name: text(a.name),
          email: text(a.email),
          institution: text(a.institution ?? ""),
          city: text(a.city ?? ""),
          country: text(a.country ?? ""),
          affiliations: sequence(a.affiliations.filter(Boolean).map(text)),
          indices: text(
            a.affiliations
              .filter(Boolean)
              .map((s) => affiliations.indexOf(s) + 1)
              .join(","),
          ),
        }),
      ),
    ),
    affiliations: sequence(
      (v.anonymous ? [] : affiliations).map((s, i) =>
        record({ name: text(s), index: text(String(i + 1)) }),
      ),
    ),
    anonymous: { t: "MetaBool", c: v.anonymous },
    "multiple-affiliations": { t: "MetaBool", c: affiliations.length > 1 },
    fields: record(
      Object.fromEntries(
        v.fields.map((f) => {
          const value =
            m.properties[f.key] ??
            (f.type === "list"
              ? f.default.split("\n").filter(Boolean)
              : f.default);
          return [
            f.key,
            Array.isArray(value)
              ? sequence(value.map((s) => text(s as string)))
              : text(value as string),
          ];
        }),
      ),
    ),
  };
}
/** Reject template partials: wrappers are self-contained and cannot load arbitrary host files. */
export function validatePackageWrapper(wrapper: string): void {
  if (
    /\$[^$\r\n]*\([^$\r\n]*\)[^$\r\n]*\$/.test(
      wrapper.replace(/\$(?:if|elseif|for|sep)\([^$]*?\)\$/g, ""),
    )
  )
    throw new Error("Template partials and functions are unsupported.");
}
function inspectAst(value: unknown, p: PackagePublication): void {
  if (Array.isArray(value)) {
    value.forEach((v) => inspectAst(v, p));
    return;
  }
  if (!value || typeof value !== "object") return;
  const o = value as Record<string, unknown>;
  if (["RawBlock", "RawInline"].includes(String(o.t)))
    throw new Error(
      "Raw markup and external images are unsupported in the package prototype.",
    );
  if (o.t === "Image") {
    const target = (
      o.c as [unknown, unknown, [string, string]] | undefined
    )?.[2]?.[0];
    if (
      !p.images ||
      typeof target !== "string" ||
      !Object.hasOwn(p.images, target)
    )
      throw new Error("Only verified vault images can be published.");
  }
  if (o.t === "Cite") {
    const c = o.c as [Record<string, unknown>[], unknown];
    const group =
      c[0].length === 1
        ? p.citationGroups?.[String(c[0][0].citationId)]
        : undefined;
    if (group)
      c[0] = group.map((item) => ({
        citationId: item.id,
        citationPrefix: item.prefix ? [{ t: "Str", c: item.prefix }] : [],
        citationSuffix: item.suffix ? [{ t: "Str", c: item.suffix }] : [],
        citationMode: { t: item.mode },
        citationNoteNum: 0,
        citationHash: 0,
      }));

    const citations = (o.c as [Record<string, unknown>[], unknown])[0];
    if (
      citations.some(
        (c) =>
          typeof c.citationId !== "string" ||
          !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(c.citationId),
      )
    )
      throw new Error("Invalid citation identifier.");
  }
  if (o.t === "Math") {
    const c = o.c as [unknown, string];
    if (
      /\\(?:input|include|write|openout|read|openin|catcode|usepackage|documentclass|special|href|url|csname|scantokens)\b|\^\^/.test(
        c[1],
      )
    )
      throw new Error("Unsupported publishing math command.");
    c[1] = compatibleMathTex(c[1], 1);
  }
  Object.values(o).forEach((v) => inspectAst(v, p));
}
export async function renderTemplatePackage(
  p: PackagePublication,
  tools: { workspace: PublishWorkspace; pandoc: string; tectonic: string },
  options: { signal?: AbortSignal; timeout?: number; offline?: boolean } = {},
): Promise<{ pdf: Uint8Array; latex: string }> {
  if (JSON.stringify([p.manuscript, p.references]).length > 8 * 1024 * 1024)
    throw new Error("Manuscript exceeds the template package size limit.");
  const meta = packageMetadata(p),
    v = packageVariant(p.package, p.variant);
  const images = Object.entries(p.images ?? {});
  const assetNames = new Set(
    p.package.assets.map((a) => packageFilename(a.name).toLowerCase()),
  );
  let imageBytes = 0;
  if (images.length > PACKAGE_IMAGE_LIMITS.count)
    throw new Error("Publishing image limit exceeded.");
  for (const [name, bytes] of images) {
    if (
      !/^asset-[0-9]+\.(png|jpg|jpeg)$/.test(name) ||
      assetNames.has(name.toLowerCase())
    )
      throw new Error(
        "Invalid publishing image or template resource filename collision.",
      );
    imageBytes += bytes.length;
    if (
      bytes.length > PACKAGE_IMAGE_LIMITS.individualBytes ||
      imageBytes > PACKAGE_IMAGE_LIMITS.totalBytes
    )
      throw new Error("Publishing image limit exceeded.");
  }
  const job = await tools.workspace.create();
  try {
    for (const a of p.package.assets.filter((a) =>
      ["resource", "template", "citation-style"].includes(a.role),
    )) {
      const bytes = p.resources[a.name];
      if (!bytes || bytes.length !== a.bytes)
        throw new Error("Missing template resource.");
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== a.sha256)
        throw new Error("Template resource integrity check failed.");
      if (a.role === "template")
        validatePackageWrapper(new TextDecoder().decode(bytes));
      await job.write(packageFilename(a.name), bytes);
    }
    for (const [name, bytes] of images) await job.write(name, bytes);
    const run = (tool: string, args: string[]) =>
      runPublishTool(tool, args, {
        cwd: job.directory,
        timeout: options.timeout ?? 180000,
        signal: options.signal,
      });
    const readAst = async (name: string, markdown: string) => {
      await job.write(`${name}.md`, markdown);
      await run(tools.pandoc, [
        "--sandbox",
        "--from=markdown-yaml_metadata_block-raw_tex-raw_html",
        "--to=json",
        `${name}.md`,
        "-o",
        `${name}.json`,
      ]);
      const ast = JSON.parse(
        new TextDecoder().decode(await job.read(`${name}.json`)),
      ) as { meta: Record<string, Meta>; blocks: unknown[] };
      inspectAst(ast.blocks, p);
      return ast;
    };
    const ast = await readAst("body", p.manuscript.body),
      abstract = await readAst("abstract", p.manuscript.abstract);
    // A single AST keeps citations in the abstract in the same citeproc context.
    for (const block of ast.blocks) {
      const header = block as { t?: string; c?: [number, ...unknown[]] };
      if (header.t === "Header" && header.c)
        header.c[0] = Math.max(1, header.c[0] - 1);
    }
    ast.meta = { ...meta };
    if (abstract.blocks.length)
      ast.blocks.unshift({
        t: "Div",
        c: [["stratum-abstract", [], []], abstract.blocks],
      });
    const ids = new Set<string>();
    for (const r of p.references) {
      if (
        typeof r.id !== "string" ||
        !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(r.id) ||
        ids.has(r.id)
      )
        throw new Error("Invalid or duplicate reference identifier.");
      ids.add(r.id);
    }
    const citedIds = new Set<string>();
    const checkReferences = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(checkReferences);
        return;
      }
      if (!value || typeof value !== "object") return;
      const o = value as Record<string, unknown>;
      if (
        o.t === "Cite" &&
        (o.c as [Record<string, unknown>[], unknown])[0].some(
          (c) => !ids.has(String(c.citationId)),
        )
      )
        throw new Error("Citation has no reference.");
      if (o.t === "Cite")
        for (const c of (o.c as [Record<string, unknown>[], unknown])[0])
          citedIds.add(String(c.citationId));
      Object.values(o).forEach(checkReferences);
    };
    checkReferences(ast.blocks);
    await job.write("references.json", JSON.stringify(p.references));
    if (v.citations.engine === "citeproc") {
      await job.write("input.json", JSON.stringify(ast));
      await run(tools.pandoc, [
        "--sandbox",
        "--from=json",
        "--to=json",
        "--citeproc",
        "--bibliography=references.json",
        `--csl=${packageFilename(v.citations.style)}`,
        "input.json",
        "-o",
        "processed.json",
        "--fail-if-warnings",
      ]);
      Object.assign(
        ast,
        JSON.parse(new TextDecoder().decode(await job.read("processed.json"))),
      );
    } else {
      await run(tools.pandoc, [
        "--sandbox",
        "--from=csljson",
        "--to=bibtex",
        "references.json",
        "-o",
        "references.bib",
        "--fail-if-warnings",
      ]);
    }
    const first = ast.blocks[0] as
      { t?: string; c?: [string[], unknown[]] } | undefined;
    if (first?.t === "Div" && first.c?.[0]?.[0] === "stratum-abstract") {
      ast.blocks.shift();
      ast.meta.abstract = { t: "MetaBlocks", c: first.c[1] };
    }
    ast.meta["has-references"] = { t: "MetaBool", c: p.references.length > 0 };
    await job.write("input.json", JSON.stringify(ast));
    await job.write("package-filter.lua", publicationTableFilter);
    await run(tools.pandoc, [
      "--sandbox",
      "--lua-filter=package-filter.lua",
      "--from=json",
      "--to=latex",
      "--standalone",
      "--syntax-highlighting=none",
      `--template=${packageFilename(v.template)}`,
      ...(v.citations.engine === "bibtex" ? ["--natbib"] : []),
      "input.json",
      "-o",
      "document.tex",
      "--fail-if-warnings",
    ]);
    const latex = new TextDecoder().decode(await job.read("document.tex"));
    await run(tools.tectonic, [
      "--untrusted",
      ...(options.offline ? ["--only-cached"] : []),
      "--keep-logs",
      "--keep-intermediates",
      "document.tex",
    ]);
    const log = new TextDecoder().decode(await job.read("document.log"));
    if (
      /undefined citations|Citation .+ undefined|There were undefined references/.test(
        log,
      )
    )
      throw new Error("Unresolved citations or references.");
    if (v.citations.engine === "bibtex" && citedIds.size) {
      const aux = new TextDecoder().decode(await job.read("document.aux"));
      if ([...citedIds].some((id) => !aux.includes(`\\bibcite{${id}}`)))
        throw new Error("Bibliography did not resolve every citation.");
    }
    const pdf = await job.read("document.pdf");
    if (new TextDecoder().decode(pdf.subarray(0, 5)) !== "%PDF-")
      throw new Error("Invalid PDF output.");
    return { pdf, latex };
  } finally {
    await job.remove();
  }
}
