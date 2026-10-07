import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { loadRuntime } from "./runtime-harness";
import type * as Desktop from "../publish-desktop";
import { DEFAULT_PUBLISH_OPTIONS } from "../publish-options";

const require = createRequire(import.meta.url);
function installedTool(name: string, configured?: string) {
  for (const candidate of [
    configured,
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* Try the next location. */
    }
  }
  return "";
}
const pandoc = installedTool("pandoc", process.env.STRATUM_TEST_PANDOC);
const tectonic = installedTool("tectonic", process.env.STRATUM_TEST_TECTONIC);
test(
  "real PDF engine returns a recoverable font error when discovery fails",
  { skip: !pandoc || !tectonic, timeout: 120_000 },
  async () => {
    let failedScans = 0;
    let conversions = 0;
    const childProcess = {
      ...(require("node:child_process") as typeof import("node:child_process")),
      spawn(
        executable: string,
        args: string[],
        options: Parameters<typeof spawn>[2],
      ) {
        if (/system_profiler|fc-list|powershell/i.test(executable)) {
          failedScans++;
          throw new Error("Synthetic font discovery failure");
        }
        if (executable === pandoc) conversions++;
        return spawn(executable, args, options);
      },
    };
    const desktop = loadRuntime<typeof Desktop>(
      "publish-desktop.ts",
      { Platform: { isDesktopApp: true, isDesktop: true } },
      {
        TextDecoder,
        TextEncoder,
        Uint8Array,
        window: {
          require: (name: string): unknown =>
            name === "node:child_process" ? childProcess : require(name),
          setTimeout,
          clearTimeout,
        },
      },
      "browser",
    );
    const font = "Stratum Nonexistent Test Serif 8c671";
    await assert.rejects(
      desktop.convertPublication(
        "<html><body><p>Synthetic font fallback test.</p></body></html>",
        [],
        "pdf",
        { pandoc, tectonic },
        undefined,
        120_000,
        { ...DEFAULT_PUBLISH_OPTIONS, bodyFont: font },
      ),
      (error: unknown) => {
        assert(error instanceof desktop.PublishFontError, String(error));
        assert.deepEqual([...error.fonts], [font]);
        assert.equal(
          error.message,
          `“${font}” isn’t available on this computer. Choose another font to publish this PDF.`,
        );
        return true;
      },
    );
    assert(failedScans > 0, "Font discovery must actually fail");
    assert.equal(
      conversions,
      1,
      "The real PDF conversion must run instead of preflight rejecting the font",
    );
  },
);
