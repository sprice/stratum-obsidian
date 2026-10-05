import { publishImage } from "./publish-image";
import { Component, MarkdownRenderer, TFile, type App } from "obsidian";
import type { FormattedDocument } from "./citation-format";
import { escapeHtml } from "./citation-display";
import {
  hasUnsupportedHtmlMedia,
  preparePublication,
  preparePublishLinks,
} from "./publish-document";
import type { PublishAsset } from "./publish-desktop";

/** Render a captured source in an isolated Reading-view surface, without citation postprocessors. */
export async function renderPublication(
  app: App,
  text: string,
  sourcePath: string,
  title: string,
  result: FormattedDocument | undefined,
  signal: AbortSignal,
): Promise<{ html: string; assets: PublishAsset[] }> {
  const prepared = preparePublication(text, result);
  const assets: PublishAsset[] = [];
  const imagePaths = new Map<string, string>();
  const image = async (target: string): Promise<string> => {
    if (signal.aborted) throw new Error("Publishing cancelled.");
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//"))
      throw new Error(
        "Publishing supports images stored in the vault. Save linked images to the vault before publishing.",
      );
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      /* Obsidian accepts literal percent signs in filenames. */
    }
    const file = app.metadataCache.getFirstLinkpathDest(
      decoded.split("#")[0],
      sourcePath,
    );
    if (
      !(file instanceof TFile) ||
      !/^(png|jpe?g|gif|svg|webp)$/i.test(file.extension)
    )
      throw new Error(
        `An embedded image could not be resolved. Publishing supports PNG, JPEG, GIF, SVG, and WebP images; embedded notes, audio, video, and PDFs are not supported.`,
      );
    const existing = imagePaths.get(file.path);
    if (existing) return existing;
    const asset = await publishImage(
      await app.vault.readBinary(file),
      file.extension.toLowerCase(),
      signal,
    );
    const name = `asset-${assets.length}.${asset.extension}`;
    assets.push({ name, bytes: asset.bytes });
    imagePaths.set(file.path, name);
    return name;
  };
  const owner = new Component();
  owner.load();
  const render = async (markdown: string): Promise<string> => {
    // Markdown image syntax is resolved above; arbitrary HTML media could fetch remote data while rendering.
    if (hasUnsupportedHtmlMedia(markdown))
      throw new Error(
        "Raw HTML media is not supported when publishing. Use Markdown image embeds instead.",
      );
    const linked = await preparePublishLinks(markdown, image);
    const element = createDiv();
    element.addClass("stratum-reference-output");
    await MarkdownRenderer.render(app, linked, element, sourcePath, owner);
    if (signal.aborted) throw new Error("Publishing cancelled.");
    if (
      element.querySelector(
        "canvas, iframe, video, audio, mjx-container, .mermaid, .internal-embed",
      )
    )
      throw new Error(
        "This note contains a rendered block that publishing does not support yet. Replace diagrams, math, or embedded documents with vault images before publishing.",
      );
    for (const anchor of Array.from(
      element.querySelectorAll('a[href^="#stratum-publish-"]'),
    ))
      anchor.setAttribute("epub:type", "noteref");
    // Task state is document content even though its checkbox is a UI control.
    for (const checkbox of Array.from(
      element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ))
      checkbox.replaceWith(checkbox.checked ? "[x] " : "[ ] ");
    element
      .querySelectorAll(
        "button, input, .copy-code-button, .metadata-container, .frontmatter, .heading-collapse-indicator, .collapse-indicator, .footnote-backref",
      )
      .forEach((node) => node.remove());
    for (const placeholder of Array.from(
      element.querySelectorAll(".stratum-publish-image"),
    )) {
      const name = placeholder.getAttribute("data-publish-image") ?? "";
      if (!assets.some((asset) => asset.name === name))
        throw new Error("An image placeholder could not be resolved.");
      const img = createEl("img");
      img.setAttribute("src", name);
      img.setAttribute(
        "alt",
        placeholder.getAttribute("data-publish-alt") ?? "",
      );
      placeholder.replaceWith(img);
    }
    // Prevent conversion from following local/remote resources introduced by another plugin.
    for (const img of Array.from(element.querySelectorAll("img"))) {
      const name = img.getAttribute("src") ?? "";
      if (!assets.some((asset) => asset.name === name))
        throw new Error(
          "A rendered image is not available for publication. Use a vault image embed.",
        );
      img.removeAttribute("srcset");
    }
    element
      .querySelectorAll(
        "script, style, link, iframe, object, embed, audio, video",
      )
      .forEach((node) => node.remove());
    for (const link of Array.from(element.querySelectorAll("a.internal-link")))
      if (!link.hasAttribute("epub:type"))
        link.replaceWith(...Array.from(link.childNodes));
    for (const node of Array.from(element.querySelectorAll("*"))) {
      for (const attr of Array.from(node.attributes))
        if (
          /^on/i.test(attr.name) ||
          ["style", "contenteditable", "srcset"].includes(attr.name)
        )
          node.removeAttribute(attr.name);
    }
    return element.innerHTML;
  };
  try {
    const body = await render(prepared.markdown);
    const notes: string[] = [];
    for (const note of prepared.notes)
      notes.push(
        `<aside epub:type="footnote" id="${note.id}">${await render(note.markdown)}</aside>`,
      );
    const bibliography = prepared.bibliography
      ? `<h2>${prepared.heading}</h2>${prepared.bibliography}`
      : "";
    return {
      html: `<!DOCTYPE html><html xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}${bibliography}${notes.join("")}</body></html>`,
      assets,
    };
  } finally {
    owner.unload();
  }
}
