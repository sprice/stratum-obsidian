import { createHash } from "node:crypto";
import type { TemplatePackage, PackageVariant } from "../publication-package";

export function packageFixture() {
  const bytes = new TextEncoder().encode("synthetic resource"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const p: TemplatePackage & { variants: PackageVariant[] } = {
    spec: "pandoc-latex-package-v1",
    id: "unfamiliar",
    version: "1.0",
    name: "Unknown future package",
    license: "MIT",
    sources: [{ url: "https://example.org/source", license: "MIT" }],
    capabilities: ["pandoc-json-v1", "tectonic-v1"],
    defaultVariant: "main",
    variants: [
      {
        id: "main",
        label: "Main",
        template: "layout.tex",
        fields: [],
        anonymous: false,
        requires: {
          title: true,
          authors: true,
          affiliations: true,
          abstract: true,
          authorDetails: [],
        },
        citations: { engine: "citeproc", style: "style.csl" },
      },
    ],
    assets: ["layout.tex", "style.csl"].map((name, i) => ({
      name,
      sha256,
      bytes: bytes.length,
      download: `/api/template-packages/v1/unfamiliar/1.0/assets/${sha256}`,
      role: i === 0 ? "template" : "citation-style",
    })),
  };
  return { p, bytes };
}

export function declarativePackageFixture() {
  const { p, bytes } = packageFixture();
  const { fields: _fields, requires: _requires, ...base } = p.variants[0];
  const manifest: TemplatePackage = {
    ...p,
    spec: "pandoc-latex-package-v3",
    assets: p.assets.map(({ download: _download, ...asset }) => asset),
    variants: [
      {
        ...base,
        properties: [
          {
            key: "title",
            label: "Title",
            type: "text",
            required: true,
            default: "",
            prefill: ["heading", "filename"],
          },
          {
            key: "authors",
            label: "Authors",
            type: "authors",
            required: true,
            default: "",
            prefill: [],
            affiliationsRequired: true,
          },
          {
            key: "abstract",
            label: "Abstract",
            type: "text",
            required: true,
            default: "",
            prefill: ["abstract"],
          },
          {
            key: "short_header",
            label: "Short header",
            type: "text",
            required: true,
            default: "",
            prefill: ["title"],
            maxLength: 50,
          },
          {
            key: "grant_code",
            label: "Grant code",
            type: "text",
            required: true,
            default: "SYNTHETIC",
            prefill: [],
          },
          {
            key: "notes",
            label: "Notes",
            type: "list",
            required: false,
            default: "",
            prefill: [],
          },
        ],
      },
    ],
  };
  return { manifest, bytes };
}
