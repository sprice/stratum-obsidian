// Model Obsidian's rendered callout controls over real DOM and image decoding.
// All source text and image bytes are synthetic; no vault or network is used.
import { MarkdownRenderer, TFile } from "./obsidian-host";
import { renderPublication } from "../../publish-render";
import { renderAastexPublication } from "../../publication-render";
import { readNotePreferences } from "../../publish-options";
import { composeLiteratureNoteBody } from "../../literature-note-layout";
import {
  MANAGED_START,
  MANAGED_END,
} from "../../literature-note-content-types";

const imageSource =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2468ac"/></svg>';
const files = new Map(
  ["body.svg", "abstract.svg"].map((path) => {
    const file = new TFile();
    file.path = path;
    file.extension = "svg";
    return [path, file];
  }),
);
const app = {
  metadataCache: { getFirstLinkpathDest: (path: string) => files.get(path) },
  vault: {
    readBinary: () =>
      Promise.resolve(new TextEncoder().encode(imageSource).buffer),
  },
};
let unexpectedSvg = false;
MarkdownRenderer.render = (_app, markdown, root) => {
  if (unexpectedSvg) {
    const svg = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"></svg>',
      "image/svg+xml",
    ).documentElement;
    root.append(svg);
  }
  const append = (parent: HTMLElement, text: string) => {
    // Production has already replaced vault embeds with inert HTML placeholders.
    const parsed = new DOMParser().parseFromString(text, "text/html");
    parent.append(...Array.from(parsed.body.childNodes));
  };
  let callout: HTMLElement | undefined;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("> [!")) {
      callout = root.createDiv({ cls: "callout" });
      const title = callout.createDiv({ cls: "callout-title" });
      for (const cls of ["callout-icon", "callout-fold"]) {
        const control = title.createDiv({ cls });
        const svg = new DOMParser().parseFromString(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>',
          "image/svg+xml",
        ).documentElement;
        control.append(svg);
      }
      title.createSpan({ text: line.replace(/^> \[![^\]]+\]\s*/, "") });
    } else if (line.startsWith("> ") && callout) {
      append(callout.createDiv({ cls: "callout-content" }), line.slice(2));
    } else {
      callout = undefined;
      const heading = /^(#{1,6}) (.*)$/.exec(line);
      if (heading)
        root.createEl(`h${heading[1].length}` as "h1", { text: heading[2] });
      else if (line.trim()) append(root.createEl("p"), line);
    }
  }
  return Promise.resolve();
};

async function render(
  kind: "draft" | "literature" | "aastex",
  academic: boolean,
) {
  const body = `## Introduction
Synthetic body preserved.
![Body figure](body.svg)
![Repeated figure](body.svg)
> [!info] Synthetic source callout
> Synthetic callout text preserved.
> ![Callout figure](body.svg)
`;
  const source =
    kind === "literature"
      ? composeLiteratureNoteBody(
          "## My Notes\n\nSynthetic personal writing preserved.\n",
          `${MANAGED_START}\n${body}\n${MANAGED_END}`,
        )
      : `## Abstract\nSynthetic abstract preserved.\n![Abstract figure](abstract.svg)\n${body}`;
  const text = `---
title: Synthetic export contract
stratum_publish:
  authors:
    - name: Alex Example
      email: alex@example.org
      affiliations: [Example University]
---
${source}`;
  const preferences = readNotePreferences({
    documentType: academic ? "academic" : "general",
    pdf: { titleSource: "properties", bodyFont: "", titleFont: "" },
  });
  const signal = new AbortController().signal;
  const result =
    kind === "aastex"
      ? await renderAastexPublication(
          app as never,
          { diagnose: () => Promise.resolve([]) } as never,
          text,
          "Papers/Synthetic.md",
          "Synthetic export contract",
          preferences,
          signal,
        ).then((result) => ({
          ...result,
          abstractHtml: result.aastex.abstractHtml,
        }))
      : await renderPublication(
          app as never,
          text,
          "Papers/Synthetic.md",
          "Synthetic export contract",
          undefined,
          signal,
          preferences,
        ).then((result) => ({ ...result, abstractHtml: "" }));
  return {
    html: result.html,
    abstractHtml: result.abstractHtml,
    assets: result.assets.map((asset) => ({
      name: asset.name,
      bytes: Array.from(new Uint8Array(asset.bytes)),
    })),
  };
}
Object.assign(window, {
  exportFixture: {
    render,
    async unsupportedInlineSvg() {
      unexpectedSvg = true;
      try {
        await render("draft", false);
        return "Unexpectedly accepted inline SVG";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        unexpectedSvg = false;
      }
    },
  },
});
