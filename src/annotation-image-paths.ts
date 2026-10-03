import type { ZoteroItemDetail } from "./backend-types";

const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export function annotationImageName(
  detail: ZoteroItemDetail,
  key: string,
): string {
  if (
    !/^[A-Z0-9]{8}$/.test(key) ||
    !/^[A-Z0-9]{8}$/.test(detail.item.key) ||
    !/^\d+$/.test(detail.library.id)
  ) {
    throw new Error("Invalid annotation identity.");
  }
  const words = (detail.item.title ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !TITLE_STOP_WORDS.has(word));
  const slug =
    Array.from(words.slice(-2).join("-"))
      .slice(0, 40)
      .join("")
      .replace(/-+$/, "") || "image";
  return `${slug}-area-${key.toLowerCase()}.png`;
}

export function validAnnotationImagePath(
  detail: ZoteroItemDetail,
  key: string,
  value: unknown,
): value is string {
  if (
    typeof value !== "string" ||
    /[\\[\]|]/.test(value) ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return false;
  const parts = value.split("/");
  return (
    !parts.some((part) => part === ".." || part === "." || !part) &&
    parts.at(-2) === "Attachments" &&
    /^[A-Z0-9]{8}$/.test(key) &&
    /^[A-Z0-9]{8}$/.test(detail.item.key) &&
    /^\d+$/.test(detail.library.id) &&
    new RegExp(
      `^[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*-area-${key.toLowerCase()}(?:-[1-9][0-9]*)?\\.png$`,
      "u",
    ).test(parts.at(-1) ?? "")
  );
}

/** Preserve successful embeds during a refresh that does not fetch images. */
export function withPreservedAnnotationImages(
  detail: ZoteroItemDetail,
  frontmatter: Record<string, unknown>,
): ZoteroItemDetail {
  const stored = frontmatter.stratum_annotation_images;
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    return detail;
  const paths = stored as Record<string, unknown>;
  return {
    ...detail,
    annotations: detail.annotations.map((annotation) => {
      const path = paths[annotation.key];
      return {
        ...annotation,
        ...(annotation.type === "image" &&
        !annotation.imagePath &&
        !annotation.imageMissing &&
        validAnnotationImagePath(detail, annotation.key, path)
          ? { imagePath: path }
          : {}),
      };
    }),
  };
}
