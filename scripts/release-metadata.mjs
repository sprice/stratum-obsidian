import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateReleaseMetadata(root = process.cwd(), tag) {
  const read = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8"));
  const pkg = read("package.json");
  const manifest = read("manifest.json");
  const versions = read("versions.json");
  const version = manifest.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Plugin version must be a numeric release version.");
  if (pkg.version !== version || (tag !== undefined && tag !== version))
    throw new Error("Package, manifest, and release tag versions must agree.");
  if (
    !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion) ||
    versions[version] !== manifest.minAppVersion
  )
    throw new Error(
      "versions.json must map this release to manifest.minAppVersion.",
    );
  return version;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  validateReleaseMetadata(process.cwd(), process.argv[2]);
  console.log("Release metadata agrees.");
}
