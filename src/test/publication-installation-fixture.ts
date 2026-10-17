import { createHash } from "node:crypto";
import type { TemplateInstallation } from "../publication-installation";
import { zip } from "./publication-resource-fixture";
export const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export function installationFixture(id = "example", upstreamVersion = "1.0") {
  const encoder = new TextEncoder(),
    cls = encoder.encode("Synthetic class"),
    asset = encoder.encode("Synthetic generated style");
  const archive = zip([
    { name: "official/class.cls", value: "Synthetic class" },
    { name: "official/LICENSE", value: "Synthetic notice" },
  ]);
  const version = `${upstreamVersion}-r1`,
    base = `/api/templates/v1/${id}/versions/${version}`;
  const manifest: TemplateInstallation = {
    schemaVersion: 1,
    name: "Synthetic template",
    pin: {
      metadata: {
        schemaVersion: 1,
        templateId: id,
        version,
        upstreamVersion,
        revision: 1,
        redistribution: "reviewed",
        license: "MIT",
        upstreamUrl: "https://example.org/source",
        validationRecipeSha256: "a".repeat(64),
        sha256: hash(archive),
        bytes: archive.length,
        requiredFiles: ["official/class.cls", "official/LICENSE"],
        dependencies: [],
        download: `${base}/download`,
        validation: `${base}/validation`,
        compilation: "not-tested",
        compilationNotes: "Synthetic fixture",
      },
      validation: {
        schemaVersion: 1,
        templateId: id,
        version,
        sourceSha256: hash(archive),
        recipeSha256: "a".repeat(64),
        toolchainImage: `example/compiler@sha256:${"b".repeat(64)}`,
        dependencies: [],
        dimensions: Object.fromEntries(
          [
            "sourceIdentity",
            "archiveSafety",
            "requiredFiles",
            "license",
            "dependencies",
            "compilation",
            "bibliography",
          ].map((name) => [name, "passed"]),
        ),
      },
      runtime: {
        "class.cls": { path: "official/class.cls", sha256: hash(cls) },
        "style.bst": { path: "official/style.bst", sha256: hash(asset) },
      },
    },
    adapter: {
      contract: "latex-manuscript-v1",
      frontMatter: "standard",
      documentClass: "class",
      classOptions: [],
      bibliography: "style",
      citations: "numeric",
      preload: [],
      packages: [],
    },
    assets: [
      {
        name: "style.bst",
        sha256: hash(asset),
        bytes: asset.length,
        download: `${base}/installation/assets/${hash(asset)}`,
      },
    ],
  };
  const artifacts = new Map<string, Uint8Array>([
    [manifest.pin.metadata.download, archive],
    [
      base,
      encoder.encode(
        // Mirror the served release view: status fields are added and the notes differ.
        JSON.stringify({
          ...manifest.pin.metadata,
          available: true,
          localValidation: "passed",
          publication: "published",
          compilation: "tested",
          compilationNotes: "Synthetic served compilation notes",
        }),
      ),
    ],
    [
      manifest.pin.metadata.validation,
      encoder.encode(JSON.stringify(manifest.pin.validation)),
    ],
    [manifest.assets[0].download, asset],
  ]);
  return { manifest, artifacts };
}
