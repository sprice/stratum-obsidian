import { Platform } from "obsidian";
declare const __STRATUM_TEMPLATE_TEST_CONFIG_PATH__: string;

/** Only the workspace dev helper opts in. No credential is embedded in main.js. */
export function templateTestHeaders(
  origin: string,
  require: (name: string) => unknown,
): Record<string, string> {
  if (!Platform.isDesktop) return {};
  if (
    typeof __STRATUM_TEMPLATE_TEST_CONFIG_PATH__ !== "string" ||
    !__STRATUM_TEMPLATE_TEST_CONFIG_PATH__
  )
    return {};
  try {
    const fs = require("node:fs") as {
      readFileSync(path: string, encoding: "utf8"): string;
    };
    const config = JSON.parse(
      fs.readFileSync(__STRATUM_TEMPLATE_TEST_CONFIG_PATH__, "utf8"),
    ) as { origin?: unknown; secret?: unknown };
    if (
      config.origin === origin &&
      typeof config.secret === "string" &&
      /^[a-f0-9]{64}$/.test(config.secret)
    )
      return { "X-Stratum-Template-Test-Secret": config.secret };
  } catch {
    // Missing or stale local config must never prevent ordinary downloads.
  }
  return {};
}
