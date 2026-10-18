import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { prepareCiCache } from "./ci-cache-prepare.mjs";
import {
  sourceDigest,
  recordLocalValidation,
  receiptFile,
} from "./ci-local-validation.mjs";

const env = {
  ...process.env,
  STRATUM_REQUIRE_PUBLISHING_TOOLS: "1",
  WIREIT_PARALLEL: process.env.WIREIT_PARALLEL ?? "2",
  WIREIT_FAILURES: "continue",
};
if (!env.STRATUM_TEST_CHROME) {
  for (const candidate of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ]) {
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) {
      env.STRATUM_TEST_CHROME = candidate;
      break;
    }
  }
}
// A failed rerun must never leave an older success receipt in place.
if (!process.env.CI) await rm(receiptFile, { force: true });
const before = await sourceDigest();
await prepareCiCache(process.cwd(), env);
const result = spawnSync("pnpm", ["ci:validate"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (!process.env.CI) {
  await recordLocalValidation(before);
  console.log(
    "Recorded local validation. Include .ci-local-validation.json with the changes you push.",
  );
}
