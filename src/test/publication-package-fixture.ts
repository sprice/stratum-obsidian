import { createHash } from "node:crypto";
import type { TemplatePackage } from "../publication-package";

export function packageFixture() {
  const bytes = new TextEncoder().encode("synthetic resource"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const p: TemplatePackage = {
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
