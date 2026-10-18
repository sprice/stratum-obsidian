import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generatePublicationAssets } from "./publication-assets.mjs";
import { testFiles } from "./ci-test-coverage.mjs";

// Run before any cached check: generated inputs must exist even on a cache hit.
export async function prepareCiCache(root = process.cwd(), env = process.env) {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const pnpm = /^pnpm\/([^ ]+)/.exec(env.npm_config_user_agent ?? "")?.[1];
  if (`pnpm@${pnpm}` !== manifest.packageManager)
    throw new Error(`Run pnpm ci:prepare with ${manifest.packageManager}.`);

  await generatePublicationAssets(
    join(root, "src/publication-templates/aastex"),
  );
  // Only enumerate execution metadata. Never serialize the full environment.
  const contents = `${JSON.stringify(
    {
      node: process.version,
      pnpm,
      platform: process.platform,
      arch: process.arch,
      ci: env.CI ?? "",
      imageOS: env.ImageOS ?? "",
      imageVersion: env.ImageVersion ?? "",
      // New tests outside src/scripts must invalidate the cached selection guard.
      tests: testFiles(root).map((file) =>
        relative(root, file).replaceAll("\\", "/"),
      ),
    },
    null,
    2,
  )}\n`;
  const directory = join(root, ".ci-cache");
  const target = join(directory, "environment.json");
  await mkdir(directory, { recursive: true });
  let previous;
  try {
    previous = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (previous !== contents) await writeFile(target, contents);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await prepareCiCache();
