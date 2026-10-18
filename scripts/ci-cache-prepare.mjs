import { mkdir, readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generatePublicationAssets } from "./publication-assets.mjs";
import { testFiles } from "./ci-test-coverage.mjs";
import { inspectPublishingTools } from "./require-publishing-tools.mjs";

// Hash optional external template resources without recording their paths/content.
async function treeDigest(directory) {
  const hash = createHash("sha256");
  async function visit(path, name = "") {
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error("CI template cache must not contain symlinks.");
    hash.update(JSON.stringify([name, stat.isDirectory()]));
    if (stat.isDirectory()) {
      for (const entry of (await readdir(path)).sort())
        await visit(join(path, entry), `${name}/${entry}`);
    } else
      hash.update(
        createHash("sha256")
          .update(await readFile(path))
          .digest(),
      );
  }
  await visit(directory);
  return hash.digest("hex");
}

export async function publishingFingerprint(
  env,
  run = spawnSync,
  platform = process.platform,
) {
  if (env.STRATUM_REQUIRE_PUBLISHING_TOOLS !== "1")
    throw new Error(
      "Cached publishing checks require STRATUM_REQUIRE_PUBLISHING_TOOLS=1.",
    );
  const outputs = inspectPublishingTools(env, run, platform);
  return createHash("sha256").update(JSON.stringify(outputs)).digest("hex");
}

// Run before any cached check: generated inputs must exist even on a cache hit.
export async function prepareCiCache(
  root = process.cwd(),
  env = process.env,
  fingerprint = publishingFingerprint,
) {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const pnpm = /^pnpm\/([^ ]+)/.exec(env.npm_config_user_agent ?? "")?.[1];
  if (`pnpm@${pnpm}` !== manifest.packageManager)
    throw new Error(`Run pnpm ci:prepare with ${manifest.packageManager}.`);

  await generatePublicationAssets(
    join(root, "src/publication-templates/aastex"),
  );
  const publishing = {
    tools: await fingerprint(env),
    templates: env.STRATUM_TEST_TEMPLATE_CACHE
      ? await treeDigest(env.STRATUM_TEST_TEMPLATE_CACHE)
      : null,
  };
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
  await mkdir(directory, { recursive: true });
  await writeIfChanged(
    join(directory, "publishing.json"),
    `${JSON.stringify(publishing)}\n`,
  );
  await writeIfChanged(join(directory, "environment.json"), contents);
}

async function writeIfChanged(target, contents) {
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
