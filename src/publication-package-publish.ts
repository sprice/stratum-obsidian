import { TFile, type App } from "obsidian";
import type { CitationService } from "./citation-service";
import { citationDocument } from "./citation-document";
import {
  publicationCitationKeys,
  publicationReferences,
} from "./publication-citations";
import { PACKAGE_IMAGE_LIMITS } from "./publication-package";
import { publicationManuscript } from "./publication-manuscript";
import { preparePublishLinks } from "./publish-document";
import { publishImage } from "./publish-image";
import type { PackagePublication } from "./publication-package-render";

/** Translate host citations and vault images into the neutral engine input. */
export async function preparePackageDocument(
  app: App,
  service: CitationService,
  text: string,
  sourcePath: string,
  titleSource: "body" | "properties",
  signal: AbortSignal,
) {
  const manuscript = publicationManuscript(text, titleSource);
  const keys = publicationCitationKeys(
    manuscript.body + "\n\n" + manuscript.abstract,
  );
  const resolved = await service.diagnose(keys);
  if (resolved.some((s) => s.problem || !s.reference))
    throw new Error(
      "Citation data is unavailable or ambiguous. Review Citations before publishing.",
    );
  const { ids, references } = publicationReferences(
    keys,
    resolved.map((s) => s.reference!),
  );
  const citationGroups: NonNullable<PackagePublication["citationGroups"]> = {};
  let groupIndex = 0;
  const images: Record<string, Uint8Array> = {};
  let imageBytes = 0;
  const imagePaths = new Map<string, string>();
  const image = async (target: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//"))
      throw new Error("Use a vault image instead of a remote image.");
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      /* Literal percent filename. */
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
        "Only vault image embeds are supported. Replace embedded notes or PDFs with images.",
      );
    const previous = imagePaths.get(file.path);
    if (previous) return previous;
    if (
      file.stat.size > PACKAGE_IMAGE_LIMITS.individualBytes ||
      Object.keys(images).length >= PACKAGE_IMAGE_LIMITS.count
    )
      throw new Error("Publishing image limit exceeded.");
    const converted = await publishImage(
      await app.vault.readBinary(file),
      file.extension.toLowerCase(),
      signal,
    );
    imageBytes += converted.bytes.byteLength;
    if (
      converted.bytes.byteLength > PACKAGE_IMAGE_LIMITS.individualBytes ||
      imageBytes > PACKAGE_IMAGE_LIMITS.totalBytes
    )
      throw new Error("Publishing image limit exceeded.");
    const name = `asset-${Object.keys(images).length}.${converted.extension}`;
    images[name] = new Uint8Array(converted.bytes);
    imagePaths.set(file.path, name);
    return name;
  };
  const escape = (s: string) => s.replace(/[\\`*_[\]<>]/g, "\\$&");
  const section = async (markdown: string) => {
    const model = citationDocument(markdown, false);
    if (model.problems.length) throw new Error(model.problems.join("\n"));
    const edits = model.citations.map((c) => {
      const key = `packagecitation${groupIndex++}`;
      citationGroups[key] = c.draft.items.map((item) => {
        const id = ids.get(item.key);
        if (!id) throw new Error("Citation data changed.");
        return {
          id,
          prefix: item.prefix,
          suffix: [
            item.locator ? `${item.label} ${item.locator}` : "",
            item.suffix,
          ]
            .filter(Boolean)
            .join(", "),
          mode: item.suppressAuthor
            ? ("SuppressAuthor" as const)
            : c.draft.narrative
              ? ("AuthorInText" as const)
              : ("NormalCitation" as const),
        };
      });
      return { from: c.from, to: c.to, value: `[@${key}]` };
    });
    edits.push(...model.bibliographies.map((b) => ({ ...b, value: "" })));
    for (const edit of edits.sort((a, b) => b.from - a.from))
      markdown =
        markdown.slice(0, edit.from) + edit.value + markdown.slice(edit.to);
    return preparePublishLinks(markdown, image, {
      text: escape,
      image: (name, alt) => `![${escape(alt)}](${name})`,
    });
  };
  const body = await section(manuscript.body),
    abstract = await section(manuscript.abstract);
  if (signal.aborted) throw new Error("Publishing cancelled.");
  return {
    manuscript: { ...manuscript, body, abstract },
    references,
    citationGroups,
    images,
  };
}
