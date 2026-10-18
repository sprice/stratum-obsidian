import { testPublishingWorkspace } from "./publishing-workspace";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { inflateRawSync } from "node:zlib";
import type { BibliographyCache } from "../publication-bibliography-cache";
import { resolveInstallationResources } from "../publication-installation-resources";
import {
  readTemplateInstallation,
  type TemplateInstallation,
} from "../publication-installation";
import { installedJournalProfile } from "../publication-installed-templates";
import { publicationManuscript } from "../publication-manuscript";
import { mathjaxParityExamples } from "./fixtures/mathjax-parity";
import { loadRuntime } from "./runtime-harness";
import type * as Desktop from "../publish-desktop";

export function qualificationCache(directory: string): BibliographyCache {
  return {
    directory,
    adapter: {
      exists: (p) =>
        fs.access(p).then(
          () => true,
          () => false,
        ),
      stat: async (p) => {
        try {
          const s = await fs.stat(p);
          return {
            type: s.isFile() ? "file" : "folder",
            size: s.size,
            mtime: s.mtimeMs,
            ctime: s.ctimeMs,
          };
        } catch {
          return null;
        }
      },
      mkdir: async (p) => {
        await fs.mkdir(p, { recursive: true });
      },
      readBinary: async (p) => Uint8Array.from(await fs.readFile(p)).buffer,
      writeBinary: (p, b) => fs.writeFile(p, new Uint8Array(b)),
      rename: fs.rename,
      remove: (p) => fs.rm(p),
    },
  };
}
/** Laptop-only entry point: exercise the production installer and PDF path with synthetic data. */
export async function qualifyTemplateInstallation(
  value: TemplateInstallation,
  artifacts: Map<string, Uint8Array>,
  directory: string,
  tools = {
    pandoc: process.env.STRATUM_TEST_PANDOC || "pandoc",
    tectonic: process.env.STRATUM_TEST_TECTONIC || "tectonic",
  },
): Promise<void> {
  const installation = readTemplateInstallation(value);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  // Each qualification proves a fresh install; only its second pass may reuse bytes.
  const freshDirectory = await fs.mkdtemp(`${directory}-fresh-`);
  try {
    const cache = qualificationCache(freshDirectory);
    const download = ({ url, maxBytes }: { url: string; maxBytes: number }) => {
      const bytes = artifacts.get(new URL(url).pathname);
      if (!bytes || bytes.length > maxBytes)
        return Promise.reject(new Error("qualification_artifact_missing"));
      return Promise.resolve(bytes);
    };
    await resolveInstallationResources(cache, installation, download, (b, l) =>
      inflateRawSync(b, { maxOutputLength: l }),
    );
    // A second pass must need no registry access.
    await resolveInstallationResources(
      cache,
      installation,
      () => Promise.reject(new Error("qualification_offline_network")),
      (b, l) => inflateRawSync(b, { maxOutputLength: l }),
      undefined,
      false,
    );
    const require = createRequire(import.meta.url);
    const runtime = loadRuntime<typeof Desktop>(
      "publish-desktop.ts",
      { Platform: { isDesktop: true, isDesktopApp: true } },
      {
        TextDecoder,
        TextEncoder,
        Uint8Array,
        crypto,
        window: { require, setTimeout, clearTimeout },
      },
      "browser",
    );
    const manuscript = publicationManuscript(
      `---\nstratum_publish:\n  authors:\n    - name: Registry Fixture\n      affiliations: [Synthetic Institute]\n      institution: Synthetic Institute\n      city: Example City\n      country: Example Country\n      email: fixture@example.org\n---\n# Synthetic qualification\n\n## Abstract\nSynthetic abstract.\n\n## Results\nSynthetic body.`,
      "body",
    );
    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const mathHtml = mathjaxParityExamples
      .slice(0, 15)
      .map(
        ({ tex }) =>
          `<p><span class="math display">\\[${escapeHtml(tex)}\\]</span></p>`,
      )
      .join("");
    const bytes = await runtime.convertPublication(
      '<h1>Results</h1><p>Synthetic citation <span class="stratum-publication-citation" data-tex="\\cite{registryfixture}">[1]</span>.</p><p><span class="math inline">\\(x^2 + \\alpha\\)</span></p>' +
        mathHtml,
      [],
      "pdf",
      {
        ...tools,
        workspace: testPublishingWorkspace(),
        bibliographyCache: cache,
      },
      undefined,
      180000,
      undefined,
      {
        journal: installedJournalProfile(installation),
        manuscript,
        abstractHtml: "<p>Synthetic abstract.</p>",
        references: [
          {
            id: "registryfixture",
            type: "article-journal",
            title: "Synthetic reference",
            author: [{ family: "Fixture", given: "Registry" }],
            "container-title": "Synthetic Journal",
            issued: { "date-parts": [[2020]] },
            volume: "1",
            page: "1-2",
          },
        ],
      },
    );
    if (
      new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5)) !== "%PDF-"
    )
      throw new Error("plugin_pdf_invalid");
  } finally {
    await fs.rm(freshDirectory, { recursive: true, force: true });
  }
}
