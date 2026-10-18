import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function inspectPublishingTools(
  env = process.env,
  run = spawnSync,
  platform = process.platform,
) {
  const tools = {
    pandoc: [env.STRATUM_TEST_PANDOC || "pandoc", "--version"],
    tectonic: [env.STRATUM_TEST_TECTONIC || "tectonic", "--version"],
    pdftotext: [env.STRATUM_TEST_PDFTOTEXT || "pdftotext", "-v"],
    chrome: [env.STRATUM_TEST_CHROME, "--version"],
    ...(platform === "linux"
      ? { fonts: ["fc-list", "--format=%{family}:%{style}:%{fontversion}\n"] }
      : {}),
  };
  const outputs = {};
  for (const [name, [executable, argument]] of Object.entries(tools)) {
    if (!executable)
      throw new Error(
        `CI requires STRATUM_TEST_CHROME to point to the configured browser.`,
      );
    try {
      // Poppler prints its version on stderr; capture it without cluttering successful runs.
      const result = run(executable, [argument], {
        encoding: "utf8",
        timeout: 15_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.error || result.status !== 0)
        throw (
          result.error ?? new Error(`Tool exited with status ${result.status}`)
        );
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
      if (name === "fonts" && !result.stdout?.trim())
        throw new Error("No installed fonts");
      outputs[name] =
        name === "fonts" ? output.split("\n").sort().join("\n") : output;
    } catch (error) {
      throw new Error(
        `Required CI publishing dependency ${name} is unavailable: ${executable}`,
        { cause: error },
      );
    }
  }
  return outputs;
}

export function verifyPublishingTools(
  env = process.env,
  run = spawnSync,
  platform = process.platform,
) {
  return Object.fromEntries(
    Object.entries(inspectPublishingTools(env, run, platform)).map(
      ([name, output]) => [
        name,
        output.split("\n")[0] || "Available (no version reported)",
      ],
    ),
  );
}
export function preflight() {
  if (process.env.STRATUM_REQUIRE_PUBLISHING_TOOLS !== "1") return;
  const artifacts = resolve(".test-artifacts/publishing");
  mkdirSync(artifacts, { recursive: true });
  let directory;
  try {
    const versions = verifyPublishingTools();
    directory = mkdtempSync(join(tmpdir(), "stratum-ci-pdf-"));
    writeFileSync(
      join(directory, "paper.md"),
      "# Synthetic CI paper\n\nA test equation: $x^2$.\n",
    );
    execFileSync(
      process.env.STRATUM_TEST_PANDOC || "pandoc",
      [
        "paper.md",
        "--standalone",
        `--pdf-engine=${process.env.STRATUM_TEST_TECTONIC || "tectonic"}`,
        "--output=paper.pdf",
      ],
      { cwd: directory, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    if (
      readFileSync(join(directory, "paper.pdf")).subarray(0, 5).toString() !==
      "%PDF-"
    )
      throw new Error("CI PDF smoke conversion did not produce a PDF.");
    writeFileSync(
      join(artifacts, "tools.json"),
      JSON.stringify(versions, null, 2),
    );
    process.stdout.write(
      "Required publishing tools and real PDF conversion passed.\n",
    );
  } catch (error) {
    writeFileSync(
      join(artifacts, "setup-failure.json"),
      JSON.stringify(
        {
          error: String(error),
          cause: String(error.cause ?? ""),
          stderr: error.stderr?.toString() ?? "",
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  preflight();
