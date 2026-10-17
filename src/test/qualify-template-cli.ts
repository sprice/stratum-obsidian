import { readFile } from "node:fs/promises";
import path from "node:path";
import { qualifyTemplateInstallation } from "./qualify-template";
import { readTemplateInstallation } from "../publication-installation";

const [directory, cache] = process.argv.slice(2);
if (!directory || !cache)
  throw new Error(
    "Usage: qualify-template.ts <fixture directory> <cache directory>",
  );
const manifest = readTemplateInstallation(
  JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")),
);
const index = JSON.parse(
  await readFile(path.join(directory, "artifacts.json"), "utf8"),
) as Record<string, string>;
const artifacts = new Map<string, Uint8Array>();
for (const [url, name] of Object.entries(index)) {
  if (!/^[a-f0-9]{64}\.bin$/.test(name))
    throw new Error("Invalid qualification artifact path");
  artifacts.set(url, await readFile(path.join(directory, name)));
}
await qualifyTemplateInstallation(manifest, artifacts, cache);
