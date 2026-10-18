export interface PublicationPackageReference {
  id: string;
  version: string;
  upstreamVersion: string;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function readPublicationPackageReference(
  value: unknown,
): PublicationPackageReference | undefined {
  const stored = record(value);
  if (
    !["id", "version", "upstreamVersion"].every(
      (key) =>
        typeof stored[key] === "string" &&
        (key === "id"
          ? /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,239}$/
          : /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/
        ).test(stored[key]),
    )
  )
    return undefined;
  return {
    id: stored.id as string,
    version: stored.version as string,
    upstreamVersion: stored.upstreamVersion as string,
  };
}
export function samePublicationPackage(
  left: PublicationPackageReference,
  right: PublicationPackageReference,
): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.upstreamVersion === right.upstreamVersion
  );
}
