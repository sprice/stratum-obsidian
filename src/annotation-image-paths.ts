import type { ZoteroItemDetail } from "./backend-types";

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
  return `stratum-${detail.library.type}-${detail.library.id}-${detail.item.key}-${key}.png`;
}

export function validAnnotationImagePath(
  detail: ZoteroItemDetail,
  key: string,
  value: unknown,
): value is string {
  if (typeof value !== "string" || /[\\[\]|\r\n]/.test(value)) return false;
  const parts = value.split("/");
  return (
    !parts.some((part) => part === ".." || part === "." || !part) &&
    parts.at(-2) === "Attachments" &&
    /^[A-Z0-9]{8}$/.test(key) &&
    /^[A-Z0-9]{8}$/.test(detail.item.key) &&
    /^\d+$/.test(detail.library.id) &&
    parts.at(-1) === annotationImageName(detail, key)
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
