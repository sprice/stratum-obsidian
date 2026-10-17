/** All renderer adapters consume the same closed, package-relative text asset format. */
export function publicationAssetPath(path: string): boolean {
  return (
    /^[a-zA-Z0-9_./-]+$/.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").some((part) => part === ".." || part === "." || !part)
  );
}
export function publicationAssetMap(value: unknown): Record<string, string> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.values(value).every((asset) => typeof asset === "string")
  )
    throw new Error(
      "Publication package assets must be an object of text files.",
    );
  for (const path of Object.keys(value))
    if (!publicationAssetPath(path))
      throw new Error("Invalid publication package asset path.");
  return value as Record<string, string>;
}
