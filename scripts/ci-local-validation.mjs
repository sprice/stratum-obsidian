import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, lstat, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const receiptFile = ".ci-local-validation.json";

// Git enumerates the source snapshot, including new files before they are staged.
// Only hashes leave this machine; no paths, environment, or source are recorded.
export async function sourceDigest(root = process.cwd()) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter((file) => file && file !== receiptFile);
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const path = resolve(root, file);
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      // Missing tracked files must hash identically before and after git add -u.
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const symlink = stat.isSymbolicLink();
    const contents = symlink
      ? Buffer.from(await readlink(path))
      : await readFile(path);
    hash.update(JSON.stringify([file, symlink, contents.length]));
    hash.update(contents);
  }
  return hash.digest("hex");
}

export async function hasLocalValidation(root = process.cwd()) {
  try {
    const receipt = JSON.parse(
      await readFile(resolve(root, receiptFile), "utf8"),
    );
    return (
      receipt?.version === 1 && receipt.sha256 === (await sourceDigest(root))
    );
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function recordLocalValidation(before, root = process.cwd()) {
  const after = await sourceDigest(root);
  if (before !== after)
    throw new Error(
      "Sources changed during validation. Run pnpm ci:check again before recording success.",
    );
  await writeFile(
    resolve(root, receiptFile),
    `${JSON.stringify({ version: 1, sha256: after }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const hit = await hasLocalValidation();
  if (process.env.GITHUB_OUTPUT)
    await writeFile(process.env.GITHUB_OUTPUT, `validated=${hit}\n`, {
      flag: "a",
    });
  console.log(
    hit
      ? "Local validation matches this source snapshot."
      : "No matching local validation; run the checks.",
  );
}
